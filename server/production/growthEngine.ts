import { createHash } from 'crypto';

export const GROWTH_SCORE_VERSION = 'qualified-growth-1';
export const GSC_OPPORTUNITY_VERSION = 'gsc-opportunity-1';

export type GscRow = {
  keys: [string, string, string?, string?];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GrowthOpportunityCandidate = {
  sourceKey: string;
  type: 'RANK_11_20' | 'HIGH_IMPRESSION_LOW_CTR' | 'CONTENT_DECAY';
  title: string;
  targetUrl: string;
  keyword: string;
  evidence: Record<string, unknown>;
  trafficPotentialMicros: bigint;
  businessRelevanceMicros: bigint;
  successProbabilityMicros: bigint;
  confidenceMicros: bigint;
  executionCostMicros: bigint;
  riskPenaltyMicros: bigint;
  expectedValueMicros: bigint;
  timeToImpactDays: number;
  formulaVersion: string;
};

export type PlannedGrowthAction = {
  type: 'UPDATE_TITLE' | 'CONTENT_REFRESH' | 'DIAGNOSE_ONLY';
  riskLevel: 'A' | 'B';
  reversible: boolean;
  observationDays: number;
  plan: Record<string, unknown>;
};

export type GscComparisonWindow = {
  current: { startDate: string; endDate: string };
  previous: { startDate: string; endDate: string };
  periodDays: number;
};

const MICROS = 1_000_000n;
const toMicros = (ratio: number): bigint => BigInt(Math.max(0, Math.min(1, ratio)) * 1_000_000 | 0);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const gscComparisonWindow = (startDate: string, endDate: string): GscComparisonWindow | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
  const periodDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start.getTime() - 86_400_000);
  const previousStart = new Date(previousEnd.getTime() - (periodDays - 1) * 86_400_000);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return {
    current: { startDate, endDate },
    previous: { startDate: date(previousStart), endDate: date(previousEnd) },
    periodDays
  };
};

export const readGscRows = (payload: unknown): GscRow[] => {
  const rows = (payload as { rows?: unknown[] } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): GscRow[] => {
    const value = row as Partial<GscRow>;
    if (!Array.isArray(value.keys) || value.keys.length < 2 || !value.keys[0] || !value.keys[1]) return [];
    if (![value.clicks, value.impressions, value.ctr, value.position].every(finite)) return [];
    if ((value.impressions as number) < 0 || (value.clicks as number) < 0 || (value.position as number) <= 0) return [];
    return [{
      keys: [String(value.keys[0]), String(value.keys[1]), value.keys[2] ? String(value.keys[2]) : undefined, value.keys[3] ? String(value.keys[3]) : undefined],
      clicks: value.clicks as number,
      impressions: value.impressions as number,
      ctr: value.ctr as number,
      position: value.position as number
    }];
  });
};

const tokens = (value: string): string[] => value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];

export const calculateBusinessRelevanceMicros = (query: string, businessCorpus: string): bigint | null => {
  const queryTokens = [...new Set(tokens(query))];
  if (!queryTokens.length || !businessCorpus.trim()) return null;
  const normalizedCorpus = businessCorpus.toLocaleLowerCase();
  const matched = queryTokens.filter((token) => normalizedCorpus.includes(token)).length;
  if (!matched) return 0n;
  return BigInt(Math.round(matched / queryTokens.length * 1_000_000));
};

const sourceKey = (type: string, query: string, page: string): string => {
  const digest = createHash('sha256').update(`${query}\n${page}`).digest('hex').slice(0, 24);
  return `${type.toLocaleLowerCase()}:${digest}`;
};

const score = (traffic: bigint, relevance: bigint, success: bigint, confidence: bigint, cost: bigint, risk: bigint): bigint => {
  const gross = traffic * relevance / MICROS * success / MICROS * confidence / MICROS;
  const deductions = cost + risk;
  return gross > deductions ? gross - deductions : 0n;
};

export const discoverGscOpportunities = (input: {
  current: GscRow[];
  previous?: GscRow[];
  businessCorpus: string;
}): GrowthOpportunityCandidate[] => {
  const previousByQueryPage = new Map((input.previous || []).map((row) => [`${row.keys[0]}\n${row.keys[1]}`, row]));
  const candidates: GrowthOpportunityCandidate[] = [];

  for (const row of input.current) {
    const [query, page] = row.keys;
    const relevance = calculateBusinessRelevanceMicros(query, input.businessCorpus);
    // Qualified growth cannot be claimed without customer-derived business
    // evidence. The raw reality row remains in its immutable GSC snapshot.
    if (relevance === null || relevance === 0n) continue;
    const confidence = toMicros(Math.min(1, row.impressions / 1_000));

    if (row.position >= 11 && row.position <= 20 && row.impressions >= 50) {
      const traffic = BigInt(Math.round(Math.max(0, row.impressions - row.clicks) * 1_000_000));
      const success = toMicros(0.7 - ((row.position - 11) / 9) * 0.3);
      const cost = 500_000n;
      const risk = 100_000n;
      candidates.push({
        sourceKey: sourceKey('RANK_11_20', query, page), type: 'RANK_11_20', title: `提升第 11–20 位页面：${query}`,
        targetUrl: page, keyword: query,
        evidence: { source: 'GSC', query, page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position },
        trafficPotentialMicros: traffic, businessRelevanceMicros: relevance, successProbabilityMicros: success, confidenceMicros: confidence,
        executionCostMicros: cost, riskPenaltyMicros: risk, expectedValueMicros: score(traffic, relevance, success, confidence, cost, risk),
        timeToImpactDays: 28, formulaVersion: GROWTH_SCORE_VERSION
      });
    }

    if (row.impressions >= 100 && row.ctr < 0.02) {
      const traffic = BigInt(Math.round(Math.max(0, row.impressions * 0.02 - row.clicks) * 1_000_000));
      const success = 650_000n;
      const cost = 300_000n;
      const risk = 250_000n;
      candidates.push({
        sourceKey: sourceKey('HIGH_IMPRESSION_LOW_CTR', query, page), type: 'HIGH_IMPRESSION_LOW_CTR', title: `修复高曝光低点击：${query}`,
        targetUrl: page, keyword: query,
        evidence: { source: 'GSC', query, page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, observedCtrThreshold: 0.02 },
        trafficPotentialMicros: traffic, businessRelevanceMicros: relevance, successProbabilityMicros: success, confidenceMicros: confidence,
        executionCostMicros: cost, riskPenaltyMicros: risk, expectedValueMicros: score(traffic, relevance, success, confidence, cost, risk),
        timeToImpactDays: 14, formulaVersion: GROWTH_SCORE_VERSION
      });
    }

    const previous = previousByQueryPage.get(`${query}\n${page}`);
    if (previous && previous.clicks >= 20 && row.clicks <= previous.clicks * 0.7) {
      const traffic = BigInt(Math.round((previous.clicks - row.clicks) * 1_000_000));
      const success = 600_000n;
      const cost = 1_500_000n;
      const risk = 400_000n;
      candidates.push({
        sourceKey: sourceKey('CONTENT_DECAY', query, page), type: 'CONTENT_DECAY', title: `恢复衰退页面：${query}`,
        targetUrl: page, keyword: query,
        evidence: { source: 'GSC_DELTA', query, page, previousClicks: previous.clicks, currentClicks: row.clicks, declineRatio: row.clicks / previous.clicks },
        trafficPotentialMicros: traffic, businessRelevanceMicros: relevance, successProbabilityMicros: success, confidenceMicros: confidence,
        executionCostMicros: cost, riskPenaltyMicros: risk, expectedValueMicros: score(traffic, relevance, success, confidence, cost, risk),
        timeToImpactDays: 28, formulaVersion: GROWTH_SCORE_VERSION
      });
    }
  }

  return candidates
    .filter((candidate) => candidate.expectedValueMicros > 0n)
    .sort((left, right) => left.expectedValueMicros === right.expectedValueMicros ? left.sourceKey.localeCompare(right.sourceKey) : left.expectedValueMicros > right.expectedValueMicros ? -1 : 1);
};

export const planMinimumEffectiveAction = (candidate: Pick<GrowthOpportunityCandidate, 'type' | 'targetUrl' | 'keyword' | 'evidence'>): PlannedGrowthAction => {
  if (candidate.type === 'HIGH_IMPRESSION_LOW_CTR') return {
    type: 'UPDATE_TITLE', riskLevel: 'B', reversible: true, observationDays: 14,
    plan: { targetUrl: candidate.targetUrl, query: candidate.keyword, diagnosisRequired: ['current_title', 'serp_title_patterns', 'intent_match'], mutationScope: ['title'] }
  };
  if (candidate.type === 'CONTENT_DECAY') return {
    type: 'CONTENT_REFRESH', riskLevel: 'B', reversible: true, observationDays: 28,
    plan: { targetUrl: candidate.targetUrl, query: candidate.keyword, diagnosisRequired: ['content_delta', 'serp_change', 'freshness', 'intent_change'], mutationScope: ['existing_content_only'] }
  };
  return {
    type: 'DIAGNOSE_ONLY', riskLevel: 'A', reversible: true, observationDays: 14,
    plan: { targetUrl: candidate.targetUrl, query: candidate.keyword, diagnosisRequired: ['page_coverage', 'intent_match', 'internal_authority'], mutationScope: [] }
  };
};

export const autonomyDecision = (input: {
  action: PlannedGrowthAction;
  autonomyLevel: 'OBSERVE_ONLY' | 'GUIDED' | 'AUTONOMOUS';
  hasVerifiedMutationExecutor: boolean;
  hasVerifiedDiagnosticExecutor: boolean;
}): 'AUTO_EXECUTE' | 'REQUIRE_REVIEW' | 'REJECT' => {
  if (input.action.type === 'DIAGNOSE_ONLY') return input.hasVerifiedDiagnosticExecutor ? 'AUTO_EXECUTE' : 'REJECT';
  if (!input.hasVerifiedMutationExecutor) return 'REJECT';
  if (input.autonomyLevel === 'OBSERVE_ONLY') return 'REQUIRE_REVIEW';
  if (input.action.riskLevel === 'A') return 'AUTO_EXECUTE';
  if (input.action.riskLevel === 'B' && input.autonomyLevel === 'AUTONOMOUS') return 'AUTO_EXECUTE';
  return 'REQUIRE_REVIEW';
};

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);
