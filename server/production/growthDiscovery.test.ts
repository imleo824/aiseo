import { describe, expect, it } from 'vitest';
import { applyObservedActionMultiplier, findCannibalizationMatch, scoreKeywordCandidate } from './growthDiscovery';
import type { WordPressSitePage } from './wordpress';

const page = (overrides: Partial<WordPressSitePage> = {}): WordPressSitePage => ({
  wordpressId: '1', resourceType: 'posts', url: 'https://example.com/wordpress-seo', slug: 'wordpress-seo',
  status: 'publish', title: 'WordPress SEO Guide', excerpt: 'Practical WordPress SEO guidance',
  content: '<h2>WordPress SEO</h2><p>Technical search optimization and content guidance.</p>',
  contentChecksum: 'a'.repeat(64), wordCount: 12, internalLinks: [], seoMetadata: {}, ...overrides
});

describe('site-wide growth discovery', () => {
  it('uses the full page inventory to prevent duplicate topic creation', () => {
    expect(findCannibalizationMatch('WordPress SEO', [page(), page({ wordpressId: '2', url: 'https://example.com/jobs', title: 'Careers', slug: 'jobs' })])?.page.url)
      .toBe('https://example.com/wordpress-seo');
    expect(findCannibalizationMatch('enterprise payroll', [page()])).toBeUndefined();
  });

  it('fails closed on weak business fit and qualifies evidence-backed relevant demand', () => {
    const shared = {
      metrics: { keyword: 'WordPress SEO', searchVolume: 800, keywordDifficulty: 35, allintitleCount: 120, serp: {}, serpEvidenceCount: 10, fetchedAt: '2026-09-05T00:00:00.000Z' },
      seedKeyword: 'WordPress SEO', pages: [page()]
    };
    const relevant = scoreKeywordCandidate({
      ...shared,
      discovery: { keyword: 'WordPress SEO', searchVolume: 800, keywordDifficulty: 35, intent: 'informational', intentProbability: 0.9, rank: 15, rankingUrl: page().url, sources: ['SITE_RANKED_KEYWORDS', 'SEARCH_INTENT'] },
      businessCorpus: 'WordPress SEO services and technical search optimization'
    });
    const unrelated = scoreKeywordCandidate({
      ...shared,
      discovery: { keyword: 'luxury cruise deals', searchVolume: 800, keywordDifficulty: 35, intent: 'commercial', intentProbability: 0.9, rank: null, rankingUrl: null, sources: ['KEYWORD_SUGGESTIONS'] },
      metrics: { ...shared.metrics, keyword: 'luxury cruise deals' },
      businessCorpus: 'WordPress SEO services and technical search optimization'
    });
    expect(relevant.score.qualified).toBe(true);
    expect(unrelated.score.qualified).toBe(false);
    expect(unrelated.score.reason).toContain('业务相关性');
  });

  it('can qualify a new site from verified homepage business context without inventing page history', () => {
    const candidate = scoreKeywordCandidate({
      discovery: { keyword: 'WordPress SEO', searchVolume: 500, keywordDifficulty: 30, intent: 'commercial', intentProbability: 0.9, rank: null, rankingUrl: null, sources: ['KEYWORD_SUGGESTIONS', 'SEARCH_INTENT'] },
      metrics: { keyword: 'WordPress SEO', searchVolume: 500, keywordDifficulty: 30, allintitleCount: 90, serp: {}, serpEvidenceCount: 10, fetchedAt: '2026-09-05T00:00:00.000Z' },
      seedKeyword: 'WordPress SEO',
      businessCorpus: 'We provide WordPress SEO audits and technical search optimization.',
      pages: []
    });
    expect(candidate.target).toBeUndefined();
    expect(candidate.score.siteFitMicros).toBeGreaterThanOrEqual(200_000n);
    expect(candidate.score.qualified).toBe(true);
  });

  it('learns cautiously only after at least three evaluated samples', () => {
    expect(applyObservedActionMultiplier(1_000_000n, [{ outcome: 'WIN' }, { outcome: 'WIN' }])).toBe(1_000_000n);
    expect(applyObservedActionMultiplier(1_000_000n, [{ outcome: 'WIN' }, { outcome: 'WIN' }, { outcome: 'WIN' }])).toBe(1_150_000n);
    expect(applyObservedActionMultiplier(1_000_000n, [{ outcome: 'LOSS' }, { outcome: 'LOSS' }, { outcome: 'LOSS' }])).toBe(850_000n);
  });
});
