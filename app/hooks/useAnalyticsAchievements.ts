"use client";

import { useEffect, useMemo } from "react";
import type { DepositEntry } from "./useDepositHistory";
import { APP_CHAIN_ID, CONTRACT_ADDRESS } from "../lib/constants";

const ACHIEVEMENTS_VERSION = "v3";
const ACHIEVEMENTS_CLEANUP_FLAG = "lore:achievements:cleanup:v3:done";

export interface AchievementStats {
  depositsCount: number;
  totalDeposited: number;
  maxSingleBet: number;
  maxEpochSpend: number;
  totalTilesPicked: number;
  uniqueTilesCount: number;
  multiTileBets: number;
  uniqueEpochsCount: number;
  winsCount: number;
  maxReward: number;
  lossesCount: number;
  maxWinStreak: number;
  firstBetWon: boolean;
  maxRewardToEpochBetRatio: number;
}

interface PersistedAchievements {
  unlockedAt: Record<string, string>;
}

interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: (stats: AchievementStats) => string;
  unlocked: (stats: AchievementStats) => boolean;
}

export type AchievementCard<TRarity extends string = string> = Omit<AchievementDefinition, "unlocked"> & {
  rarity: TRarity;
  unlocked: boolean;
  unlockedAt: string | null;
  progressLabel: string;
  progressCurrent: number;
  progressTarget: number;
  progressPct: number;
};

interface UseAnalyticsAchievementsOptions<TRarity extends string> {
  walletAddress?: string;
  deposits: DepositEntry[] | null;
  totalDeposited: number;
  definitions: AchievementDefinition[];
  rarityById: Record<string, TRarity>;
  defaultRarity: TRarity;
}

function parseProgressPart(value: string): number {
  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)\s*(k|M)?$/i);
  if (!match) return 0;
  let amount = Number(match[1]);
  if (match[2] === "k" || match[2] === "K") amount *= 1000;
  else if (match[2] === "m" || match[2] === "M") amount *= 1_000_000;
  return Number.isFinite(amount) ? amount : 0;
}

function parseProgress(label: string) {
  const parts = label.split("/").map((part) => part.trim());
  if (parts.length !== 2) return { current: 0, target: 1, percent: 0 };
  const current = parseProgressPart(parts[0]);
  const target = parseProgressPart(parts[1]);
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) {
    return { current: 0, target: 1, percent: 0 };
  }
  return {
    current,
    target,
    percent: Math.max(0, Math.min(100, (current / target) * 100)),
  };
}

function getAchievementStorageKey(walletAddress: string | undefined) {
  if (!walletAddress) return null;
  return `lore:achievements:${ACHIEVEMENTS_VERSION}:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${walletAddress.toLowerCase()}`;
}

function loadPersistedAchievements(walletAddress: string | undefined): PersistedAchievements {
  if (typeof localStorage === "undefined") return { unlockedAt: {} };
  try {
    const storageKey = getAchievementStorageKey(walletAddress);
    if (!storageKey) return { unlockedAt: {} };
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { unlockedAt: {} };
    const parsed = JSON.parse(raw) as PersistedAchievements;
    if (!parsed || typeof parsed !== "object" || !parsed.unlockedAt || typeof parsed.unlockedAt !== "object") {
      return { unlockedAt: {} };
    }
    return parsed;
  } catch {
    return { unlockedAt: {} };
  }
}

function savePersistedAchievements(walletAddress: string | undefined, payload: PersistedAchievements) {
  if (typeof localStorage === "undefined") return;
  try {
    const storageKey = getAchievementStorageKey(walletAddress);
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

function cleanupLegacyAchievementStorage() {
  if (typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(ACHIEVEMENTS_CLEANUP_FLAG) === "1") return;
    const toRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (key.startsWith("lore:achievements:v1:") || key.startsWith("lore:achievements:v2:")) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
    localStorage.setItem(ACHIEVEMENTS_CLEANUP_FLAG, "1");
  } catch {
    // ignore storage errors
  }
}

export function useAnalyticsAchievements<TRarity extends string>({
  walletAddress,
  deposits,
  totalDeposited,
  definitions,
  rarityById,
  defaultRarity,
}: UseAnalyticsAchievementsOptions<TRarity>) {
  useEffect(() => {
    cleanupLegacyAchievementStorage();
  }, []);

  const stats = useMemo<AchievementStats>(() => {
    const list = deposits ?? [];
    const tileSet = new Set<number>();
    const epochSet = new Set<string>();
    const epochUniqueTiles = new Map<string, Set<number>>();
    const epochSpend = new Map<string, number>();
    const epochWon = new Set<string>();
    const epochReward = new Map<string, number>();
    let maxSingleBet = 0;
    let maxEpochSpend = 0;
    let totalTilesPicked = 0;
    let multiTileBets = 0;

    for (const deposit of list) {
      epochSet.add(deposit.epoch);

      const depositAmounts =
        Array.isArray(deposit.amounts) && deposit.amounts.length > 0
          ? deposit.amounts
          : deposit.tileIds.length > 0
            ? deposit.tileIds.map(() => deposit.amountNum / deposit.tileIds.length)
            : [];

      for (const amount of depositAmounts) {
        if (Number.isFinite(amount) && amount > 0) {
          maxSingleBet = Math.max(maxSingleBet, amount);
        }
      }

      const nextEpochAmount = (epochSpend.get(deposit.epoch) ?? 0) + deposit.amountNum;
      epochSpend.set(deposit.epoch, nextEpochAmount);
      maxEpochSpend = Math.max(maxEpochSpend, nextEpochAmount);
      totalTilesPicked += deposit.tileIds.length;
      if (deposit.tileIds.length > 1) multiTileBets += 1;
      for (const tileId of deposit.tileIds) tileSet.add(tileId);
      const epochTiles = epochUniqueTiles.get(deposit.epoch) ?? new Set<number>();
      for (const tileId of deposit.tileIds) epochTiles.add(tileId);
      epochUniqueTiles.set(deposit.epoch, epochTiles);

      if (deposit.winningTile !== null && deposit.tileIds.includes(deposit.winningTile)) {
        epochWon.add(deposit.epoch);
      }
      if (deposit.reward !== null && deposit.reward > 0) {
        epochReward.set(deposit.epoch, Math.max(epochReward.get(deposit.epoch) ?? 0, deposit.reward));
      }
    }

    let maxReward = 0;
    let maxRewardToEpochBetRatio = 0;
    for (const [epoch, reward] of epochReward) {
      maxReward = Math.max(maxReward, reward);
      const epochBet = epochSpend.get(epoch) ?? 1;
      if (epochBet > 0) {
        maxRewardToEpochBetRatio = Math.max(maxRewardToEpochBetRatio, reward / epochBet);
      }
    }

    const winsCount = epochWon.size;
    const lossesCount = Math.max(0, epochSet.size - winsCount);

    const sortedEpochs = [...epochSet].sort((left, right) => Number(BigInt(left) - BigInt(right)));
    let maxWinStreak = 0;
    let currentStreak = 0;
    for (const epoch of sortedEpochs) {
      const uniqueTilesInEpoch = epochUniqueTiles.get(epoch)?.size ?? 0;
      const isPrecisionRound = uniqueTilesInEpoch > 0 && uniqueTilesInEpoch <= 4;
      if (isPrecisionRound && epochWon.has(epoch)) {
        currentStreak += 1;
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    const earliestDeposit = [...list].sort((left, right) => {
      const leftOrder = left.blockNumberNum > 0 ? left.blockNumberNum : Number(left.epoch);
      const rightOrder = right.blockNumberNum > 0 ? right.blockNumberNum : Number(right.epoch);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftEpoch = Number(left.epoch);
      const rightEpoch = Number(right.epoch);
      if (leftEpoch !== rightEpoch) return leftEpoch - rightEpoch;
      return left.txHash.localeCompare(right.txHash);
    })[0];
    const firstBetWon = Boolean(
      earliestDeposit
      && earliestDeposit.winningTile !== null
      && earliestDeposit.tileIds.includes(earliestDeposit.winningTile),
    );

    return {
      depositsCount: totalTilesPicked,
      totalDeposited,
      maxSingleBet,
      maxEpochSpend,
      totalTilesPicked,
      uniqueTilesCount: tileSet.size,
      multiTileBets,
      uniqueEpochsCount: epochSet.size,
      winsCount,
      maxReward,
      lossesCount,
      maxWinStreak,
      firstBetWon,
      maxRewardToEpochBetRatio,
    };
  }, [deposits, totalDeposited]);

  const persisted = useMemo(
    () => loadPersistedAchievements(walletAddress),
    [walletAddress],
  );

  const achievementCards = useMemo<AchievementCard<TRarity>[]>(() => {
    const nowIso = new Date().toISOString();
    const cards = definitions.map((definition) => {
      const unlockedNow = definition.unlocked(stats);
      const unlockedAt = persisted.unlockedAt[definition.id] ?? (unlockedNow ? nowIso : null);
      const progressLabel = definition.progress(stats);
      const progress = parseProgress(progressLabel);
      const rarity = rarityById[definition.id] ?? defaultRarity;
      const unlocked = unlockedNow || Boolean(persisted.unlockedAt[definition.id]);
      return {
        ...definition,
        rarity,
        unlocked,
        unlockedAt,
        progressLabel,
        progressCurrent: progress.current,
        progressTarget: progress.target,
        progressPct: unlocked ? 100 : progress.percent,
      };
    });

    return [...cards].sort((left, right) => (left.unlocked === right.unlocked ? 0 : left.unlocked ? 1 : -1));
  }, [defaultRarity, definitions, persisted, rarityById, stats]);

  const unlockedCount = useMemo(
    () => achievementCards.filter((card) => card.unlocked).length,
    [achievementCards],
  );

  useEffect(() => {
    const existing = loadPersistedAchievements(walletAddress);
    let changed = false;
    const nextUnlocked = { ...existing.unlockedAt };
    for (const card of achievementCards) {
      if (card.unlocked && !nextUnlocked[card.id]) {
        nextUnlocked[card.id] = card.unlockedAt ?? new Date().toISOString();
        changed = true;
      }
    }
    if (changed) {
      savePersistedAchievements(walletAddress, { unlockedAt: nextUnlocked });
    }
  }, [walletAddress, achievementCards]);

  return {
    stats,
    achievementCards,
    unlockedCount,
  };
}
