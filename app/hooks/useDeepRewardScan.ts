"use client";

import { useState, useCallback, useRef } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { encodeFunctionData, formatUnits } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import type { UnclaimedWin } from "../lib/types";
import { isUserRejection, delay } from "../lib/utils";

type EpochTuple = readonly [bigint, bigint, bigint, boolean];

const DEEP_CHUNK = BigInt(200);

export function useDeepRewardScan(
  sendTransactionSilent?: (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>,
) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  const [wins, setWins] = useState<UnclaimedWin[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [progress, setProgress] = useState("");
  const abortRef = useRef(false);

  const waitReceipt = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) return;
      await Promise.race([
        publicClient.waitForTransactionReceipt({ hash }),
        delay(TX_RECEIPT_TIMEOUT_MS).then(() => { throw new Error("Timeout"); }),
      ]);
    },
    [publicClient],
  );

  const scan = useCallback(async () => {
    if (!publicClient || !address) return;
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
        let end = cursor - DEEP_CHUNK + BigInt(1);
        if (end < BigInt(1)) end = BigInt(1);

        const epochIds: bigint[] = [];
        for (let i = cursor; i >= end; i--) epochIds.push(i);
        if (epochIds.length === 0) break;

        setProgress(`Scanning ${scanned}/${totalEpochs} epochs… (${found.length} found)`);

        const [epochResults, claimResults] = await Promise.all([
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
        ]);

        const potentialWins: { id: bigint; winTile: bigint; rewardPool: bigint }[] = [];
        epochIds.forEach((id, index) => {
          const epRes = epochResults[index]?.result as unknown as EpochTuple | undefined;
          const claimed = claimResults[index]?.result as unknown as boolean | undefined;
          if (epRes && claimed === false && epRes[3]) {
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

      setWins(found);
      setProgress(abortRef.current ? "Cancelled" : `Done – ${found.length} unclaimed reward${found.length !== 1 ? "s" : ""}`);
    } catch (e) {
      setProgress("Error during scan");
      console.error("[DeepScan]", e);
    } finally {
      setScanning(false);
    }
  }, [publicClient, address]);

  const stop = useCallback(() => { abortRef.current = true; }, []);

  const claimOne = useCallback(async (epochId: string) => {
    if (!sendTransactionSilent) return;
    setClaiming(true);
    try {
      const data = encodeFunctionData({
        abi: GAME_ABI, functionName: "claimReward", args: [BigInt(epochId)],
      });
      const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data });
      await waitReceipt(hash);
      setWins((prev) => prev ? prev.filter((w) => w.epoch !== epochId) : prev);
    } catch (err) {
      if (!isUserRejection(err)) alert("Claim failed.");
    } finally {
      setClaiming(false);
    }
  }, [sendTransactionSilent, waitReceipt]);

  const claimAllDeep = useCallback(async () => {
    if (!wins || wins.length === 0 || !sendTransactionSilent) return;
    setClaiming(true);

    const all = [...wins];
    const pending: { epoch: string; hash: `0x${string}` }[] = [];

    for (const win of all) {
      try {
        const data = encodeFunctionData({
          abi: GAME_ABI, functionName: "claimReward", args: [BigInt(win.epoch)],
        });
        const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data });
        pending.push({ epoch: win.epoch, hash });
      } catch (err) {
        if (isUserRejection(err)) break;
      }
    }

    const results = await Promise.allSettled(
      pending.map(async ({ epoch, hash }) => {
        await waitReceipt(hash);
        return epoch;
      }),
    );

    const claimedEpochs = new Set<string>();
    results.forEach((r) => {
      if (r.status === "fulfilled") claimedEpochs.add(r.value);
    });

    if (claimedEpochs.size > 0) {
      setWins((prev) => prev ? prev.filter((w) => !claimedEpochs.has(w.epoch)) : prev);
    }

    setClaiming(false);
  }, [wins, sendTransactionSilent, waitReceipt]);

  return { wins, scanning, claiming, progress, scan, stop, claimOne, claimAllDeep };
}
