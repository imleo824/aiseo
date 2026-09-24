import { describe, expect, it } from 'vitest';
import {
  publicActionPriceSelect,
  publicAuditEventSelect,
  publicDraftSelect,
  publicGrowthActionDetailSelect,
  publicGrowthActionStatusSelect,
  publicGrowthDecisionSelect,
  publicGrowthProgramInputSelect,
  publicGrowthProgramSelect,
  publicGrowthRunSelect,
  publicGrowthRunStageSelect,
  publicJobRunSelect,
  publicLedgerEntrySelect,
  publicOrganizationMemberSelect,
  publicPaymentPackageSelect,
  publicPaymentIntentSelect,
  publicSiteSelect,
  publicUsageRecordSelect
} from './apiSelections';

describe('public API field allowlists', () => {
  it('never returns encrypted WordPress credentials or their key version', () => {
    expect(publicSiteSelect).not.toHaveProperty('wordpressCredentials');
    expect(publicSiteSelect).not.toHaveProperty('wordpressCredentialKeyVersion');
    expect(publicSiteSelect).not.toHaveProperty('latestWordpressCompatibilityProfileId');
  });

  it('keeps queue internals and input payloads server-side', () => {
    expect(publicJobRunSelect).not.toHaveProperty('payload');
    expect(publicJobRunSelect).not.toHaveProperty('idempotencyKey');
    expect(publicJobRunSelect).not.toHaveProperty('queueJobId');
    expect(publicJobRunSelect).not.toHaveProperty('heartbeatAt');
    expect(publicJobRunSelect).not.toHaveProperty('attempts');
  });

  it('does not expose full remote page bodies or mutation snapshots', () => {
    expect(publicGrowthActionStatusSelect).not.toHaveProperty('beforeSnapshot');
    expect(publicGrowthActionStatusSelect).not.toHaveProperty('afterSnapshot');
    expect(publicGrowthActionDetailSelect).not.toHaveProperty('beforeSnapshot');
    expect(publicGrowthActionDetailSelect).not.toHaveProperty('afterSnapshot');
    expect(publicGrowthActionDetailSelect.pageVersions.select).not.toHaveProperty('content');
    expect(publicGrowthActionDetailSelect.pageVersions.select).not.toHaveProperty('payload');
  });

  it('keeps ownership, verification and idempotency internals out of customer records', () => {
    expect(publicDraftSelect).not.toHaveProperty('organizationId');
    expect(publicDraftSelect).not.toHaveProperty('seoSnapshotId');
    expect(publicDraftSelect).not.toHaveProperty('remotePostId');
    expect(publicAuditEventSelect).not.toHaveProperty('ipHash');
    expect(publicAuditEventSelect).not.toHaveProperty('traceId');
    expect(publicLedgerEntrySelect).not.toHaveProperty('idempotencyKey');
    expect(publicPaymentIntentSelect).not.toHaveProperty('verification');
    expect(publicPaymentIntentSelect).not.toHaveProperty('pricingSnapshot');
    expect(publicPaymentIntentSelect).not.toHaveProperty('tokenContract');
  });

  it('keeps growth-engine fingerprints, locks and tenant ownership server-side', () => {
    expect(publicGrowthProgramInputSelect).not.toHaveProperty('organizationId');
    expect(publicGrowthProgramInputSelect).not.toHaveProperty('normalizedValue');
    expect(publicGrowthProgramInputSelect).not.toHaveProperty('valueFingerprint');
    expect(publicGrowthProgramSelect).not.toHaveProperty('organizationId');
    expect(publicGrowthProgramSelect).not.toHaveProperty('inputFingerprint');
    expect(publicGrowthProgramSelect).not.toHaveProperty('lockedUntil');
    expect(publicGrowthProgramSelect).not.toHaveProperty('lastEvidenceFingerprint');
    expect(publicGrowthRunSelect).not.toHaveProperty('organizationId');
    expect(publicGrowthRunSelect).not.toHaveProperty('occurrenceKey');
    expect(publicGrowthRunSelect).not.toHaveProperty('knowledgeSourceIds');
    expect(publicGrowthRunStageSelect).not.toHaveProperty('organizationId');
    expect(publicGrowthDecisionSelect).not.toHaveProperty('organizationId');
    expect(publicGrowthDecisionSelect).not.toHaveProperty('runId');
    expect(publicGrowthDecisionSelect).not.toHaveProperty('opportunityId');
  });

  it('uses explicit billing, membership and usage response contracts', () => {
    expect(publicPaymentPackageSelect).toEqual(expect.objectContaining({ id: true, baseAmountMicros: true, creditMicros: true }));
    expect(publicActionPriceSelect).toEqual(expect.objectContaining({ action: true, creditMicros: true }));
    expect(publicOrganizationMemberSelect).not.toHaveProperty('profile');
    expect(publicUsageRecordSelect).not.toHaveProperty('organization');
    expect(publicLedgerEntrySelect).not.toHaveProperty('idempotencyKey');
  });
});
