"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBalance, usePublicClient, useWriteContract } from "wagmi";
import { getAddress, parseUnits, encodeFunctionData } from "viem";
import type { TabId } from "./lib/types";
import { useGameData } from "./hooks/useGameData";
import { useRewardScanner } from "./hooks/useRewardScanner";
import { useChartData } from "./hooks/useChartData";
import { useMining } from "./hooks/useMining";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyWallet } from "./hooks/usePrivyWallet";
import { useRebate } from "./hooks/useRebate";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { useSound } from "./hooks/useSound";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { WalletSettingsModal } from "./components/WalletSettingsModal";
import { MiningGrid } from "./components/MiningGrid";
import { RewardScanner } from "./components/RewardScanner";
import { ManualBetPanel, AutoMinerPanel } from "./components/BetPanel";
import { Analytics } from "./components/Analytics";
import { RebatePanel } from "./components/RebatePanel";
import { WhitePaper } from "./components/WhitePaper";
import { FAQ } from "./components/FAQ";
import { Leaderboards } from "./components/Leaderboards";
import { JackpotBanner } from "./components/JackpotBanner";
import { useLeaderboards } from "./hooks/useLeaderboards";
import { useRecentWins } from "./hooks/useRecentWins";
import { useJackpotHistory } from "./hooks/useJackpotHistory";
import { useDepositHistory } from "./hooks/useDepositHistory";
import { useWalletTransfers } from "./hooks/useWalletTransfers";
import { useDeepRewardScan } from "./hooks/useDeepRewardScan";
import { getLineaFeeOverrides } from "./lib/lineaFees";
import { OfflineBanner } from "./components/OfflineBanner";
import { CrystalParticles } from "./components/CrystalParticles";
import { BackupGate } from "./components/BackupGate";
import { ChatWidget } from "./components/chat/ChatWidget";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, LINEA_TOKEN_ADDRESS, TOKEN_ABI, TX_RECEIPT_TIMEOUT_MS } from "./lib/constants";
import { isUserRejection, normalizeDecimalInput } from "./lib/utils";
import { log } from "./lib/logger";

const MIN_ETH_FOR_GAS = 0.0005; // conservative floor for approve/placeBatchBets on Linea
const MIN_ETH_WITHDRAW_RESERVE_WEI = parseUnits("0.0005", 18);
// Server-side fallback: if the dedicated keeper isn't running, ask the Next server
// to resolve stale epochs using the configured keeper key.
const ENABLE_CLIENT_BOOTSTRAP_RESOLVE = true;
const ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK = false;
const BOOTSTRAP_RESOLVE_RETRY_MS = 12_000;
const ENABLE_AUTO_RESOLVE_SWEEP = false;
const VALID_TABS: TabId[] = ["hub", "analytics", "rebate", "leaderboards", "whitepaper", "faq"];
const ORB_STYLE = { animationDelay: "-10s" } as const;

export default function LineaOre() {
  const [activeTab, setActiveTab] = useState<TabId>("hub");
  const [chatOpen, setChatOpen] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const { reducedMotion, setReducedMotion, motionReady } = useReducedMotion();
  const { play: playSound, muted: soundMuted, toggleMute: toggleSoundMute, soundSettings, setSoundEnabled } = useSound();

  useEffect(() => {
    log.info("App", "mounted", { url: window.location.href, time: new Date().toISOString() });
    const hash = window.location.hash.replace("#", "");
    if (VALID_TABS.includes(hash as TabId)) setActiveTab(hash as TabId);
  }, []);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const newHash = tab === "hub" ? "" : `#${tab}`;
    history.replaceState(null, "", window.location.pathname + newHash);
  }, []);

  const [isWalletSettingsOpen, setIsWalletSettingsOpen] = useState(false);
  const [backupGateVersion, setBackupGateVersion] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState("0.0");
  const [withdrawEthAmount, setWithdrawEthAmount] = useState("0.0");
  const [depositEthAmount, setDepositEthAmount] = useState("0.001");
  const [depositTokenAmount, setDepositTokenAmount] = useState("10");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isWithdrawingEth, setIsWithdrawingEth] = useState(false);
  const [isDepositingEth, setIsDepositingEth] = useState(false);
  const [isDepositingToken, setIsDepositingToken] = useState(false);
  const { writeContractAsync } = useWriteContract();
  const { getAccessToken } = usePrivy();
  const {
    embeddedWalletAddress,
    externalWalletAddress,
    ensureEmbeddedWallet,
    exportEmbeddedWallet,
    createEmbeddedWallet,
    sendTransactionSilent,
    sendTransactionFromExternal,
  } = usePrivyWallet();

  const normalizedEmbeddedAddress = useMemo(() => {
    if (!embeddedWalletAddress) return undefined;
    try {
      return getAddress(embeddedWalletAddress);
    } catch {
      return undefined;
    }
  }, [embeddedWalletAddress]);

  // --- On-chain data ---
  const gameData = useGameData({
    historyDetailed: activeTab === "analytics",
    preferredAddress: normalizedEmbeddedAddress,
  });
  const {
    address, visualEpoch, gridDisplayEpoch, isRevealing, timeLeft,
    realTotalStaked, rolloverAmount, jackpotInfo, formattedLineaBalance, winningTileId,
    isDailyJackpot, isWeeklyJackpot, jackpotAmount,
    currentEpochResolved,
    tileViewData,
    epochDurationChange,
    actualCurrentEpoch, historyViewData,
    refetchEpoch, refetchGridEpochData, refetchTileData, refetchUserBets, refetchAllowance,
  } = gameData;
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  // --- Auto-resolve refs (declared early so visibility handler can access them) ---
  const autoResolveAttemptedRef = useRef<string | null>(null);
  const autoResolveAttemptTsRef = useRef(0);
  const RESOLVE_STORAGE_KEY = "lore_resolve_epoch";
  const AUTO_RESOLVE_RETRY_AFTER_MS = 25_000;

  const readResolveGuard = useCallback((): { epoch: string; ts: number } | null => {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(RESOLVE_STORAGE_KEY);
      if (!raw) return null;
      // Backward-compatible: old format stored only epoch string.
      if (raw[0] !== "{") return { epoch: raw, ts: 0 };
      const parsed = JSON.parse(raw) as { epoch?: string; ts?: number };
      if (!parsed?.epoch) return null;
      return { epoch: parsed.epoch, ts: Number(parsed.ts) || 0 };
    } catch {
      return null;
    }
  }, []);

  const writeResolveGuard = useCallback((epoch: string) => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(RESOLVE_STORAGE_KEY, JSON.stringify({ epoch, ts: Date.now() }));
    } catch {
      // ignore
    }
  }, []);

  const clearResolveGuard = useCallback(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(RESOLVE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // When user returns to the tab, refetch so this client catches up (e.g. winner already visible in another tab).
  // Also immediately trigger auto-resolve if the epoch is stale (game was "frozen" while tab was hidden).
  const timeLeftRef = useRef(timeLeft);
  timeLeftRef.current = timeLeft;
  const currentEpochResolvedRef = useRef(currentEpochResolved);
  currentEpochResolvedRef.current = currentEpochResolved;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refetchEpoch();
      refetchGridEpochData();
      refetchTileData();
      refetchUserBets();

      // If epoch timer is at 0 and not resolved, poke auto-resolve immediately
      // by clearing the "already attempted" guard so the AutoResolve effect re-fires
      if (timeLeftRef.current === 0 && currentEpochResolvedRef.current === false) {
        autoResolveAttemptedRef.current = null;
        autoResolveAttemptTsRef.current = 0;
        clearResolveGuard();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetchEpoch, refetchGridEpochData, refetchTileData, refetchUserBets, clearResolveGuard]);

  // Suppress the "analyzing" dim for 2s after reveal ends so stale timeLeft=0
  // doesn't flash the dim state while epochEndTime refetches for the new epoch.
  const [revealJustEnded, setRevealJustEnded] = useState(false);
  const prevRevealRef = useRef(false);
  useEffect(() => {
    if (prevRevealRef.current && !isRevealing) {
      setRevealJustEnded(true);
      const t = setTimeout(() => setRevealJustEnded(false), 2000);
      return () => clearTimeout(t);
    }
    prevRevealRef.current = isRevealing;
  }, [isRevealing]);

  const isAnalyzing = timeLeft === 0 && !isRevealing && !!visualEpoch && !revealJustEnded;

  const showSelectionOnGrid =
    !isRevealing &&
    !isAnalyzing &&
    actualCurrentEpoch != null &&
    gridDisplayEpoch != null &&
    gridDisplayEpoch === actualCurrentEpoch.toString();

  const { data: embeddedTokenBalance, isPending: embeddedTokenPending, refetch: refetchEmbeddedTokenBalance } = useBalance({
    address: normalizedEmbeddedAddress,
    token: LINEA_TOKEN_ADDRESS,
    chainId: APP_CHAIN_ID,
    query: { refetchInterval: isPageVisible ? 4000 : 15_000 },
  });
  const { data: embeddedEthBalance, isPending: embeddedEthPending, refetch: refetchEmbeddedEthBalance } = useBalance({
    address: normalizedEmbeddedAddress,
    chainId: APP_CHAIN_ID,
    query: { refetchInterval: isPageVisible ? 4000 : 15_000 },
  });

  const formattedPrivyBalance = useMemo(
    () => (embeddedTokenBalance ? Number(embeddedTokenBalance.formatted).toFixed(2) : "0.00"),
    [embeddedTokenBalance],
  );
  const formattedPrivyEthBalance = useMemo(
    () => (embeddedEthBalance ? Number(embeddedEthBalance.formatted).toFixed(4) : "0.0000"),
    [embeddedEthBalance],
  );

  // In the header, use gameData balance when embedded wallet is active - keeps values in sync and avoids a second RPC wait
  const isEmbeddedActive = Boolean(
    address && normalizedEmbeddedAddress && address.toLowerCase() === normalizedEmbeddedAddress.toLowerCase(),
  );
  const headerLineaBalance =
    isEmbeddedActive && formattedLineaBalance != null ? formattedLineaBalance : formattedPrivyBalance;
  const headerLineaLoading =
    (isEmbeddedActive && formattedLineaBalance == null) || (!isEmbeddedActive && embeddedTokenPending);
  const headerEthLoading = embeddedEthPending;

  // --- Chart ---
  const { chartData, linePath } = useChartData(realTotalStaked);

  // --- Mining logic ---
  const refreshSession = useCallback(async () => {
    await getAccessToken();
  }, [getAccessToken]);

  const miningOptions = useMemo(() => ({
    refetchAllowance,
    refetchTileData,
    refetchUserBets,
    refetchEpoch,
    refetchGridEpochData,
    preferredAddress: embeddedWalletAddress ?? null,
    ensurePreferredWallet: ensureEmbeddedWallet,
    sendTransactionSilent,
    refreshSession,
    onAutoMineBetConfirmed: () => playSound("autoBet"),
  }), [refetchAllowance, refetchTileData, refetchUserBets, refetchEpoch, refetchGridEpochData, embeddedWalletAddress, ensureEmbeddedWallet, sendTransactionSilent, refreshSession, playSound]);

  const {
    isPending, selectedTiles, selectedTilesEpoch, isAutoMining, autoMineProgress, runningParams,
    handleManualMine, handleDirectMine, handleAutoMineToggle, handleTileClick,
  } = useMining(miningOptions);

  const gridSelectedTiles = useMemo(() => {
    // Prevent visual overlap: show in-flight selected tiles only for the epoch they belong to.
    if (!showSelectionOnGrid) return [];
    if (selectedTilesEpoch && gridDisplayEpoch !== selectedTilesEpoch) return [];
    return selectedTiles;
  }, [showSelectionOnGrid, selectedTilesEpoch, gridDisplayEpoch, selectedTiles]);

  // --- Repeat last bet ---
  const LAST_BET_KEY = "lore:last-bet";
  const [lastBet, setLastBet] = useState<{ tiles: number[]; amount: string } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_BET_KEY);
      if (raw) setLastBet(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // --- Reward scanner ---
  const { unclaimedWins, isScanning, isDeepScanning, isClaiming, scanRewards, claimReward, claimAll } =
    useRewardScanner(actualCurrentEpoch, {
      sendTransactionSilent,
    });

  // --- Participation rebate ---
  const {
    rebateInfo,
    isClaiming: isClaimingRebate,
    claimRebates,
  } = useRebate({
    enabled: activeTab === "rebate",
    preferredAddress: normalizedEmbeddedAddress,
    sendTransactionSilent,
  });

  // --- Deposit history (auto-load when Analytics tab opens; periodic refresh) ---
  const { data: deposits, loading: depositsLoading, totalDeposited, error: depositsError, fetch: fetchDeposits, refresh: refreshDeposits } =
    useDepositHistory(embeddedWalletAddress ?? undefined);

  const depositsFetchedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== "analytics" || !embeddedWalletAddress) {
      depositsFetchedRef.current = false;
      return;
    }
    if (!depositsFetchedRef.current) {
      depositsFetchedRef.current = true;
      void fetchDeposits();
    }
    const iv = setInterval(() => { void fetchDeposits(); }, 30_000);
    return () => clearInterval(iv);
  }, [activeTab, embeddedWalletAddress, fetchDeposits]);

  // --- Wallet transfer history (manual load in settings) ---
  const { data: walletTransfers, loading: walletTransfersLoading, fetch: fetchWalletTransfers } =
    useWalletTransfers(embeddedWalletAddress ?? undefined, externalWalletAddress);

  // --- Deep reward scan (manual in settings) ---
  const {
    wins: deepScanWins, scanning: deepScanScanning, claiming: deepScanClaiming,
    progress: deepScanProgress, scan: deepScan, stop: deepScanStop,
    claimOne: deepClaimOne, claimAllDeep,
  } = useDeepRewardScan(sendTransactionSilent);

  // --- Leaderboards (load only when tab active) ---
  const { data: leaderboardsData, loading: leaderboardsLoading, error: leaderboardsError, refetch: leaderboardsRefetch } =
    useLeaderboards(activeTab === "leaderboards");

  const recentWins = useRecentWins();
  const { items: jackpotHistory, loading: jackpotHistoryLoading, error: jackpotHistoryError, refresh: refreshJackpotHistory } = useJackpotHistory();


  // --- Hot tiles (most frequent winners) ---
  const hotTiles = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const r of historyViewData) {
      if (!r.isResolved) continue;
      const tile = Number(r.winningTile);
      if (tile > 0) counts[tile] = (counts[tile] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([tileId, wins]) => ({ tileId: Number(tileId), wins }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 5);
  }, [historyViewData]);

  const tryClientResolveEpoch = useCallback(async (epochKey: string): Promise<boolean> => {
    if (!publicClient || !sendTransactionSilent || !embeddedWalletAddress) return false;
    try {
      const epoch = BigInt(epochKey);
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const liveEpoch = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "currentEpoch",
      })) as bigint;
      // Another tx already advanced the game; nothing to resolve for this epoch anymore.
      if (liveEpoch !== epoch) return true;
      const epochData = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "epochs",
        args: [epoch],
      })) as [bigint, bigint, bigint, boolean, boolean, boolean];
      if (epochData[3]) return true;
      const endTime = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getEpochEndTime",
        args: [epoch],
      })) as bigint;
      if (nowSec < endTime) return true;

      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "resolveEpoch",
        args: [epoch],
      });
      const gasEstimate = await publicClient.estimateGas({
        to: CONTRACT_ADDRESS,
        data,
        account: embeddedWalletAddress as `0x${string}`,
      });
      const gas = (gasEstimate * 130n) / 100n + 20_000n;
      const fees = await publicClient.estimateFeesPerGas().catch(() => null);
      const feeOverrides = fees ? getLineaFeeOverrides(fees, APP_CHAIN_ID) : undefined;
      const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas }, feeOverrides);
      log.info("AutoResolve", "client fallback sent resolve tx", { epoch: epochKey, hash });
      try {
        await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
      } catch (waitErr) {
        // Receipt timeouts are common on public RPC. Treat as success if epoch already advanced.
        try {
          const latestEpoch = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "currentEpoch",
          })) as bigint;
          if (latestEpoch > epoch) {
            log.info("AutoResolve", "resolve tx timed out but epoch advanced", { epoch: epochKey, hash });
          } else {
            throw waitErr;
          }
        } catch {
          throw waitErr;
        }
      }
      refetchEpoch();
      refetchGridEpochData();
      refetchTileData();
      refetchUserBets();
      clearResolveGuard();
      return true;
    } catch (err) {
      // If estimate reverted because someone else already resolved, don't keep retrying.
      try {
        const epoch = BigInt(epochKey);
        const latestEpoch = (await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "currentEpoch",
        })) as bigint;
        if (latestEpoch > epoch) {
          return true;
        }
      } catch {
        // fall through to warning
      }
      log.warn("AutoResolve", "client fallback resolve failed", { epoch: epochKey, err });
      return false;
    }
  }, [
    publicClient,
    sendTransactionSilent,
    embeddedWalletAddress,
    refetchEpoch,
    refetchGridEpochData,
    refetchTileData,
    refetchUserBets,
    clearResolveGuard,
  ]);

  // --- Auto-resolve stale epochs from the browser if keeper bot is slow ---
  useEffect(() => {
    if (!ENABLE_CLIENT_BOOTSTRAP_RESOLVE) return;
    if (timeLeft !== 0 || !actualCurrentEpoch) return;
    let cancelled = false;
    const epochKey = actualCurrentEpoch.toString();
    const delayMs = 4_000 + Math.floor(Math.random() * 2_000);

    const run = async () => {
      while (!cancelled) {
        const runNow = Date.now();
        const runGuard = readResolveGuard();
        if (
          autoResolveAttemptedRef.current === epochKey &&
          runNow - autoResolveAttemptTsRef.current < AUTO_RESOLVE_RETRY_AFTER_MS
        ) {
          await new Promise<void>((r) => setTimeout(r, BOOTSTRAP_RESOLVE_RETRY_MS));
          continue;
        }
        if (
          runGuard?.epoch === epochKey &&
          runNow - runGuard.ts < AUTO_RESOLVE_RETRY_AFTER_MS
        ) {
          await new Promise<void>((r) => setTimeout(r, BOOTSTRAP_RESOLVE_RETRY_MS));
          continue;
        }
        writeResolveGuard(epochKey);

        try {
          const res = await fetch("/api/bootstrap-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          });
          const payload = (await res.json().catch(() => null)) as
            | { ok?: boolean; action?: string; currentEpoch?: string; hash?: string; reason?: string; error?: string }
            | null;

          if (payload?.ok && payload.action === "sent") {
            autoResolveAttemptedRef.current = epochKey;
            autoResolveAttemptTsRef.current = Date.now();
            log.info("AutoResolve", "server keeper sent resolve tx", {
              epoch: payload.currentEpoch ?? epochKey,
              hash: payload.hash,
            });
            clearResolveGuard();
            return;
          }

          if (payload?.ok && payload.action === "noop") {
            log.info("AutoResolve", "server keeper noop", {
              epoch: payload.currentEpoch ?? epochKey,
              reason: payload.reason,
            });
            if (payload.reason !== "bootstrap_keeper_disabled") {
              autoResolveAttemptedRef.current = epochKey;
              autoResolveAttemptTsRef.current = Date.now();
              clearResolveGuard();
              return;
            }
            if (ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK && await tryClientResolveEpoch(epochKey)) {
              autoResolveAttemptedRef.current = epochKey;
              autoResolveAttemptTsRef.current = Date.now();
              return;
            }
          }

          log.warn("AutoResolve", "server keeper bootstrap resolve failed", payload ?? { status: res.status });
          if (ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK && await tryClientResolveEpoch(epochKey)) {
            autoResolveAttemptedRef.current = epochKey;
            autoResolveAttemptTsRef.current = Date.now();
            return;
          }
          autoResolveAttemptedRef.current = null;
          autoResolveAttemptTsRef.current = 0;
          clearResolveGuard();
        } catch (err) {
          log.warn("AutoResolve", "server keeper bootstrap resolve request failed", err);
          if (ENABLE_CLIENT_WALLET_RESOLVE_FALLBACK && await tryClientResolveEpoch(epochKey)) {
            autoResolveAttemptedRef.current = epochKey;
            autoResolveAttemptTsRef.current = Date.now();
            return;
          }
          autoResolveAttemptedRef.current = null;
          autoResolveAttemptTsRef.current = 0;
          clearResolveGuard();
        }
        await new Promise<void>((r) => setTimeout(r, BOOTSTRAP_RESOLVE_RETRY_MS));
      }
    };

    const timer = setTimeout(() => {
      void run().catch((err) => {
        log.warn("AutoResolve", "unhandled", err);
        autoResolveAttemptedRef.current = null;
        autoResolveAttemptTsRef.current = 0;
        clearResolveGuard();
      });
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [timeLeft, actualCurrentEpoch, readResolveGuard, writeResolveGuard, clearResolveGuard, tryClientResolveEpoch]);

  // --- Sweep: resolve past unresolved epochs the auto-resolve missed ---
  const sweepRunningRef = useRef(false);
  useEffect(() => {
    if (!ENABLE_AUTO_RESOLVE_SWEEP) return;
    const hasLowGasBalance =
      embeddedEthBalance != null && Number(embeddedEthBalance.formatted) < MIN_ETH_FOR_GAS;
    if (hasLowGasBalance) return;
    if (!publicClient || !sendTransactionSilent || !actualCurrentEpoch || !embeddedWalletAddress) return;
    if (sweepRunningRef.current) return;

    const SWEEP_INTERVAL_MS = 600_000;
    const SWEEP_LOOKBACK = 5;

    const sweep = async () => {
      if (sweepRunningRef.current) return;
      sweepRunningRef.current = true;
      try {
        const liveEpoch = (await publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch",
        })) as bigint;

        const start = liveEpoch - BigInt(SWEEP_LOOKBACK);
        for (let ep = start < BigInt(1) ? BigInt(1) : start; ep < liveEpoch; ep++) {
          try {
            const epochData = (await publicClient.readContract({
              address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs", args: [ep],
            })) as unknown as [bigint, bigint, bigint, boolean, boolean, boolean];
            if (epochData[3]) continue;

            const data = encodeFunctionData({ abi: GAME_ABI, functionName: "resolveEpoch", args: [ep] });
            try {
              await publicClient.estimateGas({ to: CONTRACT_ADDRESS, data, account: embeddedWalletAddress as `0x${string}` });
            } catch {
              log.info("AutoResolve", `sweep: estimateGas reverted for epoch ${ep.toString()}, skipping`);
              continue;
            }
            const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas: BigInt(300_000) });
            log.info("AutoResolve", `sweep resolved epoch`, { epoch: ep.toString(), hash });
            await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
          } catch {
            // skip this epoch
          }
        }
      } catch {
        // sweep error, ignore
      } finally {
        sweepRunningRef.current = false;
      }
    };

    const id = setInterval(sweep, SWEEP_INTERVAL_MS);
    const initialTimer = setTimeout(sweep, 15_000);
    return () => {
      clearInterval(id);
      clearTimeout(initialTimer);
    };
  }, [publicClient, sendTransactionSilent, actualCurrentEpoch, embeddedWalletAddress, embeddedEthBalance]);

  // --- Low balance warnings ---
  const lowEthBalance = useMemo(() => {
    if (!embeddedEthBalance) return false;
    return Number(embeddedEthBalance.formatted) < MIN_ETH_FOR_GAS;
  }, [embeddedEthBalance]);

  const lowTokenBalance = useMemo(() => {
    if (!embeddedTokenBalance) return false;
    return Number(embeddedTokenBalance.formatted) < 1;
  }, [embeddedTokenBalance]);

  const [balanceWarningDismissed, setBalanceWarningDismissed] = useState(false);
  const [embeddedAddressCopied, setEmbeddedAddressCopied] = useState(false);
  useEffect(() => {
    if (!lowEthBalance && !lowTokenBalance) setBalanceWarningDismissed(false);
  }, [lowEthBalance, lowTokenBalance]);

  useEffect(() => {
    if (!embeddedAddressCopied) return;
    const timeoutId = window.setTimeout(() => setEmbeddedAddressCopied(false), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [embeddedAddressCopied]);

  const handleCopyEmbeddedAddress = useCallback(async () => {
    if (!embeddedWalletAddress) return;
    try {
      await navigator.clipboard.writeText(embeddedWalletAddress);
      setEmbeddedAddressCopied(true);
    } catch {
      // Ignore clipboard denials so the modal does not throw in unsupported contexts.
    }
  }, [embeddedWalletAddress]);


  const openWalletSettings = useCallback(() => setIsWalletSettingsOpen(true), []);
  const closeWalletSettings = useCallback(() => setIsWalletSettingsOpen(false), []);
  const handleBackupConfirm = useCallback(() => setBackupGateVersion((v) => v + 1), []);

  // Sound: only on personal win
  useEffect(() => {
    if (!isRevealing || winningTileId === null) return;
    const myWin = tileViewData.some((t) => t.tileId === winningTileId && t.hasMyBet);
    if (myWin) playSound("myWin");
  }, [isRevealing, winningTileId, tileViewData, playSound]);

  // Sound: tick in last 10 seconds of countdown
  const timeLeftPrevRef = useRef<number | null>(null);
  useEffect(() => {
    if (timeLeft <= 0 || timeLeft > 10) {
      timeLeftPrevRef.current = timeLeft;
      return;
    }
    if (timeLeftPrevRef.current !== null && timeLeft < timeLeftPrevRef.current) {
      playSound("tick");
    }
    timeLeftPrevRef.current = timeLeft;
  }, [timeLeft, playSound]);

  const isRevealingRef = useRef(isRevealing);
  isRevealingRef.current = isRevealing;
  const stableTileClick = useCallback(
    (id: number) => handleTileClick(id, isRevealingRef.current),
    [handleTileClick],
  );

  const handleManualMineWithGuard = useCallback(
    async (amount: string) => {
      if (!embeddedWalletAddress) {
        alert("Create a Privy wallet first in Wallet Settings.");
        setIsWalletSettingsOpen(true);
        return;
      }
      const tilesSnapshot = [...selectedTiles];
      const success = await handleManualMine(amount);
      if (!success) return;
      playSound("bet");
      if (tilesSnapshot.length > 0) {
        const entry = { tiles: tilesSnapshot, amount };
        try { localStorage.setItem(LAST_BET_KEY, JSON.stringify(entry)); } catch { /* ignore */ }
        setLastBet(entry);
      }
    },
    [embeddedWalletAddress, handleManualMine, playSound, selectedTiles, LAST_BET_KEY],
  );

  const handleRepeatLastBet = useCallback(async () => {
    if (!lastBet) return;
    if (!embeddedWalletAddress) {
      alert("Create a Privy wallet first in Wallet Settings.");
      return;
    }
    const success = await handleDirectMine(lastBet.tiles, lastBet.amount);
    if (!success) return;
    playSound("bet");
    try { localStorage.setItem(LAST_BET_KEY, JSON.stringify(lastBet)); } catch {}
  }, [lastBet, embeddedWalletAddress, handleDirectMine, playSound]);

  const handleAutoMineWithGuard = useCallback(
    async (bet: string, blocks: number, rounds: number) => {
      if (!embeddedWalletAddress) {
        alert("Create a Privy wallet first in Wallet Settings.");
        setIsWalletSettingsOpen(true);
        return;
      }
      if (lowEthBalance && !isAutoMining) {
        alert("Not enough ETH for gas. Top up your Privy wallet in Settings.");
        return;
      }
      await handleAutoMineToggle(bet, blocks, rounds);
    },
    [embeddedWalletAddress, lowEthBalance, isAutoMining, handleAutoMineToggle],
  );

  const handleWithdrawToExternal = useCallback(async () => {
    if (!externalWalletAddress) {
      alert("External wallet is not connected.");
      return;
    }
    const normalized = normalizeDecimalInput(withdrawAmount);
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      alert("Invalid withdraw amount.");
      return;
    }
    const amountWei = parseUnits(normalized, 18);
    if (embeddedTokenBalance?.value != null && amountWei > embeddedTokenBalance.value) {
      alert("Insufficient LINEA balance.");
      return;
    }

    setIsWithdrawing(true);
    try {
      await writeContractAsync({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [getAddress(externalWalletAddress), amountWei],
        chainId: APP_CHAIN_ID,
      });
      setWithdrawAmount("0.0");
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Withdraw", "failed", err);
        alert("Withdraw failed. Check your balance and try again.");
      }
    } finally {
      setIsWithdrawing(false);
    }
  }, [externalWalletAddress, withdrawAmount, embeddedTokenBalance, writeContractAsync]);

  const handleWithdrawEthToExternal = useCallback(async () => {
    if (!embeddedWalletAddress) {
      alert("Create a Privy wallet first.");
      return;
    }
    if (!externalWalletAddress) {
      alert("External wallet is not connected.");
      return;
    }
    const normalized = normalizeDecimalInput(withdrawEthAmount);
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      alert("Invalid ETH withdraw amount.");
      return;
    }
    const amountWei = parseUnits(normalized, 18);
    if (embeddedEthBalance?.value != null) {
      if (amountWei > embeddedEthBalance.value) {
        alert("Insufficient ETH balance.");
        return;
      }
      const spendableWei =
        embeddedEthBalance.value > MIN_ETH_WITHDRAW_RESERVE_WEI
          ? embeddedEthBalance.value - MIN_ETH_WITHDRAW_RESERVE_WEI
          : 0n;
      if (amountWei > spendableWei) {
        alert(`Keep at least ${MIN_ETH_FOR_GAS} ETH in the Privy wallet for gas.`);
        return;
      }
    }

    setIsWithdrawingEth(true);
    try {
      const hash = await sendTransactionSilent({
        to: getAddress(externalWalletAddress),
        value: amountWei,
      });
      try {
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
        }
      } catch {
        // Balance refresh below is enough if receipt polling times out on a public RPC.
      }
      setWithdrawEthAmount("0.0");
      void refetchEmbeddedEthBalance();
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Withdraw", "ETH withdraw failed", err);
        const message = err instanceof Error ? err.message : "";
        alert(message ? `ETH withdraw failed: ${message}` : "ETH withdraw failed. Check your balance and try again.");
      }
    } finally {
      setIsWithdrawingEth(false);
    }
  }, [
    embeddedWalletAddress,
    externalWalletAddress,
    withdrawEthAmount,
    embeddedEthBalance,
    sendTransactionSilent,
    publicClient,
    refetchEmbeddedEthBalance,
  ]);

  const handleDepositEthToEmbedded = useCallback(async () => {
    if (!embeddedWalletAddress) {
      alert("Create a Privy wallet first.");
      return;
    }
    if (!externalWalletAddress) {
      alert("Connect an external wallet first.");
      return;
    }
    const normalized = normalizeDecimalInput(depositEthAmount);
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      alert("Invalid ETH amount.");
      return;
    }

    try {
      const value = parseUnits(normalized, 18);
      setIsDepositingEth(true);
      await sendTransactionFromExternal({
        to: getAddress(embeddedWalletAddress),
        value,
      });
      void refetchEmbeddedEthBalance();
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Deposit", "ETH transfer to Privy failed", err);
        const message = err instanceof Error ? err.message : "";
        alert(message ? `ETH transfer failed: ${message}` : "ETH transfer failed. Check wallet balance and try again.");
      }
    } finally {
      setIsDepositingEth(false);
    }
  }, [
    embeddedWalletAddress,
    externalWalletAddress,
    depositEthAmount,
    sendTransactionFromExternal,
    refetchEmbeddedEthBalance,
  ]);

  const handleDepositTokenToEmbedded = useCallback(async () => {
    if (!embeddedWalletAddress) {
      alert("Create a Privy wallet first.");
      return;
    }
    if (!externalWalletAddress) {
      alert("Connect an external wallet first.");
      return;
    }
    const normalized = normalizeDecimalInput(depositTokenAmount);
    if (!normalized || isNaN(Number(normalized)) || Number(normalized) <= 0) {
      alert("Invalid LINEA amount.");
      return;
    }

    try {
      const amountWei = parseUnits(normalized, 18);
      const data = encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: "transfer",
        args: [getAddress(embeddedWalletAddress), amountWei],
      });
      setIsDepositingToken(true);
      await sendTransactionFromExternal({
        to: LINEA_TOKEN_ADDRESS,
        data,
      });
      void refetchEmbeddedTokenBalance();
      if (walletTransfers) void fetchWalletTransfers();
    } catch (err) {
      if (!isUserRejection(err)) {
        log.error("Deposit", "LINEA transfer to Privy failed", err);
        const message = err instanceof Error ? err.message : "";
        alert(message ? `LINEA transfer failed: ${message}` : "LINEA transfer failed. Check wallet balance and try again.");
      }
    } finally {
      setIsDepositingToken(false);
    }
  }, [
    embeddedWalletAddress,
    externalWalletAddress,
    depositTokenAmount,
    sendTransactionFromExternal,
    refetchEmbeddedTokenBalance,
    walletTransfers,
    fetchWalletTransfers,
  ]);


  return (
    <div className="min-h-dvh w-full flex flex-col overflow-x-hidden bg-[#060612] text-slate-200 lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Ambient crystal particles */}
      {motionReady && !reducedMotion && <CrystalParticles />}

      {/* Animated background orbs */}
      <div className="fixed top-[-20%] left-[-15%] w-[50%] h-[50%] bg-violet-600 rounded-full blur-[250px] opacity-[0.07] pointer-events-none animate-orb-1" />
      <div className="fixed bottom-[-25%] right-[-15%] w-[45%] h-[45%] bg-sky-500 rounded-full blur-[250px] opacity-[0.05] pointer-events-none animate-orb-2" />
      <div className="fixed top-[30%] left-[50%] w-[30%] h-[30%] bg-fuchsia-500 rounded-full blur-[200px] opacity-[0.03] pointer-events-none animate-orb-1" style={ORB_STYLE} />

      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hotTiles={hotTiles}
        unclaimedWins={unclaimedWins}
        isScanning={isScanning}
        isDeepScanning={isDeepScanning}
        isClaiming={isClaiming}
        onClaim={claimReward}
        onClaimAll={claimAll}
      />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-visible p-3 animate-fade-in md:p-4 lg:overflow-x-hidden lg:overflow-y-auto">
        <OfflineBanner />
        {/* Compact navigation when sidebar is hidden (narrow screens) */}
        <div className="lg:hidden flex flex-wrap gap-1.5 mb-3 -mt-1">
          {(["hub", "analytics", "rebate", "leaderboards", "whitepaper", "faq"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all ${
                activeTab === tab
                  ? "bg-violet-500/20 text-violet-400"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]"
              }`}
            >
              {tab === "hub" ? "Hub" : tab === "whitepaper" ? "WP" : tab === "leaderboards" ? "Top" : tab === "faq" ? "FAQ" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <Header
          visualEpoch={visualEpoch}
          isRevealing={isRevealing}
          timeLeft={timeLeft}
          realTotalStaked={realTotalStaked}
          rolloverAmount={rolloverAmount}
          jackpotInfo={jackpotInfo}
          linePath={linePath}
          chartHasData={chartData.length > 0}
          embeddedWalletAddress={embeddedWalletAddress}
          privyEthBalance={formattedPrivyEthBalance}
          privyEthBalanceLoading={headerEthLoading}
          privyTokenBalance={headerLineaBalance}
          privyTokenBalanceLoading={headerLineaLoading}
          onOpenWalletSettings={openWalletSettings}
          muted={soundMuted}
          onToggleMute={toggleSoundMute}
          recentWins={recentWins}
          showWinsTicker
          reducedMotion={reducedMotion}
          epochDurationChange={epochDurationChange}
        />

        <WalletSettingsModal
          isOpen={isWalletSettingsOpen}
          onClose={closeWalletSettings}
          connectedWalletAddress={address}
          embeddedWalletAddress={embeddedWalletAddress}
          externalWalletAddress={externalWalletAddress}
          formattedLineaBalance={formattedPrivyBalance}
          formattedEthBalance={formattedPrivyEthBalance}
          withdrawAmount={withdrawAmount}
          withdrawEthAmount={withdrawEthAmount}
          depositEthAmount={depositEthAmount}
          depositTokenAmount={depositTokenAmount}
          isWithdrawing={isWithdrawing}
          isWithdrawingEth={isWithdrawingEth}
          isDepositingEth={isDepositingEth}
          isDepositingToken={isDepositingToken}
          onWithdrawAmountChange={setWithdrawAmount}
          onWithdrawEthAmountChange={setWithdrawEthAmount}
          onDepositEthAmountChange={setDepositEthAmount}
          onDepositTokenAmountChange={setDepositTokenAmount}
          onCreateEmbeddedWallet={createEmbeddedWallet}
          onCopyEmbeddedAddress={handleCopyEmbeddedAddress}
          embeddedAddressCopied={embeddedAddressCopied}
          onExportEmbeddedWallet={exportEmbeddedWallet}
          onWithdrawToExternal={handleWithdrawToExternal}
          onWithdrawEthToExternal={handleWithdrawEthToExternal}
          onDepositEthToEmbedded={handleDepositEthToEmbedded}
          onDepositTokenToEmbedded={handleDepositTokenToEmbedded}
          walletTransfers={walletTransfers}
          walletTransfersLoading={walletTransfersLoading}
          onLoadWalletTransfers={fetchWalletTransfers}
          deepScanWins={deepScanWins}
          deepScanScanning={deepScanScanning}
          deepScanClaiming={deepScanClaiming}
          deepScanProgress={deepScanProgress}
          onDeepScan={deepScan}
          onDeepScanStop={deepScanStop}
          onDeepClaimOne={deepClaimOne}
          onDeepClaimAll={claimAllDeep}
          soundSettings={soundSettings}
          onSoundSettingChange={setSoundEnabled}
          reducedMotion={reducedMotion}
          onReducedMotionChange={setReducedMotion}
        />

        <BackupGate
          key={backupGateVersion}
          embeddedWalletAddress={embeddedWalletAddress}
          onExportPrivateKey={exportEmbeddedWallet}
          onConfirm={handleBackupConfirm}
        />

        {activeTab === "hub" && !balanceWarningDismissed && (lowEthBalance || lowTokenBalance) && (
          <div className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] sm:text-xs font-bold uppercase tracking-wide sm:tracking-wider mb-2">
            <div className="flex min-w-0 items-start gap-2">
              <span className="text-base leading-none">⚠</span>
              <span className="leading-tight break-words">
                {lowEthBalance && lowTokenBalance
                  ? "Privy: low ETH (gas) & LINEA token"
                  : lowEthBalance
                    ? "Privy: low ETH – not enough for gas"
                    : "Privy: low LINEA token balance"}
              </span>
            </div>
            <button
              onClick={() => setBalanceWarningDismissed(true)}
              className="shrink-0 text-red-400/60 hover:text-red-300 text-sm leading-none mt-0.5"
            >
              ✕
            </button>
          </div>
        )}

        {activeTab === "hub" && (
          <div className="grid grid-cols-1 min-[900px]:grid-cols-12 gap-1.5">
            <div className="min-[900px]:col-span-9 flex flex-col gap-1.5 min-w-0">
              <MiningGrid
                key={gridDisplayEpoch ?? "none"}
                tileViewData={tileViewData}
                selectedTiles={gridSelectedTiles}
                winningTileId={winningTileId}
                isRevealing={isRevealing}
                isAnalyzing={isAnalyzing}
                reducedMotion={reducedMotion}
                showSelection={showSelectionOnGrid}
                onTileClick={stableTileClick}
              />

              {/* Jackpot celebration banner */}
              <JackpotBanner
                winningTileId={winningTileId}
                isRevealing={isRevealing}
                tileViewData={tileViewData}
                epoch={gridDisplayEpoch}
                isDailyJackpot={isDailyJackpot}
                isWeeklyJackpot={isWeeklyJackpot}
                jackpotAmount={jackpotAmount}
                reducedMotion={reducedMotion}
              />

              {/* Mobile-only Rewards (sidebar hidden on <lg) */}
              <div className="lg:hidden">
                <RewardScanner
                  unclaimedWins={unclaimedWins}
                  isScanning={isScanning}
                  isDeepScanning={isDeepScanning}
                  isClaiming={isClaiming}
                  onScan={scanRewards}
                  onClaim={claimReward}
                  onClaimAll={claimAll}
                />
              </div>
            </div>

            <div className={`min-[900px]:col-span-3 min-w-0 flex flex-col gap-1.5 ${chatOpen ? "hidden" : ""}`}>
              <ManualBetPanel
                formattedBalance={formattedLineaBalance}
                selectedTilesCount={selectedTiles.length}
                isPending={isPending}
                isRevealing={isRevealing}
                isAutoMining={isAutoMining}
                onMine={handleManualMineWithGuard}
                lastBet={lastBet}
                onRepeatBet={handleRepeatLastBet}
              />

              <AutoMinerPanel
                isAutoMining={isAutoMining}
                isPending={isPending}
                isRevealing={isRevealing}
                autoMineProgress={autoMineProgress}
                formattedBalance={formattedLineaBalance}
                runningParams={runningParams}
                lowEthForGas={lowEthBalance}
                onToggle={handleAutoMineWithGuard}
              />
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <Analytics
            walletAddress={normalizedEmbeddedAddress ?? undefined}
            historyViewData={historyViewData}
            deposits={deposits}
            depositsLoading={depositsLoading}
            depositsError={depositsError}
            totalDeposited={totalDeposited}
            onLoadDeposits={fetchDeposits}
            onRefreshDeposits={refreshDeposits}
            jackpotHistory={jackpotHistory}
            jackpotHistoryLoading={jackpotHistoryLoading}
            jackpotHistoryError={jackpotHistoryError}
            onRefreshJackpotHistory={refreshJackpotHistory}
          />
        )}

        {activeTab === "rebate" && (
          <RebatePanel
            address={address}
            rebateInfo={rebateInfo}
            isClaiming={isClaimingRebate}
            onClaimRebates={claimRebates}
          />
        )}

        {activeTab === "leaderboards" && (
          <Leaderboards
            data={leaderboardsData}
            loading={leaderboardsLoading}
            error={leaderboardsError}
            refetch={leaderboardsRefetch}
          />
        )}

        {activeTab === "whitepaper" && (
          <WhitePaper />
        )}

        {activeTab === "faq" && (
          <FAQ />
        )}

      </main>

      {/* Floating: X (Twitter) + Chat */}
      <div className="fixed bottom-3 right-3 z-[200] flex items-center gap-2">
        <a
          href="https://x.com/Linea_Ore"
          target="_blank"
          rel="noopener noreferrer"
          className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 border border-white/10 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 animate-fade-in shrink-0"
          title="X (Twitter) @Linea_Ore"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-slate-200">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <ChatWidget walletAddress={embeddedWalletAddress} onOpenChange={setChatOpen} />
      </div>
    </div>
  );
}
