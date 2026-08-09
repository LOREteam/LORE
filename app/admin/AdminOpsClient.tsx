"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalStatus, usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { toHex } from "viem";
import {
  PRIVY_LOGIN_ACCESSIBLE_NAME,
  usePrivyLoginAccessibility,
} from "../hooks/usePrivyLoginAccessibility";
import { APP_CHAIN_ID } from "../lib/constants";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { readJsonResponse } from "../lib/readJsonResponse";
import { sanitizeSupportLogPayload } from "../lib/sentrySanitize";
import { safeToFixed } from "../lib/utils";
import {
  ADMIN_AUTH_WALLET,
  ADMIN_AUTH_WALLET_CONFIGURED,
  buildAdminAuthMessage,
  createAdminAuthNonce,
  normalizeAdminAuthAddress,
} from "../lib/adminAuth";

type DataSyncHealth = {
  status?: string;
  visibility?: "public" | "private";
  redacted?: boolean;
  storage?: {
    currentEpochMeta?: number | null;
    lastIndexedBlock?: string | null;
    repairCursorBlock?: string | null;
    headBlock?: string | null;
    finalityTargetBlock?: string | null;
    lagBlocks?: number | null;
    lagToFinalityTargetBlocks?: number | null;
    diskFreeBytes?: number | null;
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
    blockProgressPct?: number | null;
    epochCoveragePct?: number | null;
    contiguousEpochCoveragePct?: number | null;
    blockRatePerMinute?: number | null;
    epochRatePerMinute?: number | null;
    estimatedMinutesToHead?: number | null;
  };
  jackpots?: {
    totalStored?: number;
    hasLatestDailyInDb?: boolean;
    hasLatestWeeklyInDb?: boolean;
    servingMode?: string;
  };
  recentWins?: {
    totalStored?: number;
    lagToHeadBlocks?: number | null;
    lagToIndexerBlocks?: number | null;
    servingMode?: string;
  };
  indexer?: {
    run?: {
      totalLogs?: number;
      runCompletedAgeMs?: number | null;
      stale?: boolean;
    };
    repair?: {
      repairedLogs?: number;
      ageMs?: number | null;
      stale?: boolean;
    };
    reconcile?: {
      missingEpochs?: number;
      ageMs?: number | null;
      stale?: boolean;
    };
  };
  env?: {
    network?: string;
    deployBlock?: string;
    lagWarnBlocks?: number | null;
    indexerFinalityBlocks?: string | null;
  };
  hints?: string[];
};

type RuntimeMetric = {
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
};

type RuntimeHealth = {
  status?: string;
  visibility?: "public" | "private";
  redacted?: boolean;
  publicConfig?: {
    chainId?: number;
    chainName?: string;
    privyAppIdConfigured?: boolean;
    privyFallbackActive?: boolean;
    readOnlyMode?: boolean;
  };
  metrics?: Record<string, RuntimeMetric>;
};

type HotRouteSummary = {
  route: string;
  label: string;
  metric: RuntimeMetric;
  cachePct: number | null;
  errorPct: number | null;
};

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

type OpsLogSource = {
  key: string;
  label: string;
  file: string;
  fileName: string;
  exists: boolean;
  status: "fresh" | "stale" | "missing";
  ageMs: number | null;
  lineCount: number;
  lastLine: string | null;
};

type OpsLogEntry = {
  ts: string | null;
  level: "error" | "warn" | "info";
  source: string;
  message: string;
};

type OpsResolvedEpoch = {
  epoch: number;
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  resolvedBlock: string | null;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
};

type OpsLiveIndexer = {
  scanFromBlock: string | null;
  scanToBlock: string | null;
  scanBlockCount: number | null;
  chunkIndex: number | null;
  chunkTotal: number | null;
  chunkFromBlock: string | null;
  chunkToBlock: string | null;
  fetchedLogs: number | null;
  parsedBets: number | null;
  parsedEpochs: number | null;
  parsedJackpots: number | null;
  parsedClaims: number | null;
  wroteChunk: boolean;
  progressPct: number | null;
};

type OpsData = {
  status: "ok";
  generatedAt: number;
  logSources: OpsLogSource[];
  recentErrors: OpsLogEntry[];
  recentEvents: OpsLogEntry[];
  recentResolvedEpochs: OpsResolvedEpoch[];
  recentJackpots: Array<{
    epoch: string;
    kind: "daily" | "weekly";
    amount: string;
    amountNum: number;
    txHash: string;
    blockNumber: string;
  }>;
  recentRewardClaims: Array<{
    epoch: string;
    user: string;
    reward: string;
    rewardNum: number;
    txHash: string;
    blockNumber: string;
  }>;
  liveIndexer: OpsLiveIndexer | null;
  storage: {
    currentEpochMeta: number | null;
    lastIndexedBlock: string | null;
    repairCursorBlock: string | null;
    headBlock: string | null;
    finalityBlocks: string | null;
    targetBlock: string | null;
    lastProcessedBlock: string | null;
  };
};

type OpsErrorPayload = {
  error?: string;
};

type AdminProcessState = {
  target: "indexer" | "bot";
  label: string;
  status: "fresh" | "stale" | "missing";
  ageMs: number | null;
  logFile: string;
  pid: number | null;
  running: boolean;
};

type AdminProcessesPayload = {
  status: "ok";
  processes: {
    indexer: AdminProcessState;
    bot: AdminProcessState;
  };
};

function getOpsPayloadError(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return null;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : null;
}

function describeAdminClientError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return String(sanitizeSupportLogPayload(message)).replace(/\s+/g, " ").trim().slice(0, 220) || "Admin operation failed";
}

function shortenAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatAdminWalletLabel() {
  return ADMIN_AUTH_WALLET_CONFIGURED ? shortenAddress(ADMIN_AUTH_WALLET) : "not configured";
}

function fmtNumber(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  return value.toLocaleString();
}

function fmtPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  return `${safeToFixed(value, 2, "...")}%`;
}

function fmtAge(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${safeToFixed(seconds, 1, "...")} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${safeToFixed(minutes, 1, "...")} min`;
  const hours = minutes / 60;
  return `${safeToFixed(hours, 1, "...")} h`;
}

function fmtGib(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return "...";
  return `${safeToFixed(value / 1_073_741_824, 2, "...")} GiB`;
}

function fmtMode(value?: string | null) {
  if (!value) return "...";
  return value.replace(/_/g, " ");
}

function statusToneClass(status?: string | null) {
  if (status === "healthy" || status === "ok") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "degraded") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "error") return "border-red-500/30 bg-red-500/10 text-red-200";
  return "border-white/10 bg-white/4 text-slate-300";
}

function staleToneClass(stale?: boolean) {
  return stale
    ? "border-red-500/30 bg-red-500/10 text-red-200"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

function modeToneClass(value?: string | null) {
  if (value === "indexer_fast_path") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (value === "bootstrap_recovery_needed") return "border-violet-500/30 bg-violet-500/10 text-violet-200";
  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function logSourceToneClass(status?: "fresh" | "stale" | "missing") {
  if (status === "fresh") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "stale") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-red-500/30 bg-red-500/10 text-red-200";
}

type AttentionItem = {
  level: "error" | "warn" | "info";
  title: string;
  detail: string;
};

function attentionToneClass(level: AttentionItem["level"]) {
  if (level === "error") return "border-red-500/30 bg-red-500/10 text-red-100";
  if (level === "warn") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-sky-500/30 bg-sky-500/10 text-sky-100";
}

function routePerfToneClass(metric: RuntimeMetric) {
  if (metric.errors > 0 || metric.lastStatus && metric.lastStatus >= 500) {
    return "border-red-500/30 bg-red-500/10";
  }
  if (metric.maxLatencyMs >= 1200 || metric.avgLatencyMs >= 500) {
    return "border-amber-500/30 bg-amber-500/10";
  }
  return "border-emerald-500/30 bg-emerald-500/10";
}

function fmtPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  return `${safeToFixed(value, 0, "...")}%`;
}

export default function AdminOpsClient() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { isOpen: privyModalOpen } = useModalStatus();
  const privyLogin = usePrivyLoginAccessibility({
    authenticated,
    login,
    modalOpen: privyModalOpen,
    ready,
  });
  const { wallets } = useWallets();
  const { address } = useAccount();
  const [dataSyncHealth, setDataSyncHealth] = useState<DataSyncHealth | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [adminAuthReady, setAdminAuthReady] = useState(false);
  const [adminAuthBusy, setAdminAuthBusy] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const [adminSessionChecked, setAdminSessionChecked] = useState(false);
  const [opsData, setOpsData] = useState<OpsData | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [processStates, setProcessStates] = useState<Record<"indexer" | "bot", AdminProcessState> | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [processActionBusy, setProcessActionBusy] = useState<"indexer" | "bot" | null>(null);
  const showLoginReload = Boolean(
    privyLogin.uiState.error &&
      (privyLogin.uiState.error.includes("still loading") || privyLogin.uiState.error.includes("timed out")),
  );
  const copyResetTimeoutRef = useRef<number | null>(null);
  const processRefreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    if (processRefreshTimeoutRef.current !== null) {
      window.clearTimeout(processRefreshTimeoutRef.current);
    }
  }, []);

  const connectedAddresses = useMemo(() => {
    const values = new Set<string>();
    const connectedAddress = normalizeAdminAuthAddress(address);
    if (connectedAddress) values.add(connectedAddress);
    for (const wallet of wallets) {
      const walletAddress = normalizeAdminAuthAddress(wallet?.address);
      if (walletAddress) values.add(walletAddress);
    }
    return [...values];
  }, [address, wallets]);

  const isAdminWallet = ADMIN_AUTH_WALLET_CONFIGURED && connectedAddresses.includes(ADMIN_AUTH_WALLET);
  const isLocalHost =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const adminWallet = useMemo(
    () => ADMIN_AUTH_WALLET_CONFIGURED
      ? wallets.find((wallet) => normalizeAdminAuthAddress(wallet.address) === ADMIN_AUTH_WALLET) ?? null
      : null,
    [wallets],
  );
  const canSeePrivateDiagnostics =
    adminAuthReady && !dataSyncHealth?.redacted && !runtimeHealth?.redacted;

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const [dataSyncRes, runtimeRes] = await Promise.all([
        fetchWithTimeout("/api/health/data-sync", { cache: "no-store" }),
        fetchWithTimeout("/api/health/runtime", { cache: "no-store" }),
      ]);

      const [dataSyncJson, runtimeJson] = await Promise.all([
        readJsonResponse<DataSyncHealth>(dataSyncRes).catch(() => null),
        readJsonResponse<RuntimeHealth>(runtimeRes).catch(() => null),
      ]);

      setDataSyncHealth((dataSyncJson ?? null) as DataSyncHealth | null);
      setRuntimeHealth((runtimeJson ?? null) as RuntimeHealth | null);
    } catch (error) {
      setErrorText(describeAdminClientError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOps = useCallback(async () => {
    if (!canSeePrivateDiagnostics) {
      setOpsData(null);
      return;
    }

    setOpsLoading(true);
    try {
      const response = await fetchWithTimeout("/api/admin/ops", { cache: "no-store" });
      const payload = await readJsonResponse<OpsData | OpsErrorPayload>(response).catch(() => null);
      const payloadError = getOpsPayloadError(payload);
      if (!response.ok || !payload || payloadError) {
        throw new Error(payloadError || `Admin ops HTTP ${response.status}`);
      }
      setOpsData(payload as OpsData);
    } catch (error) {
      setErrorText((prev) => prev ?? describeAdminClientError(error));
    } finally {
      setOpsLoading(false);
    }
  }, [canSeePrivateDiagnostics]);

  const fetchProcesses = useCallback(async () => {
    if (!canSeePrivateDiagnostics || !isLocalHost) {
      setProcessStates(null);
      return;
    }

    try {
      const response = await fetchWithTimeout("/api/admin/processes", { cache: "no-store" });
      const payload = await readJsonResponse<AdminProcessesPayload | OpsErrorPayload>(response).catch(() => null);
      const payloadError = getOpsPayloadError(payload);
      if (!response.ok || !payload || payloadError || !("processes" in payload)) {
        throw new Error(payloadError || `Admin processes HTTP ${response.status}`);
      }
      setProcessStates(payload.processes);
    } catch (error) {
      setErrorText((prev) => prev ?? describeAdminClientError(error));
    }
  }, [canSeePrivateDiagnostics, isLocalHost]);

  const refreshAdminSession = useCallback(async () => {
    if (!authenticated || !isAdminWallet) {
      setAdminAuthReady(false);
      setAdminSessionChecked(true);
      return false;
    }

    try {
      const response = await fetchWithTimeout("/api/admin/auth", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        setAdminAuthReady(false);
        return false;
      }
      setAdminAuthReady(true);
      setAdminAuthError(null);
      return true;
    } catch {
      setAdminAuthReady(false);
      return false;
    } finally {
      setAdminSessionChecked(true);
    }
  }, [authenticated, isAdminWallet]);

  useEffect(() => {
    void fetchHealth();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchHealth();
      }
    }, 15_000);
    return () => clearInterval(intervalId);
  }, [fetchHealth]);

  useEffect(() => {
    if (!canSeePrivateDiagnostics) {
      setOpsData(null);
      return;
    }
    void fetchOps();
  }, [canSeePrivateDiagnostics, fetchOps]);

  useEffect(() => {
    if (!canSeePrivateDiagnostics || !isLocalHost) {
      setProcessStates(null);
      return;
    }
    void fetchProcesses();
  }, [canSeePrivateDiagnostics, fetchProcesses, isLocalHost]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !isAdminWallet) {
      setAdminAuthReady(false);
      setAdminAuthError(null);
      setAdminSessionChecked(true);
      return;
    }
    void refreshAdminSession();
  }, [authenticated, isAdminWallet, ready, refreshAdminSession]);

  const runtimeMetricRows = useMemo(
    () => Object.entries(runtimeHealth?.metrics ?? {}).sort((a, b) => a[0].localeCompare(b[0])),
    [runtimeHealth],
  );
  const hotRoutes = useMemo<HotRouteSummary[]>(() => {
    const watchedRoutes: Array<{ route: string; label: string }> = [
      { route: "api/live-state", label: "Live State" },
      { route: "api/recent-wins", label: "Recent Wins" },
      { route: "api/leaderboards", label: "Leaderboards" },
      { route: "api/rebates", label: "Rebates" },
      { route: "api/deposits", label: "Deposits" },
      { route: "api/epochs", label: "Epochs" },
    ];

    return watchedRoutes
      .map(({ route, label }) => {
        const metric = runtimeHealth?.metrics?.[route];
        if (!metric) return null;
        const cachePct = metric.requests > 0 ? ((metric.cacheHits + metric.staleServed) / metric.requests) * 100 : null;
        const errorPct = metric.requests > 0 ? (metric.errors / metric.requests) * 100 : null;
        return {
          route,
          label,
          metric,
          cachePct,
          errorPct,
        } satisfies HotRouteSummary;
      })
      .filter((value): value is HotRouteSummary => value !== null)
      .sort((a, b) => {
        if (b.metric.avgLatencyMs !== a.metric.avgLatencyMs) {
          return b.metric.avgLatencyMs - a.metric.avgLatencyMs;
        }
        return b.metric.requests - a.metric.requests;
      });
  }, [runtimeHealth]);

  const blockProgressWidth = Math.max(0, Math.min(100, dataSyncHealth?.catchUp?.blockProgressPct ?? 0));
  const epochProgressWidth = Math.max(0, Math.min(100, dataSyncHealth?.catchUp?.epochCoveragePct ?? 0));
  const contiguousProgressWidth = Math.max(0, Math.min(100, dataSyncHealth?.catchUp?.contiguousEpochCoveragePct ?? 0));
  const liveIndexerActive = Boolean(
    opsData?.liveIndexer &&
    opsData.liveIndexer.chunkIndex != null &&
    opsData.liveIndexer.chunkTotal != null &&
    opsData.liveIndexer.chunkFromBlock &&
    opsData.liveIndexer.chunkToBlock,
  );
  const visibleDataSyncHints = useMemo(
    () =>
      (dataSyncHealth?.hints ?? []).filter((hint) =>
        !(liveIndexerActive && /heartbeat is stale/i.test(hint)),
      ),
    [dataSyncHealth?.hints, liveIndexerActive],
  );
  const diagnosticsSnapshot = useMemo(() => {
    if (!opsData) return "";
    return JSON.stringify(
      {
        generatedAt: new Date(opsData.generatedAt).toISOString(),
        runtime: {
          status: runtimeHealth?.status ?? null,
          visibility: runtimeHealth?.visibility ?? null,
        },
        dataSync: {
          status: dataSyncHealth?.status ?? null,
          phase: dataSyncHealth?.catchUp?.phase ?? null,
          lagBlocks: dataSyncHealth?.storage?.lagBlocks ?? null,
          lagToFinalityTargetBlocks: dataSyncHealth?.storage?.lagToFinalityTargetBlocks ?? null,
          finalityTargetBlock: dataSyncHealth?.storage?.finalityTargetBlock ?? null,
          indexerFinalityBlocks: dataSyncHealth?.env?.indexerFinalityBlocks ?? null,
          currentEpochMeta: dataSyncHealth?.storage?.currentEpochMeta ?? null,
          lastIndexedBlock: dataSyncHealth?.storage?.lastIndexedBlock ?? null,
          missingCount: dataSyncHealth?.epochs?.missingCount ?? null,
        },
        indexerStorage: opsData.storage,
        logs: opsData.logSources.map((source) => ({
          key: source.key,
          status: source.status,
          ageMs: source.ageMs,
          lineCount: source.lineCount,
          lastLine: source.lastLine,
        })),
        processes: processStates,
        recentErrors: opsData.recentErrors,
        recentEvents: opsData.recentEvents.slice(-8),
        recentResolvedEpochs: opsData.recentResolvedEpochs,
        recentJackpots: opsData.recentJackpots,
        liveIndexer: opsData.liveIndexer,
      },
      null,
      2,
    );
  }, [dataSyncHealth, opsData, processStates, runtimeHealth]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const runtimeStatus = runtimeHealth?.status ?? null;
    const dataSyncStatus = dataSyncHealth?.status ?? null;
    const indexerProcess = processStates?.indexer ?? null;
    const liveIndexer = opsData?.liveIndexer ?? null;
    const missingCount = dataSyncHealth?.epochs?.missingCount ?? 0;
    const missingLatestCount = dataSyncHealth?.epochs?.missingLatest?.length ?? 0;
    const lagBlocks = dataSyncHealth?.storage?.lagBlocks ?? null;
    const lagToFinalityTargetBlocks = dataSyncHealth?.storage?.lagToFinalityTargetBlocks ?? null;
    const effectiveLagBlocks = lagToFinalityTargetBlocks ?? lagBlocks;
    const effectiveLagLabel = lagToFinalityTargetBlocks != null ? "finality-target lag" : "head lag";
    const lagWarnBlocks = dataSyncHealth?.env?.lagWarnBlocks ?? 200;
    const freshRun = dataSyncHealth?.indexer?.run?.stale === false;
    const missingLatestTailOnly =
      missingCount > 0 &&
      missingLatestCount === missingCount;
    const nearHeadCatchUp = Boolean(
      freshRun &&
      missingLatestTailOnly &&
      effectiveLagBlocks != null &&
      Number.isFinite(effectiveLagBlocks) &&
      effectiveLagBlocks <= Math.max(lagWarnBlocks * 4, 5_000),
    );
    const isLiveIndexerActive = Boolean(
      liveIndexer &&
      liveIndexer.chunkIndex != null &&
      liveIndexer.chunkTotal != null &&
      liveIndexer.chunkFromBlock &&
      liveIndexer.chunkToBlock,
    );
    const indexerBootstrapping = Boolean(
      isLocalHost &&
      indexerProcess?.running &&
      indexerProcess.status === "fresh" &&
      (dataSyncHealth?.indexer?.run?.stale || isLiveIndexerActive),
    );

    if (!authenticated) {
      items.push({
        level: "info",
        title: "Admin wallet is not connected",
        detail: "Connect the approved wallet to unlock private diagnostics, logs, keeper status, and diagnostics snapshot tools.",
      });
    } else if (isAdminWallet && !adminAuthReady) {
      items.push({
        level: "warn",
        title: "Private diagnostics are still locked",
        detail: "The admin wallet is connected, but the page still needs one signed verification message before full ops data opens.",
      });
    }

    if (runtimeStatus && runtimeStatus !== "ok" && runtimeStatus !== "healthy") {
      items.push({
        level: "error",
        title: "Runtime health is not green",
        detail: `Runtime reports "${runtimeStatus}". Check API responses and server logs before treating the instance as healthy.`,
      });
    }

    if (runtimeHealth?.publicConfig?.readOnlyMode) {
      items.push({
        level: "info",
        title: "Read-only betting is enabled",
        detail: "New manual and auto-miner starts are paused by NEXT_PUBLIC_LORE_READ_ONLY_MODE. Existing data and health endpoints should remain visible.",
      });
    }

    if (dataSyncStatus && dataSyncStatus !== "healthy" && dataSyncStatus !== "ok") {
      items.push({
        level: indexerBootstrapping || nearHeadCatchUp ? "warn" : "error",
        title: "Data sync is degraded",
        detail:
          indexerBootstrapping && isLiveIndexerActive
            ? `Data sync still reports "${dataSyncStatus}", but the local indexer is actively processing chunk ${fmtNumber(liveIndexer?.chunkIndex)} / ${fmtNumber(liveIndexer?.chunkTotal)} (${liveIndexer?.chunkFromBlock} -> ${liveIndexer?.chunkToBlock}).`
            : nearHeadCatchUp
              ? `Data sync is still "${dataSyncStatus}", but the indexer is already near its target: ${effectiveLagLabel} is ${fmtNumber(effectiveLagBlocks)} blocks and the only missing epochs are the latest unresolved tail.`
            : indexerBootstrapping
              ? `Data sync still reports "${dataSyncStatus}", but a fresh local indexer is already running and catching up in phase "${fmtMode(dataSyncHealth?.catchUp?.phase)}".`
              : `Data sync reports "${dataSyncStatus}" in phase "${fmtMode(dataSyncHealth?.catchUp?.phase)}". Indexer coverage or lag needs attention.`,
      });
    }

    if (missingCount > 0) {
      items.push({
        level: nearHeadCatchUp ? "warn" : "error",
        title: "Missing epochs detected",
        detail: nearHeadCatchUp
          ? `${fmtNumber(missingCount)} latest epochs are still catching up from storage tail ${dataSyncHealth?.epochs?.missingLatest?.[0] ?? "..." } to ${dataSyncHealth?.epochs?.missingLatest?.at(-1) ?? "..."}.`
          : `${fmtNumber(missingCount)} epochs are missing from storage. Reconcile or repair needs investigation.`,
      });
    }

    if (effectiveLagBlocks != null && Number.isFinite(effectiveLagBlocks) && effectiveLagBlocks > lagWarnBlocks) {
      items.push({
        level: nearHeadCatchUp ? "info" : "warn",
        title: "Indexer lag is elevated",
        detail: nearHeadCatchUp
          ? `${effectiveLagLabel} is ${fmtNumber(effectiveLagBlocks)} blocks and still shrinking during catch-up. The current warning threshold is ${fmtNumber(lagWarnBlocks)} blocks.`
          : `${effectiveLagLabel} is ${fmtNumber(effectiveLagBlocks)} blocks, which is above the local warning threshold of ${fmtNumber(lagWarnBlocks)} blocks.`,
      });
    }

    if (dataSyncHealth?.indexer?.run?.stale && !indexerBootstrapping) {
      items.push({
        level: "error",
        title: "Indexer run heartbeat is stale",
        detail: `The last completed run is ${fmtAge(dataSyncHealth?.indexer?.run?.runCompletedAgeMs)} old.`,
      });
    }

    if (indexerBootstrapping) {
      items.push({
        level: "info",
        title: "Indexer is catching up locally",
        detail: isLiveIndexerActive
          ? `The current catch-up chunk is ${fmtNumber(liveIndexer?.chunkIndex)} / ${fmtNumber(liveIndexer?.chunkTotal)} and has fetched ${fmtNumber(liveIndexer?.fetchedLogs)} logs so far.`
          : "A fresh local watcher is already writing to the indexer log. The heartbeat card will recover after the current catch-up run finishes.",
      });
    }

    if (canSeePrivateDiagnostics && opsData) {
      const keeperProcess = processStates?.bot ?? null;
      const keeperLog = opsData.logSources.find((source) => source.key === "bot");
      if (isLocalHost && keeperProcess && !keeperProcess.running) {
        items.push({
          level: "warn",
          title: "Keeper is not running locally",
          detail: "No local bot / keeper process is active right now. Start it if you want resolve and keeper activity on this machine.",
        });
      } else if (!isLocalHost && keeperLog?.status === "missing") {
        items.push({
          level: "warn",
          title: "Keeper log is missing",
          detail: "No bot / keeper log file is present. If keeper should be running, verify the process and log output.",
        });
      } else if ((keeperProcess?.running && keeperLog?.status === "stale") || keeperLog?.status === "stale") {
        items.push({
          level: "warn",
          title: "Keeper log is stale",
          detail: `The keeper log has not updated for ${fmtAge(keeperLog.ageMs)}.`,
        });
      }

      if ((opsData.recentErrors?.length ?? 0) > 0) {
        const latestError = opsData.recentErrors[0];
        const latestErrorAgeMs = latestError.ts ? Date.now() - new Date(latestError.ts).getTime() : null;
        const hasCurrentDegradation =
          dataSyncStatus !== "healthy" ||
          runtimeStatus !== "healthy" && runtimeStatus !== "ok" ||
          Boolean(dataSyncHealth?.indexer?.run?.stale && !indexerBootstrapping);
        const suppressIndexerBootstrapNoise =
          indexerBootstrapping &&
          latestError.source === "Indexer" &&
          latestErrorAgeMs == null &&
          isLiveIndexerActive;
        const shouldShowRecentError =
          !suppressIndexerBootstrapNoise &&
          latestError.level === "error" &&
          (
            latestErrorAgeMs != null
              ? latestErrorAgeMs <= 180_000 || hasCurrentDegradation
              : hasCurrentDegradation
          );
        if (shouldShowRecentError) {
          items.push({
            level: "warn",
            title: "Recent log errors were found",
            detail: `${latestError.source}: ${latestError.message}`,
          });
        }
      }
    }

    if (items.length === 0) {
      items.push({
        level: "info",
        title: "Nothing urgent stands out",
        detail: "Runtime, data sync, and recent diagnostics all look normal right now.",
      });
    }

    return items.slice(0, 6);
  }, [
    adminAuthReady,
    authenticated,
    canSeePrivateDiagnostics,
    dataSyncHealth,
    isLocalHost,
    isAdminWallet,
    processStates,
    opsData,
    runtimeHealth,
  ]);

  const handleVerifyAdminWallet = useCallback(async () => {
    if (!authenticated || !isAdminWallet || adminAuthBusy) return;
    if (!ADMIN_AUTH_WALLET_CONFIGURED) {
      setAdminAuthReady(false);
      setAdminAuthError("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS is not configured for this environment.");
      return;
    }

    setAdminAuthBusy(true);
    setAdminAuthError(null);
    try {
      const normalizedWallet = ADMIN_AUTH_WALLET;
      const message = buildAdminAuthMessage({
        address: normalizedWallet,
        uri: `${window.location.origin}/admin`,
        chainId: APP_CHAIN_ID,
        nonce: createAdminAuthNonce(),
        issuedAt: new Date().toISOString(),
      });

      if (!adminWallet) {
        throw new Error("Admin wallet provider is not available.");
      }

      const provider = (await adminWallet.getEthereumProvider()) as Eip1193Provider;
      const messageHex = toHex(message);
      let signature = "";
      try {
        signature = String(
          await provider.request({
            method: "personal_sign",
            params: [messageHex, normalizedWallet],
          }),
        );
      } catch (personalSignError) {
        signature = String(
          await provider.request({
            method: "eth_sign",
            params: [normalizedWallet, messageHex],
          }),
        );
        const safePersonalSignError = sanitizeSupportLogPayload(
          personalSignError instanceof Error ? personalSignError.message : String(personalSignError),
        );
        console.warn(
          "[admin-auth] personal_sign fallbacked to eth_sign:",
          safePersonalSignError,
        );
      }

      const response = await fetchWithTimeout("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          authAddress: normalizedWallet,
          authMessage: message,
          authSignature: signature,
        }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response).catch(() => null);
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `Admin auth HTTP ${response.status}`);
      }

      setAdminAuthReady(true);
      setAdminSessionChecked(true);
      setAdminAuthError(null);
      await fetchHealth();
      await fetchOps();
    } catch (error) {
      setAdminAuthReady(false);
      setAdminAuthError(describeAdminClientError(error));
    } finally {
      setAdminAuthBusy(false);
    }
  }, [adminAuthBusy, adminWallet, authenticated, fetchHealth, fetchOps, isAdminWallet]);

  const handleLogout = useCallback(async () => {
    try {
      await fetchWithTimeout("/api/admin/auth", {
        method: "DELETE",
        cache: "no-store",
      });
    } catch {
      // Ignore local cleanup failures; the wallet logout still matters.
    } finally {
      setAdminAuthReady(false);
      setAdminAuthError(null);
      setAdminSessionChecked(false);
      logout();
    }
  }, [logout]);

  const handleCopySnapshot = useCallback(async () => {
    if (!diagnosticsSnapshot) return;
    try {
      await navigator.clipboard.writeText(diagnosticsSnapshot);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        copyResetTimeoutRef.current = null;
        setCopyState("idle");
      }, 2000);
    }
  }, [diagnosticsSnapshot]);

  const handleStartProcess = useCallback(async (target: "indexer" | "bot") => {
    if (!canSeePrivateDiagnostics || processActionBusy) return;
    setProcessActionBusy(target);
    setErrorText(null);
    try {
      const response = await fetchWithTimeout("/api/admin/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ target }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response).catch(() => null);
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `Process start HTTP ${response.status}`);
      }
      await fetchProcesses();
      await fetchHealth();
      if (processRefreshTimeoutRef.current !== null) {
        window.clearTimeout(processRefreshTimeoutRef.current);
      }
      processRefreshTimeoutRef.current = window.setTimeout(() => {
        processRefreshTimeoutRef.current = null;
        void fetchProcesses();
        void fetchOps();
        void fetchHealth();
      }, 1500);
    } catch (error) {
      setErrorText(describeAdminClientError(error));
    } finally {
      setProcessActionBusy(null);
    }
  }, [canSeePrivateDiagnostics, fetchHealth, fetchOps, fetchProcesses, processActionBusy]);

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-slate-200">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">LORE Ops</h1>
          <p className="text-sm text-gray-400">
            Runtime, indexer, and API health dashboard. Full admin details unlock only for the approved wallet.
          </p>
          <div
            data-privy-login-focus-root
            role="group"
            aria-label="Admin operations controls"
            tabIndex={-1}
            className="flex flex-wrap gap-2"
          >
            <span id="admin-privy-login-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {privyLogin.uiState.statusAnnouncement}
            </span>
            {canSeePrivateDiagnostics ? (
              <>
                <a
                  href="/api/health/runtime"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300 hover:bg-white/8"
                >
                  Runtime JSON
                </a>
                <a
                  href="/api/health/data-sync"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300 hover:bg-white/8"
                >
                  Data Sync JSON
                </a>
              </>
            ) : null}
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                void fetchHealth();
                void fetchOps();
              }}
              className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {loading ? "Refreshing" : "Refresh"}
            </button>
            {!authenticated ? (
              <button
                type="button"
                onClick={(event) => privyLogin.requestLogin(
                  event.currentTarget,
                  event.currentTarget.closest<HTMLElement>("[data-privy-login-focus-root]"),
                )}
                aria-label={PRIVY_LOGIN_ACCESSIBLE_NAME}
                aria-describedby="admin-privy-login-status"
                aria-haspopup="dialog"
                aria-expanded={privyLogin.uiState.modalOpen}
                aria-busy={privyLogin.uiState.busy}
                disabled={privyLogin.uiState.disabled}
                className="inline-flex min-h-11 items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200 outline-none hover:bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-emerald-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
              >
                {privyLogin.uiState.buttonText}
              </button>
            ) : isAdminWallet && !adminAuthReady ? (
              <button
                type="button"
                disabled={adminAuthBusy}
                onClick={() => void handleVerifyAdminWallet()}
                className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
              >
                {adminAuthBusy ? "Verifying" : "Verify Admin Wallet"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300 hover:bg-white/8"
              >
                Logout
              </button>
            )}
          </div>
        </div>

        {errorText ? (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {errorText}
          </div>
        ) : null}

        {adminAuthError ? (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {adminAuthError}
          </div>
        ) : null}

        {!authenticated && privyLogin.uiState.error ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
          >
            <span>{privyLogin.uiState.error}</span>
            {showLoginReload ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded border border-red-300/30 px-3 text-xs font-bold uppercase tracking-wider outline-none hover:bg-red-300/10 focus-visible:ring-2 focus-visible:ring-red-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Reload
              </button>
            ) : null}
          </div>
        ) : null}

        {!ADMIN_AUTH_WALLET_CONFIGURED ? (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            `NEXT_PUBLIC_ADMIN_WALLET_ADDRESS` is not configured. Admin wallet verification is disabled until this environment is fixed.
          </div>
        ) : null}

        {!ready ? (
          <div className="rounded border border-white/10 bg-white/2 p-4 text-sm text-slate-300">
            Checking wallet session...
          </div>
        ) : null}

        {ready && authenticated && ADMIN_AUTH_WALLET_CONFIGURED && !isAdminWallet ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Connected wallet is not allowed for full admin access.
            <div className="mt-2 text-amber-100">
              Allowed wallet: <span className="font-mono">{formatAdminWalletLabel()}</span>
            </div>
            {connectedAddresses.length > 0 ? (
              <div className="mt-1 text-amber-100">
                Connected: {connectedAddresses.map((item) => (
                  <span key={item} className="mr-2 inline-block font-mono">{shortenAddress(item)}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {ready && !authenticated && ADMIN_AUTH_WALLET_CONFIGURED ? (
          <div className="rounded border border-violet-500/30 bg-violet-500/10 p-4 text-sm text-violet-100">
            Connect the admin wallet <span className="font-mono">{formatAdminWalletLabel()}</span> to unlock the full diagnostics view.
          </div>
        ) : null}

        {ready && authenticated && isAdminWallet && !adminAuthReady ? (
          <div className="rounded border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-100">
            {adminSessionChecked
              ? "Wallet is connected, but private diagnostics are still locked. Click “Verify Admin Wallet” and sign the message once."
              : "Checking existing admin verification session..."}
            <div className="mt-2 text-sky-200">
              The signature proves wallet ownership and does not send any blockchain transaction.
            </div>
          </div>
        ) : null}

        {dataSyncHealth?.redacted || runtimeHealth?.redacted ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Private diagnostics are hidden on non-local access. Full JSON and detailed internals are available only after admin wallet verification or with the diagnostics secret.
          </div>
        ) : null}

        <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-wider text-gray-400">What Needs Attention Now</div>
            <div className="text-xs text-gray-500">{attentionItems.length} items</div>
          </div>
          <div className="space-y-2">
            {attentionItems.map((item, index) => (
              <div
                key={`${item.title}-${index}`}
                className={`rounded border p-3 text-sm ${attentionToneClass(item.level)}`}
              >
                <div className="font-semibold">{item.title}</div>
                <div className="mt-1 opacity-90">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Runtime</div>
            <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusToneClass(runtimeHealth?.status)}`}>
              {runtimeHealth?.status ?? "..."}
            </div>
            <div className="text-sm text-gray-400">
              Visibility: <b className="text-slate-200">{runtimeHealth?.visibility ?? "..."}</b>
            </div>
            <div className="text-sm text-gray-400">
              Read-only betting: <b className="text-slate-200">{runtimeHealth?.publicConfig?.readOnlyMode ? "on" : "off"}</b>
            </div>
          </div>
          <div className="space-y-2 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Data Sync</div>
            <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusToneClass(dataSyncHealth?.status)}`}>
              {dataSyncHealth?.status ?? "..."}
            </div>
            <div className="text-sm text-gray-400">
              Phase: <b className="text-slate-200">{fmtMode(dataSyncHealth?.catchUp?.phase)}</b>
            </div>
          </div>
          <div className="space-y-2 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Indexer Run</div>
            <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${staleToneClass(dataSyncHealth?.indexer?.run?.stale)}`}>
              {dataSyncHealth?.indexer?.run?.stale ? "stale" : "fresh"}
            </div>
            <div className="text-sm text-gray-400">
              Age: <b className="text-slate-200">{fmtAge(dataSyncHealth?.indexer?.run?.runCompletedAgeMs)}</b>
            </div>
          </div>
        </div>

        {canSeePrivateDiagnostics ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Indexer / Storage</div>
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div>Network: <b>{dataSyncHealth?.env?.network ?? "..."}</b></div>
              <div>Deploy block: <b>{dataSyncHealth?.env?.deployBlock ?? "..."}</b></div>
              <div>Current epoch meta: <b>{fmtNumber(dataSyncHealth?.storage?.currentEpochMeta)}</b></div>
              <div>Last indexed block: <b>{dataSyncHealth?.storage?.lastIndexedBlock ?? "null"}</b></div>
              <div>Repair cursor: <b>{dataSyncHealth?.storage?.repairCursorBlock ?? "null"}</b></div>
              <div>Lag blocks: <b>{fmtNumber(dataSyncHealth?.storage?.lagBlocks)}</b></div>
              <div>Head block: <b>{opsData?.storage.headBlock ?? dataSyncHealth?.storage?.headBlock ?? "..."}</b></div>
              <div>Finality blocks: <b>{opsData?.storage.finalityBlocks ?? dataSyncHealth?.env?.indexerFinalityBlocks ?? "..."}</b></div>
              <div>Finality target: <b>{opsData?.storage.targetBlock ?? dataSyncHealth?.storage?.finalityTargetBlock ?? "..."}</b></div>
              <div>Lag to finality target: <b>{fmtNumber(dataSyncHealth?.storage?.lagToFinalityTargetBlocks)}</b></div>
              <div>Disk free: <b>{fmtGib(dataSyncHealth?.storage?.diskFreeBytes)}</b></div>
              <div>Last processed run: <b>{opsData?.storage.lastProcessedBlock ?? "..."}</b></div>
              <div>Stored epochs: <b>{fmtNumber(dataSyncHealth?.epochs?.storedCount)}</b></div>
              <div>Missing epochs: <b>{fmtNumber(dataSyncHealth?.epochs?.missingCount)}</b></div>
              <div>Latest stored epoch: <b>{fmtNumber(dataSyncHealth?.epochs?.latestStoredEpoch)}</b></div>
              <div>Contiguous epoch: <b>{fmtNumber(dataSyncHealth?.epochs?.highestContiguousEpoch)}</b></div>
            </div>
            {dataSyncHealth?.epochs?.missingLatest?.length ? (
              <div className="rounded border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                Missing latest epochs: {dataSyncHealth.epochs.missingLatest.join(", ")}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Serving Modes</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded border border-white/10 bg-black/20 p-3">
                <div className="text-xs uppercase tracking-wider text-gray-400">Jackpots</div>
                <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${modeToneClass(dataSyncHealth?.jackpots?.servingMode)}`}>
                  {fmtMode(dataSyncHealth?.jackpots?.servingMode)}
                </div>
                <div className="text-sm">Stored: <b>{fmtNumber(dataSyncHealth?.jackpots?.totalStored)}</b></div>
                <div className="text-sm">Latest daily in DB: <b>{String(Boolean(dataSyncHealth?.jackpots?.hasLatestDailyInDb))}</b></div>
                <div className="text-sm">Latest weekly in DB: <b>{String(Boolean(dataSyncHealth?.jackpots?.hasLatestWeeklyInDb))}</b></div>
              </div>
              <div className="space-y-2 rounded border border-white/10 bg-black/20 p-3">
                <div className="text-xs uppercase tracking-wider text-gray-400">Recent Wins</div>
                <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${modeToneClass(dataSyncHealth?.recentWins?.servingMode)}`}>
                  {fmtMode(dataSyncHealth?.recentWins?.servingMode)}
                </div>
                <div className="text-sm">Stored: <b>{fmtNumber(dataSyncHealth?.recentWins?.totalStored)}</b></div>
                <div className="text-sm">Lag to head: <b>{fmtNumber(dataSyncHealth?.recentWins?.lagToHeadBlocks)}</b></div>
                <div className="text-sm">Lag to indexer: <b>{fmtNumber(dataSyncHealth?.recentWins?.lagToIndexerBlocks)}</b></div>
              </div>
            </div>
          </div>
        </div>
        ) : null}

        <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
          <div className="text-xs uppercase tracking-wider text-gray-400">Catch-Up Progress</div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>Blocks indexed</span>
              <b>{fmtPercent(dataSyncHealth?.catchUp?.blockProgressPct)}</b>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-sky-400 transition-[width] duration-500" style={{ width: `${blockProgressWidth}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>Resolved epoch coverage</span>
              <b>{fmtPercent(dataSyncHealth?.catchUp?.epochCoveragePct)}</b>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${epochProgressWidth}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>Contiguous coverage</span>
              <b>{fmtPercent(dataSyncHealth?.catchUp?.contiguousEpochCoveragePct)}</b>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-violet-400 transition-[width] duration-500" style={{ width: `${contiguousProgressWidth}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
            <div className="rounded border border-white/10 bg-black/20 p-2">
              Block rate: <b>{fmtNumber(dataSyncHealth?.catchUp?.blockRatePerMinute)}</b>/min
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-2">
              Epoch rate: <b>{fmtNumber(dataSyncHealth?.catchUp?.epochRatePerMinute)}</b>/min
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-2">
              ETA: <b>{fmtAge((dataSyncHealth?.catchUp?.estimatedMinutesToHead ?? null) != null ? (dataSyncHealth?.catchUp?.estimatedMinutesToHead ?? 0) * 60_000 : null)}</b>
            </div>
          </div>
        </div>

        {canSeePrivateDiagnostics ? (
        <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-wider text-gray-400">Hot Routes</div>
            <div className="text-xs text-gray-500">fast view for the routes that matter most to UX</div>
          </div>
          {hotRoutes.length === 0 ? (
            <div className="text-sm text-gray-400">No hot-route metrics recorded yet.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {hotRoutes.map(({ route, label, metric, cachePct, errorPct }) => (
                <div key={route} className={`space-y-2 rounded border p-3 text-sm ${routePerfToneClass(metric)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{label}</div>
                      <div className="font-mono text-[11px] text-sky-300">{route}</div>
                    </div>
                    <div className="text-right text-xs text-slate-300">
                      <div>avg <b>{metric.avgLatencyMs}ms</b></div>
                      <div>max <b>{metric.maxLatencyMs}ms</b></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 md:grid-cols-4">
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      req <b>{fmtNumber(metric.requests)}</b>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      cache <b>{fmtPct(cachePct)}</b>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      err <b>{fmtPct(errorPct)}</b>
                    </div>
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      inflight <b>{fmtNumber(metric.inflight)}</b>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        ) : null}

        {canSeePrivateDiagnostics ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Heartbeat</div>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="rounded border border-white/10 bg-black/20 p-3">
                Last completed run: <b>{fmtAge(dataSyncHealth?.indexer?.run?.runCompletedAgeMs)}</b> | logs <b>{fmtNumber(dataSyncHealth?.indexer?.run?.totalLogs)}</b>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-3">
                Repair: <b>{fmtAge(dataSyncHealth?.indexer?.repair?.ageMs)}</b> | repaired <b>{fmtNumber(dataSyncHealth?.indexer?.repair?.repairedLogs)}</b>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-3">
                Reconcile: <b>{fmtAge(dataSyncHealth?.indexer?.reconcile?.ageMs)}</b> | missing <b>{fmtNumber(dataSyncHealth?.indexer?.reconcile?.missingEpochs)}</b>
              </div>
            </div>
            {opsData?.liveIndexer ? (
              <div className="space-y-3 rounded border border-sky-500/20 bg-sky-500/10 p-3 text-sm text-sky-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-sky-200">Live Catch-Up</div>
                  <div className="text-xs">
                    chunk <b>{fmtNumber(opsData.liveIndexer.chunkIndex)}</b> / <b>{fmtNumber(opsData.liveIndexer.chunkTotal)}</b>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>
                    Scan range: <b>{opsData.liveIndexer.scanFromBlock ?? "..."}</b> {"->"} <b>{opsData.liveIndexer.scanToBlock ?? "..."}</b>
                  </div>
                  <div>
                    Chunk range: <b>{opsData.liveIndexer.chunkFromBlock ?? "..."}</b> {"->"} <b>{opsData.liveIndexer.chunkToBlock ?? "..."}</b>
                  </div>
                  <div>
                    Logs fetched: <b>{fmtNumber(opsData.liveIndexer.fetchedLogs)}</b>
                  </div>
                  <div>
                    Parsed: <b>{fmtNumber(opsData.liveIndexer.parsedBets)}</b> bets / <b>{fmtNumber(opsData.liveIndexer.parsedEpochs)}</b> epochs / <b>{fmtNumber(opsData.liveIndexer.parsedJackpots)}</b> jackpots / <b>{fmtNumber(opsData.liveIndexer.parsedClaims)}</b> claims
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs text-sky-200">
                    <span>Chunk progress</span>
                    <span>{fmtPercent(opsData.liveIndexer.progressPct)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-sky-400 transition-[width] duration-500"
                      style={{ width: `${Math.max(0, Math.min(100, opsData.liveIndexer.progressPct ?? 0))}%` }}
                    />
                  </div>
                </div>
                <div className="text-xs text-sky-200/90">
                  {opsData.liveIndexer.wroteChunk
                    ? "The current chunk has already been written to SQLite."
                    : "The current chunk is still in flight and has not been written to SQLite yet."}
                </div>
              </div>
            ) : null}
            {visibleDataSyncHints.length ? (
              <div className="space-y-1 rounded border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                {visibleDataSyncHints.map((hint) => (
                  <div key={hint}>{hint}</div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Hot API Runtime</div>
            {runtimeMetricRows.length === 0 ? (
              <div className="text-sm text-gray-400">No runtime metrics recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {runtimeMetricRows.map(([route, metric]) => (
                  <div key={route} className="space-y-1 rounded border border-white/10 bg-black/20 p-3 text-sm">
                    <div className="font-mono text-xs text-sky-300">{route}</div>
                    <div>req {metric.requests} | ok {metric.successes} | err {metric.errors} | inflight {metric.inflight}</div>
                    <div>cache {metric.cacheHits} | stale {metric.staleServed} | join {metric.inflightJoined} | bg {metric.backgroundRefreshes}</div>
                    <div>avg {metric.avgLatencyMs}ms | max {metric.maxLatencyMs}ms | last {metric.lastStatus ?? "n/a"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        ) : null}

        {canSeePrivateDiagnostics ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {opsData?.logSources.map((source) => (
            <div key={source.key} className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
              {(() => {
                const processKey = source.key === "bot" || source.key === "indexer" ? source.key : null;
                const processState = processKey ? processStates?.[processKey] ?? null : null;
                return (
                  <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-wider text-gray-400">{source.label}</div>
                <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${logSourceToneClass(source.status)}`}>
                  {source.status}
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div>Age: <b>{fmtAge(source.ageMs)}</b></div>
                <div>Lines: <b>{fmtNumber(source.lineCount)}</b></div>
                {processState ? (
                  <div>
                    Process: <b>{processState.running ? "running" : "stopped"}</b>
                    {processState.pid ? <> | PID <b>{fmtNumber(processState.pid)}</b></> : null}
                  </div>
                ) : null}
                <div className="text-xs text-gray-500">{source.fileName}</div>
              </div>
              {isLocalHost && processKey ? (
                <button
                  type="button"
                  disabled={processActionBusy !== null || Boolean(processState?.running)}
                  onClick={() => void handleStartProcess(processKey)}
                  className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
                >
                  {processActionBusy === processKey
                    ? "Starting"
                    : processKey === "bot"
                      ? "Start keeper"
                      : "Start indexer"}
                </button>
              ) : null}
              <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-gray-300">
                {source.lastLine ? source.lastLine : "No log lines yet."}
              </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
        ) : null}

        {canSeePrivateDiagnostics ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-wider text-gray-400">Recent Errors</div>
              <div className="text-xs text-gray-500">{opsLoading ? "loading..." : `${opsData?.recentErrors.length ?? 0} items`}</div>
            </div>
            <div className="space-y-2">
              {(opsData?.recentErrors.length ?? 0) === 0 ? (
                <div className="rounded border border-white/10 bg-black/20 p-3 text-sm text-gray-400">
                  No recent error lines found in local logs.
                </div>
              ) : (
                opsData?.recentErrors.map((entry, index) => (
                  <div key={`${entry.source}-${entry.ts ?? index}-${index}`} className="rounded border border-red-500/20 bg-red-500/10 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-xs text-red-200">
                      <span>{entry.source}</span>
                      <span>{entry.ts ? new Date(entry.ts).toLocaleString() : "no timestamp"}</span>
                    </div>
                    <div className="mt-1 text-red-100">{entry.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-wider text-gray-400">Recent Events</div>
              <div className="text-xs text-gray-500">{opsLoading ? "loading..." : `${opsData?.recentEvents.length ?? 0} items`}</div>
            </div>
            <div className="space-y-2">
              {(opsData?.recentEvents.length ?? 0) === 0 ? (
                <div className="rounded border border-white/10 bg-black/20 p-3 text-sm text-gray-400">
                  No recent event lines found in local logs.
                </div>
              ) : (
                opsData?.recentEvents.map((entry, index) => (
                  <div key={`${entry.source}-${entry.ts ?? index}-event-${index}`} className="rounded border border-white/10 bg-black/20 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
                      <span>{entry.source}</span>
                      <span>{entry.ts ? new Date(entry.ts).toLocaleString() : "no timestamp"}</span>
                    </div>
                    <div className="mt-1 text-slate-200">{entry.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        ) : null}

        {canSeePrivateDiagnostics ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Latest Resolved Epochs</div>
            <div className="space-y-2">
              {opsData?.recentResolvedEpochs.map((row) => (
                <div key={row.epoch} className="rounded border border-white/10 bg-black/20 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>Epoch <b>#{fmtNumber(row.epoch)}</b></div>
                    <div className="text-xs text-gray-400">Tile <b>{fmtNumber(row.winningTile)}</b></div>
                  </div>
                  <div className="mt-1 text-gray-300">
                    Pool <b>{row.totalPool}</b> | Reward <b>{row.rewardPool}</b>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Block {row.resolvedBlock ?? "unknown"}
                    {row.isDailyJackpot ? " | daily jackpot" : ""}
                    {row.isWeeklyJackpot ? " | weekly jackpot" : ""}
                  </div>
                </div>
              )) ?? null}
            </div>
          </div>

          <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-400">Jackpots / Reward Claims</div>
            <div className="rounded border border-sky-500/20 bg-sky-500/10 p-3 text-sm text-sky-100">
              This is historical jackpot history across many epochs. Daily jackpot can trigger at most once per UTC day, so several
              daily rows here simply mean this list spans multiple days.
            </div>
            <div className="space-y-2">
              {opsData?.recentJackpots.map((row, index) => (
                <div key={`${row.kind}-${row.epoch}-${index}`} className="rounded border border-violet-500/20 bg-violet-500/10 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>{row.kind} jackpot</div>
                    <div>Epoch <b>#{row.epoch}</b></div>
                  </div>
                  <div className="mt-1 text-violet-100">Amount <b>{row.amount}</b></div>
                  <div className="mt-1 text-xs text-violet-200/80">Block {row.blockNumber}</div>
                </div>
              )) ?? null}
              {opsData?.recentRewardClaims.slice(0, 3).map((row, index) => (
                <div key={`${row.txHash}-${index}`} className="rounded border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>Reward claim</div>
                    <div>Epoch <b>#{row.epoch}</b></div>
                  </div>
                  <div className="mt-1 text-emerald-100">
                    {shortenAddress(row.user)} claimed <b>{row.reward}</b>
                  </div>
                </div>
              )) ?? null}
            </div>
          </div>
        </div>
        ) : null}

        {canSeePrivateDiagnostics ? (
        <div className="space-y-3 rounded border border-white/10 bg-white/2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400">Diagnostics Snapshot</div>
              <div className="mt-1 text-sm text-gray-400">
                One copy-paste payload for debugging incidents quickly.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleCopySnapshot()}
              className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100 hover:bg-sky-500/20"
            >
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy snapshot"}
            </button>
          </div>
          <textarea
            readOnly
            value={diagnosticsSnapshot}
            className="min-h-64 w-full rounded border border-white/10 bg-black/30 p-3 font-mono text-xs text-slate-200 outline-none"
          />
        </div>
        ) : null}
      </div>
    </main>
  );
}
