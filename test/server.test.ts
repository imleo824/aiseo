import { describe, it, expect, vi } from 'vitest';
import { createRateLimiter } from '../server/middleware/rateLimiter';
import { tenantMiddleware, TenantRequest } from '../server/middleware/tenant';
import { Response } from 'express';

function createMockResponse() {
  const headers: Record<string, any> = {};
  let statusCode = 200;
  let body: any = null;

  const res: any = {
    setHeader(key: string, val: any) {
      headers[key] = val;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      body = data;
      return res;
    },
    on(event: string, _callback: () => void) {
      if (event === 'finish') {
        // mock event finish listener
      }
    }
  };

  return {
    res: res as Response,
    getHeaders: () => headers,
    getStatus: () => statusCode,
    getBody: () => body
  };
}

describe('Enterprise Middleware Suite', () => {
  it('tenantMiddleware should assign tenant-a as default tenantId', () => {
    const req: any = {
      path: '/api/sites',
      headers: { 'x-tenant-id': 'tenant-a' },
      method: 'GET'
    };
    const { res } = createMockResponse();
    const next = vi.fn();

    tenantMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as TenantRequest).tenantId).toBe('tenant-a');
    expect((req as TenantRequest).tenantData).toBeDefined();
  });

  it('rateLimiter should allow standard traffic and attach headers', () => {
    const limiter = createRateLimiter(60000, 10);
    const req: any = {
      headers: { 'x-tenant-id': 'tenant-test' },
      socket: { remoteAddress: '127.0.0.1' },
      path: '/api/sites'
    };
    const { res, getHeaders, getStatus } = createMockResponse();
    const next = vi.fn();

    limiter(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getHeaders()['X-RateLimit-Limit']).toBe(10);
    expect(getStatus()).toBe(200);
  });

  it('rateLimiter should block when threshold is exceeded', () => {
    const limiter = createRateLimiter(60000, 2);
    const req: any = {
      headers: { 'x-tenant-id': 'tenant-block' },
      socket: { remoteAddress: '10.0.0.1' },
      path: '/api/sites'
    };
    const next = vi.fn();

    // Send 3 requests
    const r1 = createMockResponse();
    limiter(req, r1.res, next);

    const r2 = createMockResponse();
    limiter(req, r2.res, next);

    const r3 = createMockResponse();
    limiter(req, r3.res, next);

    expect(r3.getStatus()).toBe(429);
    expect(r3.getBody().error.code).toBe('TOO_MANY_REQUESTS');
  });
});
