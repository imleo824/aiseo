import { describe, expect, it } from 'vitest';
import { selectRelevantInternalLinks } from './seoPipeline';

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
