"use client";

import type { AchievementStats } from "../../hooks/useAnalyticsAchievements";

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: (stats: AchievementStats) => string;
  unlocked: (stats: AchievementStats) => boolean;
}

export type AchievementRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "exotic" | "divine";

export function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000) % 1 === 0 ? `${n / 1e6}M` : `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return (n / 1000) % 1 === 0 ? `${n / 1000}k` : `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

export const achievementDefs: AchievementDef[] = [
  { id: "single_1k", title: "Spark", description: "Place 10k LINEA on a single tile in one bet", icon: "🔥", progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 10000))}/${fmtK(10000)}`, unlocked: (s) => s.maxSingleBet >= 10000 },
  { id: "single_50k", title: "Arc Flash", description: "Place 50k LINEA on a single tile in one bet", icon: "⚡", progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 50000))}/${fmtK(50000)}`, unlocked: (s) => s.maxSingleBet >= 50000 },
  { id: "single_100k", title: "High Roller", description: "Place 100k LINEA on a single tile in one bet", icon: "🎲", progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 100000))}/${fmtK(100000)}`, unlocked: (s) => s.maxSingleBet >= 100000 },
  { id: "single_300k", title: "Leviathan", description: "Place 300k LINEA on a single tile in one bet", icon: "🐋", progress: (s) => `${fmtK(Math.min(s.maxSingleBet, 300000))}/${fmtK(300000)}`, unlocked: (s) => s.maxSingleBet >= 300000 },
  { id: "round_300k", title: "Epoch Breaker", description: "Wager 300k LINEA in a single epoch", icon: "☄️", progress: (s) => `${fmtK(Math.min(s.maxEpochSpend, 300000))}/${fmtK(300000)}`, unlocked: (s) => s.maxEpochSpend >= 300000 },
  { id: "bankroll_100k", title: "Capital I", description: "Wager 100k LINEA total", icon: "🏦", progress: (s) => `${fmtK(Math.min(s.totalDeposited, 100000))}/${fmtK(100000)}`, unlocked: (s) => s.totalDeposited >= 100000 },
  { id: "bankroll_300k", title: "Capital II", description: "Wager 300k LINEA total", icon: "🏛️", progress: (s) => `${fmtK(Math.min(s.totalDeposited, 300000))}/${fmtK(300000)}`, unlocked: (s) => s.totalDeposited >= 300000 },
  { id: "bankroll_700k", title: "Capital III", description: "Wager 700k LINEA total", icon: "💠", progress: (s) => `${fmtK(Math.min(s.totalDeposited, 700000))}/${fmtK(700000)}`, unlocked: (s) => s.totalDeposited >= 700000 },
  { id: "bankroll_1m", title: "Capital IV", description: "Wager 1M LINEA total", icon: "💎", progress: (s) => `${fmtK(Math.min(s.totalDeposited, 1000000))}/${fmtK(1000000)}`, unlocked: (s) => s.totalDeposited >= 1000000 },
  { id: "wins_100", title: "Century Crown", description: "Win 100 rounds", icon: "🌪️", progress: (s) => `${Math.min(s.winsCount, 100)}/100`, unlocked: (s) => s.winsCount >= 100 },
  { id: "wins_250", title: "Quarter Crown", description: "Win 250 rounds", icon: "⚔️", progress: (s) => `${Math.min(s.winsCount, 250)}/250`, unlocked: (s) => s.winsCount >= 250 },
  { id: "wins_500", title: "Storm Banner", description: "Win 500 rounds", icon: "🌩️", progress: (s) => `${Math.min(s.winsCount, 500)}/500`, unlocked: (s) => s.winsCount >= 500 },
  { id: "wins_1000", title: "Thousand Crown", description: "Win 1k rounds", icon: "👑", progress: (s) => `${fmtK(Math.min(s.winsCount, 1000))}/${fmtK(1000)}`, unlocked: (s) => s.winsCount >= 1000 },
  { id: "wins_1500", title: "Victory Lord", description: "Win 1.5k rounds", icon: "🏆", progress: (s) => `${fmtK(Math.min(s.winsCount, 1500))}/${fmtK(1500)}`, unlocked: (s) => s.winsCount >= 1500 },
  { id: "jackpot_5k", title: "Lucky Vein", description: "Earn 5k LINEA from one epoch", icon: "💰", progress: (s) => `${fmtK(Math.min(s.maxReward, 5000))}/${fmtK(5000)}`, unlocked: (s) => s.maxReward >= 5000 },
  { id: "jackpot_10k", title: "Gold Rush", description: "Earn 10k LINEA from one epoch", icon: "💸", progress: (s) => `${fmtK(Math.min(s.maxReward, 10000))}/${fmtK(10000)}`, unlocked: (s) => s.maxReward >= 10000 },
  { id: "jackpot_50k", title: "Deep Vein", description: "Earn 50k LINEA from one epoch", icon: "🪙", progress: (s) => `${fmtK(Math.min(s.maxReward, 50000))}/${fmtK(50000)}`, unlocked: (s) => s.maxReward >= 50000 },
  { id: "jackpot_100k", title: "Motherlode", description: "Earn 100k LINEA from one epoch", icon: "👑", progress: (s) => `${fmtK(Math.min(s.maxReward, 100000))}/${fmtK(100000)}`, unlocked: (s) => s.maxReward >= 100000 },
  { id: "epochs_100", title: "Epoch Veteran", description: "Participate in 1k epochs", icon: "⏳", progress: (s) => `${fmtK(Math.min(s.uniqueEpochsCount, 1000))}/${fmtK(1000)}`, unlocked: (s) => s.uniqueEpochsCount >= 1000 },
  { id: "epochs_10k", title: "Time Lord", description: "Participate in 10k epochs", icon: "🕰️", progress: (s) => `${fmtK(Math.min(s.uniqueEpochsCount, 10000))}/${fmtK(10000)}`, unlocked: (s) => s.uniqueEpochsCount >= 10000 },
  { id: "deposits_500", title: "Veteran Bettor", description: "Place 500 bets total", icon: "📊", progress: (s) => `${Math.min(s.depositsCount, 500)}/500`, unlocked: (s) => s.depositsCount >= 500 },
  { id: "deposits_1000", title: "Bet Master", description: "Place 1k bets total", icon: "📈", progress: (s) => `${fmtK(Math.min(s.depositsCount, 1000))}/${fmtK(1000)}`, unlocked: (s) => s.depositsCount >= 1000 },
  { id: "deposits_3000", title: "Legendary Grinder", description: "Place 3k bets total", icon: "🏅", progress: (s) => `${fmtK(Math.min(s.depositsCount, 3000))}/${fmtK(3000)}`, unlocked: (s) => s.depositsCount >= 3000 },
  { id: "winstreak_3", title: "On Fire", description: "Win 3 rounds in a row (max 4 unique tiles per round)", icon: "🔥", progress: (s) => `${Math.min(s.maxWinStreak, 3)}/3`, unlocked: (s) => s.maxWinStreak >= 3 },
  { id: "winstreak_4", title: "Triple Crown", description: "Win 4 rounds in a row (max 4 unique tiles per round)", icon: "👑", progress: (s) => `${Math.min(s.maxWinStreak, 4)}/4`, unlocked: (s) => s.maxWinStreak >= 4 },
  { id: "winstreak_5", title: "Unstoppable", description: "Win 5 rounds in a row (max 4 unique tiles per round)", icon: "⚡", progress: (s) => `${Math.min(s.maxWinStreak, 5)}/5`, unlocked: (s) => s.maxWinStreak >= 5 },
  { id: "first_blood", title: "First Blood", description: "Win your first recorded bet", icon: "🎯", progress: (s) => (s.firstBetWon ? "1/1" : "0/1"), unlocked: (s) => s.firstBetWon },
  { id: "multiplier_5x", title: "5x Multiplier", description: "Win an epoch with reward >= 5x your bet in that epoch", icon: "📈", progress: (s) => `${Math.min(s.maxRewardToEpochBetRatio, 5).toFixed(1)}/5`, unlocked: (s) => s.maxRewardToEpochBetRatio >= 5 },
  { id: "multiplier_10x", title: "10x Multiplier", description: "Win an epoch with reward >= 10x your bet in that epoch", icon: "🚀", progress: (s) => `${Math.min(s.maxRewardToEpochBetRatio, 10).toFixed(1)}/10`, unlocked: (s) => s.maxRewardToEpochBetRatio >= 10 },
  { id: "life_changer", title: "Life Changer", description: "Get a reward bigger than your total wagered", icon: "💫", progress: (s) => (s.totalDeposited > 0 ? `${fmtK(Math.min(s.maxReward, s.totalDeposited * 2))}/${fmtK(s.totalDeposited)}` : "0/1"), unlocked: (s) => s.totalDeposited > 0 && s.maxReward > s.totalDeposited },
  { id: "snowball", title: "Snowball", description: "Get a reward bigger than your largest single bet", icon: "❄️", progress: (s) => (s.maxSingleBet > 0 ? `${fmtK(s.maxReward)}/${fmtK(s.maxSingleBet)}` : "0/1"), unlocked: (s) => s.maxSingleBet > 0 && s.maxReward > s.maxSingleBet },
  { id: "grid_master", title: "Grid Master", description: "Bet on all 25 tiles at least once", icon: "🗺️", progress: (s) => `${Math.min(s.uniqueTilesCount, 25)}/25`, unlocked: (s) => s.uniqueTilesCount >= 25 },
  { id: "never_give_up", title: "Iron Nerves", description: "Take 10k losing rounds and keep playing", icon: "🛡️", progress: (s) => `${fmtK(Math.min(s.lossesCount, 10000))}/${fmtK(10000)}`, unlocked: (s) => s.lossesCount >= 10000 },
];

export const achievementRarity: Record<string, AchievementRarity> = {
  single_1k: "common",
  single_50k: "uncommon",
  single_100k: "rare",
  single_300k: "legendary",
  round_300k: "epic",
  bankroll_100k: "uncommon",
  bankroll_300k: "rare",
  bankroll_700k: "epic",
  bankroll_1m: "legendary",
  wins_100: "common",
  wins_250: "uncommon",
  wins_500: "rare",
  wins_1000: "epic",
  wins_1500: "legendary",
  jackpot_5k: "uncommon",
  jackpot_10k: "rare",
  jackpot_50k: "epic",
  jackpot_100k: "legendary",
  epochs_100: "uncommon",
  epochs_10k: "legendary",
  deposits_500: "uncommon",
  deposits_1000: "rare",
  deposits_3000: "epic",
  winstreak_3: "rare",
  winstreak_4: "epic",
  winstreak_5: "exotic",
  first_blood: "common",
  multiplier_5x: "rare",
  multiplier_10x: "legendary",
  life_changer: "divine",
  snowball: "uncommon",
  grid_master: "uncommon",
  never_give_up: "exotic",
};

export const rarityLabel: Record<AchievementRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  exotic: "Exotic",
  divine: "Divine",
};

export const rarityTextColor: Record<AchievementRarity, string> = {
  common: "text-slate-400",
  uncommon: "text-emerald-400",
  rare: "text-sky-400",
  epic: "text-fuchsia-400",
  legendary: "text-amber-400",
  exotic: "text-orange-400",
  divine: "text-cyan-400",
};
