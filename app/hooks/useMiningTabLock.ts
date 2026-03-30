"use client";

import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import {
  TAB_LOCK_KEY,
  TAB_LOCK_PING_TIMEOUT_MS,
  TAB_LOCK_TTL_MS,
  createTabId,
  getSecureRandomNumber,
  getStableTabId,
} from "./useMining.shared";

const TAB_ID = getStableTabId();

const lockChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(`lore-tab-lock:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`)
    : null;

const pendingLockPingResolvers = new Map<string, (ownerAlive: boolean) => void>();

function readTabLock(): { id: string; ts: number; tx?: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { id: string; ts: number; tx?: string };
  } catch {
    return null;
  }
}

export function acquireTabLock(): boolean {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw) as { id: string; ts: number };
      if (lock.id !== TAB_ID && Date.now() - lock.ts < TAB_LOCK_TTL_MS) {
        return false;
      }
    }

    const newLock = { id: TAB_ID, ts: Date.now(), tx: getSecureRandomNumber(1_000_000).toString() };
    localStorage.setItem(TAB_LOCK_KEY, JSON.stringify(newLock));

    const verifyRaw = localStorage.getItem(TAB_LOCK_KEY);
    if (!verifyRaw) return false;
    const verifyLock = JSON.parse(verifyRaw) as { id: string; ts: number; tx?: string };
    return verifyLock.id === TAB_ID;
  } catch {
    return false;
  }
}

function clearTabLock(lockId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const current = readTabLock();
    if (!current) return true;
    if (lockId && current.id !== lockId) return false;
    window.localStorage.removeItem(TAB_LOCK_KEY);
    lockChannel?.postMessage({ type: "lock-released", from: TAB_ID });
    return true;
  } catch {
    return false;
  }
}

export async function recoverOrphanedTabLock(): Promise<boolean> {
  const lock = readTabLock();
  if (!lock || lock.id === TAB_ID) return false;

  if (Date.now() - lock.ts >= TAB_LOCK_TTL_MS) {
    return clearTabLock(lock.id);
  }

  if (!lockChannel) return false;

  const requestId = createTabId();
  const ownerAlive = await new Promise<boolean>((resolve) => {
    pendingLockPingResolvers.set(requestId, resolve);
    lockChannel.postMessage({ type: "lock-ping", from: TAB_ID, target: lock.id, requestId });
    window.setTimeout(() => {
      const pending = pendingLockPingResolvers.get(requestId);
      if (!pending) return;
      pendingLockPingResolvers.delete(requestId);
      resolve(false);
    }, TAB_LOCK_PING_TIMEOUT_MS);
  });

  if (ownerAlive) return false;

  const latest = readTabLock();
  if (!latest || latest.id !== lock.id) return false;
  return clearTabLock(lock.id);
}

export function renewTabLock() {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return;
    const lock = JSON.parse(raw) as { id: string; ts: number; tx?: string };
    if (lock.id === TAB_ID) {
      localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now(), tx: lock.tx }));
    }
  } catch {
    // ignore storage failures
  }
}

export function releaseTabLock() {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return;
    const lock = JSON.parse(raw) as { id: string; tx?: string };
    if (lock.id === TAB_ID) {
      localStorage.removeItem(TAB_LOCK_KEY);
      lockChannel?.postMessage({ type: "lock-released", from: TAB_ID });
    }
  } catch {
    // ignore storage failures
  }
}

if (lockChannel) {
  lockChannel.onmessage = (event) => {
    const data = event.data as
      | { type?: "lock-ping"; from?: string; target?: string; requestId?: string }
      | { type?: "lock-pong"; from?: string; requestId?: string }
      | { type?: "lock-released"; from?: string }
      | null;
    if (!data?.type) return;

    if (data.type === "lock-ping") {
      if (!data.requestId || data.from === TAB_ID || data.target !== TAB_ID) return;
      const lock = readTabLock();
      if (!lock || lock.id !== TAB_ID || Date.now() - lock.ts >= TAB_LOCK_TTL_MS) return;
      lockChannel.postMessage({ type: "lock-pong", from: TAB_ID, requestId: data.requestId });
      return;
    }

    if (data.type === "lock-pong") {
      if (!data.requestId) return;
      const resolve = pendingLockPingResolvers.get(data.requestId);
      if (!resolve) return;
      pendingLockPingResolvers.delete(data.requestId);
      resolve(true);
    }
  };
}
