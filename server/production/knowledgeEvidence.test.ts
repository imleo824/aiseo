import { describe, expect, it } from 'vitest';
import { growthEvidenceFingerprint, knowledgeSourceIdentity, selectRelevantSiteEvidence, shouldSkipUnchangedEvidence } from './knowledgeEvidence';

describe('knowledge evidence identity', () => {
  it('deduplicates bytes without collapsing role, URL, or customer site provenance', () => {
    const shared = {
      siteId: '00000000-0000-0000-0000-000000000001',
      normalizedUrl: 'https://example.com/about',
      checksum: 'a'.repeat(64)
    };
    const target = knowledgeSourceIdentity({ ...shared, role: 'TARGET_SITE' });
    expect(knowledgeSourceIdentity({ ...shared, role: 'TARGET_SITE' })).toBe(target);
    expect(knowledgeSourceIdentity({ ...shared, role: 'REFERENCE' })).not.toBe(target);
    expect(knowledgeSourceIdentity({ ...shared, siteId: '00000000-0000-0000-0000-000000000002', role: 'TARGET_SITE' })).not.toBe(target);
    expect(knowledgeSourceIdentity({ ...shared, normalizedUrl: 'https://example.com/services', role: 'TARGET_SITE' })).not.toBe(target);
  });

  it('retrieves topic-relevant passages across the site instead of truncating one corpus prefix', () => {
    const pages = [
      { title: 'Company history', url: 'https://example.com/about', content: '<p>General company history and office information that appears first in the corpus.</p>' },
      { title: 'WordPress SEO service', url: 'https://example.com/wordpress-seo', content: '<p>Unrelated introduction text.</p><p>WordPress SEO includes crawlability checks, evidence-based content updates, and contextual internal links for useful pages.</p>' }
    ];
    const selected = selectRelevantSiteEvidence('WordPress SEO internal links', pages);
    expect(selected[0]).toMatchObject({ url: 'https://example.com/wordpress-seo' });
    expect(selected[0].content).toContain('contextual internal links');
  });

  it('fingerprints evidence independently of provider row and object-key order', () => {
    const first = growthEvidenceFingerprint({
      siteChecksum: 'a'.repeat(64),
      externalChecksums: ['c'.repeat(64), 'b'.repeat(64)],
      gscEvidence: [
        { keys: ['second', 'https://example.com/b'], clicks: 1, impressions: 20 },
        { impressions: 10, clicks: 2, keys: ['first', 'https://example.com/a'] }
      ]
    });
    expect(growthEvidenceFingerprint({
      siteChecksum: 'a'.repeat(64),
      externalChecksums: ['b'.repeat(64), 'c'.repeat(64)],
      gscEvidence: [
        { keys: ['first', 'https://example.com/a'], clicks: 2, impressions: 10 },
        { impressions: 20, keys: ['second', 'https://example.com/b'], clicks: 1 }
      ]
    })).toBe(first);
    expect(growthEvidenceFingerprint({
      siteChecksum: 'd'.repeat(64),
      externalChecksums: ['b'.repeat(64), 'c'.repeat(64)],
      gscEvidence: []
    })).not.toBe(first);
  });

  it('skips unchanged scheduled evidence but never skips the same retry or the forced 28-day review', () => {
    const base = {
      scheduled: true,
      currentFingerprint: 'a'.repeat(64),
      lastFingerprint: 'a'.repeat(64),
      lastEvaluatedAt: new Date('2026-09-01T00:00:00Z'),
      runCreatedAt: new Date('2026-09-08T00:00:00Z')
    };
    expect(shouldSkipUnchangedEvidence({ ...base, now: new Date('2026-09-08T00:00:00Z') })).toBe(true);
    expect(shouldSkipUnchangedEvidence({ ...base, lastEvaluatedAt: new Date('2026-09-08T00:00:01Z'), now: new Date('2026-09-08T00:01:00Z') })).toBe(false);
    expect(shouldSkipUnchangedEvidence({ ...base, now: new Date('2026-09-29T00:00:00Z') })).toBe(false);
    expect(shouldSkipUnchangedEvidence({ ...base, currentFingerprint: 'b'.repeat(64), now: new Date('2026-09-08T00:00:00Z') })).toBe(false);
  });
});
