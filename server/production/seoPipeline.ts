export type InternalLinkCandidate = { title: string; url: string };

export type ActionQualityReport = {
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  generatedAt: string;
  version: string;
  originality?: { passed: boolean; overlapRatio: number; matchedShingles: number; sourceShingles: number };
  siteDuplication?: { passed: boolean; overlapRatio: number; matchedShingles: number; sourceShingles: number };
};

const semanticTokens = (value: string): Set<string> => {
  const normalized = value.toLocaleLowerCase().normalize('NFKC');
  const tokens = new Set(normalized.match(/[a-z0-9][a-z0-9-]{1,}|\p{Script=Han}{2,}/gu) || []);
  for (const run of normalized.match(/\p{Script=Han}{3,}/gu) || []) {
    for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return tokens;
};
const semanticRetention = (before: string, after: string): number => {
  const beforeTokens = semanticTokens(normalizedText(before));
  const afterTokens = semanticTokens(normalizedText(after));
  if (!beforeTokens.size || !afterTokens.size) return 0;
  let retained = 0;
  for (const token of beforeTokens) if (afterTokens.has(token)) retained += 1;
  return retained / Math.min(beforeTokens.size, afterTokens.size);
};
export const selectRelevantInternalLinks = (
  keyword: string,
  articleTitle: string,
  candidates: InternalLinkCandidate[],
  limit = 3
): InternalLinkCandidate[] => {
  const intent = semanticTokens(`${keyword} ${articleTitle}`);
  return candidates
    .map((candidate, index) => {
      const titleTokens = semanticTokens(candidate.title);
      const score = [...titleTokens].reduce((total, token) => total + (intent.has(token) ? Math.max(1, token.length) : 0), 0);
      return { candidate, index, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ candidate }) => candidate);
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const insertContextualInternalLinks = (
  html: string,
  candidates: InternalLinkCandidate[],
  limit = 3
): { html: string; inserted: InternalLinkCandidate[] } => {
  let result = html;
  const inserted: InternalLinkCandidate[] = [];
  for (const candidate of candidates.slice(0, Math.max(0, limit))) {
    if (result.includes('href="' + candidate.url + '"') || result.includes("href='" + candidate.url + "'")) continue;
    const paragraphs = [...result.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
    const titleTokens = semanticTokens(candidate.title);
    let best: RegExpMatchArray | undefined;
    let bestScore = 0;
    for (const paragraph of paragraphs) {
      const paragraphTokens = semanticTokens(normalizedText(paragraph[1]));
      const score = [...titleTokens].reduce((sum, token) => sum + (paragraphTokens.has(token) ? 1 : 0), 0);
      if (score > bestScore) {
        best = paragraph;
        bestScore = score;
      }
    }
    if (!best?.[0] || typeof best.index !== 'number') continue;
    const sentence = ' 更多信息可参阅<a href="' + escapeHtml(candidate.url) + '" rel="noopener">' + escapeHtml(candidate.title) + '</a>。';
    const replacement = best[0].replace(/<\/p>$/i, sentence + '</p>');
    result = result.slice(0, best.index) + replacement + result.slice(best.index + best[0].length);
    inserted.push(candidate);
  }
  return { html: result, inserted };
};

const normalizedText = (value: string): string => value
  .toLocaleLowerCase()
  .normalize('NFKC')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const shingles = (value: string): Set<string> => {
  const text = normalizedText(value);
  const words = text.split(' ').filter(Boolean);
  const result = new Set<string>();
  if (words.length >= 8) {
    for (let index = 0; index <= words.length - 8; index += 1) result.add(words.slice(index, index + 8).join(' '));
  }
  const han = (text.match(/\p{Script=Han}/gu) || []).join('');
  for (let index = 0; index <= han.length - 16; index += 1) result.add(han.slice(index, index + 16));
  return result;
};

export const assessSourceOriginality = (generated: string, source: string): { passed: boolean; overlapRatio: number; matchedShingles: number; sourceShingles: number } => {
  const generatedShingles = shingles(generated);
  const sourceShingles = shingles(source);
  if (!generatedShingles.size || !sourceShingles.size) return { passed: true, overlapRatio: 0, matchedShingles: 0, sourceShingles: sourceShingles.size };
  let matchedShingles = 0;
  for (const shingle of generatedShingles) if (sourceShingles.has(shingle)) matchedShingles += 1;
  const overlapRatio = matchedShingles / Math.min(generatedShingles.size, sourceShingles.size);
  return { passed: overlapRatio <= 0.15, overlapRatio, matchedShingles, sourceShingles: sourceShingles.size };
};

export const deterministicActionQualityGate = (input: {
  actionType: 'UPDATE_TITLE' | 'ADD_INTERNAL_LINKS' | 'CONTENT_REFRESH' | 'ADD_CONTENT_SECTION' | 'CREATE_CONTENT';
  title: string;
  html: string;
  beforeHtml?: string;
  insertedInternalLinks?: number;
  originality?: ReturnType<typeof assessSourceOriginality>;
  siteDuplication?: ReturnType<typeof assessSourceOriginality>;
  requiredTopics?: string[];
  declaredCoveredTopics?: string[];
  claimSources?: Array<{ claim: string; sourceTitle: string }>;
  allowedSourceTitles?: string[];
  forbiddenClaims?: string[];
}): ActionQualityReport => {
  const text = normalizedText(input.html);
  const headings = (input.html.match(/<h[2-3]\b/gi) || []).length;
  const safeHtml = !/javascript:|data:text\/html|<script\b|on\w+\s*=/i.test(input.html);
  const requiredTopics = input.requiredTopics || [];
  const declaredCovered = new Set((input.declaredCoveredTopics || []).map((topic) => normalizedText(topic)));
  const coveredTopics = requiredTopics.filter((topic) => {
    const normalized = normalizedText(topic);
    if (declaredCovered.has(normalized)) return true;
    const topicTokens = [...semanticTokens(topic)];
    return topicTokens.length > 0 && topicTokens.filter((token) => text.includes(token)).length / topicTokens.length >= 0.6;
  });
  const allowedSources = new Set((input.allowedSourceTitles || []).map((title) => normalizedText(title)));
  const invalidClaimSources = (input.claimSources || []).filter(({ sourceTitle }) => !allowedSources.has(normalizedText(sourceTitle)));
  const forbiddenHits = (input.forbiddenClaims || []).filter((claim) => {
    const normalized = normalizedText(claim);
    return normalized.length >= 6 && text.includes(normalized);
  });
  const checks: ActionQualityReport['checks'] = [
    { name: 'ACTIVE_CONTENT', passed: safeHtml },
    { name: 'SOURCE_ORIGINALITY', passed: input.originality?.passed !== false, detail: input.originality ? 'overlap=' + input.originality.overlapRatio.toFixed(4) : 'not-applicable' },
    { name: 'SITE_DUPLICATION', passed: !input.siteDuplication || input.siteDuplication.overlapRatio <= 0.35, detail: input.siteDuplication ? 'overlap=' + input.siteDuplication.overlapRatio.toFixed(4) : 'not-applicable' },
    { name: 'SOURCE_TRACEABILITY', passed: invalidClaimSources.length === 0, detail: 'invalidSources=' + invalidClaimSources.length },
    { name: 'FORBIDDEN_CLAIMS', passed: forbiddenHits.length === 0, detail: 'matches=' + forbiddenHits.length }
  ];
  if (input.actionType === 'UPDATE_TITLE') {
    checks.push({ name: 'TITLE', passed: input.title.length >= 10 && input.title.length <= 70, detail: `characters=${input.title.length}` });
    checks.push({ name: 'CONTENT_PRESERVED', passed: Boolean(input.beforeHtml) && input.html === input.beforeHtml });
  } else if (input.actionType === 'ADD_INTERNAL_LINKS') {
    const withoutAddedLinks = input.html.replace(/\s*更多信息可参阅<a\b[^>]*>[\s\S]*?<\/a>。/gi, '');
    checks.push({ name: 'LINKS_INSERTED', passed: (input.insertedInternalLinks || 0) > 0, detail: `inserted=${input.insertedInternalLinks || 0}` });
    checks.push({ name: 'CONTENT_PRESERVED', passed: Boolean(input.beforeHtml) && withoutAddedLinks === input.beforeHtml });
  } else if (input.actionType === 'ADD_CONTENT_SECTION') {
    const addedLength = input.beforeHtml && input.html.startsWith(input.beforeHtml) ? input.html.length - input.beforeHtml.length : 0;
    checks.push({ name: 'SECTION_ADDED', passed: addedLength >= 100, detail: 'addedCharacters=' + addedLength });
    checks.push({ name: 'CONTENT_PRESERVED', passed: Boolean(input.beforeHtml) && input.html.startsWith(input.beforeHtml!) });
  } else if (input.actionType === 'CONTENT_REFRESH') {
    const retention = input.beforeHtml ? semanticRetention(input.beforeHtml, input.html) : 0;
    checks.push({ name: 'CONTENT_CHANGED', passed: Boolean(input.beforeHtml) && input.html !== input.beforeHtml });
    checks.push({ name: 'TOPIC_RETENTION', passed: retention >= 0.35, detail: 'retention=' + retention.toFixed(4) });
    checks.push({ name: 'TITLE', passed: input.title.length >= 10 && input.title.length <= 180 });
    checks.push({ name: 'INTENT_COVERAGE', passed: requiredTopics.length >= 2 && coveredTopics.length / requiredTopics.length >= 0.8, detail: 'covered=' + coveredTopics.length + '/' + requiredTopics.length });
    checks.push({ name: 'STRUCTURE', passed: headings >= 1, detail: 'headings=' + headings });
    checks.push({ name: 'USEFUL_CONTENT', passed: text.length >= 100, detail: 'characters=' + text.length + '; fixed-word-count-rule=false' });
  } else {
    checks.push({ name: 'TITLE', passed: input.title.length >= 10 && input.title.length <= 180 });
    checks.push({ name: 'INTENT_COVERAGE', passed: requiredTopics.length >= 2 && coveredTopics.length / requiredTopics.length >= 0.8, detail: 'covered=' + coveredTopics.length + '/' + requiredTopics.length });
    checks.push({ name: 'STRUCTURE', passed: headings >= 1, detail: 'headings=' + headings });
    checks.push({ name: 'USEFUL_CONTENT', passed: text.length >= 100, detail: 'characters=' + text.length + '; fixed-word-count-rule=false' });
  }
  return {
    passed: checks.every(({ passed }) => passed),
    score: Math.round(checks.filter(({ passed }) => passed).length / checks.length * 100),
    checks,
    generatedAt: new Date().toISOString(),
    version: 'quality-gate-3',
    originality: input.originality,
    siteDuplication: input.siteDuplication
  };
};
