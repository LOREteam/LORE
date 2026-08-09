"use client";

import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";
import {
  TAB_LOCK_KEY,
  TAB_LOCK_PING_TIMEOUT_MS,
  TAB_LOCK_TTL_MS,
  createTabId,
  getStableTabId,
  sanitizeTabLock,
} from "./useMining.shared";

const TAB_ID = getStableTabId();

const lockChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(`lore-tab-lock:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`)
    : null;

const pendingLockPingResolvers = new Map<string, (ownerAlive: boolean) => void>();
let releaseNativeTabLock: (() => void) | null = null;

function clearInvalidStoredTabLock() {
  try {
    localStorage.removeItem(TAB_LOCK_KEY);
  } catch {
    // ignore storage failures
  }
}

async function acquireNativeTabLock(): Promise<boolean> {
  if (releaseNativeTabLock) return true;
  if (typeof navigator === "undefined" || !navigator.locks) return false;

  return new Promise((resolve) => {
    let release!: () => void;
    const hold = new Promise<void>((releaseHold) => {
      release = releaseHold;
    });

    void navigator.locks
      .request(TAB_LOCK_KEY, { ifAvailable: true, mode: "exclusive" }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        releaseNativeTabLock = release;
        resolve(true);
        await hold;
        if (releaseNativeTabLock === release) releaseNativeTabLock = null;
      })
      .catch(() => resolve(false));
  });
}

function readTabLock() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return null;
    const lock = sanitizeTabLock(JSON.parse(raw));
    if (!lock) clearInvalidStoredTabLock();
    return lock;
  } catch {
    clearInvalidStoredTabLock();
    return null;
  }
}

export async function acquireTabLock(): Promise<boolean> {
  // localStorage read/write verification is not atomic across tabs. Starting an
  // Auto-Miner without the browser lock can duplicate wallet sends.
  return acquireNativeTabLock();
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
    let timeoutId: number | null = null;
    const resolvePing = (alive: boolean) => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      pendingLockPingResolvers.delete(requestId);
      resolve(alive);
    };
    pendingLockPingResolvers.set(requestId, resolvePing);
    lockChannel.postMessage({ type: "lock-ping", from: TAB_ID, target: lock.id, requestId });
    timeoutId = window.setTimeout(() => {
      const pending = pendingLockPingResolvers.get(requestId);
      if (!pending) return;
      pending(false);
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
    const lock = sanitizeTabLock(JSON.parse(raw));
    if (!lock) {
      clearInvalidStoredTabLock();
      return;
    }
    if (lock.id === TAB_ID) {
      localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now(), tx: lock.tx }));
    }
  } catch {
    clearInvalidStoredTabLock();
  }
}

export function releaseTabLock() {
  const release = releaseNativeTabLock;
  releaseNativeTabLock = null;
  release?.();
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return;
    const lock = sanitizeTabLock(JSON.parse(raw));
    if (!lock) {
      clearInvalidStoredTabLock();
      return;
    }
    if (lock.id === TAB_ID) {
      localStorage.removeItem(TAB_LOCK_KEY);
      lockChannel?.postMessage({ type: "lock-released", from: TAB_ID });
    }
  } catch {
    clearInvalidStoredTabLock();
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
