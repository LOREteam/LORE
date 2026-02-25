"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { decodeEventLog, formatUnits, encodeEventTopics, padHex, type Log } from "viem";
import {
  CONTRACT_ADDRESS,
  GAME_ABI,
  GAME_EVENTS_ABI,
  APP_CHAIN_ID,
} from "../lib/constants";

const CHUNK_BLOCKS = 50_000;
const MAX_STORED_ENTRIES = 25_000;
const REWARD_MULTICALL_BATCH = 100;
const EPOCH_MULTICALL_BATCH = 300;
const LOG_FETCH_CONCURRENCY = 4;
const STORAGE_KEY = "lore:deposits:v4";

export interface DepositEntry {
  epoch: string;
  tileIds: number[];
  amount: string;
  amountNum: number;
  txHash: string;
  winningTile: number | null;
  reward: number | null;
}

interface StoredData {
  entries: DepositEntry[];
  lastBlock: string;
}

function storageKey(addr: string): string {
  return `${STORAGE_KEY}:${CONTRACT_ADDRESS.toLowerCase()}:${addr}`;
}

function loadFromStorage(addr: string): StoredData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(addr));
    if (!raw) return null;
    return JSON.parse(raw) as StoredData;
  } catch {
    return null;
  }
}

function saveToStorage(addr: string, data: StoredData) {
  if (typeof window === "undefined") return;
  if (data.entries.length > MAX_STORED_ENTRIES) {
    data = { ...data, entries: data.entries.slice(0, MAX_STORED_ENTRIES) };
  }
  try {
    localStorage.setItem(storageKey(addr), JSON.stringify(data));
  } catch {
    try {
      const trimmed = { ...data, entries: data.entries.slice(0, Math.floor(MAX_STORED_ENTRIES / 2)) };
      localStorage.setItem(storageKey(addr), JSON.stringify(trimmed));
    } catch { /* quota exceeded – give up */ }
  }
}

function buildUserTopics(eventName: "BetPlaced" | "BatchBetsPlaced", userAddress: string) {
  const [eventSig] = encodeEventTopics({
    abi: GAME_EVENTS_ABI,
    eventName,
  });
  const paddedUser = padHex(userAddress.toLowerCase() as `0x${string}`, { size: 32, dir: "left" });
  // BetPlaced:      topic0=sig, topic1=epoch, topic2=user, topic3=tileId
  // BatchBetsPlaced: topic0=sig, topic1=epoch, topic2=user
  return [eventSig, null, paddedUser];
}

export function useDepositHistory(userAddress?: string) {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DepositEntry[] | null>(null);
  const lastBlockRef = useRef<string | null>(null);
  const runningRef = useRef(false);

  const loadFromLocal = useCallback(() => {
    if (!userAddress) return;
    const stored = loadFromStorage(userAddress.toLowerCase());
    if (stored) {
      setData(stored.entries);
      lastBlockRef.current = stored.lastBlock;
    }
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress) {
      setData(null);
      lastBlockRef.current = null;
      return;
    }
    loadFromLocal();
  }, [userAddress, loadFromLocal]);

  const fetch = useCallback(async () => {
    if (!publicClient || !userAddress) return;
    if (runningRef.current) return;
    runningRef.current = true;

    const addr = userAddress.toLowerCase();
    setLoading(true);

    try {
      const toBlock = await publicClient.getBlockNumber();
      const last = lastBlockRef.current ? BigInt(lastBlockRef.current) : null;
      const fromBlock = last !== null ? last + BigInt(1) : BigInt(0);

      if (fromBlock > toBlock) {
        setLoading(false);
        return;
      }

      const betTopics = buildUserTopics("BetPlaced", userAddress);
      const batchTopics = buildUserTopics("BatchBetsPlaced", userAddress);
      const fetchChunked = async (topics: (string | null)[]) => {
        const result: Log[] = [];
        const ranges: Array<{ from: bigint; to: bigint }> = [];
        for (let from = fromBlock; from <= toBlock; from += BigInt(CHUNK_BLOCKS)) {
          const to = from + BigInt(CHUNK_BLOCKS) > toBlock ? toBlock : from + BigInt(CHUNK_BLOCKS - 1);
          ranges.push({ from, to });
        }

        for (let i = 0; i < ranges.length; i += LOG_FETCH_CONCURRENCY) {
          const batch = ranges.slice(i, i + LOG_FETCH_CONCURRENCY);
          const batchResults = await Promise.all(
            batch.map(({ from, to }) =>
              publicClient.getLogs({
                address: CONTRACT_ADDRESS,
                fromBlock: from,
                toBlock: to,
                topics,
              } as any),
            ),
          );
          for (const chunk of batchResults) {
            result.push(...chunk);
          }
        }
        return result;
      };

      let betLogs: Log[] = [];
      let batchLogs: Log[] = [];
      const chunked = await Promise.all([
        fetchChunked(betTopics),
        fetchChunked(batchTopics),
      ]);
      betLogs = chunked[0];
      batchLogs = chunked[1];

      interface RawEntry {
        epoch: string;
        tileIds: number[];
        amountNum: number;
        txHash: string;
        blockNumber: bigint;
      }
      const rawByTx = new Map<string, RawEntry>();
      const upsertRaw = (entry: {
        epoch: string;
        tileIds: number[];
        amountNum: number;
        txHash: string;
        blockNumber: bigint;
      }) => {
        const key = `${entry.txHash || "nohash"}:${entry.epoch}`;
        const prev = rawByTx.get(key);
        if (!prev) {
          rawByTx.set(key, {
            epoch: entry.epoch,
            tileIds: [...entry.tileIds],
            amountNum: entry.amountNum,
            txHash: entry.txHash,
            blockNumber: entry.blockNumber,
          });
          return;
        }
        const tiles = new Set<number>([...prev.tileIds, ...entry.tileIds]);
        rawByTx.set(key, {
          ...prev,
          tileIds: [...tiles],
          amountNum: prev.amountNum + entry.amountNum,
          blockNumber: entry.blockNumber > prev.blockNumber ? entry.blockNumber : prev.blockNumber,
        });
      };

      for (const log of betLogs) {
        try {
          const decoded = decodeEventLog({ abi: GAME_EVENTS_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName !== "BetPlaced") continue;
          const args = decoded.args as { epoch: bigint; user: string; tileId: bigint; amount: bigint };
          if (args.user.toLowerCase() !== addr) continue;
          const tx = log.transactionHash ?? "";
          upsertRaw({
            epoch: args.epoch.toString(),
            tileIds: [Number(args.tileId)],
            amountNum: parseFloat(formatUnits(args.amount, 18)),
            txHash: tx,
            blockNumber: log.blockNumber ?? BigInt(0),
          });
        } catch { /* skip */ }
      }

      for (const log of batchLogs) {
        try {
          const decoded = decodeEventLog({ abi: GAME_EVENTS_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName !== "BatchBetsPlaced") continue;
          const args = decoded.args as {
            epoch: bigint;
            user: string;
            tileIds: bigint[];
            amounts: bigint[];
            totalAmount: bigint;
          };
          if (args.user.toLowerCase() !== addr) continue;
          const tx = log.transactionHash ?? "";
          upsertRaw({
            epoch: args.epoch.toString(),
            tileIds: args.tileIds.map(Number),
            amountNum: parseFloat(formatUnits(args.totalAmount, 18)),
            txHash: tx,
            blockNumber: log.blockNumber ?? BigInt(0),
          });
        } catch { /* skip */ }
      }
      const raw = [...rawByTx.values()];

      const prevData = loadFromStorage(addr);
      const prevEntries = prevData?.entries ?? [];
      const unresolvedPrevEpochs = [...new Set(
        prevEntries.filter((e) => e.winningTile === null).map((e) => e.epoch),
      )];

      if (raw.length === 0 && unresolvedPrevEpochs.length === 0) {
        lastBlockRef.current = toBlock.toString();
        saveToStorage(addr, {
          entries: prevEntries,
          lastBlock: toBlock.toString(),
        });
        if (prevData) setData(prevEntries);
        setLoading(false);
        return;
      }

      raw.sort((a, b) => Number(b.blockNumber - a.blockNumber));

      // --- Phase 1: get winningTile + rewardPool for each epoch ---
      const uniqueEpochs = [...new Set([...raw.map((e) => e.epoch), ...unresolvedPrevEpochs])];
      const epochWinners = new Map<string, number>();
      const epochRewardPools = new Map<string, bigint>();

      if (uniqueEpochs.length > 0) {
        for (let i = 0; i < uniqueEpochs.length; i += EPOCH_MULTICALL_BATCH) {
          const batch = uniqueEpochs.slice(i, i + EPOCH_MULTICALL_BATCH);
          const calls = batch.map((ep) => ({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "epochs" as const,
            args: [BigInt(ep)] as const,
          }));
          const results = await publicClient.multicall({ contracts: calls });
          for (let j = 0; j < batch.length; j++) {
            const res = results[j];
            if (res.status === "success" && res.result) {
              const [, rewardPool, winTile, resolved] = res.result as unknown as [bigint, bigint, bigint, boolean, boolean, boolean];
              if (resolved && winTile > BigInt(0)) {
                epochWinners.set(batch[j], Number(winTile));
                epochRewardPools.set(batch[j], rewardPool);
              }
            }
          }
        }
      }

      // --- Phase 2: save deposits FIRST (before reward calc) ---
      const newEntriesBase: DepositEntry[] = raw.map((r) => ({
        epoch: r.epoch,
        tileIds: r.tileIds,
        amount: r.amountNum.toFixed(2),
        amountNum: r.amountNum,
        txHash: r.txHash,
        winningTile: epochWinners.get(r.epoch) ?? null,
        reward: null,
      }));

      const newTxSet = new Set(newEntriesBase.map((e) => e.txHash));
      const mergedBase = [
        ...newEntriesBase,
        ...prevEntries
          .filter((p) => !newTxSet.has(p.txHash))
          .map((p) => ({
            ...p,
            winningTile: p.winningTile ?? (epochWinners.get(p.epoch) ?? null),
          })),
      ];
      mergedBase.sort((a, b) => Number(BigInt(b.epoch) - BigInt(a.epoch)));

      const baseStored: StoredData = { entries: mergedBase, lastBlock: toBlock.toString() };
      saveToStorage(addr, baseStored);
      lastBlockRef.current = toBlock.toString();
      const savedBase = loadFromStorage(addr)?.entries ?? mergedBase;
      setData(savedBase);
      setLoading(false);

      // --- Phase 3: compute rewards in background (UI already shows deposits) ---
      const rawByEpoch = new Map<string, Set<number>>();
      for (const entry of mergedBase) {
        const prevTiles = rawByEpoch.get(entry.epoch);
        if (prevTiles) {
          for (const t of entry.tileIds) prevTiles.add(t);
        } else {
          rawByEpoch.set(entry.epoch, new Set(entry.tileIds));
        }
      }

      const winEpochsForUser: string[] = [];
      for (const [ep, tiles] of rawByEpoch) {
        const wt = epochWinners.get(ep);
        if (wt !== undefined && tiles.has(wt)) winEpochsForUser.push(ep);
      }

      if (winEpochsForUser.length > 0) {
        const epochRewards = new Map<string, number>();

        try {
          for (let i = 0; i < winEpochsForUser.length; i += REWARD_MULTICALL_BATCH) {
            const batch = winEpochsForUser.slice(i, i + REWARD_MULTICALL_BATCH);
            const betCalls = batch.flatMap((ep) => {
              const wt = epochWinners.get(ep)!;
              return [
                {
                  address: CONTRACT_ADDRESS,
                  abi: GAME_ABI,
                  functionName: "userBets" as const,
                  args: [BigInt(ep), BigInt(wt), userAddress as `0x${string}`] as const,
                },
                {
                  address: CONTRACT_ADDRESS,
                  abi: GAME_ABI,
                  functionName: "getTileData" as const,
                  args: [BigInt(ep)] as const,
                },
              ];
            });
            const betResults = await publicClient.multicall({ contracts: betCalls });
            for (let j = 0; j < batch.length; j++) {
              const ep = batch[j];
              const userBetRes = betResults[j * 2];
              const tileDataRes = betResults[j * 2 + 1];
              const rewardPool = epochRewardPools.get(ep) ?? BigInt(0);
              if (userBetRes.status === "success" && tileDataRes.status === "success" && rewardPool > BigInt(0)) {
                const userBet = userBetRes.result as bigint;
                const [pools] = tileDataRes.result as [bigint[], bigint[]];
                const wt = epochWinners.get(ep)!;
                const totalOnWinTile = pools[wt - 1] ?? BigInt(0);
                if (totalOnWinTile > BigInt(0) && userBet > BigInt(0)) {
                  const reward = (rewardPool * userBet) / totalOnWinTile;
                  epochRewards.set(ep, parseFloat(formatUnits(reward, 18)));
                }
              }
            }
          }

          if (epochRewards.size > 0) {
            const currentEntries = loadFromStorage(addr)?.entries ?? savedBase;
            const withRewards = currentEntries.map((e) => {
              const r = epochRewards.get(e.epoch);
              return r !== undefined ? { ...e, reward: r } : e;
            });
            saveToStorage(addr, { entries: withRewards, lastBlock: toBlock.toString() });
            setData(loadFromStorage(addr)?.entries ?? withRewards);
          }
        } catch {
          // Reward calc failed – deposits already saved without rewards, that's fine
        }
      }
    } catch {
      loadFromLocal();
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [publicClient, userAddress, loadFromLocal]);

  const refresh = useCallback(async () => {
    await fetch();
  }, [fetch]);

  const totalDeposited = useMemo(
    () => (data ?? []).reduce((sum, e) => sum + e.amountNum, 0),
    [data],
  );

  return { data, loading, totalDeposited, fetch, refresh };
}
