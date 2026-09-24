import { describe, expect, it } from 'vitest';
import {
  publicAuditEventSelect,
  publicDraftSelect,
  publicGrowthActionDetailSelect,
  publicGrowthActionStatusSelect,
  publicJobRunSelect,
  publicLedgerEntrySelect,
  publicPaymentIntentSelect,
  publicSiteSelect
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
});
