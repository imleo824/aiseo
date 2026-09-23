import { describe, expect, it, vi } from 'vitest';
import { canonicalJsonValue, executeIdempotent, findIdempotentReplay, idempotencyRequestHash, requireIdempotencyKey } from './idempotency';

describe('API idempotency', () => {
  it('uses a canonical hash independent of object key order', () => {
    expect(idempotencyRequestHash({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(idempotencyRequestHash({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('normalizes bigint and dates before persisting a replay response', async () => {
    const create = vi.fn();
    const tx = { idempotencyKey: { findFirst: vi.fn().mockResolvedValue(null), create } };
    const result = await executeIdempotent({
      tx: tx as never,
      organizationId: '00000000-0000-4000-8000-000000000001',
      profileId: '00000000-0000-4000-8000-000000000002',
      key: '00000000-0000-4000-8000-000000000003',
      body: { amount: '10' },
      execute: async () => ({ statusCode: 201, data: { amountMicros: 10n, at: new Date('2026-09-01T00:00:00Z') } })
    });
    expect(result.data.amountMicros).toBe(10n);
    expect(create.mock.calls[0][0].data.response).toEqual({ amountMicros: '10', at: '2026-09-01T00:00:00.000Z' });
  });

  it('rejects malformed keys and canonicalizes valid UUIDs', () => {
    expect(() => requireIdempotencyKey('not-a-uuid')).toThrow('UUID');
    expect(requireIdempotencyKey('00000000-0000-4000-8000-0000000000AA')).toBe('00000000-0000-4000-8000-0000000000aa');
    expect(canonicalJsonValue([1n])).toEqual(['1']);
  });

  it('replays a committed response and rejects key reuse with a different body', async () => {
    const body = { input: 'keyword' };
    const stored = {
      requestHash: idempotencyRequestHash(body),
      response: { accepted: true },
      statusCode: 202
    };
    const tx = { idempotencyKey: { findFirst: vi.fn().mockResolvedValue(stored), create: vi.fn() } };
    const execute = vi.fn();
    await expect(executeIdempotent({
      tx: tx as never, profileId: 'p', key: 'k', body, execute
    })).resolves.toMatchObject({ data: { accepted: true }, replayed: true, statusCode: 202 });
    expect(execute).not.toHaveBeenCalled();
    await expect(executeIdempotent({
      tx: tx as never, profileId: 'p', key: 'k', body: { input: 'different' }, execute
    })).rejects.toThrow('不同请求');
  });

  it('does not execute while the same key has no committed response yet', async () => {
    const body = { input: 'keyword' };
    const tx = { idempotencyKey: { findFirst: vi.fn().mockResolvedValue({ requestHash: idempotencyRequestHash(body), response: null, statusCode: null }), create: vi.fn() } };
    await expect(executeIdempotent({
      tx: tx as never, profileId: 'p', key: 'k', body, execute: vi.fn()
    })).rejects.toThrow('正在处理');
  });

  it('removes an expired record instead of replaying a stale response', async () => {
    const body = { siteId: 'site-1' };
    const remove = vi.fn();
    const tx = { idempotencyKey: {
      findFirst: vi.fn().mockResolvedValue({ id: 'expired', requestHash: idempotencyRequestHash(body), response: { authorizationUrl: 'stale' }, statusCode: 200, expiresAt: new Date(0) }),
      delete: remove
    } };

    await expect(findIdempotentReplay({ tx: tx as never, profileId: 'p', key: 'k', body })).resolves.toBeNull();
    expect(remove).toHaveBeenCalledWith({ where: { id: 'expired' } });
  });

  it('supports a shorter replay lifetime for expiring authorization URLs', async () => {
    const create = vi.fn();
    const tx = { idempotencyKey: { findFirst: vi.fn().mockResolvedValue(null), create } };
    const before = Date.now();
    await executeIdempotent({
      tx: tx as never,
      profileId: 'p',
      key: 'k',
      body: {},
      expiresInMs: 600_000,
      execute: async () => ({ statusCode: 200, data: { authorizationUrl: 'fresh' } })
    });
    const expiresAt = create.mock.calls[0][0].data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
  });
});
