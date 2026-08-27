import type { ArticleDraft } from '../../src/types/seo';

export type InternalLinkDecision = {
  status: 'INSERTED' | 'SKIPPED';
  message: string;
  targetUrl?: string;
  targetTitle?: string;
  relevanceScore?: number;
};

const englishStopWords = new Set([
  'about', 'after', 'best', 'content', 'from', 'guide', 'into', 'more', 'page',
  'pages', 'site', 'that', 'the', 'this', 'with', 'your'
]);

const chineseStopTerms = new Set([
  '什么', '如何', '以及', '最佳', '完整', '实战', '指南', '方法', '内容', '网站', '站点', '文章', '企业'
]);

const htmlEscape = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const hostWithoutWww = (value: string): string => value.toLowerCase().replace(/^www\./, '');

const isSameSiteUrl = (publishedUrl: string, siteDomain: string): boolean => {
  try {
    return hostWithoutWww(new URL(publishedUrl).hostname) === hostWithoutWww(siteDomain);
  } catch {
    return false;
  }
};

/**
 * Chinese has no whitespace word boundaries, so use meaningful character
 * bigrams alongside Latin terms. This is deliberately conservative: a link is
 * useful for users and crawlers only when the candidate page shares a topic,
 * not merely because it happens to be the first published post.
 */
export const semanticTerms = (value: string): Set<string> => {
  const normalized = value
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .toLocaleLowerCase();
  const english = (normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) || [])
    .filter((term) => !englishStopWords.has(term));
  const han = normalized.match(/\p{Script=Han}/gu) || [];
  const hanBigrams = Array.from({ length: Math.max(0, han.length - 1) }, (_, index) => han.slice(index, index + 2).join(''))
    .filter((term) => !chineseStopTerms.has(term));
  return new Set([...english, ...hanBigrams]);
};

const overlapScore = (source: Set<string>, target: Set<string>): { score: number; shared: number } => {
  if (!source.size || !target.size) return { score: 0, shared: 0 };
  let shared = 0;
  for (const term of source) if (target.has(term)) shared += 1;
  return { score: (2 * shared) / (source.size + target.size), shared };
};

const relatedLinkMarkup = (title: string, targetUrl: string): string =>
  `<aside><p><strong>延伸阅读：</strong><a href="${htmlEscape(targetUrl)}">${htmlEscape(title)}</a></p></aside>`;

export const weaveRelevantInternalLink = (input: {
  contentHtml: string;
  articleTitle: string;
  targetKeyword: string;
  siteDomain: string;
  publishedDrafts: ArticleDraft[];
}): { contentHtml: string; decision: InternalLinkDecision } => {
  const sourceTerms = semanticTerms(`${input.articleTitle} ${input.targetKeyword}`);
  const candidates = input.publishedDrafts.filter((draft) =>
    Boolean(draft.publishedUrl) && isSameSiteUrl(draft.publishedUrl!, input.siteDomain)
  );

  if (!candidates.length) {
    return {
      contentHtml: input.contentHtml,
      decision: { status: 'SKIPPED', message: '没有同站点、已发布且可验证的内链目标，已跳过。' }
    };
  }

  const ranked = candidates
    .map((draft) => ({
      draft,
      ...overlapScore(sourceTerms, semanticTerms(`${draft.title} ${draft.summary || ''}`))
    }))
    .sort((left, right) => right.score - left.score || right.shared - left.shared);
  const best = ranked[0];

  // A single short generic phrase is too weak a signal. The lower score is
  // enough for a focused English exact term, while Chinese needs two shared
  // bigrams to avoid linking on coincidental characters.
  const sourceHasHan = /\p{Script=Han}/u.test(`${input.articleTitle} ${input.targetKeyword}`);
  const minimumShared = sourceHasHan ? 2 : 1;
  if (!best || best.shared < minimumShared || best.score < 0.12) {
    return {
      contentHtml: input.contentHtml,
      decision: { status: 'SKIPPED', message: '没有语义相关的已发布站内页面，未插入无关内链。' }
    };
  }

  const targetUrl = best.draft.publishedUrl!;
  if (input.contentHtml.includes(targetUrl)) {
    return {
      contentHtml: input.contentHtml,
      decision: {
        status: 'SKIPPED',
        message: `正文已经包含《${best.draft.title}》的站内链接，未重复插入。`,
        targetUrl,
        targetTitle: best.draft.title,
        relevanceScore: best.score
      }
    };
  }

  return {
    contentHtml: `${input.contentHtml}${relatedLinkMarkup(best.draft.title, targetUrl)}`,
    decision: {
      status: 'INSERTED',
      message: `已插入与主题相关的站内链接：《${best.draft.title}》。`,
      targetUrl,
      targetTitle: best.draft.title,
      relevanceScore: best.score
    }
  };
};
