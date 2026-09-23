import { beforeEach, describe, expect, it, vi } from 'vitest';

const getQueueConnection = vi.hoisted(() => vi.fn());
vi.mock('../production/queue', () => ({ getQueueConnection }));

import { createRateLimiter } from './rateLimiter';

const response = () => {
  const headers = new Map<string, string>();
  const res = {
    setHeader: vi.fn((name: string, value: unknown) => headers.set(name, String(value))),
    status: vi.fn(),
    json: vi.fn()
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return { res, headers };
};

describe('distributed API rate limiter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses an isolated scope in the Redis key', async () => {
    const exec = vi.fn().mockResolvedValue([[null, 1], [null, -1]]);
    const pttl = vi.fn().mockReturnThis();
    const incr = vi.fn().mockReturnValue({ pttl, exec });
    const pexpire = vi.fn().mockResolvedValue(1);
    getQueueConnection.mockReturnValue({ multi: () => ({ incr }), pexpire });
    const { res, headers } = response();
    const next = vi.fn();

    await createRateLimiter(60_000, 60, 'readiness')({
      ip: '203.0.113.5', path: '/', socket: {}
    } as never, res as never, next);

    expect(incr).toHaveBeenCalledWith('aiseo:rate:readiness:general:203.0.113.5');
    expect(pexpire).toHaveBeenCalledWith('aiseo:rate:readiness:general:203.0.113.5', 60_000);
    expect(headers.get('X-RateLimit-Limit')).toBe('60');
    expect(next).toHaveBeenCalledOnce();
  });

  it('fails closed when Redis protection is unavailable', async () => {
    getQueueConnection.mockImplementation(() => { throw new Error('offline'); });
    const { res } = response();
    const next = vi.fn();

    await createRateLimiter()({ ip: '203.0.113.6', path: '/', socket: {}, traceId: 'trace-1' } as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 'RATE_LIMITER_UNAVAILABLE', traceId: 'trace-1' }) });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns a retry window after the scoped limit is exceeded', async () => {
    const exec = vi.fn().mockResolvedValue([[null, 61], [null, 12_500]]);
    const pttl = vi.fn().mockReturnThis();
    const incr = vi.fn().mockReturnValue({ pttl, exec });
    getQueueConnection.mockReturnValue({ multi: () => ({ incr }), pexpire: vi.fn() });
    const { res, headers } = response();
    const next = vi.fn();

    await createRateLimiter(60_000, 60)({ ip: '203.0.113.7', path: '/organizations/x/sites', socket: {}, traceId: 'trace-2' } as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(headers.get('Retry-After')).toBe('13');
    expect(next).not.toHaveBeenCalled();
  });
});
