"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, decodeEventLog, encodeEventTopics, type Log } from "viem";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  GAME_ABI,
  GAME_EVENTS_ABI,
  APP_CHAIN_ID,
} from "../lib/constants";

/** Refresh stats once per round (every epoch change) */
const MULTICALL_BATCH = 200;
const LOG_CHUNK_BLOCKS = 50_000;
const MAX_CONCURRENT_CHUNKS = 4;
const STORAGE_KEY = `lore:global-stats-cache:v4:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;

export interface GlobalStats {
  totalVolume: string;
  totalBurn: string;
  totalVolumeRaw: bigint;
  totalBurnRaw: bigint;
  resolvedEpochs: number;
}

interface Accumulator {
  volumeRaw: bigint;
  burnRaw: bigint;
  resolvedEpochs: number;
  lastScannedEpoch: number;
  lastScannedBlock: string; // stored as string for JSON serialization
}

function fmt(v: bigint): string {
  const num = parseFloat(formatUnits(v, 18));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2) + "K";
  return num.toFixed(2);
}

function toStats(acc: Accumulator): GlobalStats {
  return {
    totalVolume: fmt(acc.volumeRaw),
    totalBurn: fmt(acc.burnRaw),
    totalVolumeRaw: acc.volumeRaw,
    totalBurnRaw: acc.burnRaw,
    resolvedEpochs: acc.resolvedEpochs,
  };
}

function loadCache(): Accumulator | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return {
      volumeRaw: BigInt(obj.volumeRaw),
      burnRaw: BigInt(obj.burnRaw ?? 0),
      resolvedEpochs: obj.resolvedEpochs,
      lastScannedEpoch: obj.lastScannedEpoch,
      lastScannedBlock: obj.lastScannedBlock,
    };
  } catch { return null; }
}

function saveCache(acc: Accumulator) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      volumeRaw: acc.volumeRaw.toString(),
      burnRaw: acc.burnRaw.toString(),
      resolvedEpochs: acc.resolvedEpochs,
      lastScannedEpoch: acc.lastScannedEpoch,
      lastScannedBlock: acc.lastScannedBlock,
    }));
  } catch {}
}

export function useGlobalStats(currentEpoch?: bigint | null, enabled = true) {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const accRef = useRef<Accumulator | null>(null);
  const runningRef = useRef(false);
  const initializedRef = useRef(false);
  const lastFetchedEpochRef = useRef<bigint | null>(null);
  const queuedEpochRef = useRef<bigint | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Restore from localStorage on mount – show cached values instantly
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const cached = loadCache();
    if (cached) {
      accRef.current = cached;
      if (mountedRef.current) {
        setStats(toStats(cached));
      }
    }
  }, []);

  const fetchStats = useCallback(async (targetEpoch?: bigint | null) => {
    const epochToFetch = targetEpoch ?? currentEpoch;
    if (!publicClient || !enabled || epochToFetch == null) return;
    if (runningRef.current) {
      if (queuedEpochRef.current == null || epochToFetch > queuedEpochRef.current) {
        queuedEpochRef.current = epochToFetch;
      }
      return;
    }
    runningRef.current = true;
    const isInitial = accRef.current === null;
    if (isInitial && mountedRef.current) setLoading(true);

    try {
      const epochCount = Number(epochToFetch);
      const prev = accRef.current;
      const startEpoch = prev ? prev.lastScannedEpoch + 1 : 1;

      let addedVolume = BigInt(0);
      if (startEpoch <= epochCount) {
        for (let i = startEpoch; i <= epochCount; i += MULTICALL_BATCH) {
          const end = Math.min(i + MULTICALL_BATCH - 1, epochCount);
          const contracts = [];
          for (let j = i; j <= end; j++) {
            contracts.push({
              address: CONTRACT_ADDRESS as `0x${string}`,
              abi: GAME_ABI,
              functionName: "epochs" as const,
              args: [BigInt(j)] as const,
            });
          }
          const results = await publicClient.multicall({ contracts });
          for (const res of results) {
            if (res.status === "success" && res.result) {
              const [totalPool] = res.result as unknown as [bigint, bigint, bigint, boolean, boolean, boolean];
              addedVolume += totalPool;
            }
          }
        }
      }

      const toBlock = await publicClient.getBlockNumber();
      const prevBlock = prev ? BigInt(prev.lastScannedBlock) : null;
      const fromBlock = prevBlock !== null
        ? (prevBlock + 1n > CONTRACT_DEPLOY_BLOCK ? prevBlock + 1n : CONTRACT_DEPLOY_BLOCK)
        : CONTRACT_DEPLOY_BLOCK;

      let addedBurn = BigInt(0);
      let addedResolved = 0;

      if (fromBlock <= toBlock) {
        const [resolvedTopic] = encodeEventTopics({
          abi: GAME_EVENTS_ABI,
          eventName: "EpochResolved",
        });
        const [flushedTopic] = encodeEventTopics({
          abi: GAME_EVENTS_ABI,
          eventName: "ProtocolFeesFlushed",
        });
        if (!resolvedTopic) {
          throw new Error("EpochResolved topic not found");
        }
        if (!flushedTopic) {
          throw new Error("ProtocolFeesFlushed topic not found");
        }

        const chunks: { from: bigint; to: bigint }[] = [];
        for (let from = fromBlock; from <= toBlock; from += BigInt(LOG_CHUNK_BLOCKS)) {
          const to = from + BigInt(LOG_CHUNK_BLOCKS) > toBlock ? toBlock : from + BigInt(LOG_CHUNK_BLOCKS - 1);
          chunks.push({ from, to });
        }

        const resolvedLogs: Log[] = [];
        const flushedLogs: Log[] = [];
        for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_CHUNKS) {
          const batch = chunks.slice(i, i + MAX_CONCURRENT_CHUNKS);
          const [resolvedResults, flushedResults] = await Promise.all([
            Promise.all(
              batch.map((c) =>
                publicClient.getLogs({
                  address: CONTRACT_ADDRESS,
                  topics: [resolvedTopic],
                  fromBlock: c.from,
                  toBlock: c.to,
                } as unknown as Parameters<typeof publicClient.getLogs>[0]),
              ),
            ),
            Promise.all(
              batch.map((c) =>
                publicClient.getLogs({
                  address: CONTRACT_ADDRESS,
                  topics: [flushedTopic],
                  fromBlock: c.from,
                  toBlock: c.to,
                } as unknown as Parameters<typeof publicClient.getLogs>[0]),
              ),
            ),
          ]);
          for (const chunk of resolvedResults) resolvedLogs.push(...chunk);
          for (const chunk of flushedResults) flushedLogs.push(...chunk);
        }

        for (const log of resolvedLogs) {
          try {
            const decoded = decodeEventLog({
              abi: GAME_EVENTS_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "EpochResolved") {
              addedResolved++;
            }
          } catch { /* skip */ }
        }

        for (const log of flushedLogs) {
          try {
            const decoded = decodeEventLog({
              abi: GAME_EVENTS_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "ProtocolFeesFlushed") {
              const { burnAmount } = decoded.args as { ownerAmount: bigint; burnAmount: bigint };
              addedBurn += burnAmount;
            }
          } catch { /* skip */ }
        }
      }

      const newAcc: Accumulator = {
        volumeRaw: (prev?.volumeRaw ?? BigInt(0)) + addedVolume,
        burnRaw: (prev?.burnRaw ?? BigInt(0)) + addedBurn,
        resolvedEpochs: (prev?.resolvedEpochs ?? 0) + addedResolved,
        lastScannedEpoch: epochCount,
        lastScannedBlock: toBlock.toString(),
      };

      accRef.current = newAcc;
      saveCache(newAcc);
      lastFetchedEpochRef.current = epochToFetch;
      if (mountedRef.current) {
        setStats(toStats(newAcc));
      }
    } catch {
      // non-critical – keep previous stats
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      runningRef.current = false;
      const queuedEpoch = queuedEpochRef.current;
      if (queuedEpoch !== null && queuedEpoch !== lastFetchedEpochRef.current) {
        queuedEpochRef.current = null;
        void fetchStats(queuedEpoch);
      }
    }
  }, [currentEpoch, enabled, publicClient]);

  // Fetch on mount + once per round (when epoch changes)
  useEffect(() => {
    if (!enabled) return;
    if (currentEpoch == null) return;
    if (lastFetchedEpochRef.current === currentEpoch) return;
    if (queuedEpochRef.current == null || currentEpoch > queuedEpochRef.current) {
      queuedEpochRef.current = currentEpoch;
    }
    void fetchStats(currentEpoch);
  }, [currentEpoch, enabled, fetchStats]);

  return { stats, loading };
}
