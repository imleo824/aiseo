import { describe, expect, it } from 'vitest';
import { GrowthActionType } from '@prisma/client';
import { continuousCadenceDays, qualifySearchOpportunity, selectGrowthAction } from './growthPolicy';

describe('unified growth policy', () => {
  it('fails closed when real demand or SERP evidence is missing', () => {
    expect(qualifySearchOpportunity({ searchVolume: 0, keywordDifficulty: 20, allintitleCount: 5, hasSerpEvidence: true })).toMatchObject({ qualified: false });
    expect(qualifySearchOpportunity({ searchVolume: 100, keywordDifficulty: 20, allintitleCount: 5, hasSerpEvidence: false })).toMatchObject({ qualified: false });
    expect(qualifySearchOpportunity({ searchVolume: 100, keywordDifficulty: 20, allintitleCount: 5, hasSerpEvidence: true })).toMatchObject({ qualified: true });
  });

  it('chooses the smallest safe action from deterministic evidence', () => {
    expect(selectGrowthAction({ robotsBlocksAll: true, relevantInternalLinkCount: 0 }).type).toBe(GrowthActionType.DIAGNOSE_ONLY);
    expect(selectGrowthAction({ robotsBlocksAll: false, relevantInternalLinkCount: 0 }).type).toBe(GrowthActionType.CREATE_CONTENT);
    expect(selectGrowthAction({ robotsBlocksAll: false, targetUrl: 'https://example.com/page', target: { contentLength: 500 }, relevantInternalLinkCount: 0 }).type).toBe(GrowthActionType.ADD_CONTENT_SECTION);
    expect(selectGrowthAction({ robotsBlocksAll: false, targetUrl: 'https://example.com/page', target: { contentLength: 2_000 }, relevantInternalLinkCount: 2, gscRows: [{ keys: ['crm', 'https://example.com/page'], clicks: 1, impressions: 200, ctr: 0.005, position: 9 }]}).type).toBe(GrowthActionType.UPDATE_TITLE);
    expect(selectGrowthAction({ robotsBlocksAll: false, targetUrl: 'https://example.com/page', target: { contentLength: 2_000, modifiedAt: '2025-01-01T00:00:00Z' }, relevantInternalLinkCount: 2, now: new Date('2026-01-01T00:00:00Z') }).type).toBe(GrowthActionType.CONTENT_REFRESH);
    expect(selectGrowthAction({ robotsBlocksAll: false, targetUrl: 'https://example.com/page', target: { contentLength: 2_000, modifiedAt: '2026-01-01T00:00:00Z' }, relevantInternalLinkCount: 2, now: new Date('2026-02-01T00:00:00Z') }).type).toBe(GrowthActionType.ADD_INTERNAL_LINKS);
  });

  it('only increases cadence after three observed wins', () => {
    expect(continuousCadenceDays(2)).toBe(7);
    expect(continuousCadenceDays(3)).toBe(3.5);
  });
});
