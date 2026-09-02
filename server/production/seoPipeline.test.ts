import { describe, expect, it } from 'vitest';
import { assessSourceOriginality, deterministicActionQualityGate, selectRelevantInternalLinks } from './seoPipeline';

describe('selectRelevantInternalLinks', () => {
  it('selects only relevant, stable internal links', () => {
    const links = [
      { title: 'WordPress SEO 技术优化指南', url: 'https://example.com/wordpress-seo' },
      { title: '公司招聘信息', url: 'https://example.com/jobs' },
      { title: 'SEO 内容策略实战', url: 'https://example.com/content-seo' }
    ];
    expect(selectRelevantInternalLinks('WordPress SEO', 'WordPress 内容优化', links)).toEqual([links[0], links[2]]);
  });

  it('does not insert unrelated links to fill a quota', () => {
    expect(selectRelevantInternalLinks('企业数据库', 'Postgres 性能优化', [
      { title: '品牌招聘', url: 'https://example.com/jobs' }
    ])).toEqual([]);
  });
});

describe('content safety gates', () => {
  it('blocks substantial verbatim reuse from reference sources', () => {
    const copied = Array.from({ length: 40 }, (_, index) => `evidence grounded sentence number ${index}`).join(' ');
    expect(assessSourceOriginality(copied, copied)).toMatchObject({ passed: false, overlapRatio: 1 });
    expect(assessSourceOriginality('A completely independent explanation of database indexing.', copied).passed).toBe(true);
  });

  it('uses action-specific quality requirements without rewriting untouched content', () => {
    const original = '<article><h2>Existing section</h2><p>Original customer content remains unchanged.</p></article>';
    expect(deterministicActionQualityGate({ actionType: 'UPDATE_TITLE', title: 'A Better Existing Page Title', html: original, beforeHtml: original }).passed).toBe(true);
    expect(deterministicActionQualityGate({ actionType: 'UPDATE_TITLE', title: 'Changed title', html: `${original}<p>unexpected rewrite</p>`, beforeHtml: original }).passed).toBe(false);
    expect(deterministicActionQualityGate({ actionType: 'ADD_INTERNAL_LINKS', title: 'Existing Page Title', html: `${original}<section><a href="https://example.com/related">Related</a></section>`, beforeHtml: original, insertedInternalLinks: 1 }).passed).toBe(true);
  });
});
