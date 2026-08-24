import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitState } from '../server/infrastructure/resilience/circuitBreaker';
import { LRUCache } from '../server/utils/lruCache';
import { eventBus } from '../server/domain/eventBus';
import { fileTenantRepository } from '../server/infrastructure/persistence/fileTenantRepository';
import { ApiService } from '../src/services/api';

describe('Senior Architecture & Code Optimization Suite', () => {
  it('CircuitBreaker should enforce single-flight probe execution in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 10, name: 'test-probe-cb' });
    
    // Fail once to trip to OPEN
    try {
      await cb.execute(async () => { throw new Error('Downstream boom'); });
    } catch {}

    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Wait recovery timeout to enter HALF_OPEN
    await new Promise(r => setTimeout(r, 20));
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

    // Launch probe that hangs briefly
    let resolveProbe: any;
    const probePromise = cb.execute(async () => {
      return new Promise(r => { resolveProbe = r; });
    });

    // Concurrent call during HALF_OPEN should be rejected as probe is in flight
    await expect(cb.execute(async () => 'concurrent')).rejects.toThrow('Concurrent execution rejected');

    resolveProbe('ok');
    await expect(probePromise).resolves.toBe('ok');
  });

  it('LRUCache active pruneExpired should remove stale entries', async () => {
    const cache = new LRUCache<string, string>(10, 50); // 50ms TTL
    cache.set('key1', 'val1');
    cache.set('key2', 'val2');

    expect(cache.size()).toBe(2);
    await new Promise(r => setTimeout(r, 60));

    // Force prune
    const count = cache.pruneExpired();
    expect(count).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it('DomainEventBus should isolate subscriber exceptions and not crash callers', async () => {
    let subscriberBExecuted = false;

    const throwingSubscriber = vi.fn().mockImplementation(() => {
      throw new Error('Subscriber crash!');
    });

    const normalSubscriber = vi.fn().mockImplementation(() => {
      subscriberBExecuted = true;
    });

    eventBus.subscribe('SITE_CREATED', throwingSubscriber);
    eventBus.subscribe('SITE_CREATED', normalSubscriber);

    // Publish event should not throw despite throwing subscriber
    expect(() => {
      eventBus.publish({
        id: 'evt-test-1',
        type: 'SITE_CREATED',
        tenantId: 'tenant-a',
        timestamp: new Date().toISOString(),
        payload: { siteId: 's-1' }
      });
    }).not.toThrow();

    await new Promise(r => setTimeout(r, 20));
    expect(subscriberBExecuted).toBe(true);

    eventBus.unsubscribe('SITE_CREATED', throwingSubscriber);
    eventBus.unsubscribe('SITE_CREATED', normalSubscriber);
  });

  it('FileTenantRepository should support forceFlush and safe debounced saves', async () => {
    const account = fileTenantRepository.getAccount('tenant-a');
    expect(account).toBeDefined();

    await fileTenantRepository.appendAuditLog('tenant-a', {
      id: `log-arch-test-${Date.now()}`,
      siteId: 'site-1',
      timestamp: new Date().toISOString(),
      actor: 'SYSTEM_AUTOPILOT',
      action: 'SITE_AUDIT',
      target: 'Architecture Test',
      result: 'SUCCESS',
      details: 'Architecture Optimization Verified'
    });

    await expect(fileTenantRepository.forceFlush()).resolves.not.toThrow();
  });

  it('ApiService should automatically retry transient HTTP 502/503 errors', async () => {
    let attempts = 0;
    const customFetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          json: async () => ({ error: { message: 'Transient proxy error' } })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' })
      };
    });

    vi.stubGlobal('fetch', customFetch);

    const api = new ApiService('tenant-a');
    const health = await api.checkHealth();

    expect(attempts).toBe(2);
    expect(health).toEqual({ status: 'ok' });

    vi.unstubAllGlobals();
  });
});
