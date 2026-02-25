"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { decodeEventLog, encodeEventTopics, formatUnits } from "viem";
import { CONTRACT_ADDRESS, GAME_EVENTS_ABI, APP_CHAIN_ID } from "../lib/constants";

export interface RecentWin {
  epoch: string;
  user: string;
  amount: string;
  amountRaw: bigint;
}

const INITIAL_SCAN_BLOCKS = BigInt(200000);
const REFRESH_MS = 45_000;
const MAX_WINS = 100;
const STORAGE_KEY = "lore:recent-wins-cache";

interface WinCache {
  wins: Array<{ epoch: string; user: string; amount: string; amountRaw: string }>;
  lastBlock: string;
}

function loadCache(): { wins: RecentWin[]; lastBlock: bigint } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj: WinCache = JSON.parse(raw);
    return {
      wins: obj.wins.map(w => ({ ...w, amountRaw: BigInt(w.amountRaw) })),
      lastBlock: BigInt(obj.lastBlock),
    };
  } catch { return null; }
}

function saveCache(wins: RecentWin[], lastBlock: bigint) {
  try {
    const obj: WinCache = {
      wins: wins.map(w => ({ ...w, amountRaw: w.amountRaw.toString() })),
      lastBlock: lastBlock.toString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

export function useRecentWins() {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [wins, setWins] = useState<RecentWin[]>([]);
  const runningRef = useRef(false);
  const lastBlockRef = useRef<bigint | null>(null);
  const initializedRef = useRef(false);
  const winsRef = useRef<RecentWin[]>([]);
  winsRef.current = wins;

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const cached = loadCache();
    if (cached) {
      setWins(cached.wins);
      winsRef.current = cached.wins;
      lastBlockRef.current = cached.lastBlock;
    }
  }, []);

  const fetchWins = useCallback(async () => {
    if (!publicClient || runningRef.current) return;
    runningRef.current = true;
    try {
      const toBlock = await publicClient.getBlockNumber();
      const isIncremental = lastBlockRef.current !== null;
      const fromBlock = isIncremental
        ? lastBlockRef.current! + BigInt(1)
        : toBlock > INITIAL_SCAN_BLOCKS ? toBlock - INITIAL_SCAN_BLOCKS : BigInt(0);

      if (fromBlock > toBlock) {
        runningRef.current = false;
        return;
      }

      const topics = encodeEventTopics({
        abi: GAME_EVENTS_ABI,
        eventName: "RewardClaimed",
      });

      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        topics,
        fromBlock,
        toBlock,
      } as any);

      const newWins: RecentWin[] = [];
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: GAME_EVENTS_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "RewardClaimed") {
            const args = decoded.args as { epoch: bigint; user: string; reward: bigint };
            newWins.push({
              epoch: args.epoch.toString(),
              user: args.user,
              amount: parseFloat(formatUnits(args.reward, 18)).toFixed(2),
              amountRaw: args.reward,
            });
          }
        } catch {}
      }

      const currentWins = winsRef.current;
      const merged = isIncremental
        ? [...newWins.reverse(), ...currentWins].slice(0, MAX_WINS)
        : newWins.reverse().slice(0, MAX_WINS);

      lastBlockRef.current = toBlock;
      setWins(merged);
      saveCache(merged, toBlock);
    } catch {} finally {
      runningRef.current = false;
    }
  }, [publicClient]);

  useEffect(() => {
    fetchWins();
    const id = setInterval(fetchWins, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchWins]);

  return wins;
}
