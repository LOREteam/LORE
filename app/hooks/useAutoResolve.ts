"use client";

import { useCallback, useEffect, useRef } from "react";
import { encodeFunctionData, type PublicClient } from "viem";
import {
  getConfiguredAutoResolveSweepEnabled,
  getConfiguredClientAutoResolveEnabled,
} from "../../config/publicConfig";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import { getLineaFeeOverrides } from "../lib/lineaFees";
import { log } from "../lib/logger";
import { clearResolveGuard, readResolveGuard, writeResolveGuard } from "./autoResolveStorage";
import { waitUnlessCancelled } from "./autoResolveShared";

const ENABLE_CLIENT_BOOTSTRAP_RESOLVE = getConfiguredClientAutoResolveEnabled();
// Client wallet (Privy embedded) MUST NOT pay gas to resolve. The contract
// auto-resolves the previous epoch on the next placeBet call, and the server
// keeper acts as a fallback for stuck epochs. Anything beyond that just burns
// player gas needlessly.
const ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK = false;
const BOOTSTRAP_RESOLVE_RETRY_MS = 30_000;
const ENABLE_AUTO_RESOLVE_SWEEP = getConfiguredAutoResolveSweepEnabled();
const AUTO_RESOLVE_RETRY_AFTER_MS = 60_000;
const MIN_ETH_FOR_GAS = 0.0005;
// Generous client-side timeout: the server-side sendTransaction path on a
// busy Linea RPC can genuinely take 15-25 s, especially when replacing a
// pending tx. A tight cap here produced a flood of false "bootstrap-timeout"
// warnings while the tx actually landed.
const BOOTSTRAP_RESOLVE_REQUEST_TIMEOUT_MS = 35_000;
/** How long to wait after timer hits 0 before pinging the keeper.
 * V9 atomic resolve: gives organic player bets a chance to trigger the
 * contract's built-in `_autoResolveIfNeeded()` first, so the keeper only
 * fires when nobody actually wants to play. */
const KEEPER_TRIGGER_INITIAL_DELAY_MS = 4_000;

type SilentSender = (
  tx: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
    gas?: bigint;
    nonce?: number;
    feeMode?: "normal" | "keeper";
  },
  gasOverrides?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint },
) => Promise<`0x${string}`>;

type RefetchFn = () => void | Promise<unknown>;

interface UseAutoResolveOptions {
  actualCurrentEpoch: bigint | number | null | undefined;
  currentEpochResolved: boolean | undefined;
  embeddedEthBalanceFormatted?: string | null;
  embeddedWalletAddress: string | null;
  publicClient?: PublicClient;
  refetchEpoch: RefetchFn;
  refetchGridEpochData: RefetchFn;
  refetchTileData: RefetchFn;
  refetchUserBets: RefetchFn;
  sendTransactionSilent?: SilentSender;
  timeLeft: number;
}

export function useAutoResolve({
  actualCurrentEpoch,
  currentEpochResolved,
  embeddedEthBalanceFormatted,
  embeddedWalletAddress,
  publicClient,
  refetchEpoch,
  refetchGridEpochData,
  refetchTileData,
  refetchUserBets,
  sendTransactionSilent,
  timeLeft,
}: UseAutoResolveOptions) {
  const autoResolveAttemptedRef = useRef<string | null>(null);
  const autoResolveAttemptTsRef = useRef(0);
  const sweepRunningRef = useRef(false);

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

  const tryClientResolveEpoch = useCallback(async (epochKey: string): Promise<boolean> => {
    if (!publicClient || !sendTransactionSilent || !embeddedWalletAddress) return false;
    try {
      const epoch = BigInt(epochKey);
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const liveEpoch = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "currentEpoch",
      })) as bigint;
      if (liveEpoch !== epoch) return true;
      const epochData = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "epochs",
        args: [epoch],
      })) as [bigint, bigint, bigint, boolean, boolean, boolean];
      if (epochData[3]) return true;
      const endTime = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getEpochEndTime",
        args: [epoch],
      })) as bigint;
      if (nowSec < endTime) return true;

      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "resolveEpoch",
        args: [epoch],
      });
      const gasEstimate = await publicClient.estimateGas({
        to: CONTRACT_ADDRESS,
        data,
        account: embeddedWalletAddress as `0x${string}`,
      });
      const gas = (gasEstimate * 130n) / 100n + 20_000n;
      const fees = await publicClient.estimateFeesPerGas().catch(() => null);
      const feeOverrides = fees ? getLineaFeeOverrides(fees, APP_CHAIN_ID) : undefined;
      const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas }, feeOverrides);
      log.info("AutoResolve", "client fallback sent resolve tx", { epoch: epochKey, hash });
      try {
        await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
      } catch (waitErr) {
        try {
          const latestEpoch = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "currentEpoch",
          })) as bigint;
          if (latestEpoch > epoch) {
            log.info("AutoResolve", "resolve tx timed out but epoch advanced", { epoch: epochKey, hash });
          } else {
            throw waitErr;
          }
        } catch {
          throw waitErr;
        }
      }
      void refetchEpoch();
      void refetchGridEpochData();
      void refetchTileData();
      void refetchUserBets();
      clearResolveGuard();
      return true;
    } catch (err) {
      try {
        const epoch = BigInt(epochKey);
        const latestEpoch = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "currentEpoch",
        })) as bigint;
        if (latestEpoch > epoch) {
          return true;
        }
      } catch {
        // fall through to warning
      }
      log.warn("AutoResolve", "client fallback resolve failed", { epoch: epochKey, err });
      return false;
    }
  }, [embeddedWalletAddress, publicClient, refetchEpoch, refetchGridEpochData, refetchTileData, refetchUserBets, sendTransactionSilent]);

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
      if (!publicClient) return true; // err on the side of attempting resolve
      try {
        const epochData = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "epochs",
          args: [BigInt(epochKey)],
        })) as [bigint, bigint, bigint, boolean, boolean, boolean];
        // Index 0 = totalPool. If zero, no one bet - don't resolve.
        return epochData[0] > 0n;
      } catch {
        return true; // network error: let the keeper try
      }
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
          const payload = (await res.json().catch(() => null)) as
            | {
                ok?: boolean;
                action?: string;
                currentEpoch?: string;
                hash?: string;
                cancelledNonce?: number;
                reason?: string;
                error?: string;
                retryAfter?: number;
                isResolved?: boolean;
                isExpired?: boolean;
              }
            | null;
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

          if (payload?.ok && payload.action === "cancelled") {
            log.info("AutoResolve", "server keeper cancelled stuck tx", {
              epoch: payload.currentEpoch ?? epochKey,
              hash: payload.hash,
              nonce: payload.cancelledNonce,
            });
            markRetryScheduled(epochKey);
            const retryMs = Math.max(
              BOOTSTRAP_RESOLVE_RETRY_MS,
              Number(payload.retryAfter ?? 0) * 1000,
            );
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
              if (ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK && await tryClientResolveEpoch(epochKey)) {
                autoResolveAttemptedRef.current = epochKey;
                autoResolveAttemptTsRef.current = Date.now();
                return;
              }
              markRetryScheduled(epochKey);
              return;
            }

            if (noopReason === "bootstrap_resolve_throttled") {
              markRetryScheduled(epochKey);
              const retryMs = Math.max(
                BOOTSTRAP_RESOLVE_RETRY_MS,
                Number(payload.retryAfter ?? 0) * 1000,
              );
              if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
              continue;
            }

            if (noopReason === "bootstrap_rpc_unavailable") {
              markRetryScheduled(epochKey);
              const retryMs = Math.max(
                BOOTSTRAP_RESOLVE_RETRY_MS,
                Number(payload.retryAfter ?? 0) * 1000,
              );
              if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
              continue;
            }

            if (
              noopReason === "keeper_insufficient_funds" ||
              noopReason === "cancel_stuck_tx_failed"
            ) {
              markRetryScheduled(epochKey);
              const retryMs = Math.max(
                BOOTSTRAP_RESOLVE_RETRY_MS,
                Number(payload.retryAfter ?? 0) * 1000,
              );
              if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
              continue;
            }

            if (noopReason === "epoch_empty") {
              // Round is frozen because nobody bet - that's intentional.
              // Stop polling for this epoch; the contract's built-in
              // _autoResolveIfNeeded will handle it once a player shows up.
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
            const retryMs = Math.max(
              BOOTSTRAP_RESOLVE_RETRY_MS,
              Number(payload.retryAfter ?? 0) * 1000,
            );
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
            const retryMs = Math.max(
              BOOTSTRAP_RESOLVE_RETRY_MS,
              Number(payload?.retryAfter ?? 0) * 1000,
            );
            if (!(await waitUnlessCancelled(() => cancelled, retryMs))) return;
            continue;
          }

          log.warn("AutoResolve", "server keeper bootstrap resolve failed", payload ?? { status: res.status });
          if (ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK && await tryClientResolveEpoch(epochKey)) {
            autoResolveAttemptedRef.current = epochKey;
            autoResolveAttemptTsRef.current = Date.now();
            return;
          }
          markRetryScheduled(epochKey);
        } catch (err) {
          if (cancelled) return;
          log.warn("AutoResolve", "server keeper bootstrap resolve request failed", err);
          if (ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK && await tryClientResolveEpoch(epochKey)) {
            autoResolveAttemptedRef.current = epochKey;
            autoResolveAttemptTsRef.current = Date.now();
            return;
          }
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
  }, [actualCurrentEpoch, markRetryScheduled, publicClient, timeLeft, tryClientResolveEpoch]);

  useEffect(() => {
    if (!ENABLE_AUTO_RESOLVE_SWEEP) return;
    const hasLowGasBalance =
      embeddedEthBalanceFormatted != null && Number(embeddedEthBalanceFormatted) < MIN_ETH_FOR_GAS;
    if (hasLowGasBalance) return;
    if (!publicClient || !sendTransactionSilent || !actualCurrentEpoch || !embeddedWalletAddress) return;
    if (sweepRunningRef.current) return;

    const SWEEP_INTERVAL_MS = 600_000;
    const SWEEP_LOOKBACK = 5;
    let cancelled = false;

    const sweep = async () => {
      if (sweepRunningRef.current) return;
      sweepRunningRef.current = true;
      try {
        const liveEpoch = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "currentEpoch",
        })) as bigint;
        if (cancelled) return;

        const start = liveEpoch - BigInt(SWEEP_LOOKBACK);
        for (let ep = start < 1n ? 1n : start; ep < liveEpoch; ep++) {
          if (cancelled) return;
          try {
            const epochData = (await publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: GAME_ABI,
              functionName: "epochs",
              args: [ep],
            })) as [bigint, bigint, bigint, boolean, boolean, boolean];
            if (cancelled) return;
            if (epochData[3]) continue;

            const data = encodeFunctionData({ abi: GAME_ABI, functionName: "resolveEpoch", args: [ep] });
            try {
              await publicClient.estimateGas({
                to: CONTRACT_ADDRESS,
                data,
                account: embeddedWalletAddress as `0x${string}`,
              });
            } catch {
              log.info("AutoResolve", `sweep: estimateGas reverted for epoch ${ep.toString()}, skipping`);
              continue;
            }
            if (cancelled) return;
            const hash = await sendTransactionSilent({
              to: CONTRACT_ADDRESS,
              data,
              gas: 300_000n,
              feeMode: "keeper",
            });
            if (cancelled) return;
            log.info("AutoResolve", "sweep resolved epoch", { epoch: ep.toString(), hash });
            await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
          } catch {
            // skip this epoch
          }
        }
      } catch {
        // sweep error, ignore
      } finally {
        sweepRunningRef.current = false;
      }
    };

    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        void sweep();
      }
    }, SWEEP_INTERVAL_MS);
    const initialTimer = setTimeout(sweep, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(initialTimer);
    };
  }, [actualCurrentEpoch, embeddedEthBalanceFormatted, embeddedWalletAddress, publicClient, sendTransactionSilent]);
}
