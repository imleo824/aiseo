import type { ArticleDraft, QualityGateResult } from '../../src/types/seo';

const plainText = (html: string): string => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const shingles = (text: string): Set<string> => {
  const normalized = plainText(text).toLocaleLowerCase();
  const latinTokens = normalized.match(/[\p{L}\p{N}]{3,}/gu) || [];
  const han = normalized.match(/\p{Script=Han}/gu) || [];
  const hanTrigrams = Array.from({ length: Math.max(0, han.length - 2) }, (_, index) => han.slice(index, index + 3).join(''));
  return new Set([...latinTokens, ...hanTrigrams]);
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
};

/**
 * Applies checks that an LLM cannot truthfully self-certify: minimum useful
 * structure and similarity against already published pages in this workspace.
 */
export const applySiteContentQualityGate = (
  modelGate: QualityGateResult,
  contentHtml: string,
  publishedDrafts: ArticleDraft[]
): QualityGateResult => {
  const text = plainText(contentHtml);
  const headingCount = (contentHtml.match(/<h[2-3]\b/gi) || []).length;
  const hasSubstance = text.length >= 800;
  const hasStructure = headingCount >= 2;
  const candidate = shingles(contentHtml);
  const maxSimilarity = publishedDrafts.reduce(
    (maximum, draft) => Math.max(maximum, jaccardSimilarity(candidate, shingles(draft.contentHtml))),
    0
  );
  const duplicateContentCheck = maxSimilarity < 0.82;
  const issues = [...(modelGate.issues || [])];
  const passedChecks = [...(modelGate.passedChecks || [])];

  if (!hasSubstance) issues.push('正文有效文本少于 800 字符，不能作为可发布的深度内容。');
  else passedChecks.push('正文长度达到自动发布下限');
  if (!hasStructure) issues.push('正文缺少至少两个 H2/H3 小节，无法形成可扫描的内容结构。');
  else passedChecks.push('语义标题结构完整');
  if (!duplicateContentCheck) issues.push(`与已发布站内内容的词组重合度为 ${(maxSimilarity * 100).toFixed(0)}%，自动发布已阻止。`);
  else passedChecks.push('通过站内已发布内容重复度检查');

  return {
    ...modelGate,
    passed: Boolean(modelGate.passed && hasSubstance && hasStructure && duplicateContentCheck),
    duplicateContentCheck,
    issues: [...new Set(issues)],
    passedChecks: [...new Set(passedChecks)]
  };
};
