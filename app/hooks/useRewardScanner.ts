"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { encodeFunctionData } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, REWARD_SCAN_CHUNK_SIZE, TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import type { UnclaimedWin } from "../lib/types";
import { isUserRejection, delay } from "../lib/utils";

interface UseRewardScannerOptions {
  enabled?: boolean;
  isPageVisible?: boolean;
  sendTransactionSilent?: (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>;
  onNotify?: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}

type EpochTuple = readonly [bigint, bigint, bigint, boolean];

const MAX_SCAN_DEPTH = BigInt(12000); // deeper history scan for late claims
const FAST_SCAN_DEPTH = BigInt(1500); // quick first pass for responsive UI
const MAX_CONSECUTIVE_EMPTY = 5;
const CLAIM_GAS_FALLBACK = 200_000n;
const CLAIM_GAS_BUFFER = 20_000n;
const CLAIM_GAS_HEADROOM_BPS = 12_000n;
const BPS_DENOMINATOR = 10_000n;
const REWARD_SCAN_CACHE_TTL_MS = 60_000;

type RewardScanCacheEnvelope = {
  savedAt?: number;
  epoch?: string;
  wins?: UnclaimedWin[];
};

function getRewardScanCacheKey(address: string) {
  return `lore:reward-scan:v1:${address.toLowerCase()}`;
}

function loadCachedRewardScan(address: string, epoch: string): { wins: UnclaimedWin[]; savedAt: number | null } {
  if (typeof localStorage === "undefined") return { wins: [], savedAt: null };
  try {
    const raw = localStorage.getItem(getRewardScanCacheKey(address));
    if (!raw) return { wins: [], savedAt: null };
    const parsed = JSON.parse(raw) as RewardScanCacheEnvelope;
    if (!parsed || parsed.epoch !== epoch || !Array.isArray(parsed.wins)) {
      return { wins: [], savedAt: null };
    }
    return {
      wins: parsed.wins
        .map((item) => {
          const value = item ?? {};
          if (typeof value.epoch !== "string" || typeof value.amountWei !== "string") return null;
          return { epoch: value.epoch, amountWei: value.amountWei };
        })
        .filter((item): item is UnclaimedWin => item !== null),
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : null,
    };
  } catch {
    return { wins: [], savedAt: null };
  }
}

function saveCachedRewardScan(address: string, epoch: string, wins: UnclaimedWin[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getRewardScanCacheKey(address),
      JSON.stringify({
        savedAt: Date.now(),
        epoch,
        wins,
      } satisfies RewardScanCacheEnvelope),
    );
  } catch {
    // ignore cache write failures
  }
}

function formatClaimError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("notresolved")) return "Reward is not claimable yet because the epoch is not resolved.";
  if (lower.includes("already claimed") || lower.includes("hasclaimed") || lower.includes("claimed")) {
    return "This reward was already claimed.";
  }
  if (lower.includes("nothingtoclaim") || lower.includes("no reward")) {
    return "No reward is available for this epoch.";
  }
  return "Claim failed. Please try again.";
}

export function useRewardScanner(
  actualCurrentEpoch: bigint | undefined,
  options?: UseRewardScannerOptions,
) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const enabled = options?.enabled ?? true;
  const isPageVisible = options?.isPageVisible ?? true;
  const notify = options?.onNotify;
  const silentSend = options?.sendTransactionSilent;

  const [unclaimedWins, setUnclaimedWins] = useState<UnclaimedWin[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeepScanning, setIsDeepScanning] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const scanAbortRef = useRef(false);
  const scanRunningRef = useRef(false);
  const activeScanKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const lastScannedEpochRef = useRef<string | null>(null);
  const lastScannedAddressRef = useRef<string | null>(null);
  const cacheSavedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const unclaimedWinsRef = useRef(unclaimedWins);
  unclaimedWinsRef.current = unclaimedWins;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      scanAbortRef.current = true;
      scanRunningRef.current = false;
      activeScanKeyRef.current = null;
    };
  }, []);

  const waitReceipt = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) throw new Error("publicClient unavailable");
      const receipt = await Promise.race([
        publicClient.waitForTransactionReceipt({ hash }),
        delay(TX_RECEIPT_TIMEOUT_MS).then(() => {
          throw new Error("Transaction receipt timeout");
        }),
      ]);
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${hash}`);
      }
    },
    [publicClient],
  );

  const estimateClaimGas = useCallback(
    async (epochId: string) => {
      if (!publicClient || !address) return CLAIM_GAS_FALLBACK;
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimReward",
        args: [BigInt(epochId)],
      });
      try {
        const estimatedGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: CONTRACT_ADDRESS,
          data,
        });
        return (estimatedGas * CLAIM_GAS_HEADROOM_BPS) / BPS_DENOMINATOR + CLAIM_GAS_BUFFER;
      } catch {
        return CLAIM_GAS_FALLBACK;
      }
    },
    [address, publicClient],
  );

  const estimateBatchClaimGas = useCallback(
    async (epochIds: string[]) => {
      if (epochIds.length === 0) return CLAIM_GAS_FALLBACK;
      if (!publicClient || !address) {
        return CLAIM_GAS_FALLBACK * BigInt(epochIds.length);
      }
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimRewards",
        args: [epochIds.map((epochId) => BigInt(epochId))],
      });
      try {
        const estimatedGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: CONTRACT_ADDRESS,
          data,
        });
        return (estimatedGas * CLAIM_GAS_HEADROOM_BPS) / BPS_DENOMINATOR + CLAIM_GAS_BUFFER;
      } catch {
        return CLAIM_GAS_FALLBACK * BigInt(epochIds.length);
      }
    },
    [address, publicClient],
  );

  const prepareClaimTx = useCallback(
    async (epochId: string) => {
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimReward",
        args: [BigInt(epochId)],
      });

      if (publicClient && address) {
        await publicClient.simulateContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimReward",
          args: [BigInt(epochId)],
          account: address as `0x${string}`,
        });
      }

      const gas = await estimateClaimGas(epochId);
      return { data, gas };
    },
    [address, estimateClaimGas, publicClient],
  );

  const prepareBatchClaimTx = useCallback(
    async (epochIds: string[]) => {
      const epochArgs = epochIds.map((epochId) => BigInt(epochId));
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimRewards",
        args: [epochArgs],
      });

      if (publicClient && address) {
        await publicClient.simulateContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimRewards",
          args: [epochArgs],
          account: address as `0x${string}`,
        });
      }

      const gas = await estimateBatchClaimGas(epochIds);
      return { data, gas };
    },
    [address, estimateBatchClaimGas, publicClient],
  );

  const confirmClaimedEpochs = useCallback(
    async (epochIds: string[]) => {
      if (!publicClient || !address || epochIds.length === 0) {
        return new Set(epochIds);
      }
      const results = await publicClient.multicall({
        contracts: epochIds.map((epochId) => ({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "hasClaimed" as const,
          args: [address, BigInt(epochId)],
        })),
      });
      const claimed = new Set<string>();
      epochIds.forEach((epochId, index) => {
        if (results[index]?.result === true) {
          claimed.add(epochId);
        }
      });
      return claimed;
    },
    [address, publicClient],
  );

  const scanRewards = useCallback(async () => {
    if (!enabled || !isPageVisible || !publicClient || !actualCurrentEpoch || !address) return;
    const normalizedAddress = address.toLowerCase();
    const epochKey = actualCurrentEpoch.toString();
    const scanKey = `${normalizedAddress}:${epochKey}`;
    if (scanRunningRef.current && activeScanKeyRef.current === scanKey) return;
    if (
      lastScannedEpochRef.current === epochKey &&
      lastScannedAddressRef.current === normalizedAddress &&
      unclaimedWinsRef.current.length > 0
    ) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const shouldShowScanning = unclaimedWinsRef.current.length === 0;
    scanRunningRef.current = true;
    activeScanKeyRef.current = scanKey;
    scanAbortRef.current = false;
    if (mountedRef.current) {
      setIsScanning(shouldShowScanning);
      setIsDeepScanning(false);
    }

    try {
      const wins: UnclaimedWin[] = [];
      const startEpoch = actualCurrentEpoch > BigInt(1) ? actualCurrentEpoch - BigInt(1) : BigInt(0);
      const minEpoch = actualCurrentEpoch > MAX_SCAN_DEPTH
        ? actualCurrentEpoch - MAX_SCAN_DEPTH
        : BigInt(1);
      const mergeWins = (list: UnclaimedWin[]) => {
        const byEpoch = new Map<string, UnclaimedWin>();
        for (const w of list) byEpoch.set(w.epoch, w);
        return [...byEpoch.values()].sort((a, b) => Number(BigInt(b.epoch) - BigInt(a.epoch)));
      };

      const scanRange = async (rangeStart: bigint, rangeMin: bigint) => {
        let cursor = rangeStart;
        let consecutiveEmpty = 0;
        while (cursor >= rangeMin && !scanAbortRef.current) {
          if (requestId !== requestIdRef.current) return;
          let end = cursor - REWARD_SCAN_CHUNK_SIZE + BigInt(1);
          if (end < rangeMin) end = rangeMin;

          const epochIds: bigint[] = [];
          for (let i = cursor; i >= end; i--) epochIds.push(i);
          if (epochIds.length === 0) break;

          const [epochResults, claimResults, dustSettledResults] = await Promise.all([
            publicClient.multicall({
              contracts: epochIds.map((id) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs" as const, args: [id],
              })),
            }),
            publicClient.multicall({
              contracts: epochIds.map((id) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "hasClaimed" as const, args: [address, id],
              })),
            }),
            publicClient.multicall({
              contracts: epochIds.map((id) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochDustSettled" as const, args: [id],
              })),
            }),
          ]);
          if (requestId !== requestIdRef.current) return;

          const potentialWins: { id: bigint; winTile: bigint; rewardPool: bigint }[] = [];
          let chunkHadResolved = false;
          epochIds.forEach((id, index) => {
            const epRes = epochResults[index]?.result as unknown as EpochTuple | undefined;
            const claimed = claimResults[index]?.result as unknown as boolean | undefined;
            const dustSettled = dustSettledResults[index]?.result as unknown as boolean | undefined;
            if (!epRes) return;
            if (epRes[3]) chunkHadResolved = true;
            if (claimed === false && dustSettled !== true && epRes[3]) {
              potentialWins.push({ id, rewardPool: epRes[1], winTile: epRes[2] });
            }
          });

          if (potentialWins.length > 0) {
            consecutiveEmpty = 0;
            const [betResults, tilePoolResults] = await Promise.all([
              publicClient.multicall({
                contracts: potentialWins.map((w) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "userBets" as const, args: [w.id, w.winTile, address],
                })),
              }),
              publicClient.multicall({
                contracts: potentialWins.map((w) => ({
                  address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "tilePools" as const, args: [w.id, w.winTile],
                })),
              }),
            ]);
            if (requestId !== requestIdRef.current) return;

            potentialWins.forEach((w, index) => {
              const betAmt = betResults[index]?.result as unknown as bigint | undefined;
              const tileTotal = tilePoolResults[index]?.result as unknown as bigint | undefined;
              if (betAmt && betAmt > BigInt(0) && tileTotal && tileTotal > BigInt(0)) {
                wins.push({
                  epoch: w.id.toString(),
                  amountWei: ((w.rewardPool * betAmt) / tileTotal).toString(),
                });
              }
            });
          } else if (chunkHadResolved) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) break;
          }

          cursor = end - BigInt(1);
        }
      };

      const quickMinEpoch = (() => {
        const fastFloor = actualCurrentEpoch > FAST_SCAN_DEPTH
          ? actualCurrentEpoch - FAST_SCAN_DEPTH
          : BigInt(1);
        return fastFloor > minEpoch ? fastFloor : minEpoch;
      })();

      await scanRange(startEpoch, quickMinEpoch);
      if (scanAbortRef.current || requestId !== requestIdRef.current) return;
      if (mountedRef.current) {
        setUnclaimedWins(mergeWins(wins));
      }

      if (quickMinEpoch > minEpoch) {
        if (mountedRef.current && shouldShowScanning) {
          setIsDeepScanning(true);
        }
        await scanRange(quickMinEpoch - BigInt(1), minEpoch);
        if (scanAbortRef.current || requestId !== requestIdRef.current) return;
      }

      const mergedWins = mergeWins(wins);
      lastScannedEpochRef.current = epochKey;
      lastScannedAddressRef.current = normalizedAddress;
      saveCachedRewardScan(normalizedAddress, epochKey, mergedWins);
      cacheSavedAtRef.current = Date.now();
      if (requestId === requestIdRef.current && mountedRef.current) {
        setUnclaimedWins(mergedWins);
      }
    } catch (e) {
      console.error("Reward scanner error:", e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === requestIdRef.current) {
        if (mountedRef.current) {
          setIsDeepScanning(false);
          setIsScanning(false);
        }
        scanRunningRef.current = false;
        activeScanKeyRef.current = null;
      }
    }
  }, [address, actualCurrentEpoch, enabled, isPageVisible, publicClient]);

  useEffect(() => {
    if (!enabled || !isPageVisible || !address || !actualCurrentEpoch) return;
    const epochKey = actualCurrentEpoch.toString();
    const cached = loadCachedRewardScan(address, epochKey);
    cacheSavedAtRef.current = cached.savedAt;
    if (mountedRef.current && cached.wins.length > 0) {
      setUnclaimedWins(cached.wins);
    }
    if (cached.savedAt && Date.now() - cached.savedAt < REWARD_SCAN_CACHE_TTL_MS) {
      const timeoutId = window.setTimeout(() => {
        void scanRewards();
      }, REWARD_SCAN_CACHE_TTL_MS - (Date.now() - cached.savedAt));
      return () => window.clearTimeout(timeoutId);
    }
    void scanRewards();
  }, [actualCurrentEpoch, address, enabled, isPageVisible, scanRewards]);

  useEffect(() => {
    requestIdRef.current += 1;
    scanAbortRef.current = true;
    scanRunningRef.current = false;
    activeScanKeyRef.current = null;
    lastScannedEpochRef.current = null;
    lastScannedAddressRef.current = null;
    if (mountedRef.current) {
      setUnclaimedWins([]);
      setIsScanning(false);
      setIsDeepScanning(false);
    }
  }, [address]);

  const claimReward = useCallback(
    async (epochId: string) => {
      if (!silentSend) {
        notify?.("Wallet is not ready to claim yet. Please try again in a moment.", "warning");
        return;
      }

      if (mountedRef.current) {
        setIsClaiming(true);
      }
      try {
        const { data, gas } = await prepareClaimTx(epochId);
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
        await waitReceipt(hash);
        if (mountedRef.current) {
          setUnclaimedWins((prev) => {
            const next = prev.filter((w) => w.epoch !== epochId);
            if (address && actualCurrentEpoch) {
              saveCachedRewardScan(address, actualCurrentEpoch.toString(), next);
              cacheSavedAtRef.current = Date.now();
            }
            return next;
          });
        }
        notify?.("Reward claimed successfully.", "success");
      } catch (err) {
        if (!isUserRejection(err)) {
          console.error("[ClaimReward]", err instanceof Error ? err.message : String(err));
          notify?.(formatClaimError(err), "danger");
          void scanRewards();
        }
      } finally {
        if (mountedRef.current) {
          setIsClaiming(false);
        }
      }
    },
    [actualCurrentEpoch, address, notify, prepareClaimTx, scanRewards, silentSend, waitReceipt],
  );

  const claimAll = useCallback(async () => {
    if (unclaimedWins.length === 0) return;
    if (mountedRef.current) {
      setIsClaiming(true);
    }

    if (!silentSend) {
      if (mountedRef.current) {
        setIsClaiming(false);
      }
      return;
    }

    const all = [...unclaimedWins];
    const claimedEpochs = new Set<string>();
    let skippedEpochs = 0;
    let claimTxCount = 0;

    const submitSingleClaim = async (epochId: string) => {
      const { data, gas } = await prepareClaimTx(epochId);
      const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
      claimTxCount += 1;
      await waitReceipt(hash);
      claimedEpochs.add(epochId);
    };

    const submitBatchClaim = async (epochIds: string[]) => {
      const { data, gas } = await prepareBatchClaimTx(epochIds);
      const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
      claimTxCount += 1;
      await waitReceipt(hash);
      const confirmedClaimed = await confirmClaimedEpochs(epochIds);
      confirmedClaimed.forEach((epochId) => claimedEpochs.add(epochId));
      if (confirmedClaimed.size === 0) {
        throw new Error("Batch claim confirmed without claimed epochs");
      }
    };

    const queue: string[][] = [all.map((win) => win.epoch)];

    while (queue.length > 0) {
      const batch = queue.shift();
      if (!batch || batch.length === 0) continue;

      try {
        if (batch.length === 1) {
          await submitSingleClaim(batch[0]);
        } else {
          await submitBatchClaim(batch);
        }
      } catch (err) {
        if (isUserRejection(err)) break;
        if (batch.length === 1) {
          skippedEpochs += 1;
          continue;
        }
        const middle = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(middle));
        queue.unshift(batch.slice(0, middle));
      }
    }

    if (claimedEpochs.size > 0) {
      if (mountedRef.current) {
        setUnclaimedWins((prev) => {
          const next = prev.filter((w) => !claimedEpochs.has(w.epoch));
          if (address && actualCurrentEpoch) {
            saveCachedRewardScan(address, actualCurrentEpoch.toString(), next);
            cacheSavedAtRef.current = Date.now();
          }
          return next;
        });
      }
      notify?.(
        claimedEpochs.size === 1
          ? claimTxCount <= 1
            ? "1 reward claimed successfully."
            : `1 reward claimed successfully in ${claimTxCount} transactions.`
          : claimTxCount <= 1
            ? `${claimedEpochs.size} rewards claimed successfully in 1 transaction.`
            : `${claimedEpochs.size} rewards claimed successfully in ${claimTxCount} transactions.`,
        "success",
      );
    }
    if (skippedEpochs > 0) {
      void scanRewards();
      if (claimedEpochs.size === 0) {
        notify?.("Some rewards are no longer claimable. Reward state has been refreshed.", "info");
      }
    }

    if (mountedRef.current) {
      setIsClaiming(false);
    }
  }, [
    actualCurrentEpoch,
    address,
    confirmClaimedEpochs,
    notify,
    prepareBatchClaimTx,
    prepareClaimTx,
    scanRewards,
    unclaimedWins,
    silentSend,
    waitReceipt,
  ]);

  return { unclaimedWins, isScanning, isDeepScanning, isClaiming, scanRewards, claimReward, claimAll };
}
