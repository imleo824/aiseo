import { describe, expect, it, vi } from 'vitest';
import { requireSameOriginForCookieWrites } from './csrf';

const request = (overrides: Record<string, unknown> = {}) => ({
  method: 'POST',
  headers: { cookie: 'seo_session=opaque-token' },
  protocol: 'https',
  get: (name: string) => ({ host: 'app.example.com', origin: 'https://app.example.com' }[name]),
  ...overrides
}) as any;

const response = () => {
  const json = vi.fn();
  return { status: vi.fn().mockReturnValue({ json }), json } as any;
};

describe('cookie-write CSRF origin guard', () => {
  it('allows a same-origin browser write', () => {
    const next = vi.fn();
    requireSameOriginForCookieWrites(request(), response(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a cross-origin write that carries a session cookie', () => {
    const next = vi.fn();
    const res = response();
    requireSameOriginForCookieWrites(request({ get: (name: string) => ({ host: 'app.example.com', origin: 'https://evil.example' }[name]) }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not impose browser-origin semantics on bearer clients', () => {
    const next = vi.fn();
    requireSameOriginForCookieWrites(request({ headers: { authorization: 'Bearer api-token' }, get: () => undefined }), response(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
