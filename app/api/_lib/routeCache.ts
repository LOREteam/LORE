type CacheEntry<T> = {
  payload: T;
  expiresAt: number;
};

const MAX_ROUTE_CACHE_KEY_LENGTH = 4096;
const INVALID_WRITE_VERSION = Number.NaN;
const ROUTE_CACHE_KEY_CONTROL_RE = /[\u0000-\u001f\u007f]/;

function isUsableCacheKey(key: string) {
  return typeof key === "string" && key.length <= MAX_ROUTE_CACHE_KEY_LENGTH && !ROUTE_CACHE_KEY_CONTROL_RE.test(key);
}

function touchEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>) {
  cache.delete(key);
  cache.set(key, entry);
}

function pruneOldest<T>(cache: Map<string, CacheEntry<T>>, maxEntries: number) {
  const evicted: string[] = [];
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next();
    if (oldestKey.done) break;
    const key = oldestKey.value;
    cache.delete(key);
    evicted.push(key);
  }
  return evicted;
}

function normalizeMaxEntries(maxEntries: number) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) return 0;
  return maxEntries;
}

function computeExpiresAt(ttlMs: number, now = Date.now()) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) return 0;
  if (!Number.isSafeInteger(now) || now < 0) return 0;
  if (ttlMs > Number.MAX_SAFE_INTEGER - now) return 0;
  return now + ttlMs;
}

function isFreshEntry<T>(entry: CacheEntry<T>, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) return false;
  return entry.expiresAt > now;
}

export function createRouteCache<T>(maxEntries: number) {
  const capacity = normalizeMaxEntries(maxEntries);
  const cache = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();
  const refresh = new Map<string, Promise<void>>();
  const writeVersion = new Map<string, number>();
  const pendingWrites = new Map<string, Set<number>>();

  const cleanupWriteVersionIfOrphaned = (key: string) => {
    if (!cache.has(key) && !inflight.has(key) && !refresh.has(key) && !pendingWrites.has(key)) {
      writeVersion.delete(key);
    }
  };
  const pruneCache = () => {
    for (const key of pruneOldest(cache, capacity)) cleanupWriteVersionIfOrphaned(key);
  };

  return {
    getFresh(key: string, now = Date.now()) {
      if (!isUsableCacheKey(key)) return null;
      const entry = cache.get(key);
      if (!entry || !isFreshEntry(entry, now)) return null;
      touchEntry(cache, key, entry);
      return entry.payload;
    },
    getStale(key: string) {
      if (!isUsableCacheKey(key)) return null;
      const entry = cache.get(key);
      if (!entry) return null;
      touchEntry(cache, key, entry);
      return entry.payload;
    },
    set(key: string, payload: T, ttlMs: number) {
      if (!isUsableCacheKey(key)) return payload;
      writeVersion.set(key, (writeVersion.get(key) ?? 0) + 1);
      touchEntry(cache, key, {
        payload,
        expiresAt: computeExpiresAt(ttlMs),
      });
      pruneCache();
      return payload;
    },
    beginWrite(key: string) {
      if (!isUsableCacheKey(key)) return INVALID_WRITE_VERSION;
      const nextVersion = (writeVersion.get(key) ?? 0) + 1;
      writeVersion.set(key, nextVersion);
      const versions = pendingWrites.get(key) ?? new Set<number>();
      versions.add(nextVersion);
      pendingWrites.set(key, versions);
      return nextVersion;
    },
    getWriteVersion(key: string) {
      if (!isUsableCacheKey(key)) return 0;
      return writeVersion.get(key) ?? 0;
    },
    setIfLatest(key: string, payload: T, ttlMs: number, version: number) {
      if (!isUsableCacheKey(key) || !Number.isSafeInteger(version) || version <= 0) return payload;
      const versions = pendingWrites.get(key);
      versions?.delete(version);
      if (versions?.size === 0) pendingWrites.delete(key);
      const latestVersion = writeVersion.get(key) ?? 0;
      if (version < latestVersion) {
        cleanupWriteVersionIfOrphaned(key);
        return cache.get(key)?.payload ?? payload;
      }
      touchEntry(cache, key, {
        payload,
        expiresAt: computeExpiresAt(ttlMs),
      });
      pruneCache();
      return payload;
    },
    invalidate(key: string) {
      if (!isUsableCacheKey(key)) return;
      writeVersion.set(key, (writeVersion.get(key) ?? 0) + 1);
      cache.delete(key);
      inflight.delete(key);
      refresh.delete(key);
      cleanupWriteVersionIfOrphaned(key);
    },
    delete(key: string) {
      if (!isUsableCacheKey(key)) return;
      writeVersion.set(key, (writeVersion.get(key) ?? 0) + 1);
      cache.delete(key);
      inflight.delete(key);
      refresh.delete(key);
      cleanupWriteVersionIfOrphaned(key);
    },
    clear() {
      cache.clear();
      inflight.clear();
      refresh.clear();
      writeVersion.clear();
      pendingWrites.clear();
    },
    getInflight(key: string) {
      if (!isUsableCacheKey(key)) return null;
      return inflight.get(key) ?? null;
    },
    setInflight(key: string, promise: Promise<T>) {
      if (!isUsableCacheKey(key)) return promise;
      inflight.set(key, promise);
      return promise;
    },
    clearInflight(key: string, expected?: Promise<T>) {
      if (!isUsableCacheKey(key)) return;
      if (expected && inflight.get(key) !== expected) return;
      inflight.delete(key);
      cleanupWriteVersionIfOrphaned(key);
    },
    getRefresh(key: string) {
      if (!isUsableCacheKey(key)) return null;
      return refresh.get(key) ?? null;
    },
    setRefresh(key: string, promise: Promise<void>) {
      if (!isUsableCacheKey(key)) return promise;
      refresh.set(key, promise);
      return promise;
    },
    clearRefresh(key: string, expected?: Promise<void>) {
      if (!isUsableCacheKey(key)) return;
      if (expected && refresh.get(key) !== expected) return;
      refresh.delete(key);
      cleanupWriteVersionIfOrphaned(key);
    },
    finishWrite(key: string, version: number) {
      if (!isUsableCacheKey(key) || !Number.isSafeInteger(version) || version <= 0) return;
      const versions = pendingWrites.get(key);
      versions?.delete(version);
      if (versions?.size === 0) pendingWrites.delete(key);
      cleanupWriteVersionIfOrphaned(key);
    },
    size() {
      return cache.size;
    },
  };
}
