"use client";

const RESOLVE_STORAGE_KEY = "lore_resolve_epoch";

export interface ResolveGuardEntry {
  epoch: string;
  ts: number;
}

export function readResolveGuard(): ResolveGuardEntry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(RESOLVE_STORAGE_KEY);
    if (!raw) return null;
    if (raw[0] !== "{") return { epoch: raw, ts: 0 };
    const parsed = JSON.parse(raw) as { epoch?: string; ts?: number };
    if (!parsed?.epoch) return null;
    return { epoch: parsed.epoch, ts: Number(parsed.ts) || 0 };
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
