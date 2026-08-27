import { describe, expect, it } from 'vitest';
import { weaveRelevantInternalLink } from './internalLinking';

const draft = (title: string, publishedUrl: string, summary = '') => ({
  id: title,
  title,
  summary,
  contentHtml: '<p>Published body</p>',
  publishedUrl
}) as any;

describe('semantic internal linking', () => {
  it('links only to a related page on the same site', () => {
    const result = weaveRelevantInternalLink({
      contentHtml: '<h2>正文</h2><p>内容</p>',
      articleTitle: 'Kubernetes FinOps 成本优化指南',
      targetKeyword: 'Kubernetes FinOps',
      siteDomain: 'example.com',
      publishedDrafts: [
        draft('Kubernetes 成本治理与 FinOps 实战', 'https://example.com/kubernetes-finops/'),
        draft('品牌设计系统指南', 'https://example.com/design-system/'),
        draft('Kubernetes FinOps 外部页', 'https://other.example/kubernetes-finops/')
      ]
    });

    expect(result.decision).toMatchObject({
      status: 'INSERTED',
      targetUrl: 'https://example.com/kubernetes-finops/'
    });
    expect(result.contentHtml).toContain('https://example.com/kubernetes-finops/');
    expect(result.contentHtml).not.toContain('https://other.example/kubernetes-finops/');
  });

  it('does not manufacture a related link when topics do not overlap', () => {
    const result = weaveRelevantInternalLink({
      contentHtml: '<h2>正文</h2><p>内容</p>',
      articleTitle: 'B2B 邮件营销转化策略',
      targetKeyword: 'B2B 邮件营销',
      siteDomain: 'example.com',
      publishedDrafts: [draft('PostgreSQL 数据库迁移方案', 'https://example.com/database-migration/')]
    });

    expect(result.decision.status).toBe('SKIPPED');
    expect(result.decision.message).toContain('语义相关');
    expect(result.contentHtml).not.toContain('<aside>');
  });

  it('does not append an existing target URL twice', () => {
    const result = weaveRelevantInternalLink({
      contentHtml: '<p><a href="https://example.com/kubernetes-finops/">已有关联链接</a></p>',
      articleTitle: 'Kubernetes FinOps 成本优化指南',
      targetKeyword: 'Kubernetes FinOps',
      siteDomain: 'example.com',
      publishedDrafts: [draft('Kubernetes 成本治理与 FinOps 实战', 'https://example.com/kubernetes-finops/')]
    });

    expect(result.decision.status).toBe('SKIPPED');
    expect(result.contentHtml).not.toContain('<aside>');
  });
});
