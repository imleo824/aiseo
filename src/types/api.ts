export type Organization = { id: string; name: string; creditBalanceMicros: string; role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' };
export type Me = { profile: { id: string; email: string; displayName?: string; platformRole: 'USER' | 'PLATFORM_ADMIN' }; organizations: Organization[] };
export type Site = { id: string; name: string; domain: string; language: string; wordpressStatus: string; wordpressUser?: string; wordpressVerifiedAt?: string; publishPolicy: string; manualPublishSuccesses: number; autoPublishEnabledAt?: string; createdAt: string; integrations: Array<{ id: string; provider: 'GSC'; propertyId?: string; status: string; lastSyncedAt?: string; lastErrorMessage?: string }> };
export type KnowledgeSource = { id: string; siteId?: string; type: string; title: string; summary?: string; status: string; createdAt: string };
export type Opportunity = { id: string; siteId: string; title: string; type: string; targetUrl?: string; keyword?: string; searchVolume?: number; keywordDifficulty?: number; allintitleCount?: number; roiScoreMicros?: string; expectedValueMicros?: string; confidenceMicros?: string; formulaVersion: string; status: string };
export type SiteGrowthState = {
  id: string;
  siteId: string;
  status: 'NEEDS_BASELINE' | 'BASELINING' | 'ACTIVE' | 'OBSERVING' | 'PAUSED' | 'BLOCKED';
  autonomyLevel: 'OBSERVE_ONLY' | 'GUIDED' | 'AUTONOMOUS';
  stateVersion: string;
  baselineCompletedAt?: string;
  lastCycleAt?: string;
  nextDecisionAt?: string;
  lastDataWatermark?: string;
  blockedReason?: string;
};
export type GrowthAction = {
  id: string;
  type: string;
  status: string;
  riskLevel: 'A' | 'B' | 'C' | 'D';
  autonomyDecision: 'AUTO_EXECUTE' | 'REQUIRE_REVIEW' | 'REJECT';
  targetUrl?: string;
  expectedValueMicros?: string;
  plan: Record<string, unknown>;
  createdAt: string;
  decision: { rank: number; scoreMicros: string; rationale: Record<string, unknown> };
};
export type GrowthStatus = {
  state: SiteGrowthState | null;
  cycles: Array<{ id: string; status: string; stage: string; trigger: string; summary?: Record<string, unknown>; errorMessage?: string; createdAt: string; finishedAt?: string }>;
  opportunities: Opportunity[];
  actions: GrowthAction[];
  readiness: {
    canStart: boolean;
    gscReady: boolean;
    knowledgeReady: boolean;
    wordpressReady: boolean;
    executionMode: 'OBSERVE_ONLY' | 'REVIEW_GATED';
    blockers: Array<'GSC_CONNECTION_REQUIRED' | 'KNOWLEDGE_SOURCE_REQUIRED'>;
  };
  metrics: {
    organicClicks: number | null;
    previousOrganicClicks: number | null;
    organicClickChangePct: number | null;
    attributedLiftMicros: string | null;
    attributionStatus: 'AVAILABLE' | 'INSUFFICIENT_OBSERVATION';
    source: 'GSC' | 'UNAVAILABLE';
    collectedAt: string | null;
  };
};
export type JobRun = {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTER';
  result?: { resultId?: string };
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
};
export type Draft = {
  id: string;
  siteId: string;
  opportunityId?: string;
  title: string;
  status: string;
  html: string;
  qualityReport: { passed?: boolean; score?: number; issues?: string[]; passedChecks?: string[] };
  dataProvenance?: Array<{ source?: string; status?: string }>;
  knowledgeSourceIds?: string[];
  publishedUrl?: string;
  createdAt?: string;
  reviews: Array<{ decision: string; comment?: string }>;
  publishAttempts: Array<{ status: string; remoteUrl?: string; errorMessage?: string }>;
};
export type Ledger = { balanceMicros: string; heldMicros: string; availableMicros: string; entries: Array<{ id: string; type: string; amountMicros: string; balanceAfterMicros: string; reason: string; createdAt: string }> };
