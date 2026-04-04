import { markRouteBackgroundRefresh } from "./runtimeMetrics";

type RefreshCapableCache<TPayload> = {
  getRefresh(key: string): Promise<void> | null;
  setRefresh(key: string, promise: Promise<void>): Promise<void>;
  clearRefresh(key: string): void;
  getInflight(key: string): Promise<TPayload> | null;
  setInflight(key: string, promise: Promise<TPayload>): Promise<TPayload>;
  clearInflight(key: string): void;
  beginWrite(key: string): number;
  setIfLatest(key: string, payload: TPayload, ttlMs: number, version: number): TPayload;
};

type StartBackgroundRefreshOptions<TBuildResult, TPayload> = {
  cache: RefreshCapableCache<TPayload>;
  cacheKey: string;
  ttlMs: number;
  routeMetricKey: string;
  build: () => Promise<TBuildResult>;
  toPayload: (result: TBuildResult) => TPayload;
  onError: (error: unknown) => void;
  onCommit?: (result: TBuildResult, payload: TPayload) => void;
  shouldSkip?: () => boolean;
};

type StartInflightBuildOptions<TBuildResult, TPayload> = {
  cache: RefreshCapableCache<TPayload>;
  cacheKey: string;
  ttlMs: number;
  build: () => Promise<TBuildResult>;
  toPayload: (result: TBuildResult) => TPayload;
  onCommit?: (result: TBuildResult, payload: TPayload) => void;
};

export function startVersionedBackgroundRefresh<TBuildResult, TPayload>(
  options: StartBackgroundRefreshOptions<TBuildResult, TPayload>,
) {
  const { cache, cacheKey, ttlMs, routeMetricKey, build, toPayload, onError, onCommit, shouldSkip } = options;
  if (cache.getRefresh(cacheKey) || cache.getInflight(cacheKey) || shouldSkip?.()) {
    return;
  }

  markRouteBackgroundRefresh(routeMetricKey);
  const writeVersion = cache.beginWrite(cacheKey);
  const refreshPromise = build()
    .then((result) => {
      const payload = toPayload(result);
      cache.setIfLatest(cacheKey, payload, ttlMs, writeVersion);
      onCommit?.(result, payload);
    })
    .catch((error) => {
      onError(error);
    })
    .finally(() => {
      cache.clearRefresh(cacheKey);
    });

  cache.setRefresh(cacheKey, refreshPromise);
}

export function startVersionedInflightBuild<TBuildResult, TPayload>(
  options: StartInflightBuildOptions<TBuildResult, TPayload>,
) {
  const { cache, cacheKey, ttlMs, build, toPayload, onCommit } = options;
  const writeVersion = cache.beginWrite(cacheKey);
  const buildPromise = build();
  const requestPromise = buildPromise
    .then((result) => {
      const payload = toPayload(result);
      onCommit?.(result, payload);
      return cache.setIfLatest(cacheKey, payload, ttlMs, writeVersion);
    })
    .finally(() => {
      cache.clearInflight(cacheKey);
    });

  cache.setInflight(cacheKey, requestPromise);
  return { buildPromise, requestPromise };
}
