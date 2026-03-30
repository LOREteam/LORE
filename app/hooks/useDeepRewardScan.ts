"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { encodeFunctionData } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import type { UnclaimedWin } from "../lib/types";
import { isUserRejection, delay } from "../lib/utils";

type EpochTuple = readonly [bigint, bigint, bigint, boolean];

const DEEP_CHUNK = BigInt(200);
const CLAIM_GAS_FALLBACK = 200_000n;
const CLAIM_GAS_BUFFER = 20_000n;
const CLAIM_GAS_HEADROOM_BPS = 12_000n;
const BPS_DENOMINATOR = 10_000n;

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
  return "Claim failed.";
}

export function useDeepRewardScan(
  sendTransactionSilent?: (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>,
  onNotify?: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  const [wins, setWins] = useState<UnclaimedWin[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [progress, setProgress] = useState("");
  const abortRef = useRef(false);
  const scanRunningRef = useRef(false);
  const scanAddressRef = useRef<string | null>(null);

  const waitReceipt = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) throw new Error("publicClient unavailable");
      const receipt = await Promise.race([
        publicClient.waitForTransactionReceipt({ hash }),
        delay(TX_RECEIPT_TIMEOUT_MS).then(() => { throw new Error("Timeout"); }),
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

  const scan = useCallback(async () => {
    if (!publicClient || !address) return;
    const normalizedAddress = address.toLowerCase();
    if (scanRunningRef.current) return;
    scanRunningRef.current = true;
    scanAddressRef.current = normalizedAddress;
    abortRef.current = false;
    setScanning(true);
    setWins(null);
    setProgress("Reading current epoch…");

    try {
      const currentEpoch = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch",
      }) as bigint;

      const startEpoch = currentEpoch > BigInt(1) ? currentEpoch - BigInt(1) : BigInt(0);
      const totalEpochs = Number(startEpoch);
      const found: UnclaimedWin[] = [];
      let scanned = 0;

      let cursor = startEpoch;
      while (cursor > BigInt(0) && !abortRef.current) {
        if (scanAddressRef.current !== normalizedAddress) return;
        let end = cursor - DEEP_CHUNK + BigInt(1);
        if (end < BigInt(1)) end = BigInt(1);

        const epochIds: bigint[] = [];
        for (let i = cursor; i >= end; i--) epochIds.push(i);
        if (epochIds.length === 0) break;

        setProgress(`Scanning ${scanned}/${totalEpochs} epochs… (${found.length} found)`);

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
        if (scanAddressRef.current !== normalizedAddress) return;

        const potentialWins: { id: bigint; winTile: bigint; rewardPool: bigint }[] = [];
        epochIds.forEach((id, index) => {
          const epRes = epochResults[index]?.result as unknown as EpochTuple | undefined;
          const claimed = claimResults[index]?.result as unknown as boolean | undefined;
          const dustSettled = dustSettledResults[index]?.result as unknown as boolean | undefined;
          if (epRes && claimed === false && dustSettled !== true && epRes[3]) {
            potentialWins.push({ id, rewardPool: epRes[1], winTile: epRes[2] });
          }
        });

        if (potentialWins.length > 0) {
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
          if (scanAddressRef.current !== normalizedAddress) return;

          potentialWins.forEach((w, index) => {
            const betAmt = betResults[index]?.result as unknown as bigint | undefined;
            const tileTotal = tilePoolResults[index]?.result as unknown as bigint | undefined;
            if (betAmt && betAmt > BigInt(0) && tileTotal && tileTotal > BigInt(0)) {
              found.push({
                epoch: w.id.toString(),
                amountWei: ((w.rewardPool * betAmt) / tileTotal).toString(),
              });
            }
          });
        }

        scanned += epochIds.length;
        cursor = end - BigInt(1);
      }

      if (scanAddressRef.current === normalizedAddress) {
        setWins(found);
      }
      if (scanAddressRef.current === normalizedAddress) {
        setProgress(abortRef.current ? "Cancelled" : `Done – ${found.length} unclaimed reward${found.length !== 1 ? "s" : ""}`);
      }
    } catch (e) {
      if (scanAddressRef.current === normalizedAddress) {
        setProgress("Error during scan");
      }
      console.error("[DeepScan]", e instanceof Error ? e.message : String(e));
    } finally {
      if (scanAddressRef.current === normalizedAddress) {
        setScanning(false);
        scanRunningRef.current = false;
        scanAddressRef.current = null;
      }
    }
  }, [publicClient, address]);

  useEffect(() => {
    abortRef.current = true;
    scanRunningRef.current = false;
    scanAddressRef.current = address ? address.toLowerCase() : null;
    setWins(null);
    setScanning(false);
    setProgress("");
  }, [address]);

  const stop = useCallback(() => { abortRef.current = true; }, []);

  const claimOne = useCallback(async (epochId: string) => {
    if (!sendTransactionSilent) return;
    setClaiming(true);
    try {
      const { data, gas } = await prepareClaimTx(epochId);
      const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas });
      await waitReceipt(hash);
      setWins((prev) => prev ? prev.filter((w) => w.epoch !== epochId) : prev);
      onNotify?.("Reward claimed successfully.", "success");
    } catch (err) {
      if (!isUserRejection(err)) onNotify?.(formatClaimError(err), "danger");
    } finally {
      setClaiming(false);
    }
  }, [onNotify, prepareClaimTx, sendTransactionSilent, waitReceipt]);

  const claimAllDeep = useCallback(async () => {
    if (!wins || wins.length === 0 || !sendTransactionSilent) return;
    setClaiming(true);
    try {
      const all = [...wins];
      const claimedEpochs = new Set<string>();
      let skippedEpochs = 0;
      let claimTxCount = 0;

      const submitSingleClaim = async (epochId: string) => {
        const { data, gas } = await prepareClaimTx(epochId);
        const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas });
        claimTxCount += 1;
        await waitReceipt(hash);
        claimedEpochs.add(epochId);
      };

      const submitBatchClaim = async (epochIds: string[]) => {
        const { data, gas } = await prepareBatchClaimTx(epochIds);
        const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas });
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
        setWins((prev) => prev ? prev.filter((w) => !claimedEpochs.has(w.epoch)) : prev);
        onNotify?.(
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
      if (skippedEpochs > 0 && claimedEpochs.size === 0) {
        onNotify?.("Some rewards are no longer claimable.", "info");
      }
    } finally {
      setClaiming(false);
    }
  }, [
    confirmClaimedEpochs,
    onNotify,
    prepareBatchClaimTx,
    prepareClaimTx,
    wins,
    sendTransactionSilent,
    waitReceipt,
  ]);

  return { wins, scanning, claiming, progress, scan, stop, claimOne, claimAllDeep };
}
