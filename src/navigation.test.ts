import { describe, expect, it } from 'vitest';
import { isAdminNavItem, NAVIGATION, navFromSearch, requiresWorkspaceResource } from './navigation';

describe('workspace navigation contract', () => {
  it('restores only known views from the URL', () => {
    expect(navFromSearch('?view=SITE_MANAGEMENT')).toBe('SITE_MANAGEMENT');
    expect(navFromSearch('?view=UNKNOWN')).toBe('DASHBOARD');
    expect(navFromSearch('')).toBe('DASHBOARD');
  });

  it('keeps administrator access metadata in the same registry as page copy', () => {
    expect(isAdminNavItem('PRICING_CONFIG')).toBe(true);
    expect(isAdminNavItem('DASHBOARD')).toBe(false);
    expect(NAVIGATION.PRICING_CONFIG.audience).toBe('ADMIN');
    expect(NAVIGATION.DASHBOARD.audience).toBe('CUSTOMER');
  });

  it('loads expensive resources only for the page that consumes them', () => {
    expect(requiresWorkspaceResource('DASHBOARD', 'growthStatus')).toBe(true);
    expect(requiresWorkspaceResource('DASHBOARD', 'transactions')).toBe(false);
    expect(requiresWorkspaceResource('CREDIT_LEDGER', 'transactions')).toBe(true);
    expect(requiresWorkspaceResource('CREDIT_LEDGER', 'pricing')).toBe(true);
    expect(requiresWorkspaceResource('TENANT_MANAGEMENT', 'tenants')).toBe(true);
  });
});
