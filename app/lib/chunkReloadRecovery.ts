export const CHUNK_RELOAD_KEY = "lore:chunk-reload-once";
export const CHUNK_RELOAD_WINDOW_MS = 15_000;

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

export function isChunkLoadLikeErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("chunkloaderror") ||
    (lower.includes("loading chunk") && lower.includes("/_next/static/chunks/")) ||
    (lower.includes("loading chunk") && lower.includes("failed"))
  );
}

export function shouldAttemptChunkReloadOnce(
  storage: StorageLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!storage) return true;
  const raw = storage.getItem(CHUNK_RELOAD_KEY);
  const lastAt = raw === null ? Number.NaN : Number(raw);
  const alreadyRetried = Number.isFinite(lastAt) && now - lastAt < CHUNK_RELOAD_WINDOW_MS;
  if (alreadyRetried) return false;
  storage.setItem(CHUNK_RELOAD_KEY, String(now));
  return true;
}

export function clearExpiredChunkReloadAttempt(
  storage: StorageLike | null | undefined,
  now: number = Date.now(),
) {
  if (!storage) return;
  const raw = storage.getItem(CHUNK_RELOAD_KEY);
  const lastAt = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(lastAt) || now - lastAt >= CHUNK_RELOAD_WINDOW_MS) {
    storage.removeItem(CHUNK_RELOAD_KEY);
  }
}

export function reloadWithCacheBust(locationLike: LocationLike, now: number = Date.now()) {
  try {
    const url = new URL(locationLike.href);
    url.searchParams.set("_r", String(now));
    locationLike.replace(url.toString());
  } catch {
    locationLike.reload();
  }
}
