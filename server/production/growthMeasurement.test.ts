import { describe, expect, it } from 'vitest';
import { actionMeasurementWindow, aggregateTargetGsc, evaluateGrowthOutcome, evaluateRankOutcome } from './growthMeasurement';

describe('immutable growth measurement windows', () => {
  it('anchors before and after windows to the action date plus the GSC data lag', () => {
    expect(actionMeasurementWindow(new Date('2026-09-05T16:30:00Z'), 14)).toMatchObject({
      previous: { startDate: '2026-08-22', endDate: '2026-09-04' },
      current: { startDate: '2026-09-06', endDate: '2026-09-19' },
      windowDays: 14,
      dataLagDays: 3
    });
    expect(actionMeasurementWindow(new Date('2026-09-05T16:30:00Z'), 14).readyAt.toISOString()).toBe('2026-09-22T00:00:00.000Z');
  });

  it('never falls back to whole-site traffic and excludes branded queries', () => {
    const rows = [
      { keys: ['wordpress seo', 'https://example.com/guide/'] as [string, string], clicks: 12, impressions: 120, ctr: 0.1, position: 8 },
      { keys: ['Example brand wordpress', 'https://example.com/guide'] as [string, string], clicks: 30, impressions: 40, ctr: 0.75, position: 1 },
      { keys: ['other page', 'https://example.com/other'] as [string, string], clicks: 90, impressions: 900, ctr: 0.1, position: 4 }
    ];
    expect(aggregateTargetGsc(rows, 'https://example.com/guide', ['Example brand'])).toMatchObject({ clicks: 12, impressions: 120, queryCount: 1, rowCount: 1 });
    expect(aggregateTargetGsc(rows, 'https://example.com/missing')).toMatchObject({ clicks: 0, impressions: 0, rowCount: 0 });
    expect(() => aggregateTargetGsc(rows, 'not-a-url')).toThrow('valid target URL');
  });

  it('reports a cautious outcome and confidence rather than absolute causation', () => {
    const previous = { clicks: 5, impressions: 200, ctr: 0.025, position: 12, queryCount: 2, rowCount: 2 };
    expect(evaluateGrowthOutcome({ clicks: 12, impressions: 300, ctr: 0.04, position: 9, queryCount: 4, rowCount: 4 }, previous).outcome).toBe('WIN');
    expect(evaluateGrowthOutcome({ clicks: 0, impressions: 10, ctr: 0, position: 20, queryCount: 1, rowCount: 1 }, previous).outcome).toBe('INCONCLUSIVE');
  });

  it('treats provider rank as a leading indicator, including a missing top-20 result', () => {
    expect(evaluateRankOutcome(8, 15)).toMatchObject({ outcome: 'WIN', rankImprovement: 7 });
    expect(evaluateRankOutcome(18, 15)).toMatchObject({ outcome: 'LOSS', rankImprovement: -3 });
    expect(evaluateRankOutcome(null, null).outcome).toBe('INCONCLUSIVE');
    expect(evaluateRankOutcome(12, null).outcome).toBe('WIN');
  });
});
