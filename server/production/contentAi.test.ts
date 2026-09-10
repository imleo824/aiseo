import { describe, expect, it } from 'vitest';
import type { ContentBrief } from './contentAi';
import { validateContentBriefEvidence } from './contentAi';

const brief = (overrides: Partial<ContentBrief> = {}): ContentBrief => ({
  audience: 'WordPress site owners',
  searchIntent: 'informational',
  pageGoal: 'Explain a verified and safe WordPress SEO workflow.',
  requiredTopics: ['WordPress audit', 'Internal links'],
  userQuestions: ['How does the workflow operate?'],
  allowedSiteFacts: [{ fact: 'The service performs WordPress technical audits.', sourceTitle: '[TARGET_SITE] Services' }],
  forbiddenClaims: ['Guaranteed first place rankings'],
  internalLinkTargets: [{ title: 'Services', url: 'https://example.com/services/' }],
  ...overrides
});

const knowledge = [
  { title: '[TARGET_SITE] Services', content: 'The service performs WordPress technical audits and contextual internal linking.' },
  { title: '[COMPETITOR] Rival', content: 'The rival claims unlimited publishing.' }
];

describe('content brief evidence contract', () => {
  it('accepts customer facts and links grounded in verified target-site evidence', () => {
    expect(validateContentBriefEvidence(brief(), knowledge, [{ title: 'Services', url: 'https://example.com/services' }])).toEqual(brief());
  });

  it('rejects competitor claims presented as customer facts', () => {
    expect(() => validateContentBriefEvidence(brief({
      allowedSiteFacts: [{ fact: 'The rival claims unlimited publishing.', sourceTitle: '[COMPETITOR] Rival' }]
    }), knowledge, [{ title: 'Services', url: 'https://example.com/services' }])).toThrow(/客户站点证据/);
  });

  it('rejects hallucinated customer facts and unverified internal links', () => {
    expect(() => validateContentBriefEvidence(brief({
      allowedSiteFacts: [{ fact: 'The service guarantees ten thousand visitors.', sourceTitle: '[TARGET_SITE] Services' }]
    }), knowledge, [{ title: 'Services', url: 'https://example.com/services' }])).toThrow(/客户站点证据/);
    expect(() => validateContentBriefEvidence(brief({
      internalLinkTargets: [{ title: 'Unknown', url: 'https://example.com/unknown' }]
    }), knowledge, [{ title: 'Services', url: 'https://example.com/services' }])).toThrow(/内部链接/);
  });
});
