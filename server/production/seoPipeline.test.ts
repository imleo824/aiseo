import { describe, expect, it } from 'vitest';
import { applyVerifiedLocalHtmlPatch, assessSourceOriginality, deterministicActionQualityGate, insertContextualInternalLinks, selectRelevantInternalLinks } from './seoPipeline';

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
    const linked = insertContextualInternalLinks(original, [{ title: 'Original customer content', url: 'https://example.com/related' }]);
    expect(linked.inserted).toHaveLength(1);
    expect(linked.html).toContain('<a href="https://example.com/related" rel="noopener">Original customer content</a>');
    expect(linked.html).not.toContain('更多信息可参阅');
    expect(deterministicActionQualityGate({ actionType: 'ADD_INTERNAL_LINKS', title: 'Existing Page Title', html: linked.html, beforeHtml: original, insertedInternalLinks: linked.inserted.length, allowedLinkUrls: ['https://example.com/related'] }).passed).toBe(true);
    expect(deterministicActionQualityGate({ actionType: 'ADD_INTERNAL_LINKS', title: 'Existing Page Title', html: linked.html, beforeHtml: original, insertedInternalLinks: linked.inserted.length, allowedLinkUrls: [] }).passed).toBe(false);
  });

  it('requires a refresh to change the page while retaining its verified topic', () => {
    const original = '<article><h2>WordPress SEO foundations</h2><p>Technical optimization, internal links, crawlability, and useful content help readers discover the right pages.</p></article>';
    const refreshed = '<article><h2>WordPress SEO foundations</h2><p>Technical optimization and crawlability help search engines discover useful pages.</p><h2>Internal linking workflow</h2><p>Use contextual internal links so readers can reach the right related content.</p></article>';
    const common = {
      actionType: 'CONTENT_REFRESH' as const,
      title: 'WordPress SEO Foundations Guide',
      beforeHtml: original,
      requiredTopics: ['WordPress SEO foundations', 'Internal linking workflow'],
      declaredCoveredTopics: ['WordPress SEO foundations', 'Internal linking workflow'],
      claimSources: [{ claim: 'Technical optimization and crawlability help search engines discover useful pages.', sourceTitle: 'Verified WordPress guide' }],
      allowedSourceTitles: ['Verified WordPress guide'],
      sourceDocuments: [{ title: 'Verified WordPress guide', content: 'Technical optimization and crawlability help search engines discover useful pages.' }]
    };
    expect(deterministicActionQualityGate({ ...common, html: refreshed }).passed).toBe(true);
    expect(deterministicActionQualityGate({ ...common, html: original }).passed).toBe(false);
    expect(deterministicActionQualityGate({ ...common, html: '<article><h2>Luxury cruises</h2><p>Unrelated travel deals and resort packages for vacation planning.</p></article>' }).passed).toBe(false);
  });

  it('applies only an exact, unique, bounded local refresh patch', () => {
    const original = '<article><h2>Foundations</h2><p>Stable customer facts and positioning remain untouched throughout this page.</p><h2>Old workflow</h2><p>This verified section needs a precise update for the current workflow.</p><h2>Resources</h2><p>Existing customer resources and support details remain unchanged.</p></article>';
    const target = '<h2>Old workflow</h2><p>This verified section needs a precise update for the current workflow.</p>';
    const replacement = '<h2>Current workflow</h2><p>This verified section now explains the current workflow with evidence, clear steps, safe validation, and a reversible outcome.</p>';
    const patched = applyVerifiedLocalHtmlPatch(original, target, replacement);
    expect(patched.html).toContain(replacement);
    expect(patched.html).toContain('Stable customer facts and positioning remain untouched');
    expect(patched.targetCharacters).toBeGreaterThan(20);
    expect(() => applyVerifiedLocalHtmlPatch(original, original, replacement)).toThrow(/局部修改范围/);
    expect(() => applyVerifiedLocalHtmlPatch(original, '<p>missing</p>', replacement)).toThrow(/精确且唯一/);
  });
});
