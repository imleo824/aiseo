interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LRUCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private readonly maxCapacity: number;
  private readonly defaultTtlMs: number;

  constructor(maxCapacity: number = 200, defaultTtlMs: number = 300000) {
    this.maxCapacity = maxCapacity;
    this.defaultTtlMs = defaultTtlMs;
  }

  public get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  public set(key: K, value: V, ttlMs?: number): void {
    this.pruneExpired();

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCapacity) {
      // Evict oldest entry (first item in Map iteration)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, expiresAt });
  }

  public pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [k, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(k);
        pruned++;
      }
    }
    return pruned;
  }

  public delete(key: K): boolean {
    return this.cache.delete(key);
  }

  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}

export const serpAnalysisCache = new LRUCache<string, any>(100, 600000); // 10 min cache
