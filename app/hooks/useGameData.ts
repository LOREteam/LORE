"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useReadContract, useReadContracts, useBalance } from "wagmi";
import { formatUnits } from "viem";
import {
  CONTRACT_ADDRESS,
  LINEA_TOKEN_ADDRESS,
  GAME_ABI,
  TOKEN_ABI,
  GRID_SIZE,
  HISTORY_DEPTH,
  MIN_WINNER_DISPLAY_MS,
  MAX_REVEAL_DURATION_MS,
  APP_CHAIN_ID,
} from "../lib/constants";

type EpochTuple = readonly [bigint, bigint, bigint, boolean, boolean, boolean];

interface UseGameDataOptions {
  historyDetailed?: boolean;
}

export function useGameData(options?: UseGameDataOptions) {
  const historyDetailed = options?.historyDetailed ?? false;
  const { address } = useAccount();
  const chainId = APP_CHAIN_ID;
  const { data: tokenBalance } = useBalance({ address, token: LINEA_TOKEN_ADDRESS, chainId });
  const [isPageVisible, setIsPageVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const [visualEpoch, setVisualEpoch] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [lockedGridEpoch, setLockedGridEpoch] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  // Polling speed tier – changes only at thresholds, not every second
  type PollPhase = "fast" | "medium" | "slow";
  const [pollPhase, setPollPhase] = useState<PollPhase>("slow");
  const timeLeftRef = useRef(0);

  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealStartTimeRef = useRef<number>(0);
  const winnerFoundTimeRef = useRef<number>(0);
  const revealTargetEpochRef = useRef<string | null>(null);
  const revealSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const forceExitReveal = useCallback(() => {
    if (revealIntervalRef.current) {
      clearInterval(revealIntervalRef.current);
      revealIntervalRef.current = null;
    }
    if (revealSafetyRef.current) {
      clearTimeout(revealSafetyRef.current);
      revealSafetyRef.current = null;
    }
    const targetEpoch = revealTargetEpochRef.current;
    revealTargetEpochRef.current = null;
    setIsRevealing(false);
    setLockedGridEpoch(null);
    if (targetEpoch != null) setVisualEpoch(targetEpoch);
  }, []);

  const visualEpochBigInt = useMemo(
    () => (visualEpoch ? BigInt(visualEpoch) : null),
    [visualEpoch],
  );

  // lockedGridEpoch persists until the new epoch is ready - prevents intermediate flash
  const gridDisplayEpoch = lockedGridEpoch ?? visualEpoch;
  const gridDisplayEpochBigInt = useMemo(
    () => (gridDisplayEpoch ? BigInt(gridDisplayEpoch) : null),
    [gridDisplayEpoch],
  );

  // --- Core contract reads (polling speed driven by pollPhase, not timeLeft) ---
  // Linea blocks are ~2s; polling faster than 1s is wasteful.
  const epochInterval = isPageVisible
    ? pollPhase === "fast"
      ? 1200
      : pollPhase === "medium"
        ? 2500
        : 5000
    : 20_000;
  const epochEndInterval = isPageVisible ? (pollPhase === "fast" ? 1800 : 6000) : 20_000;
  const gridEpochInterval = isPageVisible
    ? (isRevealing ? 500 : pollPhase === "fast" ? 1500 : 5000)
    : 20_000;

  const { data: actualCurrentEpoch, refetch: refetchEpoch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch",
    chainId, query: { refetchInterval: epochInterval },
  });
  const { data: epochDurationSec } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochDuration",
    chainId, query: { refetchInterval: isPageVisible ? 15000 : 30000 },
  });
  const { data: pendingEpochDuration } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "pendingEpochDuration",
    chainId, query: { refetchInterval: isPageVisible ? 30000 : 60000 },
  });
  const { data: pendingEpochDurationEta } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "pendingEpochDurationEta",
    chainId, query: { refetchInterval: isPageVisible ? 30000 : 60000 },
  });
  const { data: pendingEpochDurationEffectiveFromEpoch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "pendingEpochDurationEffectiveFromEpoch",
    chainId, query: { refetchInterval: isPageVisible ? 30000 : 60000 },
  });

  const { data: epochEndTime, refetch: refetchEpochEndTime } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getEpochEndTime",
    args: actualCurrentEpoch ? [actualCurrentEpoch] : undefined,
    chainId, query: { enabled: !!actualCurrentEpoch, refetchInterval: epochEndInterval },
  });

  const { data: jackpotInfoRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getJackpotInfo",
    chainId, query: { refetchInterval: isPageVisible ? 15000 : 30000 },
  });

  const { data: rolloverPoolRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "rolloverPool",
    chainId, query: { refetchInterval: isPageVisible ? 15000 : 30000 },
  });

  const { data: tileData, refetch: refetchTileData } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getTileData",
    args: gridDisplayEpochBigInt ? [gridDisplayEpochBigInt] : undefined,
    chainId, query: { enabled: !!gridDisplayEpochBigInt, refetchInterval: isPageVisible ? 3000 : 20000 },
  });

  // Prefetch tile data + user bets for the NEXT epoch during reveal so transition is instant
  const prefetchEpoch = isRevealing && actualCurrentEpoch && gridDisplayEpochBigInt && actualCurrentEpoch !== gridDisplayEpochBigInt
    ? actualCurrentEpoch : undefined;
  useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getTileData",
    args: prefetchEpoch ? [prefetchEpoch] : undefined,
    chainId, query: { enabled: !!prefetchEpoch && isPageVisible, refetchInterval: 0 },
  });
  useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
    args: prefetchEpoch && address ? [prefetchEpoch, address] : undefined,
    chainId, query: { enabled: !!prefetchEpoch && !!address && isPageVisible, refetchInterval: 0 },
  });
  useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getEpochEndTime",
    args: prefetchEpoch ? [prefetchEpoch] : undefined,
    chainId, query: { enabled: !!prefetchEpoch && isPageVisible, refetchInterval: 0 },
  });

  const gridAndCurrentAreSame =
    gridDisplayEpochBigInt != null &&
    actualCurrentEpoch != null &&
    gridDisplayEpochBigInt === actualCurrentEpoch;

  const { data: gridEpochData, refetch: refetchGridEpochData } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs",
    args: gridDisplayEpochBigInt ? [gridDisplayEpochBigInt] : undefined,
    chainId, query: { enabled: !!gridDisplayEpochBigInt, refetchInterval: gridEpochInterval },
  });

  const { data: separateCurrentEpochData } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs",
    args: actualCurrentEpoch ? [actualCurrentEpoch] : undefined,
    chainId, query: {
      enabled: !!actualCurrentEpoch && !gridAndCurrentAreSame,
      refetchInterval: isPageVisible ? 3000 : 20000,
    },
  });

  const currentEpochData = gridAndCurrentAreSame ? gridEpochData : separateCurrentEpochData;

  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "allowance",
    args: address ? [address, CONTRACT_ADDRESS] : undefined,
    chainId, query: { enabled: !!address },
  });

  // --- User bets per tile - single call via getUserBetsAll ---
  const { data: userBetsAllRaw, refetch: refetchUserBets, dataUpdatedAt: userBetsUpdatedAt } = useReadContract({
    address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getUserBetsAll",
    args: gridDisplayEpochBigInt && address ? [gridDisplayEpochBigInt, address] : undefined,
    chainId, query: { enabled: !!gridDisplayEpochBigInt && !!address, refetchInterval: isPageVisible ? 3000 : 20000 },
  });

  const userBetsEpochRef = useRef<string | null>(null);
  const userBetsValidAtRef = useRef(0);

  const userBetsAll = useMemo(() => {
    const currentKey = gridDisplayEpochBigInt?.toString() ?? null;
    if (currentKey !== userBetsEpochRef.current) {
      if (userBetsUpdatedAt > userBetsValidAtRef.current) {
        userBetsEpochRef.current = currentKey;
        userBetsValidAtRef.current = userBetsUpdatedAt;
        return userBetsAllRaw as bigint[] | undefined;
      }
      return undefined;
    }
    if (userBetsUpdatedAt > userBetsValidAtRef.current) {
      userBetsValidAtRef.current = userBetsUpdatedAt;
    }
    return userBetsAllRaw as bigint[] | undefined;
  }, [userBetsAllRaw, userBetsUpdatedAt, gridDisplayEpochBigInt]);

  // --- History epochs for analytics (lazy-loaded) ---
  const historyEpochsList = useMemo(() => {
    if (!actualCurrentEpoch) return [];
    return Array.from({ length: HISTORY_DEPTH }, (_, i) => actualCurrentEpoch - BigInt(i + 1))
      .filter((id) => id > BigInt(0));
  }, [actualCurrentEpoch]);

  const { data: historyData, refetch: refetchHistory } = useReadContracts({
    contracts: historyEpochsList.map((id) => ({
      address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs" as const, args: [id], chainId,
    })),
    query: {
      enabled: historyEpochsList.length > 0 && isPageVisible,
      refetchInterval: historyDetailed ? 15000 : 90000,
      placeholderData: (prev) => prev,
    },
  });

  const historyUserBetsCalls = useMemo(() => {
    if (!address || !historyData || historyEpochsList.length === 0) return [];
    return historyEpochsList.map((epoch, i) => {
      const res = historyData[i]?.result;
      const winBlock = res != null ? (res as unknown as EpochTuple)[2] : BigInt(0);
      return {
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "userBets" as const,
        args: [epoch, winBlock, address],
        chainId,
      };
    });
  }, [historyEpochsList, historyData, address, chainId]);

  const { data: historyUserBetsData } = useReadContracts({
    contracts: historyUserBetsCalls,
    query: {
      enabled: historyDetailed && historyUserBetsCalls.length > 0 && isPageVisible,
      refetchInterval: 15000,
    },
  });

  // --- Sync winner detection into ref for interval access ---
  useEffect(() => {
    if (!isRevealing) return;
    if (winnerFoundTimeRef.current > 0) return;
    if (gridEpochData) {
      const resolved = (gridEpochData as unknown as EpochTuple)[3];
      if (resolved) {
        winnerFoundTimeRef.current = Date.now();
      }
    }
  }, [isRevealing, gridEpochData]);

  // --- Epoch reveal logic ---
  useEffect(() => {
    if (!actualCurrentEpoch) return;

    if (!visualEpoch) {
      setVisualEpoch(actualCurrentEpoch.toString());
      return;
    }

    if (
      visualEpochBigInt &&
      actualCurrentEpoch > visualEpochBigInt &&
      !isRevealing &&
      !revealIntervalRef.current
    ) {
      const epochGap = actualCurrentEpoch - visualEpochBigInt;

      // Skip reveal only when lagging behind by more than one epoch
      if (epochGap > BigInt(1)) {
        setVisualEpoch(actualCurrentEpoch.toString());
        setLockedGridEpoch(null);
        return;
      }

      revealTargetEpochRef.current = actualCurrentEpoch.toString();
      revealStartTimeRef.current = Date.now();
      winnerFoundTimeRef.current = 0;
      setLockedGridEpoch(visualEpoch);
      setIsRevealing(true);
      refetchGridEpochData();
      setTimeout(() => { refetchUserBets(); }, 100);

      if (revealSafetyRef.current) clearTimeout(revealSafetyRef.current);
      revealSafetyRef.current = setTimeout(forceExitReveal, MAX_REVEAL_DURATION_MS + 3000);

      revealIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - revealStartTimeRef.current;

        if (winnerFoundTimeRef.current > 0) {
          const shownFor = Date.now() - winnerFoundTimeRef.current;
          if (shownFor >= MIN_WINNER_DISPLAY_MS) {
            forceExitReveal();
          }
          return;
        }

        if (elapsed >= MAX_REVEAL_DURATION_MS) {
          forceExitReveal();
        }
      }, 200);

      return;
    }
  }, [actualCurrentEpoch, visualEpoch, visualEpochBigInt, isRevealing, epochEndTime, refetchGridEpochData, refetchUserBets, forceExitReveal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (revealIntervalRef.current) {
        clearInterval(revealIntervalRef.current);
        revealIntervalRef.current = null;
      }
      if (revealSafetyRef.current) {
        clearTimeout(revealSafetyRef.current);
        revealSafetyRef.current = null;
      }
    };
  }, []);

  // Safety: if isRevealing but interval is dead (strict mode, HMR, tab switch edge case),
  // force exit after a short delay
  useEffect(() => {
    if (!isRevealing) return;
    const check = setTimeout(() => {
      if (!revealIntervalRef.current) {
        forceExitReveal();
      }
    }, 1500);
    return () => clearTimeout(check);
  }, [isRevealing, forceExitReveal]);

  // --- Countdown timer with threshold-based pollPhase to avoid re-render cascade ---
  const didRefetchAtZeroRef = useRef(false);
  const isRevealingRef = useRef(isRevealing);
  isRevealingRef.current = isRevealing;
  const visualEpochRef = useRef(visualEpoch);
  visualEpochRef.current = visualEpoch;
  const lockedGridEpochRef = useRef(lockedGridEpoch);
  lockedGridEpochRef.current = lockedGridEpoch;

  const refetchEpochRef = useRef(refetchEpoch);
  refetchEpochRef.current = refetchEpoch;
  const refetchGridEpochDataRef = useRef(refetchGridEpochData);
  refetchGridEpochDataRef.current = refetchGridEpochData;
  const refetchEpochEndTimeRef = useRef(refetchEpochEndTime);
  refetchEpochEndTimeRef.current = refetchEpochEndTime;

  useEffect(() => {
    if (!epochEndTime) {
      setTimeLeft(0);
      timeLeftRef.current = 0;
      setPollPhase("fast");
      return;
    }

    const computePhase = (tl: number): PollPhase =>
      tl === 0 ? "fast" : tl <= 10 ? "medium" : "slow";

    const updateTimeLeft = () => {
      const endMs = Number(epochEndTime) * 1000;
      const now = Date.now();
      const tl = endMs > now ? Math.floor((endMs - now) / 1000) : 0;
      const prev = timeLeftRef.current;
      timeLeftRef.current = tl;
      setTimeLeft(tl);

      const prevPhase = computePhase(prev);
      const nextPhase = computePhase(tl);
      if (prevPhase !== nextPhase) {
        setPollPhase(nextPhase);
      }

      // One-shot refetch + grid lock when timer hits zero
      if (tl === 0 && prev > 0) {
        didRefetchAtZeroRef.current = false;
      }
      if (tl === 0 && !didRefetchAtZeroRef.current) {
        didRefetchAtZeroRef.current = true;
        if (visualEpochRef.current && !lockedGridEpochRef.current && !isRevealingRef.current) {
          setLockedGridEpoch(visualEpochRef.current);
        }
        refetchEpochRef.current();
        refetchGridEpochDataRef.current();
        refetchEpochEndTimeRef.current?.();
      }
    };

    updateTimeLeft();
    const interval = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [epochEndTime]);

  // --- Derived data ---
  type JackpotInfoTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

  const jackpotInfo = useMemo(() => {
    if (!jackpotInfoRaw) return null;
    const t = jackpotInfoRaw as unknown as JackpotInfoTuple;
    return {
      dailyPool: parseFloat(formatUnits(t[0], 18)),
      dailyPoolWei: t[0],
      weeklyPool: parseFloat(formatUnits(t[1], 18)),
      weeklyPoolWei: t[1],
      lastDailyDay: Number(t[2]),
      lastWeeklyWeek: Number(t[3]),
      lastDailyJackpotEpoch: t[4] > BigInt(0) ? t[4].toString() : null,
      lastWeeklyJackpotEpoch: t[5] > BigInt(0) ? t[5].toString() : null,
      lastDailyJackpotAmount: parseFloat(formatUnits(t[6], 18)),
      lastWeeklyJackpotAmount: parseFloat(formatUnits(t[7], 18)),
    };
  }, [jackpotInfoRaw]);

  const rolloverAmount = useMemo(() => {
    if (rolloverPoolRaw === undefined) return 0;
    return parseFloat(formatUnits(rolloverPoolRaw as bigint, 18));
  }, [rolloverPoolRaw]);

  const realTotalStaked = useMemo(() => {
    if (!tileData) return 0;
    const pools = tileData[0];
    if (!Array.isArray(pools)) return 0;
    const currentPool = (pools as bigint[]).reduce((acc, val) => acc + val, BigInt(0));
    const roll = rolloverPoolRaw !== undefined ? (rolloverPoolRaw as bigint) : BigInt(0);
    return parseFloat(formatUnits(currentPool + roll, 18));
  }, [tileData, rolloverPoolRaw]);

  const formattedLineaBalance = useMemo(
    () => (tokenBalance ? Number(tokenBalance.formatted).toFixed(2) : null),
    [tokenBalance],
  );

  const winningTileId = useMemo(() => {
    if (!isRevealing || !gridEpochData) return null;
    const tuple = gridEpochData as unknown as EpochTuple;
    if (tuple[3] && Number(tuple[2]) > 0) {
      return Number(tuple[2]);
    }
    return null;
  }, [isRevealing, gridEpochData]);

  // getTileData(epoch) -> (pools[0..24], users[0..24]); index i = tile #(i+1)
  const tileViewData = useMemo(() => {
    const poolsArr = tileData && Array.isArray(tileData[0]) ? (tileData[0] as bigint[]) : null;
    const usersArr = tileData && Array.isArray(tileData[1]) ? (tileData[1] as bigint[]) : null;
    return Array.from({ length: GRID_SIZE }, (_, i) => {
      const myBetRaw = userBetsAll?.[i];
      const hasMyBet = myBetRaw !== undefined && myBetRaw > BigInt(0);
      const poolWei = poolsArr?.[i] ?? BigInt(0);
      const usersRaw = usersArr?.[i] ?? BigInt(0);
      const users = Number(usersRaw);
      const poolDisplay = parseFloat(formatUnits(poolWei, 18)).toFixed(2);
      return { tileId: i + 1, users: users >= 0 ? users : 0, poolDisplay, hasMyBet };
    });
  }, [tileData, userBetsAll]);

  const historyViewData = useMemo(() => {
    return historyData?.map((dataObj, index) => {
      if (!dataObj.result) return null;
      const roundId = historyEpochsList[index];
      const [pool, , winBlock, isRes] = dataObj.result as unknown as EpochTuple;
      const userBetOnWinner = historyUserBetsData?.[index]?.result != null
        ? BigInt(historyUserBetsData[index].result as bigint) > BigInt(0)
        : false;
      return {
        roundId: roundId.toString(),
        poolDisplay: formatUnits(pool, 18),
        winningTile: winBlock.toString(),
        isResolved: isRes,
        userWon: isRes && userBetOnWinner,
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null) ?? [];
  }, [historyData, historyEpochsList, historyUserBetsData]);

  const epochDurationChange = useMemo(() => {
    const next = pendingEpochDuration ? Number(pendingEpochDuration) : 0;
    if (!next) return null;
    return {
      current: epochDurationSec ? Number(epochDurationSec) : null,
      next,
      eta: pendingEpochDurationEta ? Number(pendingEpochDurationEta) : null,
      effectiveFromEpoch: pendingEpochDurationEffectiveFromEpoch
        ? pendingEpochDurationEffectiveFromEpoch.toString()
        : null,
    };
  }, [epochDurationSec, pendingEpochDuration, pendingEpochDurationEta, pendingEpochDurationEffectiveFromEpoch]);

  return {
    address,
    chainId,
    visualEpoch,
    gridDisplayEpoch,
    isRevealing,
    timeLeft,
    realTotalStaked,
    rolloverAmount,
    jackpotInfo,
    formattedLineaBalance,
    winningTileId,
    currentEpochResolved: currentEpochData
      ? Boolean((currentEpochData as unknown as EpochTuple)[3])
      : undefined,
    tileViewData,
    currentAllowance,
    actualCurrentEpoch,
    historyViewData,
    epochDurationChange,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    refetchAllowance,
    refetchHistory,
  };
}
