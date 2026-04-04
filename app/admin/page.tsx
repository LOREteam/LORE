"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatUnits } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { NoticeStack, type NoticeItem, type NoticeTone } from "../components/NoticeStack";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";

function fmtToken(v?: bigint) {
  if (v === undefined) return "...";
  return Number(formatUnits(v, 18)).toFixed(4);
}

function fmtNumber(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  return value.toLocaleString();
}

function fmtPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  return `${value.toFixed(2)}%`;
}

function fmtMinutes(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  if (value < 60) return `${value.toFixed(1)} min`;
  const hours = value / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function fmtAge(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return fmtMinutes(seconds / 60);
}

function fmtMode(value?: string | null) {
  if (!value) return "...";
  return value.replace(/_/g, " ");
}

function modeToneClass(value?: string | null) {
  if (value === "indexer_fast_path") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (value === "bootstrap_recovery_needed") return "border-violet-500/30 bg-violet-500/10 text-violet-200";
  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function staleToneClass(stale?: boolean) {
  return stale
    ? "border-red-500/30 bg-red-500/10 text-red-200"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

type DataSyncHealth = {
  status?: string;
  storage?: {
    currentEpochMeta?: number | null;
    lastIndexedBlock?: string | null;
    repairCursorBlock?: string | null;
    lagBlocks?: number | null;
    latestStoredJackpotBlock?: string | null;
    latestRewardClaimBlock?: string | null;
    rewardClaimsLagToHead?: number | null;
    rewardClaimsLagToIndexer?: number | null;
  };
  epochs?: {
    storedCount?: number;
    missingCount?: number;
    latestStoredEpoch?: number | null;
    highestContiguousEpoch?: number | null;
    coveragePct?: number | null;
    contiguousCoveragePct?: number | null;
    missingLatest?: number[];
  };
  catchUp?: {
    phase?: string;
    totalBlocksToIndex?: number;
    indexedBlocksToCurrentHead?: number;
    blockProgressPct?: number | null;
    epochCoveragePct?: number | null;
    contiguousEpochCoveragePct?: number | null;
    blockRatePerMinute?: number | null;
    epochRatePerMinute?: number | null;
    estimatedMinutesToHead?: number | null;
    recentSamples?: Array<{
      ts: number;
      lastIndexedBlock: string | null;
      storedEpochCount: number;
      lagBlocks: number | null;
    }>;
  };
  jackpots?: {
    totalStored?: number;
    hasLatestDailyInDb?: boolean;
    hasLatestWeeklyInDb?: boolean;
    lastDailyEpoch?: number;
    lastWeeklyEpoch?: number;
    servingMode?: string;
  };
  recentWins?: {
    totalStored?: number;
    latestRewardClaimBlock?: string | null;
    lagToHeadBlocks?: number | null;
    lagToIndexerBlocks?: number | null;
    servingMode?: string;
  };
  indexer?: {
    run?: {
      startedAt?: number;
      completedAt?: number;
      fromBlock?: string;
      toBlock?: string;
      totalLogs?: number;
      runCompletedAgeMs?: number | null;
      stale?: boolean;
    };
    repair?: {
      at?: number;
      fromBlock?: string;
      toBlock?: string;
      repairedLogs?: number;
      ageMs?: number | null;
      stale?: boolean;
    };
    reconcile?: {
      at?: number;
      currentEpoch?: number;
      missingEpochs?: number;
      repairedEpochs?: number;
      targetEpochs?: number[];
      ageMs?: number | null;
      stale?: boolean;
    };
  };
  env?: {
    network?: string;
    dbPath?: string;
    deployBlock?: string;
    lagWarnBlocks?: number | null;
    jackpotRecoveryBlockLag?: number | null;
    recentWinsRecoveryBlockLag?: number | null;
    indexerHeartbeatStaleMs?: number | null;
  };
  hints?: string[];
};

type RuntimeHealth = {
  status?: string;
  metrics?: Record<string, {
    requests: number;
    successes: number;
    errors: number;
    cacheHits: number;
    staleServed: number;
    inflightJoined: number;
    backgroundRefreshes: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
    inflight: number;
    lastStatus: number | null;
  }>;
};

export default function AdminPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { login } = usePrivy();
  const { writeContractAsync } = useWriteContract();
  const [nextDuration, setNextDuration] = useState("60");
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [dataSyncHealth, setDataSyncHealth] = useState<DataSyncHealth | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const noticeIdRef = useRef(1);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: NoticeTone = "info") => {
    const id = noticeIdRef.current++;
    setNotices((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, tone === "danger" ? 7000 : 5000);
  }, []);

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "owner",
    chainId: APP_CHAIN_ID,
  });
  const { data: accruedOwnerFees, refetch: refetchOwnerFees } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "accruedOwnerFees",
    chainId: APP_CHAIN_ID,
  });
  const { data: accruedBurnFees, refetch: refetchBurnFees } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "accruedBurnFees",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingResolverReward, refetch: refetchResolverReward } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingResolverRewards",
    args: address ? [address] : undefined,
    chainId: APP_CHAIN_ID,
    query: { enabled: !!address },
  });
  const { data: epochDuration, refetch: refetchDuration } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "epochDuration",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingDuration, refetch: refetchPendingDuration } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDuration",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingEta, refetch: refetchPendingEta } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDurationEta",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingFromEpoch, refetch: refetchPendingFromEpoch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDurationEffectiveFromEpoch",
    chainId: APP_CHAIN_ID,
  });

  const isOwner = useMemo(() => {
    if (!address || !owner) return false;
    return address.toLowerCase() === owner.toLowerCase();
  }, [address, owner]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchOwnerFees(),
      refetchBurnFees(),
      refetchResolverReward(),
      refetchDuration(),
      refetchPendingDuration(),
      refetchPendingEta(),
      refetchPendingFromEpoch(),
    ]);
  }, [
    refetchBurnFees,
    refetchDuration,
    refetchOwnerFees,
    refetchPendingDuration,
    refetchPendingEta,
    refetchPendingFromEpoch,
    refetchResolverReward,
  ]);

  const waitReceipt = useCallback(async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error("publicClient unavailable");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction reverted: ${hash}`);
    }
  }, [publicClient]);

  const onFlush = useCallback(async () => {
    try {
      setBusy("flush");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "flushProtocolFees",
        args: [],
        chainId: APP_CHAIN_ID,
      });
      await waitReceipt(hash);
      await refetchAll();
      notify("Protocol fees flushed successfully.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setBusy(null);
    }
  }, [notify, refetchAll, waitReceipt, writeContractAsync]);

  const onClaimResolver = useCallback(async () => {
    try {
      setBusy("resolver");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
        args: [],
        chainId: APP_CHAIN_ID,
      });
      await waitReceipt(hash);
      await refetchAll();
      notify("Resolver rewards claimed successfully.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setBusy(null);
    }
  }, [notify, refetchAll, waitReceipt, writeContractAsync]);

  const onScheduleDuration = useCallback(async () => {
    const n = Number(nextDuration);
    if (!Number.isFinite(n) || n < 15 || n > 3600) {
      notify("Duration must be 15..3600 seconds.", "warning");
      return;
    }
    try {
      setBusy("schedule");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "scheduleEpochDuration",
        args: [BigInt(Math.floor(n))],
        chainId: APP_CHAIN_ID,
      });
      await waitReceipt(hash);
      await refetchAll();
      notify(`Epoch duration change scheduled to ${Math.floor(n)} seconds.`, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setBusy(null);
    }
  }, [nextDuration, notify, refetchAll, waitReceipt, writeContractAsync]);

  const onCancelDuration = useCallback(async () => {
    try {
      setBusy("cancel");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "cancelEpochDurationChange",
        args: [],
        chainId: APP_CHAIN_ID,
      });
      await waitReceipt(hash);
      await refetchAll();
      notify("Pending epoch duration change cancelled.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setBusy(null);
    }
  }, [notify, refetchAll, waitReceipt, writeContractAsync]);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const [dataSyncRes, runtimeRes] = await Promise.all([
        fetch("/api/health/data-sync", { cache: "no-store" }),
        fetch("/api/health/runtime", { cache: "no-store" }),
      ]);

      const [dataSyncJson, runtimeJson] = await Promise.all([
        dataSyncRes.json().catch(() => null),
        runtimeRes.json().catch(() => null),
      ]);

      setDataSyncHealth((dataSyncJson ?? null) as DataSyncHealth | null);
      setRuntimeHealth((runtimeJson ?? null) as RuntimeHealth | null);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "warning");
    } finally {
      setHealthLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void fetchHealth();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchHealth();
      }
    }, 15_000);
    return () => clearInterval(intervalId);
  }, [fetchHealth]);

  const runtimeMetricRows = useMemo(
    () => Object.entries(runtimeHealth?.metrics ?? {}).sort((a, b) => a[0].localeCompare(b[0])),
    [runtimeHealth],
  );
  const catchUpPhase = dataSyncHealth?.catchUp?.phase ?? "unknown";
  const catchUpToneClass =
    catchUpPhase === "synced"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : catchUpPhase === "near_head"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
        : catchUpPhase === "bootstrapping"
          ? "border-violet-500/30 bg-violet-500/10 text-violet-200"
          : "border-amber-500/30 bg-amber-500/10 text-amber-200";
  const blockProgressWidth = Math.max(0, Math.min(100, dataSyncHealth?.catchUp?.blockProgressPct ?? 0));
  const epochProgressWidth = Math.max(0, Math.min(100, dataSyncHealth?.epochs?.coveragePct ?? 0));
  const contiguousProgressWidth = Math.max(0, Math.min(100, dataSyncHealth?.epochs?.contiguousCoveragePct ?? 0));
  const jackpotServingMode = dataSyncHealth?.jackpots?.servingMode ?? null;
  const recentWinsServingMode = dataSyncHealth?.recentWins?.servingMode ?? null;

  return (
    <main className="min-h-screen bg-[#060612] text-slate-200 p-6">
      <NoticeStack notices={notices} onDismiss={dismissNotice} />
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">LORE Admin</h1>
        <p className="text-sm text-gray-400">
          Contract: <span className="font-mono">{CONTRACT_ADDRESS}</span>
        </p>

        {!address ? (
          <button onClick={login} className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500">
            Login / Connect
          </button>
        ) : !isOwner ? (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm space-y-1">
            <div>Connected wallet is not owner.</div>
            <div className="text-[12px] text-red-200/90">
              Connected: <span className="font-mono">{address}</span>
            </div>
            <div className="text-[12px] text-red-200/90">
              Owner: <span className="font-mono">{owner ?? "..."}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-400">Fees</div>
              <div className="text-sm">Accrued owner fees: <b>{fmtToken(accruedOwnerFees as bigint | undefined)}</b> LINEA</div>
              <div className="text-sm">Accrued burn fees: <b>{fmtToken(accruedBurnFees as bigint | undefined)}</b> LINEA</div>
              <button disabled={busy !== null} onClick={onFlush} className="px-3 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50">
                Flush Protocol Fees
              </button>
            </div>

            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-400">Resolver</div>
              <div className="text-sm">My pending resolver reward: <b>{fmtToken(pendingResolverReward as bigint | undefined)}</b> LINEA</div>
              <button disabled={busy !== null} onClick={onClaimResolver} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">
                Claim Resolver Rewards
              </button>
            </div>

            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-400">Epoch Duration</div>
              <div className="text-sm">Current: <b>{epochDuration ? Number(epochDuration) : "..."}s</b></div>
              <div className="text-sm">
                Pending: <b>{pendingDuration ? `${Number(pendingDuration)}s` : "none"}</b>
                {pendingEta ? `, ETA ${new Date(Number(pendingEta) * 1000).toLocaleString()}` : ""}
                {pendingFromEpoch ? `, from epoch #${pendingFromEpoch.toString()}` : ""}
              </div>
              <div className="flex gap-2">
                <input
                  value={nextDuration}
                  onChange={(e) => setNextDuration(e.target.value)}
                  className="px-2 py-1 rounded bg-black/30 border border-white/10"
                  placeholder="seconds"
                />
                <button disabled={busy !== null} onClick={onScheduleDuration} className="px-3 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50">
                  Schedule
                </button>
                <button disabled={busy !== null} onClick={onCancelDuration} className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>

            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-wider text-gray-400">Indexer / Storage Health</div>
                <button
                  disabled={healthLoading}
                  onClick={() => void fetchHealth()}
                  className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm"
                >
                  {healthLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              <div className="text-sm">Status: <b>{dataSyncHealth?.status ?? "..."}</b></div>
              <div className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${catchUpToneClass}`}>
                {catchUpPhase.replace(/_/g, " ")}
              </div>
              <div className="text-sm">Network: <b>{dataSyncHealth?.env?.network ?? "..."}</b></div>
              <div className="text-sm">DB path: <span className="font-mono text-xs">{dataSyncHealth?.env?.dbPath ?? "..."}</span></div>
              <div className="text-sm">Deploy block: <b>{dataSyncHealth?.env?.deployBlock ?? "..."}</b></div>
              <div className="text-sm">Lag warn threshold: <b>{fmtNumber(dataSyncHealth?.env?.lagWarnBlocks)}</b></div>
              <div className="text-sm">Last indexed block: <b>{dataSyncHealth?.storage?.lastIndexedBlock ?? "null"}</b></div>
              <div className="text-sm">Repair cursor block: <b>{dataSyncHealth?.storage?.repairCursorBlock ?? "null"}</b></div>
              <div className="text-sm">Lag blocks: <b>{fmtNumber(dataSyncHealth?.storage?.lagBlocks)}</b></div>
              <div className="text-sm">Stored epochs: <b>{fmtNumber(dataSyncHealth?.epochs?.storedCount)}</b></div>
              <div className="text-sm">Missing epochs: <b>{fmtNumber(dataSyncHealth?.epochs?.missingCount)}</b></div>
              <div className="text-sm">Latest stored epoch: <b>{fmtNumber(dataSyncHealth?.epochs?.latestStoredEpoch)}</b></div>
              <div className="text-sm">Highest contiguous epoch: <b>{fmtNumber(dataSyncHealth?.epochs?.highestContiguousEpoch)}</b></div>
              <div className="text-sm">Stored jackpots: <b>{String(dataSyncHealth?.jackpots?.totalStored ?? 0)}</b></div>
              <div className="text-sm">
                Latest jackpots in DB:
                <b> daily {String(Boolean(dataSyncHealth?.jackpots?.hasLatestDailyInDb))}</b>,
                <b> weekly {String(Boolean(dataSyncHealth?.jackpots?.hasLatestWeeklyInDb))}</b>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wider text-gray-400">Jackpots Serving</div>
                    <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${modeToneClass(jackpotServingMode)}`}>
                      {fmtMode(jackpotServingMode)}
                    </div>
                  </div>
                  <div className="text-sm">Stored jackpots: <b>{fmtNumber(dataSyncHealth?.jackpots?.totalStored)}</b></div>
                  <div className="text-sm">Latest jackpot block: <b>{dataSyncHealth?.storage?.latestStoredJackpotBlock ?? "null"}</b></div>
                  <div className="text-sm">Recovery threshold: <b>{fmtNumber(dataSyncHealth?.env?.jackpotRecoveryBlockLag)}</b> blocks</div>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wider text-gray-400">Recent Wins Serving</div>
                    <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${modeToneClass(recentWinsServingMode)}`}>
                      {fmtMode(recentWinsServingMode)}
                    </div>
                  </div>
                  <div className="text-sm">Stored claims: <b>{fmtNumber(dataSyncHealth?.recentWins?.totalStored)}</b></div>
                  <div className="text-sm">Latest reward claim block: <b>{dataSyncHealth?.recentWins?.latestRewardClaimBlock ?? "null"}</b></div>
                  <div className="text-sm">Lag to head: <b>{fmtNumber(dataSyncHealth?.recentWins?.lagToHeadBlocks)}</b> blocks</div>
                  <div className="text-sm">Lag to indexer: <b>{fmtNumber(dataSyncHealth?.recentWins?.lagToIndexerBlocks)}</b> blocks</div>
                  <div className="text-sm">Recovery threshold: <b>{fmtNumber(dataSyncHealth?.env?.recentWinsRecoveryBlockLag)}</b> blocks</div>
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-wider text-gray-400">Indexer Heartbeat</div>
                  <div className="text-xs text-gray-400">
                    stale after <b>{fmtAge(dataSyncHealth?.env?.indexerHeartbeatStaleMs)}</b>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-gray-400">Run</span>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${staleToneClass(dataSyncHealth?.indexer?.run?.stale)}`}>
                        {dataSyncHealth?.indexer?.run?.stale ? "stale" : "fresh"}
                      </span>
                    </div>
                    <div>Age: <b>{fmtAge(dataSyncHealth?.indexer?.run?.runCompletedAgeMs)}</b></div>
                    <div>Range: <span className="font-mono text-xs">{dataSyncHealth?.indexer?.run?.fromBlock ?? "..."}</span> {"->"} <span className="font-mono text-xs">{dataSyncHealth?.indexer?.run?.toBlock ?? "..."}</span></div>
                    <div>Logs: <b>{fmtNumber(dataSyncHealth?.indexer?.run?.totalLogs)}</b></div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-gray-400">Repair</span>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${staleToneClass(dataSyncHealth?.indexer?.repair?.stale)}`}>
                        {dataSyncHealth?.indexer?.repair?.stale ? "stale" : "fresh"}
                      </span>
                    </div>
                    <div>Age: <b>{fmtAge(dataSyncHealth?.indexer?.repair?.ageMs)}</b></div>
                    <div>Range: <span className="font-mono text-xs">{dataSyncHealth?.indexer?.repair?.fromBlock ?? "..."}</span> {"->"} <span className="font-mono text-xs">{dataSyncHealth?.indexer?.repair?.toBlock ?? "..."}</span></div>
                    <div>Repaired logs: <b>{fmtNumber(dataSyncHealth?.indexer?.repair?.repairedLogs)}</b></div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-gray-400">Reconcile</span>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${staleToneClass(dataSyncHealth?.indexer?.reconcile?.stale)}`}>
                        {dataSyncHealth?.indexer?.reconcile?.stale ? "stale" : "fresh"}
                      </span>
                    </div>
                    <div>Age: <b>{fmtAge(dataSyncHealth?.indexer?.reconcile?.ageMs)}</b></div>
                    <div>Missing epochs: <b>{fmtNumber(dataSyncHealth?.indexer?.reconcile?.missingEpochs)}</b></div>
                    <div>Repaired this pass: <b>{fmtNumber(dataSyncHealth?.indexer?.reconcile?.repairedEpochs)}</b></div>
                    <div>Targets: <span className="text-xs text-gray-300">{dataSyncHealth?.indexer?.reconcile?.targetEpochs?.length ? dataSyncHealth.indexer.reconcile.targetEpochs.join(", ") : "none"}</span></div>
                  </div>
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                <div className="text-xs uppercase tracking-wider text-gray-400">Catch-Up Progress</div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>Blocks indexed</span>
                    <b>{fmtPercent(dataSyncHealth?.catchUp?.blockProgressPct)}</b>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-sky-400 transition-[width] duration-500" style={{ width: `${blockProgressWidth}%` }} />
                  </div>
                  <div className="text-xs text-gray-400">
                    {fmtNumber(dataSyncHealth?.catchUp?.indexedBlocksToCurrentHead)} / {fmtNumber(dataSyncHealth?.catchUp?.totalBlocksToIndex)} blocks
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>Resolved epoch coverage</span>
                    <b>{fmtPercent(dataSyncHealth?.epochs?.coveragePct)}</b>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${epochProgressWidth}%` }} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>Contiguous epoch coverage</span>
                    <b>{fmtPercent(dataSyncHealth?.epochs?.contiguousCoveragePct)}</b>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-violet-400 transition-[width] duration-500" style={{ width: `${contiguousProgressWidth}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    Block rate: <b>{fmtNumber(dataSyncHealth?.catchUp?.blockRatePerMinute)}</b>/min
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    Epoch rate: <b>{fmtNumber(dataSyncHealth?.catchUp?.epochRatePerMinute)}</b>/min
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    ETA to head: <b>{fmtMinutes(dataSyncHealth?.catchUp?.estimatedMinutesToHead)}</b>
                  </div>
                </div>
                {dataSyncHealth?.catchUp?.recentSamples?.length ? (
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wider text-gray-400">Recent Samples</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {[...dataSyncHealth.catchUp.recentSamples].reverse().slice(0, 6).map((sample) => (
                        <div key={sample.ts} className="rounded border border-white/10 bg-white/[0.03] p-2 text-xs text-gray-300 space-y-1">
                          <div>{new Date(sample.ts).toLocaleTimeString()}</div>
                          <div>last indexed: <span className="font-mono">{sample.lastIndexedBlock ?? "null"}</span></div>
                          <div>lag: <b>{fmtNumber(sample.lagBlocks)}</b> blocks</div>
                          <div>epochs stored: <b>{fmtNumber(sample.storedEpochCount)}</b></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              {dataSyncHealth?.hints?.length ? (
                <div className="rounded border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200 space-y-1">
                  {dataSyncHealth.hints.map((hint) => (
                    <div key={hint}>{hint}</div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <div className="text-xs uppercase tracking-wider text-gray-400">Hot API Runtime</div>
              {runtimeMetricRows.length === 0 ? (
                <div className="text-sm text-gray-400">No runtime metrics recorded yet.</div>
              ) : (
                <div className="space-y-2">
                  {runtimeMetricRows.map(([route, metric]) => (
                    <div key={route} className="rounded border border-white/10 bg-black/20 p-3 text-sm space-y-1">
                      <div className="font-mono text-xs text-sky-300">{route}</div>
                      <div>req {metric.requests} | ok {metric.successes} | err {metric.errors} | inflight {metric.inflight}</div>
                      <div>cache {metric.cacheHits} | stale {metric.staleServed} | join {metric.inflightJoined} | bg {metric.backgroundRefreshes}</div>
                      <div>avg {metric.avgLatencyMs}ms | max {metric.maxLatencyMs}ms | last status {metric.lastStatus ?? "n/a"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
