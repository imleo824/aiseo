import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-token', user: { id: 'user-a' } } } })),
  signOut: vi.fn(async () => ({ error: null }))
}));

vi.mock('./supabase', () => ({ getSupabaseBrowserClient: () => ({ auth }) }));

import { ApiError, api, writeRequestFingerprint } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  auth.signOut.mockClear();
});

describe('write request identity', () => {
  it('is stable for an identical logical write', async () => {
    await expect(writeRequestFingerprint('POST', '/sites', '{"domain":"example.com"}'))
      .resolves.toBe(await writeRequestFingerprint('post', '/sites', '{"domain":"example.com"}'));
  });

  it('changes when the route or body changes', async () => {
    const original = await writeRequestFingerprint('POST', '/sites', '{"domain":"example.com"}');
    expect(await writeRequestFingerprint('POST', '/sites', '{"domain":"other.example"}')).not.toBe(original);
    expect(await writeRequestFingerprint('POST', '/organizations', '{"domain":"example.com"}')).not.toBe(original);
  });

  it('does not reuse a pending write identity across signed-in users', async () => {
    const userA = await writeRequestFingerprint('POST', '/sites', '{"domain":"example.com"}', 'user-a');
    const userB = await writeRequestFingerprint('POST', '/sites', '{"domain":"example.com"}', 'user-b');
    expect(userA).not.toBe(userB);
  });
});

describe('API authentication recovery', () => {
  it('clears a stale local session after the API rejects a revoked JWT', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: '会话已撤销' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })));

    await expect(api.get('/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' } satisfies Partial<ApiError>);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
