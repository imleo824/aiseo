import { describe, expect, it } from 'vitest';
import { autonomyDecision, calculateBusinessRelevanceMicros, discoverGscOpportunities, gscComparisonWindow, planMinimumEffectiveAction, readGscRows } from './growthEngine';

describe('growth engine', () => {
  it('rejects malformed provider rows instead of inventing metrics', () => {
    expect(readGscRows({ rows: [{ keys: ['query'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }, { keys: ['crm', 'https://example.com/crm'], clicks: 4, impressions: 200, ctr: 0.02, position: 12 }] })).toHaveLength(1);
    expect(readGscRows({})).toEqual([]);
  });

  it('builds adjacent non-overlapping GSC comparison windows', () => {
    expect(gscComparisonWindow('2026-08-01', '2026-08-28')).toEqual({
      current: { startDate: '2026-08-01', endDate: '2026-08-28' },
      previous: { startDate: '2026-07-04', endDate: '2026-07-31' },
      periodDays: 28
    });
    expect(gscComparisonWindow('2026-08-28', '2026-08-01')).toBeNull();
  });

  it('requires customer-derived business evidence for qualified opportunities', () => {
    expect(calculateBusinessRelevanceMicros('enterprise crm pricing', 'We sell enterprise CRM software and publish pricing guides.')).toBe(1_000_000n);
    expect(calculateBusinessRelevanceMicros('consumer recipes', 'Enterprise CRM software')).toBe(0n);
    expect(calculateBusinessRelevanceMicros('enterprise crm', '')).toBeNull();
  });

  it('discovers and deterministically ranks GSC opportunities', () => {
    const candidates = discoverGscOpportunities({
      businessCorpus: 'Enterprise CRM software, CRM pricing and CRM comparison research.',
      current: [
        { keys: ['crm pricing', 'https://example.com/pricing'], clicks: 4, impressions: 500, ctr: 0.008, position: 12 },
        { keys: ['crm comparison', 'https://example.com/compare'], clicks: 20, impressions: 400, ctr: 0.05, position: 8 }
      ],
      previous: [
        { keys: ['crm comparison', 'https://example.com/compare'], clicks: 40, impressions: 420, ctr: 0.095, position: 6 }
      ]
    });
    expect(candidates.map(({ type }) => type)).toEqual(expect.arrayContaining(['RANK_11_20', 'HIGH_IMPRESSION_LOW_CTR', 'CONTENT_DECAY']));
    expect(candidates.every(({ expectedValueMicros }) => expectedValueMicros > 0n)).toBe(true);
    expect(candidates[0].expectedValueMicros).toBeGreaterThanOrEqual(candidates.at(-1)!.expectedValueMicros);
  });

  it('uses the minimum effective action and progressive autonomy', () => {
    const action = planMinimumEffectiveAction({ type: 'HIGH_IMPRESSION_LOW_CTR', targetUrl: 'https://example.com/pricing', keyword: 'crm pricing', evidence: {} });
    expect(action).toMatchObject({ type: 'UPDATE_TITLE', riskLevel: 'B', observationDays: 14 });
    expect(autonomyDecision({ action, autonomyLevel: 'OBSERVE_ONLY', hasVerifiedMutationExecutor: true, hasVerifiedDiagnosticExecutor: true })).toBe('REQUIRE_REVIEW');
    expect(autonomyDecision({ action, autonomyLevel: 'AUTONOMOUS', hasVerifiedMutationExecutor: true, hasVerifiedDiagnosticExecutor: true })).toBe('AUTO_EXECUTE');
    expect(autonomyDecision({ action, autonomyLevel: 'AUTONOMOUS', hasVerifiedMutationExecutor: false, hasVerifiedDiagnosticExecutor: true })).toBe('REJECT');
    const diagnosis = planMinimumEffectiveAction({ type: 'RANK_11_20', targetUrl: 'https://example.com/pricing', keyword: 'crm pricing', evidence: {} });
    expect(autonomyDecision({ action: diagnosis, autonomyLevel: 'OBSERVE_ONLY', hasVerifiedMutationExecutor: false, hasVerifiedDiagnosticExecutor: true })).toBe('AUTO_EXECUTE');
    expect(autonomyDecision({ action: diagnosis, autonomyLevel: 'AUTONOMOUS', hasVerifiedMutationExecutor: false, hasVerifiedDiagnosticExecutor: false })).toBe('REJECT');
  });
});
