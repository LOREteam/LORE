"use client";

export interface JackpotDisplayInfo {
  dailyPool: number;
  weeklyPool: number;
  lastDailyDay: number;
  lastWeeklyWeek: number;
  lastDailyJackpotEpoch: string | null;
  lastWeeklyJackpotEpoch: string | null;
  lastDailyJackpotAmount: number;
  lastWeeklyJackpotAmount: number;
}
