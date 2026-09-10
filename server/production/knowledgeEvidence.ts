import { createHash } from 'crypto';

export type EvidenceSourceRole = 'TARGET_SITE' | 'REFERENCE' | 'COMPETITOR';

export const evidenceSourceRole = (
  prefix: '[TARGET_SITE]' | '[REFERENCE]' | '[COMPETITOR]'
): EvidenceSourceRole => prefix === '[TARGET_SITE]'
  ? 'TARGET_SITE'
  : prefix === '[REFERENCE]'
    ? 'REFERENCE'
    : 'COMPETITOR';

export const knowledgeSourceIdentity = (input: {
  siteId: string;
  role: EvidenceSourceRole;
  normalizedUrl: string;
  checksum: string;
}): string => createHash('sha256').update([
  input.siteId,
  input.role,
  input.normalizedUrl,
  input.checksum
].join('\n')).digest('hex');

const canonicalEvidence = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(canonicalEvidence)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalEvidence(item)]));
  }
  return value;
};

export const growthEvidenceFingerprint = (input: {
  siteChecksum: string;
  gscEvidence: unknown;
  externalChecksums: string[];
}): string => createHash('sha256').update(JSON.stringify(canonicalEvidence({
  siteChecksum: input.siteChecksum,
  gscEvidence: input.gscEvidence,
  externalChecksums: input.externalChecksums
}))).digest('hex');

export const shouldSkipUnchangedEvidence = (input: {
  scheduled: boolean;
  currentFingerprint: string;
  lastFingerprint: string | null;
  lastEvaluatedAt: Date | null;
  runCreatedAt: Date;
  now?: Date;
  forcedEvaluationDays?: number;
}): boolean => {
  if (!input.scheduled || !input.lastEvaluatedAt || input.lastFingerprint !== input.currentFingerprint) return false;
  if (input.lastEvaluatedAt.getTime() >= input.runCreatedAt.getTime()) return false;
  const age = (input.now || new Date()).getTime() - input.lastEvaluatedAt.getTime();
  return age >= 0 && age < (input.forcedEvaluationDays || 28) * 86_400_000;
};

const plainText = (value: string): string => value
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/\s+/g, ' ')
  .trim();

const tokens = (value: string): Set<string> => new Set(
  value.toLocaleLowerCase().normalize('NFKC').match(/[a-z0-9][a-z0-9-]{1,}|\p{Script=Han}{2,}/gu) || []
);

const overlapScore = (query: Set<string>, value: string): number => {
  const candidate = tokens(value);
  return [...query].reduce((score, token) => score + (candidate.has(token) ? Math.max(1, token.length) : 0), 0);
};

export const selectRelevantSiteEvidence = (
  keyword: string,
  pages: Array<{ title: string; url: string; excerpt?: string; content: string }>,
  maximumPages = 12,
  maximumCharacters = 80_000
): Array<{ title: string; url: string; content: string }> => {
  const query = tokens(keyword);
  const ranked = pages
    .map((page, index) => {
      const text = plainText(page.content);
      const passages = text.split(/(?<=[。！？.!?])\s+|\n+/)
        .map((passage) => passage.trim())
        .filter((passage) => passage.length >= 40)
        .map((passage, passageIndex) => ({ passage, passageIndex, score: overlapScore(query, passage) }))
        .sort((left, right) => right.score - left.score || left.passageIndex - right.passageIndex);
      const selectedPassages = passages.filter(({ score }) => score > 0).slice(0, 10);
      const content = (selectedPassages.length ? selectedPassages : passages.slice(0, 4))
        .map(({ passage }) => passage)
        .join('\n')
        .slice(0, 12_000);
      const score = overlapScore(query, `${page.title} ${page.excerpt || ''}`) * 4
        + overlapScore(query, text);
      return { ...page, content, score, index };
    })
    .filter(({ content }) => content.length > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: Array<{ title: string; url: string; content: string }> = [];
  let usedCharacters = 0;
  for (const page of ranked) {
    if (selected.length >= maximumPages) break;
    const remaining = maximumCharacters - usedCharacters;
    if (remaining < 200) break;
    const content = page.content.slice(0, remaining);
    selected.push({ title: page.title, url: page.url, content });
    usedCharacters += content.length;
  }
  return selected;
};
