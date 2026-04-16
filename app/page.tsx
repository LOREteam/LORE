import LineaOreClient from "./LineaOreClient";
import {
  buildStoredLiveStateBootstrap,
  getLiveStatePayloadWithSnapshotFallback,
  loadLiveStateSnapshot,
  type LiveStatePayload,
} from "./api/live-state/shared";
import {
  getRecentWinsPayloadForRender,
  loadRecentWinsSnapshot,
  saveRecentWinsSnapshot,
} from "./api/recent-wins/data";

const PAGE_LIVE_STATE_CACHE_MS = 4_000;
const PAGE_LIVE_STATE_RENDER_WAIT_MS = 1_200;
const PAGE_RECENT_WINS_RENDER_WAIT_MS = 1_200;

type CachedInitialLiveState = {
  payload: LiveStatePayload | null;
  expiresAt: number;
};

let initialLiveStateCache: CachedInitialLiveState | null = null;
let initialLiveStateInflight: Promise<LiveStatePayload | null> | null = null;

function sanitizeInitialLiveState(payload: LiveStatePayload | null): LiveStatePayload | null {
  if (!payload) return null;
  return JSON.parse(
    JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  ) as LiveStatePayload;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return Promise.race<T | null>([
    promise,
    new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function startInitialLiveStateRefresh() {
  if (!initialLiveStateInflight) {
    initialLiveStateInflight = getLiveStatePayloadWithSnapshotFallback()
      .then((payload) => {
        const sanitizedPayload = sanitizeInitialLiveState(payload);
        initialLiveStateCache = {
          payload: sanitizedPayload,
          expiresAt: Date.now() + PAGE_LIVE_STATE_CACHE_MS,
        };
        return sanitizedPayload;
      })
      .catch(() => {
        const previousPayload = initialLiveStateCache?.payload ?? null;
        initialLiveStateCache = {
          payload: previousPayload,
          expiresAt: Date.now() + (previousPayload ? PAGE_LIVE_STATE_CACHE_MS : 1_000),
        };
        return previousPayload;
      })
      .finally(() => {
        initialLiveStateInflight = null;
      });
  }

  return initialLiveStateInflight;
}

async function getInitialLiveState() {
  const now = Date.now();
  if (initialLiveStateCache && initialLiveStateCache.expiresAt > now) {
    return initialLiveStateCache.payload;
  }

  const persistedSnapshot = sanitizeInitialLiveState(
    loadLiveStateSnapshot(Number.POSITIVE_INFINITY) ?? buildStoredLiveStateBootstrap(),
  );
  if (persistedSnapshot) {
    initialLiveStateCache = {
      payload: persistedSnapshot,
      expiresAt: now + PAGE_LIVE_STATE_CACHE_MS,
    };
    void startInitialLiveStateRefresh();
    return persistedSnapshot;
  }

  if (initialLiveStateCache) {
    void startInitialLiveStateRefresh();
    return initialLiveStateCache.payload;
  }

  const payload = await withTimeout(startInitialLiveStateRefresh(), PAGE_LIVE_STATE_RENDER_WAIT_MS);
  return payload;
}

async function getInitialRecentWins() {
  const snapshot = loadRecentWinsSnapshot();
  if (snapshot) {
    void getRecentWinsPayloadForRender()
      .then((payload) => {
        saveRecentWinsSnapshot(payload);
        return payload;
      })
      .catch(() => undefined);
    return snapshot.wins;
  }

  const payload = await withTimeout(getRecentWinsPayloadForRender(), PAGE_RECENT_WINS_RENDER_WAIT_MS);
  if (payload) {
    saveRecentWinsSnapshot(payload);
    return payload.wins;
  }

  return [];
}

export default async function Page() {
  const initialLiveState = await getInitialLiveState();
  const initialRecentWins = await getInitialRecentWins();
  return (
    <LineaOreClient
      initialLiveState={initialLiveState}
      initialNowMs={Date.now()}
      initialRecentWins={initialRecentWins}
    />
  );
}
