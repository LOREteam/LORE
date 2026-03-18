"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeEventLog, encodeEventTopics, encodeFunctionData, formatUnits, getAddress } from "viem";
import type { Hex, PublicClient } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_HAS_REBATE_API,
  CONTRACT_DEPLOY_BLOCK,
  GAME_ABI,
  GAME_EVENTS_ABI,
  TX_RECEIPT_TIMEOUT_MS,
} from "../lib/constants";
import { delay, isUserRejection } from "../lib/utils";
import { log } from "../lib/logger";

type SilentSendFn = (tx: {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
}) => Promise<`0x${string}`>;

interface UseRebateOptions {
  enabled?: boolean;
  preferredAddress?: `0x${string}` | string | null;
  sendTransactionSilent?: SilentSendFn;
}

interface RebateEpochInfo {
  epoch: number;
  pendingWei: bigint;
  pending: string;
  claimed: boolean;
  resolved: boolean;
  userVolumeWei: bigint;
  rebatePoolWei: bigint;
}

const GAS_CLAIM_REBATES = BigInt(1_200_000);
const REBATE_DETAILS_LIMIT = 8;
const REBATE_SUMMARY_CHUNK_SIZE = 24;
const LOG_CHUNK_SIZE_BLOCKS = BigInt(49_999);

function isMissingContractMethodError(err: unknown, methodName: string) {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const quotedMethod = `function "${methodName.toLowerCase()}"`;
  return (
    msg.includes(`${quotedMethod} returned no data`) ||
    msg.includes(`${quotedMethod} is not in the abi`) ||
    msg.includes(`does not have the function "${methodName.toLowerCase()}"`) ||
    msg.includes("returned no data (\"0x\")")
  );
}

async function loadUserRebateEpochs(
  publicClient: PublicClient,
  address: `0x${string}`,
  previous?: { epochs: bigint[]; lastBlock: bigint | null },
): Promise<{ epochs: bigint[]; lastBlock: bigint }> {
  const topics: Hex[] = [];
  for (const eventName of ["BetPlaced", "BatchBetsPlaced"] as const) {
    const encoded = encodeEventTopics({ abi: GAME_EVENTS_ABI, eventName });
    if (encoded[0]) topics.push(encoded[0]);
  }

  const epochSet = new Set<bigint>(previous?.epochs ?? []);
  const latestBlock = await publicClient.getBlockNumber();
  const startBlock = previous?.lastBlock !== null && previous?.lastBlock !== undefined
    ? previous.lastBlock + 1n
    : CONTRACT_DEPLOY_BLOCK;

  for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += LOG_CHUNK_SIZE_BLOCKS + 1n) {
    const toBlock = fromBlock + LOG_CHUNK_SIZE_BLOCKS > latestBlock
      ? latestBlock
      : fromBlock + LOG_CHUNK_SIZE_BLOCKS;

    const logs = await publicClient.getLogs({
      address: CONTRACT_ADDRESS,
      topics: topics.length > 0 ? [topics, null, [address]] : undefined,
      fromBlock,
      toBlock,
    } as Parameters<typeof publicClient.getLogs>[0]);

    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: GAME_EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "BetPlaced" || decoded.eventName === "BatchBetsPlaced") {
          const epoch = decoded.args.epoch;
          if (typeof epoch === "bigint") epochSet.add(epoch);
        }
      } catch {
        // ignore malformed or unrelated logs
      }
    }
  }

  return {
    epochs: [...epochSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    lastBlock: latestBlock,
  };
}

async function loadClaimableEpochsExact(
  publicClient: PublicClient,
  address: `0x${string}`,
  epochs: bigint[],
): Promise<number[]> {
  const claimable = new Set<number>();

  for (let i = 0; i < epochs.length; i += REBATE_SUMMARY_CHUNK_SIZE) {
    const chunk = epochs.slice(i, i + REBATE_SUMMARY_CHUNK_SIZE);
    const contracts = chunk.map((epoch) => ({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getRebateInfo" as const,
      args: [epoch, address] as const,
    }));

    try {
      const results = await publicClient.multicall({
        contracts,
      });

      results.forEach((result, index) => {
        if (result.status !== "success") return;
        const [, , pendingWei, claimed, resolved] = result.result as [
          bigint,
          bigint,
          bigint,
          boolean,
          boolean,
        ];
        if (pendingWei > 0 && !claimed && resolved) {
          claimable.add(Number(chunk[index]));
        }
      });
    } catch (err) {
      log.warn("Rebate", "exact claimable multicall failed, falling back to per-epoch reads", err);
      for (const epoch of chunk) {
        try {
          const result = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "getRebateInfo",
            args: [epoch, address],
          }) as [bigint, bigint, bigint, boolean, boolean];
          const [, , pendingWei, claimed, resolved] = result;
          if (pendingWei > 0 && !claimed && resolved) {
            claimable.add(Number(epoch));
          }
        } catch (readErr) {
          log.warn("Rebate", "exact claimable epoch read failed", { epoch: Number(epoch), err: readErr });
        }
      }
    }
  }

  return [...claimable].sort((a, b) => b - a);
}

export function useRebate(options?: UseRebateOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [isClaiming, setIsClaiming] = useState(false);
  const [rebateEpochs, setRebateEpochs] = useState<number[]>([]);
  const [claimableEpochs, setClaimableEpochs] = useState<number[]>([]);
  const [claimableEpochCount, setClaimableEpochCount] = useState(0);
  const [pendingRebateWei, setPendingRebateWei] = useState(BigInt(0));
  const [details, setDetails] = useState<RebateEpochInfo[]>([]);
  const [isSupported, setIsSupported] = useState(CONTRACT_HAS_REBATE_API);
  const enabled = options?.enabled ?? true;
  const rebateAddress = useMemo(() => {
    const candidate = options?.preferredAddress ?? address;
    if (!candidate) return null;
    try {
      return getAddress(candidate);
    } catch {
      return null;
    }
  }, [address, options?.preferredAddress]);
  const rebateUnavailableWarningRef = useRef(false);
  const rebateEpochScanCacheRef = useRef<{
    address: `0x${string}` | null;
    epochs: bigint[];
    lastBlock: bigint | null;
  }>({
    address: null,
    epochs: [],
    lastBlock: null,
  });

  const waitReceipt = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) return;
      const receipt = await Promise.race([
        publicClient.waitForTransactionReceipt({ hash }),
        delay(TX_RECEIPT_TIMEOUT_MS).then(() => {
          throw new Error("Timeout");
        }),
      ]);
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${hash}`);
      }
    },
    [publicClient],
  );

  const refetchRebateInfo = useCallback(async () => {
    if (!enabled || !rebateAddress || !publicClient) {
      setRebateEpochs([]);
      setClaimableEpochs([]);
      setClaimableEpochCount(0);
      setPendingRebateWei(BigInt(0));
      setDetails([]);
      setIsSupported(CONTRACT_HAS_REBATE_API);
      rebateEpochScanCacheRef.current = { address: null, epochs: [], lastBlock: null };
      return;
    }

    if (!CONTRACT_HAS_REBATE_API) {
      if (!rebateUnavailableWarningRef.current) {
        rebateUnavailableWarningRef.current = true;
        log.info("Rebate", "disabled for legacy contract profile");
      }
      setRebateEpochs([]);
      setClaimableEpochs([]);
      setClaimableEpochCount(0);
      setPendingRebateWei(BigInt(0));
      setDetails([]);
      setIsSupported(false);
      return;
    }

    try {
      setIsSupported(true);
      const cache = rebateEpochScanCacheRef.current;
      const nextScan = await loadUserRebateEpochs(
        publicClient,
        rebateAddress,
        cache.address === rebateAddress ? { epochs: cache.epochs, lastBlock: cache.lastBlock } : undefined,
      );
      rebateEpochScanCacheRef.current = {
        address: rebateAddress,
        epochs: nextScan.epochs,
        lastBlock: nextScan.lastBlock,
      };
      const epochs = nextScan.epochs;

      const epochList = epochs.map((epoch) => Number(epoch));
      setRebateEpochs(epochList);

      if (epochList.length === 0) {
        setClaimableEpochs([]);
        setClaimableEpochCount(0);
        setPendingRebateWei(BigInt(0));
        setDetails([]);
        return;
      }

      let totalPending = BigInt(0);
      let summaryClaimableCount = 0;

      for (let i = 0; i < epochs.length; i += REBATE_SUMMARY_CHUNK_SIZE) {
        const chunk = epochs.slice(i, i + REBATE_SUMMARY_CHUNK_SIZE);
        const summary = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "getRebateSummary",
          args: [rebateAddress, chunk],
        })) as [bigint, bigint];
        totalPending += summary[0];
        summaryClaimableCount += Number(summary[1]);
      }
      setPendingRebateWei(totalPending);
      const exactClaimableEpochs =
        summaryClaimableCount > 0
          ? await loadClaimableEpochsExact(publicClient, rebateAddress, epochs)
          : [];
      setClaimableEpochCount(exactClaimableEpochs.length);

      const recentEpochs = [...epochs].reverse().slice(0, REBATE_DETAILS_LIMIT);
      const contracts = recentEpochs.map((epoch) => ({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getRebateInfo" as const,
        args: [epoch, rebateAddress] as const,
      }));
      const results = await publicClient.multicall({ contracts });

      const nextDetails: RebateEpochInfo[] = [];
      const nextClaimable = new Set<number>(exactClaimableEpochs);

      results.forEach((result, index) => {
        if (result.status !== "success") return;
        const epoch = Number(recentEpochs[index]);
        const [rebatePoolWei, userVolumeWei, pendingWei, claimed, resolved] = result.result as [
          bigint,
          bigint,
          bigint,
          boolean,
          boolean,
        ];
        if (pendingWei > 0 && !claimed && resolved) {
          nextClaimable.add(epoch);
        }
        nextDetails.push({
          epoch,
          pendingWei,
          pending: formatUnits(pendingWei, 18),
          claimed,
          resolved,
          userVolumeWei,
          rebatePoolWei,
        });
      });

      if (exactClaimableEpochs.length === 0) {
        setClaimableEpochs([]);
      } else {
        setClaimableEpochs([...nextClaimable].sort((a, b) => b - a));
      }
      setDetails(nextDetails.sort((a, b) => b.epoch - a.epoch));
    } catch (err) {
      if (
        isMissingContractMethodError(err, "getRebateSummary") ||
        isMissingContractMethodError(err, "getRebateInfo") ||
        isMissingContractMethodError(err, "claimEpochsRebate")
      ) {
        if (!rebateUnavailableWarningRef.current) {
          rebateUnavailableWarningRef.current = true;
          log.info("Rebate", "rebate methods unavailable for current contract profile");
        }
        setIsSupported(false);
      } else {
        log.warn("Rebate", "refetch failed", err);
      }
      setClaimableEpochs([]);
      setClaimableEpochCount(0);
      setPendingRebateWei(BigInt(0));
      setDetails([]);
    }
  }, [enabled, publicClient, rebateAddress, rebateUnavailableWarningRef]);

  useEffect(() => {
    if (!enabled) {
      setRebateEpochs([]);
      setClaimableEpochs([]);
      setClaimableEpochCount(0);
      setPendingRebateWei(BigInt(0));
      setDetails([]);
      setIsSupported(CONTRACT_HAS_REBATE_API);
      rebateEpochScanCacheRef.current = { address: null, epochs: [], lastBlock: null };
      return;
    }
    void refetchRebateInfo();
    if (!rebateAddress) return;
    const id = window.setInterval(() => {
      void refetchRebateInfo();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [enabled, rebateAddress, refetchRebateInfo]);

  const claimRebates = useCallback(async () => {
    if (!CONTRACT_HAS_REBATE_API || !rebateAddress || !publicClient || rebateEpochs.length === 0) return;
    setIsClaiming(true);
    try {
      const candidateEpochs = claimableEpochs.length > 0 ? claimableEpochs : rebateEpochs;
      const verifiedClaimableEpochs = await loadClaimableEpochsExact(
        publicClient,
        rebateAddress,
        candidateEpochs.map((epoch) => BigInt(epoch)),
      );

      if (verifiedClaimableEpochs.length === 0) {
        await refetchRebateInfo();
        if (typeof window !== "undefined") {
          window.alert("No claimable rebate epochs were found. Rebate state has been refreshed.");
        }
        return;
      }

      const epochArgs = verifiedClaimableEpochs.map((epoch) => BigInt(epoch));
      await publicClient.simulateContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "claimEpochsRebate",
        args: [epochArgs],
        account: rebateAddress,
        gas: GAS_CLAIM_REBATES,
      });

      const silentSend = options?.sendTransactionSilent;

      if (silentSend) {
        const data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "claimEpochsRebate",
          args: [epochArgs],
        });
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas: GAS_CLAIM_REBATES });
        await waitReceipt(hash);
      } else {
        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimEpochsRebate",
          args: [epochArgs],
          chainId: APP_CHAIN_ID,
          gas: GAS_CLAIM_REBATES,
        });
        await waitReceipt(hash);
      }

      log.info("Rebate", "claimed", { epochs: verifiedClaimableEpochs.length });
      await refetchRebateInfo();
    } catch (err) {
      if (isUserRejection(err)) {
        log.warn("Rebate", "claim cancelled", err);
      } else {
        log.error("Rebate", "claim failed", err);
        if (typeof window !== "undefined") {
          window.alert(`Rebate claim failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      setIsClaiming(false);
    }
  }, [claimableEpochs, options?.sendTransactionSilent, publicClient, rebateAddress, rebateEpochs, refetchRebateInfo, waitReceipt, writeContractAsync]);

  const rebateInfo = useMemo(
    () => ({
      isSupported,
      pendingRebateWei,
      pendingRebate: formatUnits(pendingRebateWei, 18),
      claimableEpochs: claimableEpochCount,
      totalEpochs: rebateEpochs.length,
      recentEpochs: details,
    }),
    [claimableEpochCount, details, isSupported, pendingRebateWei, rebateEpochs.length],
  );

  return {
    rebateInfo,
    isClaiming,
    claimRebates,
    refetchRebateInfo,
  };
}
