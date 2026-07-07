"use client";

const RESOLVE_STORAGE_KEY = "lore_resolve_epoch";

export interface ResolveGuardEntry {
  epoch: string;
  ts: number;
}

export function normalizeResolveGuardEntry(value: unknown): ResolveGuardEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const epoch = typeof raw.epoch === "string" ? raw.epoch.trim() : "";
  if (!/^\d+$/.test(epoch)) return null;
  const ts = typeof raw.ts === "number" && Number.isFinite(raw.ts) && raw.ts > 0 ? raw.ts : 0;
  return { epoch, ts };
}

export function readResolveGuard(): ResolveGuardEntry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(RESOLVE_STORAGE_KEY);
    if (!raw) return null;
    if (raw[0] !== "{") return normalizeResolveGuardEntry({ epoch: raw, ts: 0 });
    return normalizeResolveGuardEntry(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeResolveGuard(epoch: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RESOLVE_STORAGE_KEY, JSON.stringify({ epoch, ts: Date.now() }));
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
