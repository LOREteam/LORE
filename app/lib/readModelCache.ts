import { normalizeCacheTimestamp } from "./cacheTimestamp";

export type ReadModelCacheStorage = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
};

type NormalizedPayload<T> = {
  rawPayload: unknown;
  value: T;
  legacy: boolean;
};

export type LoadReadModelCacheOptions<T> = {
  storage: ReadModelCacheStorage | null | undefined;
  cacheKey: string;
  payloadKey: string;
  emptyValue: T;
  normalizePayload(value: unknown): T;
  acceptPayload?(payload: NormalizedPayload<T>): boolean;
  now?: number;
};

function removeCacheKey(storage: ReadModelCacheStorage, cacheKey: string) {
  try {
    storage.removeItem(cacheKey);
  } catch {
    // Cache cleanup must not interrupt the read model.
  }
}

export function loadReadModelCache<T>(
  options: LoadReadModelCacheOptions<T>,
): { value: T; savedAt: number | null } {
  const {
    storage,
    cacheKey,
    payloadKey,
    emptyValue,
    normalizePayload,
    acceptPayload = () => true,
    now = Date.now(),
  } = options;
  if (!storage) return { value: emptyValue, savedAt: null };

  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return { value: emptyValue, savedAt: null };
    const parsed = JSON.parse(raw) as unknown;
    const legacy = Array.isArray(parsed);
    if (!legacy && (!parsed || typeof parsed !== "object")) {
      removeCacheKey(storage, cacheKey);
      return { value: emptyValue, savedAt: null };
    }

    const envelope = legacy ? null : parsed as Record<string, unknown>;
    const rawPayload = legacy ? parsed : envelope?.[payloadKey];
    const value = normalizePayload(rawPayload);
    if (!acceptPayload({ rawPayload, value, legacy })) {
      removeCacheKey(storage, cacheKey);
      return { value: emptyValue, savedAt: null };
    }
    return {
      value,
      savedAt: legacy ? null : normalizeCacheTimestamp(envelope?.savedAt, now),
    };
  } catch {
    removeCacheKey(storage, cacheKey);
    return { value: emptyValue, savedAt: null };
  }
}
