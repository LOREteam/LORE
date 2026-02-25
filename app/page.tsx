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
import { useReferral } from "./hooks/useReferral";
import { useSound } from "./hooks/useSound";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { WalletSettingsModal } from "./components/WalletSettingsModal";
import { MiningGrid } from "./components/MiningGrid";
import { RewardScanner } from "./components/RewardScanner";
import { ManualBetPanel, AutoMinerPanel } from "./components/BetPanel";
import { Analytics } from "./components/Analytics";
import { ReferralPanel } from "./components/ReferralPanel";
import { WhitePaper } from "./components/WhitePaper";
import { FAQ } from "./components/FAQ";
import { Leaderboards } from "./components/Leaderboards";
import { useLeaderboards } from "./hooks/useLeaderboards";
import { useRecentWins } from "./hooks/useRecentWins";
import { useJackpotHistory } from "./hooks/useJackpotHistory";
import { WinsTicker } from "./components/WinsTicker";
import { useDepositHistory } from "./hooks/useDepositHistory";
import { useWalletTransfers } from "./hooks/useWalletTransfers";
import { useDeepRewardScan } from "./hooks/useDeepRewardScan";
import { OfflineBanner } from "./components/OfflineBanner";
import { CrystalParticles } from "./components/CrystalParticles";
import { BackupGate } from "./components/BackupGate";
import { ChatWidget } from "./components/chat/ChatWidget";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, LINEA_TOKEN_ADDRESS, TOKEN_ABI, TX_RECEIPT_TIMEOUT_MS } from "./lib/constants";
import { isUserRejection, normalizeDecimalInput } from "./lib/utils";
import { log } from "./lib/logger";

// Long delay so bot (45s grace) or someone's bet resolves first; jitter so not all tabs tx at once
const AUTO_RESOLVE_DELAY_BASE_MS = 90_000;
const AUTO_RESOLVE_JITTER_MS = 30_000;
const MIN_ETH_FOR_GAS = 0.0001; // ~enough for a couple of txs on Linea
const VALID_TABS: TabId[] = ["hub", "analytics", "referral", "leaderboards", "whitepaper"];
const ORB_STYLE = { animationDelay: "-10s" } as const;

export default function LineaOre() {
  const [activeTab, setActiveTab] = useState<TabId>("hub");
  const [chatOpen, setChatOpen] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
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
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const { writeContractAsync } = useWriteContract();

  // --- On-chain data ---
  const gameData = useGameData({ historyDetailed: activeTab === "analytics" });
  const {
    address, visualEpoch, gridDisplayEpoch, isRevealing, timeLeft,
    realTotalStaked, rolloverAmount, jackpotInfo, formattedLineaBalance, winningTileId,
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

  const { getAccessToken } = usePrivy();
  const {
    embeddedWalletAddress,
    externalWalletAddress,
    ensureEmbeddedWallet,
    exportEmbeddedWallet,
    createEmbeddedWallet,
    sendTransactionSilent,
  } = usePrivyWallet();

  const normalizedEmbeddedAddress = useMemo(() => {
    if (!embeddedWalletAddress) return undefined;
    try {
      return getAddress(embeddedWalletAddress);
    } catch {
      return undefined;
    }
  }, [embeddedWalletAddress]);

  const { data: embeddedTokenBalance, isPending: embeddedTokenPending } = useBalance({
    address: normalizedEmbeddedAddress,
    token: LINEA_TOKEN_ADDRESS,
    chainId: APP_CHAIN_ID,
    query: { refetchInterval: isPageVisible ? 4000 : 15_000 },
  });
  const { data: embeddedEthBalance, isPending: embeddedEthPending } = useBalance({
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
    ensurePreferredWallet: ensureEmbeddedWallet,
    sendTransactionSilent,
    refreshSession,
    onAutoMineBetConfirmed: () => playSound("autoBet"),
  }), [refetchAllowance, refetchTileData, refetchUserBets, refetchEpoch, ensureEmbeddedWallet, sendTransactionSilent, refreshSession, playSound]);

  const {
    isPending, selectedTiles, selectedTilesEpoch, isAutoMining, autoMineProgress, runningParams,
    handleManualMine, handleDirectMine, handleAutoMineToggle, handleTileClick, setTiles,
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

  // --- Referral ---
  const {
    referralInfo, referralLink, isRegistering, isClaiming: isClaimingReferral, isSettingReferrer,
    registerCode, claimEarnings, copyReferralLink,
  } = useReferral({ sendTransactionSilent });

  // --- Deposit history (auto-load when Analytics tab opens; periodic refresh) ---
  const { data: deposits, loading: depositsLoading, totalDeposited, fetch: fetchDeposits, refresh: refreshDeposits } =
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
  const { items: jackpotHistory, loading: jackpotHistoryLoading, refresh: refreshJackpotHistory } = useJackpotHistory();


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

  // --- Auto-resolve stale epochs from the browser if keeper bot is slow ---
  const AUTO_RESOLVE_MAX_RETRIES = 3;
  const AUTO_RESOLVE_RETRY_DELAY_MS = 6_000;

  useEffect(() => {
    const hasLowGasBalance =
      embeddedEthBalance != null && Number(embeddedEthBalance.formatted) < MIN_ETH_FOR_GAS;
    if (hasLowGasBalance) return;
    if (timeLeft !== 0 || currentEpochResolved !== false || !actualCurrentEpoch || !publicClient) return;
    const epochKey = actualCurrentEpoch.toString();
    const now = Date.now();
    const localGuard = readResolveGuard();
    if (
      autoResolveAttemptedRef.current === epochKey &&
      now - autoResolveAttemptTsRef.current < AUTO_RESOLVE_RETRY_AFTER_MS
    ) return;
    if (
      localGuard?.epoch === epochKey &&
      now - localGuard.ts < AUTO_RESOLVE_RETRY_AFTER_MS
    ) return;

    const delayMs = AUTO_RESOLVE_DELAY_BASE_MS + Math.floor(Math.random() * AUTO_RESOLVE_JITTER_MS);
    const timer = setTimeout(() => {
      const run = async () => {
        const runNow = Date.now();
        const runGuard = readResolveGuard();
        if (
          autoResolveAttemptedRef.current === epochKey &&
          runNow - autoResolveAttemptTsRef.current < AUTO_RESOLVE_RETRY_AFTER_MS
        ) return;
        if (
          runGuard?.epoch === epochKey &&
          runNow - runGuard.ts < AUTO_RESOLVE_RETRY_AFTER_MS
        ) return;
        writeResolveGuard(epochKey);

        for (let attempt = 0; attempt < AUTO_RESOLVE_MAX_RETRIES; attempt++) {
          try {
            if (!sendTransactionSilent) {
              log.warn("AutoResolve", "wallet not ready, waiting...");
              await new Promise<void>((r) => setTimeout(r, 5_000));
              if (!sendTransactionSilent) throw new Error("Privy embedded wallet not found.");
            }

            const resolveEpochLive = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch" }) as bigint;
            const resolveEpochData = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs", args: [actualCurrentEpoch] }) as unknown as [bigint, bigint, bigint, boolean, boolean, boolean];
            if (resolveEpochLive !== actualCurrentEpoch || resolveEpochData[3] === true) {
              clearResolveGuard();
              return;
            }

            const data = encodeFunctionData({
              abi: GAME_ABI,
              functionName: "resolveEpoch",
              args: [resolveEpochLive],
            });
            let hash: `0x${string}` | null = null;
            let gasOverrides: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | undefined;
            for (let g = 0; g < 3; g++) {
              try {
                hash = await sendTransactionSilent(
                  { to: CONTRACT_ADDRESS, data, gas: BigInt(300_000) },
                  gasOverrides,
                );
                break;
              } catch (sendErr) {
                const sm = sendErr instanceof Error ? sendErr.message.toLowerCase() : String(sendErr).toLowerCase();
                if ((sm.includes("replacement") && sm.includes("underpriced")) && g < 2) {
                  try {
                    const fees = await publicClient.estimateFeesPerGas();
                    const bump = BigInt(150);
                    gasOverrides = {
                      maxFeePerGas: fees.maxFeePerGas ? (fees.maxFeePerGas * bump) / BigInt(100) : undefined,
                      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ? (fees.maxPriorityFeePerGas * bump) / BigInt(100) : undefined,
                    };
                    if (!gasOverrides.maxFeePerGas) gasOverrides = undefined;
                    log.warn("AutoResolve", `replacement underpriced, retry with higher gas (attempt ${g + 2}/3)`);
                    continue;
                  } catch { /* fallthrough */ }
                }
                throw sendErr;
              }
            }
            if (!hash) throw new Error("resolveEpoch tx hash missing");
            autoResolveAttemptedRef.current = epochKey;
            autoResolveAttemptTsRef.current = Date.now();
            log.info("AutoResolve", `sent resolveEpoch tx`, { epoch: epochKey, hash });
            try {
              await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
            } catch (receiptErr) {
              const re = receiptErr instanceof Error ? receiptErr : new Error(String(receiptErr));
              if (re.name === "WaitForTransactionReceiptTimeoutError" || re.message?.toLowerCase().includes("timeout")) {
                log.info("AutoResolve", `tx sent, receipt timeout (will confirm on-chain)`, { epoch: epochKey, hash });
              } else {
                throw receiptErr;
              }
            }
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
            const isSessionErr = msg.includes("authorization signatures") || msg.includes("signing keys") || msg.includes("incorrect or expired") || (err instanceof Error && err.name === "PrivyApiError");
            const isSimRevert = msg.includes("execution reverted") || msg.includes("estimategasexecutionerror");
            const isAlreadyHandled = msg.includes("known transaction") || msg.includes("already known") || msg.includes("nonce too low");
            const isContractExpected = msg.includes("timernotended") || msg.includes("canonlyresolvecurrent");
            const isWalletMissing = msg.includes("wallet not found") || msg.includes("wallet not ready");

            if (isContractExpected || isSimRevert || isAlreadyHandled) {
              try {
                const freshData = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs", args: [actualCurrentEpoch] }) as unknown as [bigint, bigint, bigint, boolean, boolean, boolean];
                if (freshData[3]) {
                  log.info("AutoResolve", `epoch ${epochKey} already resolved (keeper bot), done`);
                } else if (isContractExpected) {
                  log.info("AutoResolve", `epoch ${epochKey} contract revert (timer not ended / wrong epoch), skipping`);
                } else {
                  log.info("AutoResolve", `epoch ${epochKey} revert but not yet resolved, skipping`);
                }
              } catch { /* ignore */ }
              autoResolveAttemptedRef.current = epochKey;
              autoResolveAttemptTsRef.current = Date.now();
              clearResolveGuard();
              return;
            }
            if (isSessionErr && attempt < AUTO_RESOLVE_MAX_RETRIES - 1) {
              log.warn("AutoResolve", `session error (attempt ${attempt + 1}/${AUTO_RESOLVE_MAX_RETRIES}), refreshing...`, err);
              try { await refreshSession(); } catch { /* ignore */ }
              await new Promise<void>((r) => setTimeout(r, 3_000));
              continue;
            }
            if (isWalletMissing && attempt < AUTO_RESOLVE_MAX_RETRIES - 1) {
              log.warn("AutoResolve", `wallet not ready (attempt ${attempt + 1}/${AUTO_RESOLVE_MAX_RETRIES}), retrying...`, err);
              await new Promise<void>((r) => setTimeout(r, AUTO_RESOLVE_RETRY_DELAY_MS));
              continue;
            }

            log.warn("AutoResolve", "failed", err);
            autoResolveAttemptedRef.current = null;
            autoResolveAttemptTsRef.current = 0;
            clearResolveGuard();
            return;
          }
        }
      };
      void run().catch((err) => {
        log.warn("AutoResolve", "unhandled", err);
        autoResolveAttemptedRef.current = null;
        autoResolveAttemptTsRef.current = 0;
        clearResolveGuard();
      });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [timeLeft, currentEpochResolved, actualCurrentEpoch, sendTransactionSilent, publicClient, embeddedWalletAddress, refreshSession, embeddedEthBalance, readResolveGuard, writeResolveGuard, clearResolveGuard]);

  // --- Sweep: resolve past unresolved epochs the auto-resolve missed ---
  const sweepRunningRef = useRef(false);
  useEffect(() => {
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
  useEffect(() => {
    if (!lowEthBalance && !lowTokenBalance) setBalanceWarningDismissed(false);
  }, [lowEthBalance, lowTokenBalance]);

  const handleCopyEmbeddedAddress = useCallback(async () => {
    if (!embeddedWalletAddress) return;
    await navigator.clipboard.writeText(embeddedWalletAddress);
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
      await handleManualMine(amount);
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
    await handleDirectMine(lastBet.tiles, lastBet.amount);
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
      if (lowEthBalance) {
        alert("Not enough ETH for gas. Top up your Privy wallet in Settings.");
        return;
      }
      await handleAutoMineToggle(bet, blocks, rounds);
    },
    [embeddedWalletAddress, lowEthBalance, handleAutoMineToggle],
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


  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#060612] text-slate-200">
      {/* Animated background orbs */}
      {/* Ambient crystal particles */}
      <CrystalParticles />

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
        onScan={scanRewards}
        onClaim={claimReward}
        onClaimAll={claimAll}
      />

      <main className="flex-1 flex flex-col p-3 md:p-4 overflow-hidden z-10 relative overflow-y-auto animate-fade-in">
        <OfflineBanner />
        {/* Compact navigation when sidebar is hidden (narrow screens) */}
        <div className="lg:hidden flex flex-wrap gap-1.5 mb-3 -mt-1">
          {(["hub", "analytics", "referral", "leaderboards", "whitepaper", "faq"] as const).map((tab) => (
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
          address={address}
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
          epochDurationChange={epochDurationChange}
        />

        <WalletSettingsModal
          isOpen={isWalletSettingsOpen}
          onClose={closeWalletSettings}
          connectedWalletAddress={address}
          embeddedWalletAddress={embeddedWalletAddress}
          externalWalletAddress={externalWalletAddress}
          formattedLineaBalance={formattedPrivyBalance}
          withdrawAmount={withdrawAmount}
          isWithdrawing={isWithdrawing}
          onWithdrawAmountChange={setWithdrawAmount}
          onCreateEmbeddedWallet={createEmbeddedWallet}
          onCopyEmbeddedAddress={handleCopyEmbeddedAddress}
          onExportEmbeddedWallet={exportEmbeddedWallet}
          onWithdrawToExternal={handleWithdrawToExternal}
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
        />

        <BackupGate
          key={backupGateVersion}
          embeddedWalletAddress={embeddedWalletAddress}
          onExportPrivateKey={exportEmbeddedWallet}
          onConfirm={handleBackupConfirm}
        />

        {activeTab === "hub" && !balanceWarningDismissed && (lowEthBalance || lowTokenBalance) && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold uppercase tracking-wider mb-2">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠</span>
              <span>
                {lowEthBalance && lowTokenBalance
                  ? "Privy: low ETH (gas) & LINEA token"
                  : lowEthBalance
                    ? "Privy: low ETH – not enough for gas"
                    : "Privy: low LINEA token balance"}
              </span>
            </div>
            <button
              onClick={() => setBalanceWarningDismissed(true)}
              className="text-red-400/60 hover:text-red-300 text-sm leading-none"
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
                showSelection={showSelectionOnGrid}
                onTileClick={stableTileClick}
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

            <div className={`min-[900px]:col-span-3 flex flex-col gap-1.5 ${chatOpen ? "hidden" : ""}`}>
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
            totalDeposited={totalDeposited}
            onLoadDeposits={fetchDeposits}
            onRefreshDeposits={refreshDeposits}
            jackpotHistory={jackpotHistory}
            jackpotHistoryLoading={jackpotHistoryLoading}
            onRefreshJackpotHistory={refreshJackpotHistory}
          />
        )}

        {activeTab === "referral" && (
          <ReferralPanel
            address={address}
            referralLink={referralLink}
            referralInfo={referralInfo}
            isRegistering={isRegistering}
            isClaiming={isClaimingReferral}
            isSettingReferrer={isSettingReferrer}
            onRegisterCode={registerCode}
            onClaimEarnings={claimEarnings}
            onCopyLink={copyReferralLink}
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
