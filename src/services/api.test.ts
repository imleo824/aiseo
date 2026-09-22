import { describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  getSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } })
}));

vi.mock('../lib/api', () => ({ api: { get: apiGet } }));

import { ApiService, toWorkspaceDraft } from './api';

describe('API response projections', () => {
  it('projects a write-response draft without hydrated relations', () => {
    const projected = toWorkspaceDraft({
      id: '00000000-0000-0000-0000-000000000001',
      siteId: '00000000-0000-0000-0000-000000000002',
      title: 'Queued delivery',
      status: 'PUBLISHING',
      html: '<p>Verified content</p>',
      qualityReport: { passed: true, score: 92 },
      createdAt: '2026-09-15T00:00:00.000Z'
    });

    expect(projected.status).toBe('PUBLISHING');
    expect(projected.publishedAt).toBeUndefined();
  });

  it('preserves an explicitly selected organization after loading the current user', async () => {
    apiGet.mockResolvedValueOnce({ data: {
      profile: { id: 'profile-1', email: 'admin@example.test', displayName: 'Admin', platformRole: 'PLATFORM_ADMIN', createdAt: '2026-09-01T00:00:00.000Z' },
      organizations: [
        { id: 'organization-a', name: 'Organization A', creditBalanceMicros: '0', totalRechargedMicros: '0', totalConsumedMicros: '0', role: 'OWNER' },
        { id: 'organization-b', name: 'Organization B', creditBalanceMicros: '0', totalRechargedMicros: '0', totalConsumedMicros: '0', role: 'OWNER' }
      ]
    } });

    const result = await new ApiService('organization-b').getMe();

    expect(result.tenantId).toBe('organization-b');
    expect(result.account.companyName).toBe('Organization B');
  });
});
