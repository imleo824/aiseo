import { describe, expect, it } from 'vitest';
import { applySiteContentQualityGate } from './contentQualityGate';

const passingModelGate = {
  passed: true,
  overallScore: 96,
  factReliabilityScore: 95,
  hallucinationFree: true,
  languageMatch: true,
  sourceCheckPassed: true,
  duplicateContentCheck: true,
  issues: [],
  passedChecks: []
};

const substantiveArticle = (topic: string) => `<h2>${topic} 原理</h2><p>${`${topic} 的可验证实施细节与客户资料。`.repeat(70)}</p><h2>落地步骤</h2><p>${`${topic} 的监测、验证与持续优化。`.repeat(70)}</p>`;

describe('site content quality gate', () => {
  it('blocks a near-duplicate of a published article', () => {
    const content = substantiveArticle('企业技术方案');
    const result = applySiteContentQualityGate(passingModelGate, content, [{ contentHtml: content } as any]);

    expect(result.passed).toBe(false);
    expect(result.duplicateContentCheck).toBe(false);
  });

  it('requires substantive structured content before automatic publishing', () => {
    const result = applySiteContentQualityGate(passingModelGate, '<p>短内容</p>', []);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('800'),
      expect.stringContaining('H2/H3')
    ]));
  });

  it('allows a structured, sufficiently distinct article when the model gate passes', () => {
    const result = applySiteContentQualityGate(passingModelGate, substantiveArticle('云原生可观测性'), [{ contentHtml: substantiveArticle('数据库迁移') } as any]);

    expect(result.passed).toBe(true);
    expect(result.duplicateContentCheck).toBe(true);
  });

  it('does not let a short English sales paragraph pass on character count alone', () => {
    const content = `<h2>Why it matters</h2><p>${'A platform can improve collaboration, visibility, and predictable delivery. '.repeat(14)}</p><h2>How it works</h2><p>${'Teams review the workflow and apply the right change for their customers. '.repeat(14)}</p>`;
    const result = applySiteContentQualityGate(passingModelGate, content, []);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('450') ]));
  });
});
