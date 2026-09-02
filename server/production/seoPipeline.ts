export type InternalLinkCandidate = { title: string; url: string };

export type ActionQualityReport = {
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  generatedAt: string;
  version: string;
  originality?: { passed: boolean; overlapRatio: number; matchedShingles: number; sourceShingles: number };
};

const semanticTokens = (value: string): Set<string> => {
  const normalized = value.toLocaleLowerCase().normalize('NFKC');
  const tokens = new Set(normalized.match(/[a-z0-9][a-z0-9-]{1,}|\p{Script=Han}{2,}/gu) || []);
  for (const run of normalized.match(/\p{Script=Han}{3,}/gu) || []) {
    for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return tokens;
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
}): ActionQualityReport => {
  const text = normalizedText(input.html);
  const chineseCharacters = (text.match(/\p{Script=Han}/gu) || []).length;
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const headings = (input.html.match(/<h[2-3]\b/gi) || []).length;
  const safeHtml = !/javascript:|data:text\/html|<script\b|on\w+\s*=/i.test(input.html);
  const checks: ActionQualityReport['checks'] = [
    { name: 'ACTIVE_CONTENT', passed: safeHtml },
    { name: 'ORIGINALITY', passed: input.originality?.passed !== false, detail: input.originality ? `overlap=${input.originality.overlapRatio.toFixed(4)}` : 'not-applicable' }
  ];
  if (input.actionType === 'UPDATE_TITLE') {
    checks.push({ name: 'TITLE', passed: input.title.length >= 10 && input.title.length <= 70, detail: `characters=${input.title.length}` });
    checks.push({ name: 'CONTENT_PRESERVED', passed: Boolean(input.beforeHtml) && input.html === input.beforeHtml });
  } else if (input.actionType === 'ADD_INTERNAL_LINKS') {
    checks.push({ name: 'LINKS_INSERTED', passed: (input.insertedInternalLinks || 0) > 0, detail: `inserted=${input.insertedInternalLinks || 0}` });
    checks.push({ name: 'CONTENT_PRESERVED', passed: Boolean(input.beforeHtml) && input.html.startsWith(input.beforeHtml!)});
  } else if (input.actionType === 'ADD_CONTENT_SECTION') {
    const addedLength = input.beforeHtml && input.html.startsWith(input.beforeHtml) ? input.html.length - input.beforeHtml.length : 0;
    checks.push({ name: 'SECTION_ADDED', passed: addedLength >= 300, detail: `addedCharacters=${addedLength}` });
    checks.push({ name: 'CONTENT_PRESERVED', passed: Boolean(input.beforeHtml) && input.html.startsWith(input.beforeHtml!) });
  } else {
    checks.push({ name: 'TITLE', passed: input.title.length >= 10 && input.title.length <= 180 });
    checks.push({ name: 'SUBSTANCE', passed: chineseCharacters >= 800 || words >= 450, detail: `han=${chineseCharacters}, words=${words}` });
    checks.push({ name: 'STRUCTURE', passed: headings >= 2, detail: `headings=${headings}` });
  }
  return {
    passed: checks.every(({ passed }) => passed),
    score: Math.round(checks.filter(({ passed }) => passed).length / checks.length * 100),
    checks,
    generatedAt: new Date().toISOString(),
    version: 'action-quality-gate-2',
    originality: input.originality
  };
};
