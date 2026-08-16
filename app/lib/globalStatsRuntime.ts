import { readJsonResponse } from "./readJsonResponse";

export interface GlobalStatsAccumulator {
  volumeRaw: bigint;
  burnRaw: bigint;
  resolvedEpochs: number;
  lastScannedEpoch: number;
  lastScannedBlock: string;
}

export interface GlobalStatsStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function parseNonNegativeBigInt(value: unknown): bigint | null {
  try {
    const parsed = BigInt(String(value ?? ""));
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function parseNonNegativeSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function normalizeGlobalStatsAccumulator(value: unknown): GlobalStatsAccumulator | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const volumeRaw = parseNonNegativeBigInt(obj.volumeRaw);
  const burnRaw = parseNonNegativeBigInt(obj.burnRaw ?? 0);
  const resolvedEpochs = parseNonNegativeSafeInteger(obj.resolvedEpochs);
  const lastScannedEpoch = parseNonNegativeSafeInteger(obj.lastScannedEpoch);
  const lastScannedBlock = String(obj.lastScannedBlock ?? "");
  if (volumeRaw === null || burnRaw === null) return null;
  if (resolvedEpochs === null || lastScannedEpoch === null) return null;
  if (!/^\d+$/.test(lastScannedBlock)) return null;
  return { volumeRaw, burnRaw, resolvedEpochs, lastScannedEpoch, lastScannedBlock };
}

export function getUsableGlobalStatsAccumulator(
  acc: GlobalStatsAccumulator | null,
  currentEpoch: number,
): GlobalStatsAccumulator | null {
  if (!acc || !Number.isSafeInteger(currentEpoch) || currentEpoch < 0) return null;
  return acc.lastScannedEpoch <= currentEpoch ? acc : null;
}

export function safeGlobalStatsCurrentEpoch(currentEpoch?: bigint | null): number | null {
  if (currentEpoch == null || currentEpoch < 0n) return null;
  if (currentEpoch > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(currentEpoch);
}

export function removeGlobalStatsCache(storage: GlobalStatsStorage | null, cacheKey: string) {
  if (!storage) return;
  try {
    storage.removeItem(cacheKey);
  } catch {
    // Cache cleanup is best effort.
  }
}

export function loadGlobalStatsCache(
  storage: GlobalStatsStorage | null,
  cacheKey: string,
): GlobalStatsAccumulator | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return null;
    const acc = normalizeGlobalStatsAccumulator(JSON.parse(raw));
    if (!acc) removeGlobalStatsCache(storage, cacheKey);
    return acc;
  } catch {
    removeGlobalStatsCache(storage, cacheKey);
    return null;
  }
}

export function saveGlobalStatsCache(
  storage: GlobalStatsStorage | null,
  cacheKey: string,
  acc: GlobalStatsAccumulator,
) {
  if (!storage) return;
  try {
    storage.setItem(cacheKey, JSON.stringify({
      volumeRaw: acc.volumeRaw.toString(),
      burnRaw: acc.burnRaw.toString(),
      resolvedEpochs: acc.resolvedEpochs,
      lastScannedEpoch: acc.lastScannedEpoch,
      lastScannedBlock: acc.lastScannedBlock,
    }));
  } catch {
    // Cache writes are best effort.
  }
}

export async function fetchGlobalStatsAccumulator({
  currentEpoch,
  fetchImpl = fetch,
  signal,
}: {
  currentEpoch: number;
  fetchImpl?: typeof fetch;
  signal: AbortSignal;
}): Promise<GlobalStatsAccumulator> {
  if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0) {
    throw new Error("global stats current epoch is invalid");
  }
  const response = await fetchImpl("/api/global-stats", { cache: "no-store", signal });
  if (!response.ok) throw new Error(`global stats request failed: ${response.status}`);
  const payload = await readJsonResponse<Record<string, unknown>>(response);
  if (!payload) throw new Error("global stats response is empty");
  const next = normalizeGlobalStatsAccumulator({
    volumeRaw: payload.totalVolumeWei,
    burnRaw: payload.totalBurnWei,
    resolvedEpochs: payload.resolvedEpochs,
    lastScannedEpoch: currentEpoch,
    lastScannedBlock: payload.lastIndexedBlock,
  });
  if (!next) throw new Error("global stats response is invalid");
  return next;
}
