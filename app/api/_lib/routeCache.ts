type CacheEntry<T> = {
  payload: T;
  expiresAt: number;
};

function touchEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>) {
  cache.delete(key);
  cache.set(key, entry);
}

function pruneOldest<T>(cache: Map<string, CacheEntry<T>>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function createRouteCache<T>(maxEntries: number) {
  const cache = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();
  const refresh = new Map<string, Promise<void>>();
  const writeVersion = new Map<string, number>();

  return {
    getFresh(key: string, now = Date.now()) {
      const entry = cache.get(key);
      if (!entry || entry.expiresAt <= now) return null;
      touchEntry(cache, key, entry);
      return entry.payload;
    },
    getStale(key: string) {
      const entry = cache.get(key);
      if (!entry) return null;
      touchEntry(cache, key, entry);
      return entry.payload;
    },
    set(key: string, payload: T, ttlMs: number) {
      touchEntry(cache, key, {
        payload,
        expiresAt: Date.now() + ttlMs,
      });
      pruneOldest(cache, maxEntries);
      return payload;
    },
    beginWrite(key: string) {
      const nextVersion = (writeVersion.get(key) ?? 0) + 1;
      writeVersion.set(key, nextVersion);
      return nextVersion;
    },
    setIfLatest(key: string, payload: T, ttlMs: number, version: number) {
      const latestVersion = writeVersion.get(key) ?? 0;
      if (version < latestVersion) {
        return cache.get(key)?.payload ?? payload;
      }
      touchEntry(cache, key, {
        payload,
        expiresAt: Date.now() + ttlMs,
      });
      pruneOldest(cache, maxEntries);
      return payload;
    },
    delete(key: string) {
      cache.delete(key);
      inflight.delete(key);
      refresh.delete(key);
      writeVersion.delete(key);
    },
    clear() {
      cache.clear();
      inflight.clear();
      refresh.clear();
      writeVersion.clear();
    },
    getInflight(key: string) {
      return inflight.get(key) ?? null;
    },
    setInflight(key: string, promise: Promise<T>) {
      inflight.set(key, promise);
      return promise;
    },
    clearInflight(key: string) {
      inflight.delete(key);
    },
    getRefresh(key: string) {
      return refresh.get(key) ?? null;
    },
    setRefresh(key: string, promise: Promise<void>) {
      refresh.set(key, promise);
      return promise;
    },
    clearRefresh(key: string) {
      refresh.delete(key);
    },
    size() {
      return cache.size;
    },
  };
}
