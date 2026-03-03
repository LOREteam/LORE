"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DepositEntry } from "../hooks/useDepositHistory";
import type { JackpotHistoryEntry } from "../hooks/useJackpotHistory";
import { loadingQuotes, emptyStates } from "../lib/loreTexts";
import { LoreText } from "./LoreText";
import { UiButton } from "./ui/UiButton";
import { UiBadge } from "./ui/UiBadge";
import { UiPanel } from "./ui/UiPanel";
import { UiTable, UiTableBody, UiTableHead, UiTableRow } from "./ui/UiTable";

const PAGE_SIZE = 50;
const ACHIEVEMENTS_VERSION = "v2";
const ACHIEVEMENTS_CLEANUP_FLAG = "lore:achievements:cleanup:v2:done";

interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: (stats: AchievementStats) => string;
  unlocked: (stats: AchievementStats) => boolean;
}

type AchievementRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "exotic" | "divine";

interface AchievementStats {
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

const achievementDefs: AchievementDef[] = [
  {
    id: "single_1k",
    title: "Warm Blood",
    description: "Place 10k LINEA on one single bet",
    icon: "🔥",
    progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 10000))}/${fmtK(10000)}`,
    unlocked: (s) => s.maxSingleBet >= 10000,
  },
  {
    id: "single_50k",
    title: "Hot Streak",
    description: "Place 50k LINEA on one single bet",
    icon: "⚡",
    progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 50000))}/${fmtK(50000)}`,
    unlocked: (s) => s.maxSingleBet >= 50000,
  },
  {
    id: "single_100k",
    title: "High Roller",
    description: "Place 100k LINEA on one single bet",
    icon: "🎲",
    progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 100000))}/${fmtK(100000)}`,
    unlocked: (s) => s.maxSingleBet >= 100000,
  },
  {
    id: "single_300k",
    title: "Whale Bite",
    description: "Place 300k LINEA on one single bet",
    icon: "🐋",
    progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 300000))}/${fmtK(300000)}`,
    unlocked: (s) => s.maxSingleBet >= 300000,
  },
  {
    title: "Epoch Crusher",
    id: "round_300k",
    description: "Spend 300k LINEA in one epoch",
    icon: "☄️",
    progress: (s) => `${fmtK(Math.min(s.maxEpochSpend, 300000))}/${fmtK(300000)}`,
    unlocked: (s) => s.maxEpochSpend >= 300000,
  },
  {
    id: "bankroll_100k",
    title: "Capital I",
    description: "Deposit 100k LINEA total",
    icon: "🏦",
    progress: (s) => `${fmtK(Math.min(s.totalDeposited, 100000))}/${fmtK(100000)}`,
    unlocked: (s) => s.totalDeposited >= 100000,
  },
  {
    id: "bankroll_300k",
    title: "Capital II",
    description: "Deposit 300k LINEA total",
    icon: "🏛️",
    progress: (s) => `${fmtK(Math.min(s.totalDeposited, 300000))}/${fmtK(300000)}`,
    unlocked: (s) => s.totalDeposited >= 300000,
  },
  {
    id: "bankroll_700k",
    title: "Capital III",
    description: "Deposit 700k LINEA total",
    icon: "💠",
    progress: (s) => `${fmtK(Math.min(s.totalDeposited, 700000))}/${fmtK(700000)}`,
    unlocked: (s) => s.totalDeposited >= 700000,
  },
  {
    id: "bankroll_1m",
    title: "Capital IV",
    description: "Deposit 1M LINEA total",
    icon: "💎",
    progress: (s) => `${fmtK(Math.min(s.totalDeposited, 1000000))}/${fmtK(1000000)}`,
    unlocked: (s) => s.totalDeposited >= 1000000,
  },
  {
    id: "wins_100",
    title: "Century Crown",
    description: "Win 100 rounds",
    icon: "🌪️",
    progress: (s) => `${Math.min(s.winsCount, 100)}/100`,
    unlocked: (s) => s.winsCount >= 100,
  },
  {
    id: "wins_250",
    title: "Quarter Master",
    description: "Win 250 rounds",
    icon: "⚔️",
    progress: (s) => `${Math.min(s.winsCount, 250)}/250`,
    unlocked: (s) => s.winsCount >= 250,
  },
  {
    id: "wins_500",
    title: "Half Legend",
    description: "Win 500 rounds",
    icon: "👑",
    progress: (s) => `${Math.min(s.winsCount, 500)}/500`,
    unlocked: (s) => s.winsCount >= 500,
  },
  {
    id: "wins_1000",
    title: "Thousand King",
    description: "Win 1k rounds",
    icon: "👑",
    progress: (s) => `${fmtK(Math.min(s.winsCount, 1000))}/${fmtK(1000)}`,
    unlocked: (s) => s.winsCount >= 1000,
  },
  {
    id: "wins_1500",
    title: "Victory Lord",
    description: "Win 1.5k rounds",
    icon: "🏆",
    progress: (s) => `${fmtK(Math.min(s.winsCount, 1500))}/${fmtK(1500)}`,
    unlocked: (s) => s.winsCount >= 1500,
  },
  {
    id: "jackpot_5k",
    title: "Vein Finder",
    description: "Get 5k LINEA reward in one epoch",
    icon: "💰",
    progress: (s) => `${fmtK(Math.min(s.maxReward, 5000))}/${fmtK(5000)}`,
    unlocked: (s) => s.maxReward >= 5000,
  },
  {
    id: "jackpot_10k",
    title: "Vein Hunter",
    description: "Get 10k LINEA reward in one epoch",
    icon: "💰",
    progress: (s) => `${fmtK(Math.min(s.maxReward, 10000))}/${fmtK(10000)}`,
    unlocked: (s) => s.maxReward >= 10000,
  },
  {
    id: "jackpot_50k",
    title: "Vein Master",
    description: "Get 50k LINEA reward in one epoch",
    icon: "💰",
    progress: (s) => `${fmtK(Math.min(s.maxReward, 50000))}/${fmtK(50000)}`,
    unlocked: (s) => s.maxReward >= 50000,
  },
  {
    id: "jackpot_100k",
    title: "King Vein",
    description: "Get 100k LINEA reward in one epoch",
    icon: "🪙",
    progress: (s) => `${fmtK(Math.min(s.maxReward, 100000))}/${fmtK(100000)}`,
    unlocked: (s) => s.maxReward >= 100000,
  },
  {
    id: "epochs_100",
    title: "Epoch Veteran",
    description: "Participate in 1k epochs",
    icon: "⏳",
    progress: (s) => `${fmtK(Math.min(s.uniqueEpochsCount, 1000))}/${fmtK(1000)}`,
    unlocked: (s) => s.uniqueEpochsCount >= 1000,
  },
  {
    id: "epochs_10k",
    title: "Time Lord",
    description: "Participate in 10k epochs",
    icon: "🕰️",
    progress: (s) => `${fmtK(Math.min(s.uniqueEpochsCount, 10000))}/${fmtK(10000)}`,
    unlocked: (s) => s.uniqueEpochsCount >= 10000,
  },
  {
    id: "deposits_500",
    title: "Veteran Bettor",
    description: "Make 500 bets total",
    icon: "📊",
    progress: (s) => `${Math.min(s.depositsCount, 500)}/500`,
    unlocked: (s) => s.depositsCount >= 500,
  },
  {
    id: "deposits_1000",
    title: "Bet Master",
    description: "Make 1k bets total",
    icon: "📈",
    progress: (s) => `${fmtK(Math.min(s.depositsCount, 1000))}/${fmtK(1000)}`,
    unlocked: (s) => s.depositsCount >= 1000,
  },
  {
    id: "deposits_3000",
    title: "Legendary Grinder",
    description: "Make 3k bets total",
    icon: "🏅",
    progress: (s) => `${fmtK(Math.min(s.depositsCount, 3000))}/${fmtK(3000)}`,
    unlocked: (s) => s.depositsCount >= 3000,
  },
  {
    id: "winstreak_3",
    title: "On Fire",
    description: "Win 3 rounds in a row (max 4 unique tiles per round)",
    icon: "🔥",
    progress: (s) => `${Math.min(s.maxWinStreak, 3)}/3`,
    unlocked: (s) => s.maxWinStreak >= 3,
  },
  {
    id: "winstreak_4",
    title: "Triple Crown",
    description: "Win 4 rounds in a row (max 4 unique tiles per round)",
    icon: "👑",
    progress: (s) => `${Math.min(s.maxWinStreak, 4)}/4`,
    unlocked: (s) => s.maxWinStreak >= 4,
  },
  {
    id: "winstreak_5",
    title: "Unstoppable",
    description: "Win 5 rounds in a row (max 4 unique tiles per round)",
    icon: "⚡",
    progress: (s) => `${Math.min(s.maxWinStreak, 5)}/5`,
    unlocked: (s) => s.maxWinStreak >= 5,
  },
  {
    id: "first_blood",
    title: "First Blood",
    description: "Win your very first bet",
    icon: "🎯",
    progress: (s) => (s.firstBetWon ? "1/1" : "0/1"),
    unlocked: (s) => s.firstBetWon,
  },
  {
    id: "multiplier_5x",
    title: "5x Multiplier",
    description: "Win an epoch with reward ≥ 5× your bet in that epoch",
    icon: "📈",
    progress: (s) => `${Math.min(s.maxRewardToEpochBetRatio, 5).toFixed(1)}/5`,
    unlocked: (s) => s.maxRewardToEpochBetRatio >= 5,
  },
  {
    id: "multiplier_10x",
    title: "10x Multiplier",
    description: "Win an epoch with reward ≥ 10× your bet in that epoch",
    icon: "🚀",
    progress: (s) => `${Math.min(s.maxRewardToEpochBetRatio, 10).toFixed(1)}/10`,
    unlocked: (s) => s.maxRewardToEpochBetRatio >= 10,
  },
  {
    id: "life_changer",
    title: "Life Changer",
    description: "Get a reward bigger than your total deposited",
    icon: "💫",
    progress: (s) => (s.totalDeposited > 0 ? `${fmtK(Math.min(s.maxReward, s.totalDeposited * 2))}/${fmtK(s.totalDeposited)}` : "0/1"),
    unlocked: (s) => s.totalDeposited > 0 && s.maxReward > s.totalDeposited,
  },
  {
    id: "snowball",
    title: "Snowball",
    description: "Get a reward bigger than your largest single bet",
    icon: "❄️",
    progress: (s) => (s.maxSingleBet > 0 ? `${fmtK(s.maxReward)}/${fmtK(s.maxSingleBet)}` : "0/1"),
    unlocked: (s) => s.maxSingleBet > 0 && s.maxReward > s.maxSingleBet,
  },
  {
    id: "grid_master",
    title: "Grid Master",
    description: "Bet on all 25 tiles at least once",
    icon: "🗺️",
    progress: (s) => `${Math.min(s.uniqueTilesCount, 25)}/25`,
    unlocked: (s) => s.uniqueTilesCount >= 25,
  },
  {
    id: "never_give_up",
    title: "Iron Nerves",
    description: "Take 10k losing rounds and keep playing",
    icon: "🛡️",
    progress: (s) => `${fmtK(Math.min(s.lossesCount, 10000))}/${fmtK(10000)}`,
    unlocked: (s) => s.lossesCount >= 10000 && s.depositsCount >= 10050,
  },
];

const achievementRarity: Record<string, AchievementRarity> = {
  single_1k: "common",
  single_50k: "rare",
  single_100k: "epic",
  single_300k: "legendary",
  round_300k: "legendary",
  bankroll_100k: "rare",
  bankroll_300k: "epic",
  bankroll_700k: "legendary",
  bankroll_1m: "legendary",
  wins_100: "common",
  wins_250: "uncommon",
  wins_500: "rare",
  wins_1000: "epic",
  wins_1500: "legendary",
  jackpot_5k: "common",
  jackpot_10k: "uncommon",
  jackpot_50k: "rare",
  jackpot_100k: "epic",
  epochs_100: "rare",
  epochs_10k: "legendary",
  deposits_500: "uncommon",
  deposits_1000: "epic",
  deposits_3000: "legendary",
  winstreak_3: "rare",
  winstreak_4: "epic",
  winstreak_5: "exotic",
  first_blood: "rare",
  multiplier_5x: "epic",
  multiplier_10x: "legendary",
  life_changer: "divine",
  snowball: "uncommon",
  grid_master: "common",
  never_give_up: "exotic",
};

const rarityLabel: Record<AchievementRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  exotic: "Exotic",
  divine: "Divine",
};

const rarityTextColor: Record<AchievementRarity, string> = {
  common: "text-slate-400",
  uncommon: "text-emerald-400",
  rare: "text-sky-400",
  epic: "text-fuchsia-400",
  legendary: "text-amber-400",
  exotic: "text-orange-400",
  divine: "text-cyan-400",
};

function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000) % 1 === 0 ? `${n / 1e6}M` : `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return (n / 1000) % 1 === 0 ? `${n / 1000}k` : `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

function parseProgressPart(s: string): number {
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(k|M)?$/i);
  if (!m) return 0;
  let n = Number(m[1]);
  if (m[2] === "k" || m[2] === "K") n *= 1000;
  else if (m[2] === "m" || m[2] === "M") n *= 1_000_000;
  return Number.isFinite(n) ? n : 0;
}

function parseProgress(label: string) {
  const parts = label.split("/").map((p) => p.trim());
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
  return `lore:achievements:${ACHIEVEMENTS_VERSION}:${walletAddress.toLowerCase()}`;
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
    const legacyPrefix = "lore:achievements:v1:";
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(legacyPrefix)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
    localStorage.setItem(ACHIEVEMENTS_CLEANUP_FLAG, "1");
  } catch {
    // ignore storage errors
  }
}

interface AnalyticsProps {
  walletAddress?: string;
  historyViewData: Array<{
    roundId: string;
    poolDisplay: string;
    winningTile: string;
    isResolved: boolean;
    userWon: boolean;
  }>;
  deposits: DepositEntry[] | null;
  depositsLoading: boolean;
  depositsError: string | null;
  totalDeposited: number;
  onLoadDeposits: () => void;
  onRefreshDeposits: () => void;
  jackpotHistory: JackpotHistoryEntry[];
  jackpotHistoryLoading: boolean;
  jackpotHistoryError: string | null;
  onRefreshJackpotHistory: () => void;
}

export const Analytics = React.memo(function Analytics({
  walletAddress,
  historyViewData,
  deposits,
  depositsLoading,
  depositsError,
  totalDeposited,
  onLoadDeposits,
  onRefreshDeposits,
  jackpotHistory,
  jackpotHistoryLoading,
  jackpotHistoryError,
  onRefreshJackpotHistory,
}: AnalyticsProps) {
  useEffect(() => {
    cleanupLegacyAchievementStorage();
  }, []);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleDeposits = useMemo(() => deposits?.slice(0, visibleCount), [deposits, visibleCount]);
  const hasMore = deposits !== null && visibleCount < deposits.length;

  // Track which rows we've already shown – animate only genuinely new ones
  const seenHistoryRef = useRef<Set<string>>(new Set());
  const historyInitRef = useRef(false);
  const seenDepositsRef = useRef<Set<string>>(new Set());
  const depositsInitRef = useRef(false);

  const newHistoryIds = useMemo(() => {
    if (!historyInitRef.current) return new Set<string>();
    const s = new Set<string>();
    for (const r of historyViewData) {
      if (!seenHistoryRef.current.has(r.roundId)) s.add(r.roundId);
    }
    return s;
  }, [historyViewData]);

  useEffect(() => {
    if (historyViewData.length > 0) {
      historyInitRef.current = true;
      for (const r of historyViewData) seenHistoryRef.current.add(r.roundId);
    }
  }, [historyViewData]);

  const newDepositIds = useMemo(() => {
    if (!depositsInitRef.current || !deposits) return new Set<string>();
    const s = new Set<string>();
    for (const d of deposits) {
      if (d.txHash && !seenDepositsRef.current.has(d.txHash)) s.add(d.txHash);
    }
    return s;
  }, [deposits]);

  useEffect(() => {
    if (deposits && deposits.length > 0) {
      depositsInitRef.current = true;
      for (const d of deposits) if (d.txHash) seenDepositsRef.current.add(d.txHash);
    }
  }, [deposits]);
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

    // Pass 1: accumulate per-epoch totals
    for (const d of list) {
      epochSet.add(d.epoch);

      const perTile = d.tileIds.length > 0 ? d.amountNum / d.tileIds.length : d.amountNum;
      maxSingleBet = Math.max(maxSingleBet, perTile);

      const nextEpochAmount = (epochSpend.get(d.epoch) ?? 0) + d.amountNum;
      epochSpend.set(d.epoch, nextEpochAmount);
      maxEpochSpend = Math.max(maxEpochSpend, nextEpochAmount);
      totalTilesPicked += d.tileIds.length;
      if (d.tileIds.length > 1) multiTileBets += 1;
      for (const t of d.tileIds) tileSet.add(t);
      const epochTiles = epochUniqueTiles.get(d.epoch) ?? new Set<number>();
      for (const t of d.tileIds) epochTiles.add(t);
      epochUniqueTiles.set(d.epoch, epochTiles);

      if (d.winningTile !== null && d.tileIds.includes(d.winningTile)) {
        epochWon.add(d.epoch);
      }
      if (d.reward !== null && d.reward > 0) {
        epochReward.set(d.epoch, Math.max(epochReward.get(d.epoch) ?? 0, d.reward));
      }
    }

    // Pass 2: compute reward-based stats using final epochSpend values
    let maxReward = 0;
    let maxRewardToEpochBetRatio = 0;
    for (const [ep, reward] of epochReward) {
      maxReward = Math.max(maxReward, reward);
      const epochBet = epochSpend.get(ep) ?? 1;
      if (epochBet > 0) {
        maxRewardToEpochBetRatio = Math.max(maxRewardToEpochBetRatio, reward / epochBet);
      }
    }

    const winsCount = epochWon.size;
    const lossesCount = Math.max(0, epochSet.size - winsCount);

    const sortedEpochs = [...epochSet].sort((a, b) => Number(BigInt(a) - BigInt(b)));
    let maxWinStreak = 0;
    let currentStreak = 0;
    for (const ep of sortedEpochs) {
      // Anti-cheese: streak counts only in precision rounds (<= 4 unique tiles in epoch).
      const uniqueTilesInEpoch = epochUniqueTiles.get(ep)?.size ?? 0;
      const isPrecisionRound = uniqueTilesInEpoch > 0 && uniqueTilesInEpoch <= 4;
      if (isPrecisionRound && epochWon.has(ep)) {
        currentStreak += 1;
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    const firstEpoch = sortedEpochs[0];
    const firstBetWon = firstEpoch ? epochWon.has(firstEpoch) : false;

    return {
      depositsCount: list.length,
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

  const achievementCards = useMemo(() => {
    const nowIso = new Date().toISOString();
    const cards = achievementDefs.map((def) => {
      const unlockedNow = def.unlocked(stats);
      const unlockedAt = persisted.unlockedAt[def.id] ?? (unlockedNow ? nowIso : null);
      const progressLabel = def.progress(stats);
      const progress = parseProgress(progressLabel);
      const rarity = achievementRarity[def.id] ?? "common";
      const unlocked = unlockedNow || Boolean(persisted.unlockedAt[def.id]);
      return {
        ...def,
        rarity,
        unlocked,
        unlockedAt,
        progressLabel,
        progressCurrent: progress.current,
        progressTarget: progress.target,
        progressPct: unlocked ? 100 : progress.percent,
      };
    });
    // Locked first, unlocked at the end – so unfinished ones stay visible
    return [...cards].sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? 1 : -1));
  }, [stats, persisted]);

  const unlockedCount = useMemo(
    () => achievementCards.filter((a) => a.unlocked).length,
    [achievementCards],
  );

  React.useEffect(() => {
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

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto animate-fade-in">
      {/* ═══ Achievements ═══ */}
      <UiPanel
        tone="default"
        padding="md"
        className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
      >
        <div className="relative flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <div className="w-1 h-4 bg-amber-500 rounded-sm shadow-[0_0_10px_rgba(245,158,11,0.45)]" />
            Achievements
          </h2>
          {(deposits === null || depositsLoading) && (
            <p className="absolute left-1/2 -translate-x-1/2 text-[10px] text-slate-500 whitespace-nowrap">
              Progress fills after My Deposits loads below
            </p>
          )}
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            Unlocked: <span className="text-amber-400">{unlockedCount}/{achievementCards.length}</span>
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {achievementCards.map((a) => (
            <div
              key={a.id}
              className={`shrink-0 w-[148px] h-[96px] rounded-lg border px-2 py-2 transition-colors flex flex-col ${
                a.unlocked
                  ? "border-violet-400/30 bg-gradient-to-br from-[#1a1a2f] to-[#131322]"
                  : "border-white/[0.07] bg-gradient-to-br from-[#141424] to-[#10101b]"
              }`}
              title={a.description}
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1 min-h-0 overflow-hidden">
                <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                  <div className="relative w-7 h-7 shrink-0 [clip-path:polygon(30%_4%,70%_4%,96%_30%,96%_70%,70%_96%,30%_96%,4%_70%,4%_30%)] bg-gradient-to-br from-violet-400/40 via-fuchsia-400/30 to-sky-400/40 border border-white/15 shadow-[0_0_7px_rgba(139,92,246,0.25)]">
                    <div className="absolute inset-[1.5px] [clip-path:polygon(30%_4%,70%_4%,96%_30%,96%_70%,70%_96%,30%_96%,4%_70%,4%_30%)] bg-[#171727] border border-white/10 flex items-center justify-center text-xs">
                      {a.icon}
                    </div>
                  </div>
                  <div className="min-w-0 truncate">
                    <div className={`text-[13px] font-black leading-none truncate ${a.unlocked ? "text-white" : "text-slate-200/90"}`}>
                      {a.title}
                    </div>
                    <div className={`text-[10px] font-semibold ${rarityTextColor[a.rarity]}`}>
                      {rarityLabel[a.rarity]}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 leading-tight line-clamp-2 min-h-0 flex-1">
                  {a.description}
                </div>
              </div>

              <div className="mt-1 w-full shrink-0">
                <div className="h-1.5 w-full rounded-full bg-black/40 border border-white/10 overflow-hidden">
                  <div
                    className={`h-full shrink-0 rounded-full transition-all duration-500 ${
                      a.unlocked
                        ? "bg-gradient-to-r from-emerald-400 to-lime-400"
                        : "bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, Number(a.progressPct) || 0))}%`,
                      minWidth: (a.progressPct > 0 && a.progressPct < 100) ? "4px" : undefined,
                    }}
                  />
                </div>
              </div>

              {a.unlocked && a.unlockedAt ? (
                <div className="mt-0.5 text-[9px] text-slate-500 shrink-0 leading-none">
                  unlocked {new Date(a.unlockedAt).toLocaleDateString()}
                </div>
              ) : (
                <div className="mt-0.5 shrink-0 h-3" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </UiPanel>

      {/* ═══ My Deposits ═══ */}
      <UiPanel
        tone="default"
        padding="md"
        className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <div className="w-1 h-4 bg-sky-500 rounded-sm shadow-[0_0_10px_rgba(14,165,233,0.4)]" />
            My Deposits
          </h2>
          <div className="flex items-center gap-3">
            {deposits && deposits.length > 0 && (
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                Total: <span className="text-sky-400">{totalDeposited.toFixed(2)} LINEA</span>
                <span className="text-gray-600 ml-1.5">({deposits.length} tx)</span>
              </span>
            )}
            <UiButton
              onClick={onRefreshDeposits}
              disabled={depositsLoading}
              variant="ghost"
              size="xs"
              className="h-8 w-8 p-0 text-gray-500 hover:text-sky-300 hover:border-sky-500/20 hover:bg-sky-500/[0.06]"
              title="Refresh"
              aria-label="Refresh deposits"
            >
              <svg className={`w-3.5 h-3.5 ${depositsLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </UiButton>
          </div>
        </div>

        {depositsError ? (
          <div className="flex flex-col items-center justify-center py-4 gap-2">
            <span className="text-[11px] text-amber-400/90">Failed to load: {depositsError}</span>
            <span className="text-[10px] text-gray-500">Check Firebase and indexer on the server. Then click Refresh above.</span>
          </div>
        ) : deposits === null && !depositsLoading ? (
          <div className="flex flex-col items-center justify-center py-3 gap-2">
            <span className="text-[12px] text-gray-500">Scans full chain history for your bets (cached incrementally)</span>
            <UiButton
              onClick={onLoadDeposits}
              disabled={depositsLoading}
              variant="sky"
              size="sm"
              uppercase
            >
              {depositsLoading ? <LoreText items={loadingQuotes} /> : "Load History"}
            </UiButton>
          </div>
        ) : deposits === null && depositsLoading ? (
          <div className="flex items-center justify-center py-4 gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-synced-pulse" />
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider"><LoreText items={loadingQuotes} /></span>
          </div>
        ) : deposits && deposits.length === 0 ? (
          <div className="text-center py-4 flex flex-col items-center gap-2">
            <span className="text-[11px] text-gray-600 italic"><LoreText items={emptyStates.analytics} /></span>
            <span className="text-[10px] text-gray-500">If you&apos;ve already placed bets, use <strong className="text-sky-400/90">Refresh</strong> above to load history.</span>
          </div>
        ) : (
          <>
            <UiTable tone="sky" maxHeightClass="max-h-[260px]">
              <table className="w-full text-left">
                <UiTableHead>
                  <tr>
                    <th className="px-3 py-2 w-[70px]">Epoch</th>
                    <th className="px-3 py-2">Tiles</th>
                    <th className="px-3 py-2 text-right w-[110px]">Amount</th>
                    <th className="px-3 py-2 text-right w-[90px]">Tx</th>
                  </tr>
                </UiTableHead>
                <UiTableBody>
                  {visibleDeposits!.map((d, idx) => {
                    const isNew = d.txHash ? newDepositIds.has(d.txHash) : false;
                    return (
                    <UiTableRow key={d.txHash || `${d.epoch}-${idx}`} index={idx} isNew={isNew}>
                      <td className="px-3 py-2 font-mono text-white text-sm font-semibold whitespace-nowrap">#{d.epoch}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {[...d.tileIds].sort((a, b) => a - b).map((t, i) => {
                            const isWinner = d.winningTile !== null && t === d.winningTile;
                            return (
                              <span
                                key={`${t}-${i}`}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold border ${
                                  isWinner
                                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-[0_0_6px_rgba(245,158,11,0.3)]"
                                    : "bg-violet-500/10 text-violet-400 border-violet-500/20"
                                }`}
                              >
                                {t}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className="font-bold text-sky-400 font-mono text-sm">{d.amount}</span>
                        <span className="text-xs text-gray-600 ml-0.5">LINEA</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {d.txHash ? (
                          <a
                            href={`https://sepolia.lineascan.build/tx/${d.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-violet-400/60 hover:text-violet-400 transition-colors"
                          >
                            {d.txHash.slice(0, 6)}…{d.txHash.slice(-4)}
                          </a>
                        ) : (
                          <span className="text-gray-600">–</span>
                        )}
                      </td>
                    </UiTableRow>
                    );
                  })}
                </UiTableBody>
              </table>
            </UiTable>
            {hasMore && (
              <UiButton
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                variant="ghost"
                size="xs"
                fullWidth
                uppercase
                className="mt-2 text-gray-400 hover:text-gray-300"
              >
                Show more ({deposits.length - visibleCount} remaining)
              </UiButton>
            )}
          </>
        )}
      </UiPanel>

      {/* ═══ Jackpot History ═══ */}
      <UiPanel
        tone="default"
        padding="md"
        className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <div className="w-1 h-4 bg-amber-400 rounded-sm shadow-[0_0_10px_rgba(251,191,36,0.45)]" />
            Jackpot History
          </h2>
          <UiButton
            onClick={onRefreshJackpotHistory}
            disabled={jackpotHistoryLoading}
            variant="ghost"
            size="xs"
            className="h-8 w-8 p-0 text-gray-500 hover:text-amber-300 hover:border-amber-500/20 hover:bg-amber-500/[0.06]"
            title="Refresh jackpot history"
            aria-label="Refresh jackpot history"
          >
            <svg className={`w-3.5 h-3.5 ${jackpotHistoryLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </UiButton>
        </div>

        {jackpotHistoryError ? (
          <div className="text-center py-4 flex flex-col items-center gap-2">
            <span className="text-[11px] text-amber-400/90">Failed to load: {jackpotHistoryError}</span>
            <span className="text-[10px] text-gray-500">Check Firebase and indexer. Use Refresh above.</span>
          </div>
        ) : jackpotHistory.length === 0 ? (
          <div className="text-center py-4 flex flex-col items-center gap-2">
            {jackpotHistoryLoading ? (
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider"><LoreText items={loadingQuotes} /></span>
            ) : (
              <>
                <span className="text-[11px] text-gray-600 italic">No jackpot awards yet.</span>
                <span className="text-[10px] text-gray-500">If a jackpot was awarded, the indexer may still be syncing. Use Refresh above.</span>
              </>
            )}
          </div>
        ) : (
          <UiTable tone="amber" maxHeightClass="max-h-[220px]">
            <table className="w-full text-left">
              <UiTableHead>
                <tr>
                  <th className="px-3 py-2 w-[90px]">Type</th>
                  <th className="px-3 py-2 w-[150px]">Date</th>
                  <th className="px-3 py-2 w-[80px]">Epoch</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right w-[95px]">Tx</th>
                </tr>
              </UiTableHead>
              <UiTableBody>
                {jackpotHistory.map((j, idx) => (
                  <UiTableRow key={`${j.kind}-${j.epoch}-${j.txHash}-${idx}`} index={idx}>
                    <td className="px-3 py-2">
                      {j.kind === "daily" ? (
                        <UiBadge tone="amber" size="xs" uppercase>
                          Daily
                        </UiBadge>
                      ) : (
                        <UiBadge tone="fuchsia" size="xs" uppercase>
                          Weekly
                        </UiBadge>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {j.timestamp ? (
                        <span className="text-[11px] text-gray-300 font-mono">
                          {new Date(j.timestamp).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-gray-600">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-white text-sm font-semibold whitespace-nowrap">#{j.epoch}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="font-bold text-amber-300 font-mono text-sm">{j.amount}</span>
                      <span className="text-xs text-gray-600 ml-0.5">LINEA</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {j.txHash ? (
                        <a
                          href={`https://sepolia.lineascan.build/tx/${j.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-violet-400/60 hover:text-violet-400 transition-colors"
                        >
                          {j.txHash.slice(0, 6)}…{j.txHash.slice(-4)}
                        </a>
                      ) : (
                        <span className="text-gray-600">–</span>
                      )}
                    </td>
                  </UiTableRow>
                ))}
              </UiTableBody>
            </table>
          </UiTable>
        )}
      </UiPanel>

      {/* ═══ Blockchain History ═══ */}
      <UiPanel
        tone="default"
        padding="md"
        className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
      >
        <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2 uppercase tracking-wider">
          <div className="w-1 h-4 bg-violet-500 rounded-sm shadow-[0_0_10px_rgba(139,92,246,0.4)]" />
          Blockchain History
        </h2>

        <UiTable tone="violet" maxHeightClass="max-h-[260px]">
          <table className="w-full text-left">
            <UiTableHead>
              <tr>
                <th className="px-3 py-2">Round</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Winner</th>
                <th className="px-3 py-2 text-right">Pool</th>
              </tr>
            </UiTableHead>
            <UiTableBody>
              {historyViewData.map((row, idx) => {
                const winBlockNum = Number(row.winningTile);
                const isNew = newHistoryIds.has(row.roundId);
                return (
                  <UiTableRow key={row.roundId} index={idx} isNew={isNew}>
                    <td className="px-3 py-2 font-mono text-white text-sm font-semibold">#{row.roundId}</td>
                    <td className="px-3 py-2">
                      {row.isResolved ? (
                        <UiBadge tone="success" size="xs" uppercase dot>
                          Done
                        </UiBadge>
                      ) : (
                        <UiBadge tone="warning" size="xs" uppercase dot pulseDot>
                          Pending
                        </UiBadge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.isResolved && winBlockNum > 0 ? (
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white">Block #{row.winningTile}</span>
                          {row.userWon && (
                            <UiBadge tone="amber" size="xs" uppercase>
                              <span className="text-amber-300">★</span> You won
                            </UiBadge>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-600">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-bold text-violet-400 font-mono text-sm">{row.poolDisplay}</span>
                      <span className="text-[11px] text-gray-600 ml-1">LINEA</span>
                    </td>
                  </UiTableRow>
                );
              })}
            </UiTableBody>
          </table>
        </UiTable>
      </UiPanel>
    </div>
  );
});
