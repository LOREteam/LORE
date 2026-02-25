"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { decodeEventLog, encodeEventTopics, formatUnits, type Log } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_EVENTS_ABI } from "../lib/constants";

export interface JackpotHistoryEntry {
  epoch: string;
  amount: string;
  amountNum: number;
  kind: "daily" | "weekly";
  txHash: string;
  blockNumber: bigint;
  timestamp: number | null;
}

const CHUNK_BLOCKS = BigInt(50_000);
const REFRESH_MS = 45_000;
const MAX_ITEMS = 200;
const STORAGE_KEY = "lore:jackpot-history:v2";

interface JackpotCache {
  items: Array<{
    epoch: string;
    amount: string;
    amountNum: number;
    kind: "daily" | "weekly";
    txHash: string;
    blockNumber: string;
    timestamp: number | null;
  }>;
  lastBlock: string;
}

function cacheKey() {
  return `${STORAGE_KEY}:${CONTRACT_ADDRESS.toLowerCase()}`;
}

function loadCache(): { items: JackpotHistoryEntry[]; lastBlock: bigint } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JackpotCache;
    return {
      items: (parsed.items ?? []).map((x) => ({
        ...x,
        blockNumber: BigInt(x.blockNumber),
        timestamp: x.timestamp ?? null,
      })),
      lastBlock: BigInt(parsed.lastBlock),
    };
  } catch {
    return null;
  }
}

function saveCache(items: JackpotHistoryEntry[], lastBlock: bigint) {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: JackpotCache = {
      items: items.map((x) => ({
        ...x,
        blockNumber: x.blockNumber.toString(),
      })),
      lastBlock: lastBlock.toString(),
    };
    localStorage.setItem(cacheKey(), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function useJackpotHistory() {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [items, setItems] = useState<JackpotHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const runningRef = useRef(false);
  const lastBlockRef = useRef<bigint | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const cached = loadCache();
    if (cached) {
      setItems(cached.items);
      lastBlockRef.current = cached.lastBlock;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!publicClient || runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    try {
      const toBlock = await publicClient.getBlockNumber();
      const fromBlock = lastBlockRef.current !== null
        ? lastBlockRef.current + BigInt(1)
        : BigInt(0);

      if (fromBlock > toBlock) {
        setLoading(false);
        return;
      }

      const [dailySig] = encodeEventTopics({ abi: GAME_EVENTS_ABI, eventName: "DailyJackpotAwarded" });
      const [weeklySig] = encodeEventTopics({ abi: GAME_EVENTS_ABI, eventName: "WeeklyJackpotAwarded" });

      const fetchChunked = async (topic: `0x${string}`) => {
        const result: Log[] = [];
        for (let from = fromBlock; from <= toBlock; from += CHUNK_BLOCKS) {
          const to = from + CHUNK_BLOCKS - BigInt(1) > toBlock ? toBlock : from + CHUNK_BLOCKS - BigInt(1);
          const logs = await publicClient.getLogs({
            address: CONTRACT_ADDRESS,
            topics: [topic],
            fromBlock: from,
            toBlock: to,
          } as any);
          result.push(...logs);
        }
        return result;
      };

      const [dailyLogs, weeklyLogs] = await Promise.all([
        fetchChunked(dailySig),
        fetchChunked(weeklySig),
      ]);

      const parseLogs = (logs: Log[], kind: "daily" | "weekly") => {
        const out: JackpotHistoryEntry[] = [];
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({
              abi: GAME_EVENTS_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName !== (kind === "daily" ? "DailyJackpotAwarded" : "WeeklyJackpotAwarded")) continue;
            const args = decoded.args as { epoch: bigint; amount: bigint };
            const amountNum = parseFloat(formatUnits(args.amount, 18));
            out.push({
              epoch: args.epoch.toString(),
              amount: amountNum.toFixed(2),
              amountNum,
              kind,
              txHash: log.transactionHash ?? "",
              blockNumber: log.blockNumber ?? BigInt(0),
              timestamp: null,
            });
          } catch {
            // ignore malformed log
          }
        }
        return out;
      };

      const incoming = [
        ...parseLogs(dailyLogs, "daily"),
        ...parseLogs(weeklyLogs, "weekly"),
      ];

      const uniqueBlocks = [...new Set(incoming.map((x) => x.blockNumber.toString()))];
      const blockTsMap = new Map<string, number>();
      if (uniqueBlocks.length > 0) {
        const blockResults = await Promise.all(
          uniqueBlocks.map(async (bn) => {
            try {
              const block = await publicClient.getBlock({ blockNumber: BigInt(bn) });
              return { bn, ts: Number(block.timestamp) * 1000 };
            } catch {
              return { bn, ts: 0 };
            }
          }),
        );
        for (const row of blockResults) {
          if (row.ts > 0) blockTsMap.set(row.bn, row.ts);
        }
      }
      const incomingWithTs = incoming.map((entry) => ({
        ...entry,
        timestamp: blockTsMap.get(entry.blockNumber.toString()) ?? null,
      }));

      const merged = [...incomingWithTs, ...items]
        .sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
          return Number(BigInt(b.epoch) - BigInt(a.epoch));
        })
        .filter((entry, idx, arr) => {
          const key = `${entry.kind}:${entry.epoch}:${entry.txHash}`;
          return idx === arr.findIndex((x) => `${x.kind}:${x.epoch}:${x.txHash}` === key);
        })
        .slice(0, MAX_ITEMS);

      setItems(merged);
      lastBlockRef.current = toBlock;
      saveCache(merged, toBlock);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [publicClient, items]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { items, loading, refresh };
}

