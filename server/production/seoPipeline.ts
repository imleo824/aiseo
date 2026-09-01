export type InternalLinkCandidate = { title: string; url: string };

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
