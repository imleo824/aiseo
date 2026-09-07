import { describe, expect, it } from 'vitest';
import { extractGscOpportunitySeeds, gscComparisonWindow, readGscRows } from './gscData';

describe('GSC data contracts', () => {
  it('rejects malformed provider rows instead of inventing metrics', () => {
    expect(readGscRows({ rows: [{ keys: ['query'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }, { keys: ['crm', 'https://example.com/crm'], clicks: 4, impressions: 200, ctr: 0.02, position: 12 }] })).toHaveLength(1);
    expect(readGscRows({})).toEqual([]);
  });

  it('builds adjacent non-overlapping comparison windows', () => {
    expect(gscComparisonWindow('2026-08-01', '2026-08-28')).toEqual({
      current: { startDate: '2026-08-01', endDate: '2026-08-28' },
      previous: { startDate: '2026-07-04', endDate: '2026-07-31' },
      periodDays: 28
    });
    expect(gscComparisonWindow('2026-08-28', '2026-08-01')).toBeNull();
  });

  it('aggregates dimensions and extracts only non-brand actionable signals', () => {
    const seeds = extractGscOpportunitySeeds({
      brandTerms: ['Acme'],
      current: [
        { keys: ['crm pricing', 'https://example.com/pricing', 'usa', 'desktop'], clicks: 1, impressions: 120, ctr: 0.008, position: 12 },
        { keys: ['crm pricing', 'https://example.com/pricing', 'can', 'mobile'], clicks: 0, impressions: 80, ctr: 0, position: 14 },
        { keys: ['Acme login', 'https://example.com/login'], clicks: 1, impressions: 300, ctr: 0.003, position: 15 }
      ],
      previous: [{ keys: ['crm pricing', 'https://example.com/pricing'], clicks: 20, impressions: 190, ctr: 0.105, position: 10 }]
    });
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({ keyword: 'crm pricing', impressions: 200, rankingUrl: 'https://example.com/pricing' });
    expect(seeds[0].sources).toEqual(expect.arrayContaining(['GSC_RANK_11_20', 'GSC_LOW_CTR', 'GSC_CONTENT_DECAY']));
  });
});
