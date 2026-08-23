import { describe, it, expect } from 'vitest';
import { LRUCache } from '../server/utils/lruCache';

describe('LRUCache', () => {
  it('should store and retrieve values correctly', () => {
    const cache = new LRUCache<string, string>(5, 10000);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');

    expect(cache.get('k1')).toBe('v1');
    expect(cache.get('k2')).toBe('v2');
    expect(cache.has('k1')).toBe(true);
    expect(cache.has('non-existent')).toBe(false);
  });

  it('should evict oldest entry when capacity is exceeded', () => {
    const cache = new LRUCache<string, number>(2, 10000);
    cache.set('a', 1);
    cache.set('b', 2);
    // Access 'a' to mark it recently used
    cache.get('a');
    
    // Add third item, 'b' should be evicted
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    expect(cache.size()).toBe(2);
  });

  it('should expire values past TTL', async () => {
    const cache = new LRUCache<string, string>(10, 20); // 20ms TTL
    cache.set('temp', 'val', 20);

    expect(cache.get('temp')).toBe('val');

    await new Promise((r) => setTimeout(r, 40));
    expect(cache.get('temp')).toBeUndefined();
  });

  it('should clear all entries on clear()', () => {
    const cache = new LRUCache<string, string>(5, 10000);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('k1')).toBeUndefined();
  });
});
