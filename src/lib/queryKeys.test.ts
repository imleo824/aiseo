import { describe, expect, it } from 'vitest';
import { rechargePricingQueryKey, rechargePricingQueryRoot, tenantQueryRoot, tenantWorkspaceQueryRoot } from './queryKeys';

describe('authenticated query keys', () => {
  it('isolates the same workspace alias between browser users', () => {
    expect(tenantWorkspaceQueryRoot('user-a', '')).not.toEqual(tenantWorkspaceQueryRoot('user-b', ''));
    expect(rechargePricingQueryKey('user-a', 'organization-1')).not.toEqual(rechargePricingQueryKey('user-b', 'organization-1'));
  });

  it('provides a user-scoped root for cache invalidation and logout cleanup', () => {
    expect(tenantQueryRoot('user-a')).toEqual(['tenant', 'user-a']);
    expect(tenantWorkspaceQueryRoot('user-a', 'organization-1')).toEqual(['tenant', 'user-a', 'organization-1']);
    expect(rechargePricingQueryRoot('user-a')).toEqual(['recharge-pricing', 'user-a']);
  });
});
