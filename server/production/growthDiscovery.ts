import { createHash } from 'crypto';
import sanitizeHtml from 'sanitize-html';
import type { KeywordMetrics, KeywordDiscoveryCandidate } from './providers';
import { scoreSearchOpportunity, type SearchOpportunityScore } from './growthPolicy';
import type { WordPressSitePage } from './wordpress';

const plainText = (value: string): string => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
  .toLocaleLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokens = (value: string): Set<string> => {
  const normalized = plainText(value);
  const result = new Set(normalized.match(/[a-z0-9][a-z0-9-]{1,}|\p{Script=Han}{2,}/gu) || []);
  for (const run of normalized.match(/\p{Script=Han}{3,}/gu) || []) {
    for (let index = 0; index < run.length - 1; index += 1) result.add(run.slice(index, index + 2));
  }
  return result;
};

const tokenCoverage = (needle: string, haystack: string): number => {
  const expected = [...tokens(needle)];
  if (!expected.length) return 0;
  const actual = tokens(haystack);
  return expected.filter((token) => actual.has(token)).length / expected.length;
};

export type CannibalizationMatch = {
  page: WordPressSitePage;
  score: number;
  risk: number;
};

export const findCannibalizationMatch = (
  keyword: string,
  pages: WordPressSitePage[]
): CannibalizationMatch | undefined => {
  const ranked = pages
    .filter(({ resourceType }) => resourceType === 'posts' || resourceType === 'pages')
    .map((page) => {
      const titleScore = tokenCoverage(keyword, page.title + ' ' + page.slug);
      const bodyScore = tokenCoverage(keyword, page.content.slice(0, 8_000));
      const score = titleScore * 0.75 + bodyScore * 0.25;
      return { page, score, risk: Math.min(1, titleScore * 0.8 + bodyScore * 0.4) };
    })
    .sort((left, right) => right.score - left.score || left.page.url.localeCompare(right.page.url));
  return ranked[0]?.score >= 0.5 ? ranked[0] : undefined;
};

export const contentCoverageScore = (keyword: string, page: WordPressSitePage): number => {
  const title = tokenCoverage(keyword, page.title + ' ' + page.slug);
  const body = tokenCoverage(keyword, page.content);
  return Math.min(1, title * 0.45 + body * 0.55);
};

export const businessRelevanceScore = (keyword: string, seedKeyword: string, businessCorpus: string): number => {
  const corpusFit = tokenCoverage(keyword, businessCorpus);
  const seedFit = Math.max(tokenCoverage(keyword, seedKeyword), tokenCoverage(seedKeyword, keyword));
  return Math.min(1, corpusFit * 0.65 + seedFit * 0.35);
};

export const siteTopicFitScore = (keyword: string, pages: WordPressSitePage[], fallbackCorpus = ''): number => {
  if (!pages.length) return tokenCoverage(keyword, fallbackCorpus);
  let best = 0;
  for (const page of pages) {
    best = Math.max(best, tokenCoverage(keyword, page.title + ' ' + page.excerpt + ' ' + page.content.slice(0, 4_000)));
  }
  return Math.min(1,
    best * 0.7
    + tokenCoverage(keyword, pages.slice(0, 20).map(({ title }) => title).join(' ')) * 0.2
    + tokenCoverage(keyword, fallbackCorpus) * 0.1
  );
};

export type ScoredKeywordCandidate = {
  discovery: KeywordDiscoveryCandidate;
  metrics: KeywordMetrics;
  score: SearchOpportunityScore;
  target: CannibalizationMatch | undefined;
  sourceKey: string;
};

export const scoreKeywordCandidate = (input: {
  discovery: KeywordDiscoveryCandidate;
  metrics: KeywordMetrics;
  seedKeyword: string;
  businessCorpus: string;
  pages: WordPressSitePage[];
}): ScoredKeywordCandidate => {
  const target = findCannibalizationMatch(input.discovery.keyword, input.pages);
  const businessRelevance = businessRelevanceScore(input.discovery.keyword, input.seedKeyword, input.businessCorpus);
  const siteTopicFit = siteTopicFitScore(input.discovery.keyword, input.pages, input.businessCorpus);
  const score = scoreSearchOpportunity({
    searchVolume: input.metrics.searchVolume,
    keywordDifficulty: input.metrics.keywordDifficulty,
    allintitleCount: input.metrics.allintitleCount,
    hasSerpEvidence: input.metrics.serpEvidenceCount > 0,
    businessRelevance,
    intentProbability: input.discovery.intentProbability,
    siteTopicFit,
    existingRank: input.discovery.rank,
    sourceCount: input.discovery.sources.length + 1,
    cannibalizationRisk: target && target.score < 0.72 ? target.risk : 0
  });
  const sourceKey = 'candidate:' + createHash('sha256')
    .update(input.discovery.keyword.toLocaleLowerCase().normalize('NFKC'))
    .digest('hex')
    .slice(0, 24);
  return { discovery: input.discovery, metrics: input.metrics, score, target, sourceKey };
};

export const applyObservedActionMultiplier = (
  expectedValueMicros: bigint,
  samples: Array<{ outcome: 'WIN' | 'NEUTRAL' | 'LOSS' | 'INCONCLUSIVE' | 'NOT_READY' }>
): bigint => {
  const evaluated = samples.filter(({ outcome }) => outcome === 'WIN' || outcome === 'NEUTRAL' || outcome === 'LOSS');
  if (evaluated.length < 3) return expectedValueMicros;
  const value = evaluated.reduce((sum, { outcome }) => sum + (outcome === 'WIN' ? 1 : outcome === 'LOSS' ? -1 : 0), 0);
  const multiplierMicros = BigInt(Math.max(750_000, Math.min(1_250_000, 1_000_000 + value * 50_000)));
  return expectedValueMicros * multiplierMicros / 1_000_000n;
};
