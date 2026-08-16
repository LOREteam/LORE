"use client";

import { getAddress } from "viem";

const EOA_NONCE_LOCK_PREFIX = "lineaore:eoa-nonce-lock:v1";

export type EoaNonceLockFailure = "invalid-identity" | "unavailable" | "contended";

export class EoaNonceLockError extends Error {
  readonly reason: EoaNonceLockFailure;

  constructor(reason: EoaNonceLockFailure) {
    const message = reason === "invalid-identity"
      ? "EOA nonce lock identity is invalid."
      : reason === "unavailable"
        ? "Web Locks are required for cross-tab-safe EOA nonce submission in this browser."
        : "Another tab is already reserving or submitting a transaction for this wallet.";
    super(message);
    this.name = "EoaNonceLockError";
    this.reason = reason;
  }
}

type EoaNonceLockIdentity = {
  chainId: number;
  actor: string;
};

type EoaNonceLockOptions = {
  ifAvailable?: boolean;
  errorFactory?: (reason: EoaNonceLockFailure) => Error;
};

export type EoaNonceLockLease = {
  name: string;
  release: () => void;
};

function lockError(options: EoaNonceLockOptions, reason: EoaNonceLockFailure) {
  return options.errorFactory?.(reason) ?? new EoaNonceLockError(reason);
}

export function getEoaNonceLockName(identity: EoaNonceLockIdentity): string {
  if (!Number.isSafeInteger(identity.chainId) || identity.chainId <= 0) {
    throw new EoaNonceLockError("invalid-identity");
  }
  try {
    return `${EOA_NONCE_LOCK_PREFIX}:${identity.chainId}:${getAddress(identity.actor).toLowerCase()}`;
  } catch {
    throw new EoaNonceLockError("invalid-identity");
  }
}

function resolveLockName(identity: EoaNonceLockIdentity, options: EoaNonceLockOptions) {
  try {
    return getEoaNonceLockName(identity);
  } catch {
    throw lockError(options, "invalid-identity");
  }
}

function getBrowserLocks(options: EoaNonceLockOptions) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) throw lockError(options, "unavailable");
  return locks;
}

export async function withEoaNonceLock<T>(
  identity: EoaNonceLockIdentity,
  options: EoaNonceLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const name = resolveLockName(identity, options);
  const locks = getBrowserLocks(options);
  return locks.request(
    name,
    options.ifAvailable
      ? { ifAvailable: true, mode: "exclusive" }
      : { mode: "exclusive" },
    async (lock) => {
      if (!lock) throw lockError(options, "contended");
      return operation();
    },
  );
}

export async function acquireEoaNonceLockLease(
  identity: EoaNonceLockIdentity,
  options: Omit<EoaNonceLockOptions, "ifAvailable"> = {},
): Promise<EoaNonceLockLease> {
  const name = resolveLockName(identity, options);
  const locks = getBrowserLocks(options);
  let releaseHold: (() => void) | undefined;
  let reportAcquired: ((acquired: boolean) => void) | undefined;
  const acquired = new Promise<boolean>((resolve) => { reportAcquired = resolve; });
  const hold = new Promise<void>((resolve) => { releaseHold = resolve; });

  void locks.request(
    name,
    { ifAvailable: true, mode: "exclusive" },
    async (lock) => {
      reportAcquired?.(Boolean(lock));
      if (lock) await hold;
    },
  ).catch(() => reportAcquired?.(false));

  if (!await acquired || !releaseHold) {
    throw lockError(options, "contended");
  }

  let released = false;
  return {
    name,
    release: () => {
      if (released) return;
      released = true;
      releaseHold?.();
    },
  };
}
