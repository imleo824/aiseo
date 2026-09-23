export const tenantQueryRoot = (authUserId: string) => ['tenant', authUserId] as const;

export const tenantAccountQueryKey = (authUserId: string) => (
  [...tenantQueryRoot(authUserId), 'account'] as const
);

export const tenantWorkspaceQueryRoot = (authUserId: string, workspaceId: string) => (
  [...tenantQueryRoot(authUserId), workspaceId || 'primary'] as const
);

export const rechargePricingQueryRoot = (authUserId: string) => ['recharge-pricing', authUserId] as const;

export const rechargePricingQueryKey = (authUserId: string, workspaceId: string) => (
  [...rechargePricingQueryRoot(authUserId), workspaceId] as const
);
