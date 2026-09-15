import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  getSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } })
}));

vi.mock('../lib/api', () => ({ api: {} }));

import { toWorkspaceDraft } from './api';

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
});
