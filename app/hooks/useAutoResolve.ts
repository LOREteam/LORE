"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PublicClient } from "viem";
import {
  getConfiguredClientAutoResolveEnabled,
} from "../../config/publicConfig";
import { CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import { log } from "../lib/logger";
import { readJsonResponse } from "../lib/readJsonResponse";
import { clearResolveGuard, readResolveGuard, writeResolveGuard } from "./autoResolveStorage";
import { waitUnlessCancelled } from "./autoResolveShared";

const ENABLE_CLIENT_BOOTSTRAP_RESOLVE = getConfiguredClientAutoResolveEnabled();
const BOOTSTRAP_RESOLVE_RETRY_MS = 30_000;
const BOOTSTRAP_RESOLVE_MAX_RETRY_MS = 300_000;
const AUTO_RESOLVE_RETRY_AFTER_MS = 60_000;
// Generous client-side timeout: the server-side keeper submission path on a
// busy Linea RPC can genuinely take 15-25 s, especially when replacing a
// pending tx. A tight cap here produced a flood of false "bootstrap-timeout"
// warnings while the tx actually landed.
const BOOTSTRAP_RESOLVE_REQUEST_TIMEOUT_MS = 35_000;
/** How long to wait after timer hits 0 before pinging the keeper. Organic bet
 * paths get the first chance to advance before the funded-epoch fallback. */
const KEEPER_TRIGGER_INITIAL_DELAY_MS = 4_000;

type BootstrapResolvePayload = {
  ok?: boolean;
  action?: string;
  currentEpoch?: string;
  hash?: string;
  reason?: string;
  error?: string;
  retryAfter?: number;
  isResolved?: boolean;
  isExpired?: boolean;
};

function parseRetryAfterSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,5})$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

export function getBootstrapRetryDelayMs(retryAfter: unknown): number {
  const retryAfterSeconds = parseRetryAfterSeconds(retryAfter);
  if (retryAfterSeconds === null) {
    return BOOTSTRAP_RESOLVE_RETRY_MS;
  }
  return Math.min(
    BOOTSTRAP_RESOLVE_MAX_RETRY_MS,
    Math.max(BOOTSTRAP_RESOLVE_RETRY_MS, retryAfterSeconds * 1000),
  );
}

type RefetchFn = () => void | Promise<unknown>;

export async function readEpochHasPool(publicClient: PublicClient | undefined, epochKey: string): Promise<boolean> {
  if (!publicClient) return false;
  try {
    const epochData = (await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "epochs",
      args: [BigInt(epochKey)],
    })) as [bigint, bigint, bigint, boolean, boolean, boolean];
    return epochData[0] > 0n;
  } catch {
    return false;
  }
}

interface UseAutoResolveOptions {
  actualCurrentEpoch: bigint | number | null | undefined;
  currentEpochResolved: boolean | undefined;
  publicClient?: PublicClient;
  refetchEpoch: RefetchFn;
  refetchGridEpochData: RefetchFn;
  refetchTileData: RefetchFn;
  refetchUserBets: RefetchFn;
  timeLeft: number;
}

export function useAutoResolve({
  actualCurrentEpoch,
  currentEpochResolved,
  publicClient,
  refetchEpoch,
  refetchGridEpochData,
  refetchTileData,
  refetchUserBets,
  timeLeft,
}: UseAutoResolveOptions) {
  const autoResolveAttemptedRef = useRef<string | null>(null);
  const autoResolveAttemptTsRef = useRef(0);

  const timeLeftRef = useRef(timeLeft);
  timeLeftRef.current = timeLeft;
  const currentEpochResolvedRef = useRef(currentEpochResolved);
  currentEpochResolvedRef.current = currentEpochResolved;
  const refetchEpochRef = useRef(refetchEpoch);
  refetchEpochRef.current = refetchEpoch;
  const refetchGridEpochDataRef = useRef(refetchGridEpochData);
  refetchGridEpochDataRef.current = refetchGridEpochData;
  const refetchTileDataRef = useRef(refetchTileData);
  refetchTileDataRef.current = refetchTileData;
  const refetchUserBetsRef = useRef(refetchUserBets);
  refetchUserBetsRef.current = refetchUserBets;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refetchEpoch();
      void refetchGridEpochData();
      void refetchTileData();
      void refetchUserBets();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetchEpoch, refetchGridEpochData, refetchTileData, refetchUserBets]);

  const markRetryScheduled = useCallback((epochKey: string) => {
    autoResolveAttemptedRef.current = epochKey;
    autoResolveAttemptTsRef.current = Date.now();
    writeResolveGuard(epochKey);
  }, []);

  useEffect(() => {
    if (!ENABLE_CLIENT_BOOTSTRAP_RESOLVE) return;
    if (timeLeft !== 0 || !actualCurrentEpoch) return;

    let cancelled = false;
    const epochKey = actualCurrentEpoch.toString();
    // Long delay so organic player bets get a chance to trigger contract auto-resolve.
    // Add jitter so multiple clients don't all hammer the keeper at once.
    const delayMs = KEEPER_TRIGGER_INITIAL_DELAY_MS + Math.floor(Math.random() * 5_000);

    /** Pre-check on the client: skip the keeper entirely if the epoch has zero
     * bets. There's nothing to resolve and burning keeper gas is pointless. */
    const epochHasBets = async (): Promise<boolean> => {
      return readEpochHasPool(publicClient, epochKey);
    };

    const run = async () => {
      // Bail out early if there are no bets - round just sits frozen.
      if (!(await epochHasBets())) {
        if (cancelled) return;
        log.info("AutoResolve", "skipping keeper trigger: epoch has no bets", { epoch: epochKey });
        return;
      }
      while (!cancelled) {
        const runNow = Date.now();
        const runGuard = readResolveGuard();
        if (
          autoResolveAttemptedRef.current === epochKey &&
          runNow - autoResolveAttemptTsRef.current < AUTO_RESOLVE_RETRY_AFTER_MS
        ) {
          await new Promise<void>((resolve) => setTimeout(resolve, BOOTSTRAP_RESOLVE_RETRY_MS));
          continue;
        }
        if (runGuard?.epoch === epochKey && runNow - runGuard.ts < AUTO_RESOLVE_RETRY_AFTER_MS) {
          await new Promise<void>((resolve) => setTimeout(resolve, BOOTSTRAP_RESOLVE_RETRY_MS));
          continue;
        }
        writeResolveGuard(epochKey);

        try {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort("bootstrap-timeout"), BOOTSTRAP_RESOLVE_REQUEST_TIMEOUT_MS);
          const res = await fetch("/api/bootstrap-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal,
          }).finally(() => window.clearTimeout(timeoutId));
          if (cancelled) return;
          const payload = await readJsonResponse<BootstrapResolvePayload>(res).catch(() => null);
          if (cancelled) return;

          if (payload?.ok && payload.action === "sent") {
            log.info("AutoResolve", "server keeper sent resolve tx", {
              epoch: payload.currentEpoch ?? epochKey,
              hash: payload.hash,
            });
            clearResolveGuard();
            autoResolveAttemptedRef.current = epochKey;
            autoResolveAttemptTsRef.current = Date.now();
            return;
          }

          if (payload?.ok && payload.action === "pending") {
            log.info("AutoResolve", "server keeper resolve tx pending", {
              epoch: payload.currentEpoch ?? epochKey,
              hash: payload.hash,
              reason: payload.reason ?? "resolve_pending",
            });
            markRetryScheduled(epochKey);
            const retryMs = getBootstrapRetryDelayMs(payload.retryAfter);
            if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
            continue;
          }

          if (payload?.ok && payload.action === "noop") {
            const noopReason = payload.reason ?? "keeper_noop";
            log.info("AutoResolve", "server keeper noop", {
              epoch: payload.currentEpoch ?? epochKey,
              reason: noopReason,
            });

            if (noopReason === "bootstrap_keeper_disabled") {
              markRetryScheduled(epochKey);
              return;
            }

            if (noopReason === "bootstrap_resolve_throttled") {
              markRetryScheduled(epochKey);
              const retryMs = getBootstrapRetryDelayMs(payload.retryAfter);
              if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
              continue;
            }

            if (noopReason === "bootstrap_rpc_unavailable") {
              markRetryScheduled(epochKey);
              const retryMs = getBootstrapRetryDelayMs(payload.retryAfter);
              if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
              continue;
            }

            if (
              noopReason === "keeper_insufficient_funds" ||
              noopReason === "cancel_stuck_tx_failed"
            ) {
              markRetryScheduled(epochKey);
              const retryMs = getBootstrapRetryDelayMs(payload.retryAfter);
              if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
              continue;
            }

            if (noopReason === "epoch_empty") {
              // Stop polling while idle. The next contract bet advances this
              // empty epoch on demand without a standalone keeper transaction.
              markRetryScheduled(epochKey);
              return;
            }

            if (
              noopReason === "epoch_already_resolved" ||
              noopReason === "epoch_no_longer_current" ||
              noopReason === "resolve_tx_known" ||
              noopReason === "resolve_nonce_already_used" ||
              payload.isResolved === true
            ) {
              // Epoch IS resolved on-chain - force refetch so UI picks up the new epoch.
              autoResolveAttemptedRef.current = epochKey;
              autoResolveAttemptTsRef.current = Date.now();
              clearResolveGuard();
              void refetchEpochRef.current();
              void refetchGridEpochDataRef.current();
              void refetchTileDataRef.current();
              void refetchUserBetsRef.current();
              return;
            }

            if (noopReason === "epoch_not_expired" || payload.isExpired === false) {
              // Clock skew: client thinks epoch expired, contract disagrees.
              // Retry after a short delay instead of giving up permanently.
              markRetryScheduled(epochKey);
              if (!(await waitUnlessCancelled(() => cancelled, BOOTSTRAP_RESOLVE_RETRY_MS))) return;
              continue;
            }

            markRetryScheduled(epochKey);
            const retryMs = getBootstrapRetryDelayMs(payload.retryAfter);
            if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
            continue;
          }

          if (payload?.reason === "bootstrap_unauthorized" || res.status === 403) {
            log.info("AutoResolve", "server keeper not available to browser", {
              epoch: epochKey,
              reason: payload?.reason ?? "bootstrap_unauthorized",
            });
            markRetryScheduled(epochKey);
            return;
          }

          if (payload?.error === "Too many requests" || res.status === 429) {
            log.info("AutoResolve", "server keeper rate limited", {
              epoch: epochKey,
              retryAfter: payload?.retryAfter,
            });
            markRetryScheduled(epochKey);
            const retryMs = getBootstrapRetryDelayMs(payload?.retryAfter);
            if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
            continue;
          }

          log.warn("AutoResolve", "server keeper bootstrap resolve failed", payload ?? { status: res.status });
          markRetryScheduled(epochKey);
        } catch (err) {
          if (cancelled) return;
          log.warn("AutoResolve", "server keeper bootstrap resolve request failed", err);
          markRetryScheduled(epochKey);
        }

        if (!(await waitUnlessCancelled(() => cancelled, BOOTSTRAP_RESOLVE_RETRY_MS))) return;
      }
    };

    const timer = setTimeout(() => {
      void run().catch((err) => {
        log.warn("AutoResolve", "unhandled", err);
        markRetryScheduled(epochKey);
      });
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [actualCurrentEpoch, markRetryScheduled, publicClient, timeLeft]);
}
