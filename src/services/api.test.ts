import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  getSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } })
}));

vi.mock('../lib/api', () => ({ api: { get: (path: string) => apiGet(path) } }));

import { ApiService, toWorkspaceDraft } from './api';

describe('API response projections', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

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

  it('loads continuous programs once at organization scope instead of once per site', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (typeof path !== 'string') throw new Error('request path must be a string');
      if (path === '/me') return { data: {
        profile: { id: 'profile-1', email: 'owner@example.test', displayName: 'Owner', platformRole: 'USER', createdAt: '2026-09-01T00:00:00.000Z' },
        organizations: [{ id: 'organization-a', name: 'Organization A', creditBalanceMicros: '0', totalRechargedMicros: '0', totalConsumedMicros: '0', role: 'OWNER' }]
      } };
      if (path.startsWith('/organizations/organization-a/sites?')) return { data: [
        { id: 'site-a', name: 'Site A', domain: 'https://a.example', language: 'zh-CN', wordpressStatus: 'CONNECTED', integrations: [], createdAt: '2026-09-01T00:00:00.000Z' },
        { id: 'site-b', name: 'Site B', domain: 'https://b.example', language: 'en-US', wordpressStatus: 'CONNECTED', integrations: [], createdAt: '2026-09-01T00:00:00.000Z' }
      ], meta: {} };
      if (path.startsWith('/organizations/organization-a/growth-programs?mode=CONTINUOUS')) return { data: [{
        id: 'program-a', siteId: 'site-b', mode: 'CONTINUOUS', inputs: [{ type: 'KEYWORD', value: 'crm' }], status: 'ACTIVE', deliveredRunCount: 0, createdAt: '2026-09-01T00:00:00.000Z'
      }], meta: {} };
      throw new Error(`unexpected request: ${path}`);
    });

    const result = await new ApiService('organization-a').getTasks();

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].siteId).toBe('site-b');
    expect(apiGet.mock.calls.filter(([path]) => String(path).includes('/growth-programs'))).toEqual([
      ['/organizations/organization-a/growth-programs?mode=CONTINUOUS&limit=100']
    ]);
  });

  it('restores all site statuses through one paginated organization endpoint', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/me') return { data: {
        profile: { id: 'profile-1', email: 'owner@example.test', displayName: 'Owner', platformRole: 'USER', createdAt: '2026-09-01T00:00:00.000Z' },
        organizations: [{ id: 'organization-a', name: 'Organization A', creditBalanceMicros: '0', totalRechargedMicros: '0', totalConsumedMicros: '0', role: 'OWNER' }]
      } };
      if (path === '/organizations/organization-a/growth-statuses?limit=100') return { data: [{
        siteId: 'site-a',
        status: {
          program: null, run: null, action: null, stages: [], blocker: null,
          measurement: { gscConnected: false, trafficClaimAllowed: false },
          wordpressCompatibility: { mode: 'SAFE_AUTO', supportedActions: ['CREATE_CONTENT'], blockedActions: [], blockReasons: [] }
        }
      }], meta: {} };
      throw new Error(`unexpected request: ${path}`);
    });

    const rows = await new ApiService('organization-a').getGrowthStatuses();

    expect(rows).toHaveLength(1);
    expect(rows[0].siteId).toBe('site-a');
    expect(apiGet).toHaveBeenCalledWith('/organizations/organization-a/growth-statuses?limit=100');
  });
});
