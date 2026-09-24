import { Prisma } from '@prisma/client';

// Public API responses are deliberately allowlisted here. Prisma models also
// contain encrypted credentials, queue internals and full remote page bodies;
// returning model objects directly makes those fields easy to expose when the
// schema grows.
export const publicProfileSelect = {
  id: true,
  email: true,
  displayName: true,
  platformRole: true,
  createdAt: true
} satisfies Prisma.ProfileSelect;

export const publicOrganizationSelect = {
  id: true,
  name: true,
  creditBalanceMicros: true,
  createdAt: true
} satisfies Prisma.OrganizationSelect;

export const publicSiteSelect = {
  id: true,
  name: true,
  domain: true,
  language: true,
  niche: true,
  wordpressStatus: true,
  wordpressUser: true,
  wordpressVerifiedAt: true,
  wordpressCompatibilityMode: true,
  wordpressCompatibilityCheckedAt: true,
  createdAt: true,
  integrations: {
    select: {
      id: true,
      provider: true,
      propertyId: true,
      status: true,
      lastSyncedAt: true,
      lastErrorCode: true,
      lastErrorMessage: true
    }
  }
} satisfies Prisma.SiteSelect;

export const publicJobRunSelect = {
  id: true,
  type: true,
  status: true,
  result: true,
  errorCode: true,
  errorMessage: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true
} satisfies Prisma.JobRunSelect;

export const publicDraftSelect = {
  id: true,
  siteId: true,
  opportunityId: true,
  status: true,
  title: true,
  slug: true,
  html: true,
  qualityReport: true,
  dataProvenance: true,
  knowledgeSourceIds: true,
  publishedUrl: true,
  createdAt: true,
  reviews: {
    orderBy: { createdAt: 'asc' as const },
    select: { decision: true, comment: true, createdAt: true }
  },
  publishAttempts: {
    orderBy: { attemptNumber: 'asc' as const },
    select: {
      status: true,
      attemptNumber: true,
      remoteUrl: true,
      errorCode: true,
      errorMessage: true,
      finishedAt: true,
      createdAt: true
    }
  }
} satisfies Prisma.ContentDraftSelect;

export const publicOpportunitySelect = {
  id: true,
  siteId: true,
  title: true,
  type: true,
  targetUrl: true,
  keyword: true,
  searchVolume: true,
  keywordDifficulty: true,
  roiScoreMicros: true,
  expectedValueMicros: true,
  confidenceMicros: true,
  formulaVersion: true,
  status: true,
  createdAt: true
} satisfies Prisma.OpportunitySelect;

export const publicAuditEventSelect = {
  id: true,
  actorId: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  createdAt: true
} satisfies Prisma.AuditEventSelect;

export const publicLedgerEntrySelect = {
  id: true,
  type: true,
  amountMicros: true,
  balanceAfterMicros: true,
  reason: true,
  paymentIntentId: true,
  metadata: true,
  createdAt: true
} satisfies Prisma.LedgerEntrySelect;

export const publicPaymentIntentSelect = {
  id: true,
  packageId: true,
  pricingSource: true,
  network: true,
  recipientAddress: true,
  baseAmountMicros: true,
  expectedAmountMicros: true,
  creditMicros: true,
  txHash: true,
  status: true,
  expiresAt: true,
  submittedAt: true,
  confirmedAt: true,
  creditedAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.PaymentIntentSelect;

export const publicGrowthActionStatusSelect = {
  id: true,
  runId: true,
  type: true,
  status: true,
  riskLevel: true,
  autonomyDecision: true,
  targetUrl: true,
  expectedValueMicros: true,
  fallbackReason: true,
  remoteMutationState: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.GrowthActionSelect;

export const publicGrowthActionDetailSelect = {
  ...publicGrowthActionStatusSelect,
  reversible: true,
  plan: true,
  observationStartsAt: true,
  observeUntil: true,
  cooldownUntil: true,
  executedAt: true,
  verifiedAt: true,
  rolledBackAt: true,
  evidence: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, type: true, sourceRef: true, payload: true, createdAt: true }
  },
  pageVersions: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      kind: true,
      remotePostId: true,
      resourceType: true,
      url: true,
      title: true,
      contentChecksum: true,
      remoteModifiedAt: true,
      changedFields: true,
      structureChecksum: true,
      restSchemaFingerprint: true,
      remoteRevisionId: true,
      publicVerification: true,
      createdAt: true
    }
  },
  measurements: {
    orderBy: { windowDays: 'asc' as const },
    select: {
      id: true,
      source: true,
      windowDays: true,
      baseline: true,
      measurement: true,
      observedClickDeltaMicros: true,
      confidenceMicros: true,
      outcome: true,
      observedAt: true
    }
  }
} satisfies Prisma.GrowthActionSelect;
