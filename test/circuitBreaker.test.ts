import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '../server/infrastructure/resilience/circuitBreaker';
import { LRUCache } from '../server/utils/lruCache';

describe('Resilience & Architecture Utilities', () => {
  describe('CircuitBreaker', () => {
    let cb: CircuitBreaker;

    beforeEach(() => {
      cb = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 2,
        recoveryTimeoutMs: 50
      });
    });

    it('should initially be in CLOSED state', () => {
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after failureThreshold is reached', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Downstream failed'));

      // 1st failure
      await expect(cb.execute(failingFn)).rejects.toThrow('Downstream failed');
      expect(cb.getState()).toBe(CircuitState.CLOSED);

      // 2nd failure -> threshold reached -> OPEN
      await expect(cb.execute(failingFn)).rejects.toThrow('Downstream failed');
      expect(cb.getState()).toBe(CircuitState.OPEN);

      // 3rd call should be rejected immediately by circuit breaker without executing fn
      await expect(cb.execute(failingFn)).rejects.toThrow(/Circuit is OPEN/);
      expect(failingFn).toHaveBeenCalledTimes(2);
    });

    it('should use fallback when circuit is OPEN or failing', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Network error'));
      const fallback = vi.fn().mockReturnValue('fallback-data');

      const res = await cb.execute(failingFn, fallback);
      expect(res).toBe('fallback-data');
      expect(fallback).toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after recoveryTimeoutMs', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Network error'));
      await expect(cb.execute(failingFn)).rejects.toThrow();
      await expect(cb.execute(failingFn)).rejects.toThrow();
      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for recovery timeout
      await new Promise(r => setTimeout(r, 60));
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('LRUCache', () => {
    it('should respect capacity and evict least recently used entries', () => {
      const cache = new LRUCache<string, number>(2, 10000);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);

      // Add 3rd item -> 'b' was least recently accessed, so 'b' is evicted
      cache.set('c', 3);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('b')).toBeUndefined();
    });

    it('should respect TTL expiration', async () => {
      const cache = new LRUCache<string, string>(10, 30);
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');

      await new Promise(r => setTimeout(r, 40));
      expect(cache.get('key')).toBeUndefined();
    });
  });
});
