export const CHUNK_RELOAD_KEY = "lore:chunk-reload-once";
export const CHUNK_RELOAD_WINDOW_MS = 15_000;
export const CHUNK_RELOAD_PARAM = "__lore_reload";
const LEGACY_CHUNK_RELOAD_PARAM = "_r";

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface LocationLike {
  href: string;
  reload(): void;
  replace(url: string): void;
}

interface HistoryLike {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export function isChunkLoadLikeErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("chunkloaderror") ||
    (lower.includes("loading chunk") && lower.includes("/_next/static/chunks/")) ||
    (lower.includes("loading chunk") && lower.includes("failed")) ||
    (lower.includes("failed to fetch dynamically imported module") && lower.includes("/_next/static/chunks/")) ||
    (lower.includes("importing a module script failed") && lower.includes("/_next/static/chunks/"))
  );
}

function normalizeChunkReloadNow(now: number): number | null {
  return Number.isSafeInteger(now) && now >= 0 ? now : null;
}

function parseStoredChunkReloadAt(value: string | null, now: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,15})$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed > now) return null;
  return parsed;
}

export function shouldAttemptChunkReloadOnce(
  storage: StorageLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!storage) return true;
  const currentNow = normalizeChunkReloadNow(now);
  if (currentNow === null) return false;
  const raw = storage.getItem(CHUNK_RELOAD_KEY);
  const lastAt = parseStoredChunkReloadAt(raw, currentNow);
  const alreadyRetried = lastAt !== null && currentNow - lastAt < CHUNK_RELOAD_WINDOW_MS;
  if (alreadyRetried) return false;
  storage.setItem(CHUNK_RELOAD_KEY, String(currentNow));
  return true;
}

export function clearExpiredChunkReloadAttempt(
  storage: StorageLike | null | undefined,
  now: number = Date.now(),
) {
  if (!storage) return;
  const currentNow = normalizeChunkReloadNow(now);
  if (currentNow === null) {
    storage.removeItem(CHUNK_RELOAD_KEY);
    return;
  }
  const raw = storage.getItem(CHUNK_RELOAD_KEY);
  const lastAt = parseStoredChunkReloadAt(raw, currentNow);
  if (lastAt === null || currentNow - lastAt >= CHUNK_RELOAD_WINDOW_MS) {
    storage.removeItem(CHUNK_RELOAD_KEY);
  }
}

export function reloadWithCacheBust(locationLike: LocationLike, now: number = Date.now()) {
  try {
    const url = new URL(locationLike.href);
    const currentNow = normalizeChunkReloadNow(now) ?? normalizeChunkReloadNow(Date.now()) ?? 0;
    url.searchParams.delete(LEGACY_CHUNK_RELOAD_PARAM);
    url.searchParams.set(CHUNK_RELOAD_PARAM, String(currentNow));
    locationLike.replace(url.toString());
  } catch {
    locationLike.reload();
  }
}

export function stripChunkReloadCacheParam(
  locationLike: Pick<LocationLike, "href">,
  historyLike: HistoryLike | null | undefined,
) {
  if (!historyLike) return false;
  try {
    const url = new URL(locationLike.href);
    const hadParam = url.searchParams.has(CHUNK_RELOAD_PARAM) || url.searchParams.has(LEGACY_CHUNK_RELOAD_PARAM);
    if (!hadParam) return false;
    url.searchParams.delete(CHUNK_RELOAD_PARAM);
    url.searchParams.delete(LEGACY_CHUNK_RELOAD_PARAM);
    const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
    historyLike.replaceState(historyLike.state, "", cleanUrl);
    return true;
  } catch {
    return false;
  }
}
