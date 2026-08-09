"use client";

const RESOLVE_STORAGE_KEY = "lore_resolve_epoch";
const RESOLVE_GUARD_MAX_FUTURE_SKEW_MS = 5_000;
const RESOLVE_GUARD_MAX_EPOCH_DIGITS = 20;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export interface ResolveGuardEntry {
  epoch: string;
  ts: number;
}

function normalizeResolveGuardTimestamp(value: unknown, now = Date.now()) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return null;
  if (value - now > RESOLVE_GUARD_MAX_FUTURE_SKEW_MS) return null;
  return value;
}

function normalizeResolveGuardEpoch(value: unknown) {
  if (typeof value !== "string") return null;
  const epoch = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(epoch)) return null;
  if (epoch.length > RESOLVE_GUARD_MAX_EPOCH_DIGITS) return null;
  if (BigInt(epoch) > MAX_SAFE_INTEGER_BIGINT) return null;
  return epoch;
}

export function normalizeResolveGuardEntry(value: unknown, now = Date.now()): ResolveGuardEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const epoch = normalizeResolveGuardEpoch(raw.epoch);
  if (epoch === null) return null;
  const ts = normalizeResolveGuardTimestamp(raw.ts, now);
  if (ts === null) return null;
  return { epoch, ts };
}

export function readResolveGuard(): ResolveGuardEntry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(RESOLVE_STORAGE_KEY);
    if (!raw) return null;
    if (raw[0] !== "{") {
      const epoch = normalizeResolveGuardEpoch(raw);
      if (epoch === null) {
        clearResolveGuard();
        return null;
      }
      const migrated = { epoch, ts: Date.now() };
      localStorage.setItem(RESOLVE_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const entry = normalizeResolveGuardEntry(JSON.parse(raw));
    if (!entry) clearResolveGuard();
    return entry;
  } catch {
    clearResolveGuard();
    return null;
  }
}

export function writeResolveGuard(epoch: string) {
  if (typeof localStorage === "undefined") return;
  const normalizedEpoch = normalizeResolveGuardEpoch(epoch);
  if (normalizedEpoch === null) return;
  try {
    localStorage.setItem(RESOLVE_STORAGE_KEY, JSON.stringify({ epoch: normalizedEpoch, ts: Date.now() }));
  } catch {
    // ignore
  }
}

export function clearResolveGuard() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(RESOLVE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
