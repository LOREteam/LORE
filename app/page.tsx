import LineaOreClient from "./LineaOreClient";
import { buildLiveStatePayload, type LiveStatePayload } from "./api/live-state/shared";

const PAGE_LIVE_STATE_CACHE_MS = 4_000;
const PAGE_LIVE_STATE_RENDER_WAIT_MS = 1_200;

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
    initialLiveStateInflight = buildLiveStatePayload()
      .then((payload) => {
        const sanitizedPayload = sanitizeInitialLiveState(payload);
        initialLiveStateCache = {
          payload: sanitizedPayload,
          expiresAt: Date.now() + PAGE_LIVE_STATE_CACHE_MS,
        };
        return sanitizedPayload;
      })
      .catch(() => {
        initialLiveStateCache = {
          payload: null,
          expiresAt: Date.now() + 1_000,
        };
        return null;
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

  if (initialLiveStateCache) {
    void startInitialLiveStateRefresh();
    return initialLiveStateCache.payload;
  }

  const payload = await withTimeout(startInitialLiveStateRefresh(), PAGE_LIVE_STATE_RENDER_WAIT_MS);
  return payload;
}

export default async function Page() {
  const initialLiveState = await getInitialLiveState();
  return <LineaOreClient initialLiveState={initialLiveState} initialNowMs={Date.now()} />;
}
