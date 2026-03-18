"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { encodeFunctionData } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, REWARD_SCAN_CHUNK_SIZE, TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import type { UnclaimedWin } from "../lib/types";
import { isUserRejection, delay } from "../lib/utils";

interface UseRewardScannerOptions {
  sendTransactionSilent?: (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>;
}

type EpochTuple = readonly [bigint, bigint, bigint, boolean];

const MAX_SCAN_DEPTH = BigInt(12000); // deeper history scan for late claims
const FAST_SCAN_DEPTH = BigInt(1500); // quick first pass for responsive UI
const MAX_CONSECUTIVE_EMPTY = 5;

export function useRewardScanner(
  actualCurrentEpoch: bigint | undefined,
  options?: UseRewardScannerOptions,
) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  const [unclaimedWins, setUnclaimedWins] = useState<UnclaimedWin[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeepScanning, setIsDeepScanning] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const scanAbortRef = useRef(false);
  const scanRunningRef = useRef(false);
  const lastScannedEpochRef = useRef<string | null>(null);
  const unclaimedWinsRef = useRef(unclaimedWins);
  unclaimedWinsRef.current = unclaimedWins;

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

  const scanRewards = useCallback(async () => {
    if (!publicClient || !actualCurrentEpoch || !address) return;
    if (scanRunningRef.current) return;

    const epochKey = actualCurrentEpoch.toString();
    if (lastScannedEpochRef.current === epochKey && unclaimedWinsRef.current.length > 0) return;

    scanRunningRef.current = true;
    scanAbortRef.current = false;
    setIsScanning(true);
    setIsDeepScanning(false);

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
      if (scanAbortRef.current) return;
      setUnclaimedWins(mergeWins(wins));

      if (quickMinEpoch > minEpoch) {
        setIsDeepScanning(true);
        await scanRange(quickMinEpoch - BigInt(1), minEpoch);
        if (scanAbortRef.current) return;
      }

      lastScannedEpochRef.current = epochKey;
      setUnclaimedWins(mergeWins(wins));
    } catch (e) {
      console.error("Reward scanner error:", e);
    } finally {
      setIsDeepScanning(false);
      setIsScanning(false);
      scanRunningRef.current = false;
    }
  }, [publicClient, actualCurrentEpoch, address]);

  useEffect(() => {
    scanRewards();
  }, [scanRewards]);

  useEffect(() => {
    lastScannedEpochRef.current = null;
  }, [address]);

  const claimReward = useCallback(
    async (epochId: string) => {
      const silentSend = options?.sendTransactionSilent;
      if (!silentSend) {
        alert("Wallet is not ready to claim yet. Please try again in a moment.");
        return;
      }

      setIsClaiming(true);
      try {
        const data = encodeFunctionData({
          abi: GAME_ABI, functionName: "claimReward", args: [BigInt(epochId)],
        });
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas: BigInt(200_000) });
        await waitReceipt(hash);
        setUnclaimedWins((prev) => prev.filter((w) => w.epoch !== epochId));
      } catch (err) {
        if (!isUserRejection(err)) {
          console.error("[ClaimReward]", err);
          alert("Claim failed. Please try again.");
        }
      } finally {
        setIsClaiming(false);
      }
    },
    [options?.sendTransactionSilent, waitReceipt],
  );

  const CLAIM_BATCH_SIZE = 5;

  const claimAll = useCallback(async () => {
    if (unclaimedWins.length === 0) return;
    setIsClaiming(true);

    const silentSend = options?.sendTransactionSilent;
    if (!silentSend) { setIsClaiming(false); return; }

    const all = [...unclaimedWins];
    const claimedEpochs = new Set<string>();

    // Process in batches: send txs sequentially (nonce ordering),
    // then wait for all receipts in parallel (the actual speedup).
    for (let i = 0; i < all.length; i += CLAIM_BATCH_SIZE) {
      const batch = all.slice(i, i + CLAIM_BATCH_SIZE);
      const pending: { epoch: string; hash: `0x${string}` }[] = [];

      for (const win of batch) {
        try {
          const data = encodeFunctionData({
            abi: GAME_ABI, functionName: "claimReward", args: [BigInt(win.epoch)],
          });
          const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas: BigInt(200_000) });
          pending.push({ epoch: win.epoch, hash });
        } catch (err) {
          if (isUserRejection(err)) break;
        }
      }

      const receiptResults = await Promise.allSettled(
        pending.map(async ({ epoch, hash }) => {
          await waitReceipt(hash);
          return epoch;
        }),
      );

      receiptResults.forEach((r) => {
        if (r.status === "fulfilled") claimedEpochs.add(r.value);
      });
    }

    if (claimedEpochs.size > 0) {
      setUnclaimedWins((prev) => prev.filter((w) => !claimedEpochs.has(w.epoch)));
    }

    setIsClaiming(false);
  }, [unclaimedWins, options?.sendTransactionSilent, waitReceipt]);

  return { unclaimedWins, isScanning, isDeepScanning, isClaiming, scanRewards, claimReward, claimAll };
}
