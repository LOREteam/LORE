"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_HAS_REBATE_API,
  GAME_ABI,
  TX_RECEIPT_TIMEOUT_MS,
} from "../lib/constants";
import { readJsonResponse } from "../lib/readJsonResponse";
import { delay, isUserRejection } from "../lib/utils";
import { log } from "../lib/logger";

type SilentSendFn = (tx: {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
}) => Promise<`0x${string}`>;

interface UseRebateOptions {
  enabled?: boolean;
  active?: boolean;
  isPageVisible?: boolean;
  preferredAddress?: `0x${string}` | string | null;
  sendTransactionSilent?: SilentSendFn;
  onNotify?: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
}

interface RebateEpochInfo {
  epoch: number;
  pendingWei: bigint;
  pending: string;
  claimed: boolean;
  resolved: boolean;
  userVolumeWei: bigint;
  rebatePoolWei: bigint;
}

type ClaimPlanKind = "none" | "single" | "split" | "unknown";

interface ApiRebateEpochInfo {
  epoch: number;
  pendingWei: string;
  pending: string;
  claimed: boolean;
  resolved: boolean;
  userVolumeWei: string;
  rebatePoolWei: string;
}

interface ApiRebatePayload {
  isSupported: boolean;
  pendingRebateWei: string;
  claimableEpochCount: number;
  claimableEpochList: number[];
  totalEpochs: number;
  participatingEpochs: number[];
  recentEpochs: ApiRebateEpochInfo[];
  error?: string;
}

type CachedRebateInfo = Omit<ApiRebatePayload, "error"> & { cachedAt: number };

const GAS_CLAIM_REBATES = BigInt(1_200_000);
const REBATE_EXACT_CHUNK_SIZE = 48;
const CLAIM_GAS_HEADROOM_BPS = 1_200n;
const CLAIM_GAS_BUFFER = 80_000n;
const REBATE_CLIENT_CACHE_TTL_MS = 60_000;
const REBATE_CLIENT_CACHE_DISPLAY_TTL_MS = 12 * 60 * 60 * 1000;
const REBATE_REFRESH_MS = 30_000;
const REBATE_HIDDEN_REFRESH_MS = 120_000;
const REBATE_WARM_REFRESH_MS = 90_000;
const CLAIM_PLAN_CACHE_TTL_MS = 60_000;
const REBATE_CONFIRM_POLL_INTERVAL_MS = 2_000;
const REBATE_CONFIRM_ATTEMPTS = Math.max(1, Math.floor(TX_RECEIPT_TIMEOUT_MS / REBATE_CONFIRM_POLL_INTERVAL_MS));

function getRebateCacheKey(address: string) {
  return `lore:rebate:v1:${address.toLowerCase()}`;
}

function getClaimPlanCacheKey(address: string, epochs: number[]) {
  return `lore:rebate-claim-plan:v1:${address.toLowerCase()}:${epochs.join(",")}`;
}

function loadCachedRebatePayload(address: string): CachedRebateInfo | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(getRebateCacheKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRebateInfo;
    if (!parsed || typeof parsed.cachedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedRebatePayload(address: string, payload: ApiRebatePayload) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getRebateCacheKey(address),
      JSON.stringify({
        ...payload,
        cachedAt: Date.now(),
      } satisfies CachedRebateInfo),
    );
  } catch {
    // ignore storage failures
  }
}

function loadCachedClaimPlan(address: string, epochs: number[]): { kind: ClaimPlanKind; savedAt: number } | null {
  if (typeof localStorage === "undefined" || epochs.length === 0) return null;
  try {
    const raw = localStorage.getItem(getClaimPlanCacheKey(address, epochs));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: ClaimPlanKind; savedAt?: number };
    if (
      (parsed.kind === "single" || parsed.kind === "split" || parsed.kind === "unknown" || parsed.kind === "none")
      && typeof parsed.savedAt === "number"
      && Number.isFinite(parsed.savedAt)
    ) {
      return { kind: parsed.kind, savedAt: parsed.savedAt };
    }
    return null;
  } catch {
    return null;
  }
}

function saveCachedClaimPlan(address: string, epochs: number[], kind: ClaimPlanKind) {
  if (typeof localStorage === "undefined" || epochs.length === 0) return;
  try {
    localStorage.setItem(
      getClaimPlanCacheKey(address, epochs),
      JSON.stringify({ kind, savedAt: Date.now() }),
    );
  } catch {
    // ignore storage failures
  }
}

function isMissingContractMethodError(err: unknown, methodName: string) {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const quotedMethod = `function "${methodName.toLowerCase()}"`;
  return (
    msg.includes(`${quotedMethod} returned no data`) ||
    msg.includes(`${quotedMethod} is not in the abi`) ||
    msg.includes(`does not have the function "${methodName.toLowerCase()}"`) ||
    msg.includes("returned no data (\"0x\")")
  );
}

async function loadClaimableEpochsExact(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  address: `0x${string}`,
  epochs: bigint[],
): Promise<number[]> {
  const claimable = new Set<number>();

  for (let i = 0; i < epochs.length; i += REBATE_EXACT_CHUNK_SIZE) {
    const chunk = epochs.slice(i, i + REBATE_EXACT_CHUNK_SIZE);
    const contracts = chunk.map((epoch) => ({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "getRebateInfo" as const,
      args: [epoch, address] as const,
    }));

    try {
      const results = await publicClient.multicall({ contracts });
      results.forEach((result, index) => {
        if (result.status !== "success") return;
        const [, , pendingWei, claimed, resolved] = result.result as [
          bigint,
          bigint,
          bigint,
          boolean,
          boolean,
        ];
        if (pendingWei > 0n && !claimed && resolved) {
          claimable.add(Number(chunk[index]));
        }
      });
    } catch (err) {
      log.warn("Rebate", "exact claimable multicall failed, falling back to per-epoch reads", err);
      for (const epoch of chunk) {
        try {
          const result = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "getRebateInfo",
            args: [epoch, address],
          })) as [bigint, bigint, bigint, boolean, boolean];
          const [, , pendingWei, claimed, resolved] = result;
          if (pendingWei > 0n && !claimed && resolved) {
            claimable.add(Number(epoch));
          }
        } catch (readErr) {
          log.warn("Rebate", "exact claimable epoch read failed", { epoch: Number(epoch), err: readErr });
        }
      }
    }
  }

  return [...claimable].sort((a, b) => b - a);
}

function parseApiEpochInfo(row: ApiRebateEpochInfo): RebateEpochInfo {
  return {
    epoch: row.epoch,
    pendingWei: BigInt(row.pendingWei),
    pending: row.pending,
    claimed: row.claimed,
    resolved: row.resolved,
    userVolumeWei: BigInt(row.userVolumeWei),
    rebatePoolWei: BigInt(row.rebatePoolWei),
  };
}

function recentRebateEpochsEqual(left: ApiRebateEpochInfo[], right: ApiRebateEpochInfo[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.epoch !== b.epoch ||
      a.pendingWei !== b.pendingWei ||
      a.pending !== b.pending ||
      a.claimed !== b.claimed ||
      a.resolved !== b.resolved ||
      a.userVolumeWei !== b.userVolumeWei ||
      a.rebatePoolWei !== b.rebatePoolWei
    ) {
      return false;
    }
  }
  return true;
}

function rebatePayloadEqual(left: ApiRebatePayload | null, right: ApiRebatePayload) {
  if (!left) return false;
  if (
    left.isSupported !== right.isSupported ||
    left.pendingRebateWei !== right.pendingRebateWei ||
    left.claimableEpochCount !== right.claimableEpochCount ||
    left.totalEpochs !== right.totalEpochs ||
    left.claimableEpochList.length !== right.claimableEpochList.length ||
    left.participatingEpochs.length !== right.participatingEpochs.length
  ) {
    return false;
  }
  for (let index = 0; index < left.claimableEpochList.length; index += 1) {
    if (left.claimableEpochList[index] !== right.claimableEpochList[index]) return false;
  }
  for (let index = 0; index < left.participatingEpochs.length; index += 1) {
    if (left.participatingEpochs[index] !== right.participatingEpochs[index]) return false;
  }
  return recentRebateEpochsEqual(left.recentEpochs, right.recentEpochs);
}

export function useRebate(options?: UseRebateOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [isClaiming, setIsClaiming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [rebateEpochs, setRebateEpochs] = useState<number[]>([]);
  const [claimableEpochs, setClaimableEpochs] = useState<number[]>([]);
  const [claimableEpochCount, setClaimableEpochCount] = useState(0);
  const [pendingRebateWei, setPendingRebateWei] = useState(0n);
  const [details, setDetails] = useState<RebateEpochInfo[]>([]);
  const [isSupported, setIsSupported] = useState(CONTRACT_HAS_REBATE_API);
  const [claimPlanKind, setClaimPlanKind] = useState<ClaimPlanKind>("none");
  const [isEstimatingClaimPlan, setIsEstimatingClaimPlan] = useState(false);
  const [payloadVersion, setPayloadVersion] = useState(0);
  const enabled = options?.enabled ?? true;
  const active = options?.active ?? enabled;
  const isPageVisible = options?.isPageVisible ?? true;
  const notify = options?.onNotify;
  const silentSend = options?.sendTransactionSilent;
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const cacheSavedAtRef = useRef<number | null>(null);
  const rebateUnavailableWarningRef = useRef(false);
  const mountedRef = useRef(false);
  const lastPayloadRef = useRef<ApiRebatePayload | null>(null);
  const cachedPayloadRef = useRef<Record<string, CachedRebateInfo | null>>({});
  const claimPlanCacheRef = useRef<Record<string, { kind: ClaimPlanKind; savedAt: number } | null>>({});
  const exactAttemptVersionRef = useRef<number | null>(null);
  const rebateAddress = useMemo(() => {
    const candidate = options?.preferredAddress ?? address;
    if (!candidate) return null;
    try {
      return getAddress(candidate);
    } catch {
      return null;
    }
  }, [address, options?.preferredAddress]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const resetState = useCallback(() => {
    if (!mountedRef.current) return;
    setRebateEpochs([]);
    setClaimableEpochs([]);
    setClaimableEpochCount(0);
    setPendingRebateWei(0n);
    setDetails([]);
    setIsSupported(CONTRACT_HAS_REBATE_API);
    setClaimPlanKind("none");
    setIsEstimatingClaimPlan(false);
    setIsLoading(false);
    setHasLoaded(false);
    setPayloadVersion(0);
    hasLoadedRef.current = false;
    lastPayloadRef.current = null;
    exactAttemptVersionRef.current = null;
  }, []);

  const applyPayload = useCallback((payload: ApiRebatePayload) => {
    if (!mountedRef.current) return false;
    const changed = !rebatePayloadEqual(lastPayloadRef.current, payload);
    lastPayloadRef.current = payload;
    if (!changed) {
      setHasLoaded(true);
      return false;
    }
    setIsSupported(payload.isSupported);
    setRebateEpochs(payload.participatingEpochs);
    setClaimableEpochs(payload.claimableEpochList);
    setClaimableEpochCount(payload.claimableEpochCount);
    setPendingRebateWei(BigInt(payload.pendingRebateWei || "0"));
    setDetails(payload.recentEpochs.map(parseApiEpochInfo).sort((a, b) => b.epoch - a.epoch));
    setHasLoaded(true);
    setPayloadVersion((current) => current + 1);
    return true;
  }, []);

  const primeFromDisplayCache = useCallback((targetAddress: string) => {
    if (hasLoadedRef.current) return false;
    const cached =
      cachedPayloadRef.current[targetAddress] ??
      (cachedPayloadRef.current[targetAddress] = loadCachedRebatePayload(targetAddress));
    if (!cached || Date.now() - cached.cachedAt >= REBATE_CLIENT_CACHE_DISPLAY_TTL_MS) {
      return false;
    }
    applyPayload(cached);
    hasLoadedRef.current = true;
    cacheSavedAtRef.current = cached.cachedAt;
    return true;
  }, [applyPayload]);

  const readClaimPlanCache = useCallback((targetAddress: string, epochs: number[]) => {
    const cacheKey = getClaimPlanCacheKey(targetAddress, epochs);
    if (Object.prototype.hasOwnProperty.call(claimPlanCacheRef.current, cacheKey)) {
      return claimPlanCacheRef.current[cacheKey];
    }
    const cached = loadCachedClaimPlan(targetAddress, epochs);
    claimPlanCacheRef.current[cacheKey] = cached;
    return cached;
  }, []);

  const writeClaimPlanCache = useCallback((targetAddress: string, epochs: number[], kind: ClaimPlanKind) => {
    const cached = { kind, savedAt: Date.now() };
    claimPlanCacheRef.current[getClaimPlanCacheKey(targetAddress, epochs)] = cached;
    saveCachedClaimPlan(targetAddress, epochs, kind);
  }, []);

  const formatRebateError = useCallback((err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    const low = msg.toLowerCase();
    if (low.includes("notresolved")) return "Rebate is not claimable yet because the epoch is not resolved.";
    if (low.includes("rebatealreadyclaimed")) return "One of the selected rebate epochs was already claimed.";
    if (low.includes("norebateavailable") || low.includes("nothing to claim")) {
      return "No rebate is currently claimable for the selected epochs.";
    }
    if (low.includes("emptyarray")) return "No rebate epochs were selected for claim.";
    return msg;
  }, []);

  const confirmClaimBatch = useCallback(
    async (hash: `0x${string}`, sender: `0x${string}`, epochArgs: bigint[]) => {
      if (!publicClient) return;

      for (let attempt = 0; attempt < REBATE_CONFIRM_ATTEMPTS; attempt += 1) {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            throw new Error(`Transaction reverted: ${hash}`);
          }
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
          const missingReceipt =
            message.includes("could not be found") ||
            message.includes("not found");
          if (!missingReceipt) {
            throw err;
          }
        }

        const remainingEpochs = await loadClaimableEpochsExact(publicClient, sender, epochArgs);
        if (remainingEpochs.length === 0) {
          return;
        }

        await delay(REBATE_CONFIRM_POLL_INTERVAL_MS);
      }

      throw new Error(
        `Rebate claim confirmation timed out after ${TX_RECEIPT_TIMEOUT_MS}ms. Refresh the rebate tab in a few seconds.`,
      );
    },
    [publicClient],
  );

  const refetchRebateInfo = useCallback(async (options?: { forceFresh?: boolean; includeExact?: boolean }) => {
    if (!enabled || !rebateAddress) {
      resetState();
      return false;
    }

    if (!CONTRACT_HAS_REBATE_API) {
      if (!rebateUnavailableWarningRef.current) {
        rebateUnavailableWarningRef.current = true;
        log.info("Rebate", "disabled for legacy contract profile");
      }
      if (mountedRef.current) {
        setIsSupported(false);
        setIsLoading(false);
        setRebateEpochs([]);
        setClaimableEpochs([]);
        setClaimableEpochCount(0);
        setPendingRebateWei(0n);
        setDetails([]);
      }
      hasLoadedRef.current = true;
      if (mountedRef.current) {
        setHasLoaded(true);
      }
      return true;
    }

    const requestId = ++requestIdRef.current;
    primeFromDisplayCache(rebateAddress);

    if (!hasLoadedRef.current) {
      if (mountedRef.current) {
        setIsLoading(true);
      }
    }

    try {
      const query = new URLSearchParams({ user: rebateAddress.toLowerCase() });
      if (options?.forceFresh) query.set("refresh", String(Date.now()));
      if (options?.includeExact) query.set("exact", "1");
      const response = await fetch(`/api/rebates?${query.toString()}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<ApiRebatePayload>(response);

      if (!payload) {
        throw new Error(`Empty response from /api/rebates (HTTP ${response.status})`);
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      if (requestId !== requestIdRef.current) return;

      const changed = applyPayload(payload);
      const fetchedAt = Date.now();
      hasLoadedRef.current = true;
      if (mountedRef.current) {
        setHasLoaded(true);
      }
      cacheSavedAtRef.current = fetchedAt;
      if (changed || !cachedPayloadRef.current[rebateAddress]) {
        const cachedPayload = {
          ...payload,
          cachedAt: fetchedAt,
        } satisfies CachedRebateInfo;
        cachedPayloadRef.current[rebateAddress] = cachedPayload;
        saveCachedRebatePayload(rebateAddress, payload);
      }
      return true;
    } catch (err) {
      if (
        isMissingContractMethodError(err, "getRebateSummary") ||
        isMissingContractMethodError(err, "getRebateInfo") ||
        isMissingContractMethodError(err, "claimEpochsRebate")
      ) {
        if (!rebateUnavailableWarningRef.current) {
          rebateUnavailableWarningRef.current = true;
          log.info("Rebate", "rebate methods unavailable for current contract profile");
        }
        if (mountedRef.current) {
          setIsSupported(false);
        }
      } else {
        log.warn("Rebate", "refetch failed", err);
      }

      if (!hasLoadedRef.current) {
        if (mountedRef.current) {
          setRebateEpochs([]);
          setClaimableEpochs([]);
          setClaimableEpochCount(0);
          setPendingRebateWei(0n);
          setDetails([]);
          setHasLoaded(false);
        }
      }
      return false;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyPayload, enabled, primeFromDisplayCache, rebateAddress, resetState]);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!enabled) {
      resetState();
      return;
    }

    if (!rebateAddress) return;

    primeFromDisplayCache(rebateAddress);

    const pollMs = active
      ? (isPageVisible ? REBATE_REFRESH_MS : REBATE_HIDDEN_REFRESH_MS)
      : REBATE_WARM_REFRESH_MS;
    const savedAt = cacheSavedAtRef.current;
    const initialDelay =
      savedAt && Date.now() - savedAt < REBATE_CLIENT_CACHE_TTL_MS
        ? REBATE_CLIENT_CACHE_TTL_MS - (Date.now() - savedAt)
        : 0;
    let cancelled = false;

    const schedule = (delayMs: number) => {
      timeoutRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        await refetchRebateInfo();
        if (cancelled) return;
        schedule(pollMs);
      }, delayMs);
    };

    schedule(initialDelay);
    return () => {
      cancelled = true;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [active, enabled, isPageVisible, primeFromDisplayCache, rebateAddress, refetchRebateInfo, resetState]);

  useEffect(() => {
    if (!enabled || !active || !isPageVisible || !rebateAddress) return;
    if (!hasLoaded || isLoading || !isSupported) return;
    if (claimableEpochCount <= 0 || claimableEpochs.length > 0) return;
    if (payloadVersion === 0 || exactAttemptVersionRef.current === payloadVersion) return;
    exactAttemptVersionRef.current = payloadVersion;
    void refetchRebateInfo({ includeExact: true }).then((ok) => {
      if (!ok && exactAttemptVersionRef.current === payloadVersion) {
        exactAttemptVersionRef.current = null;
      }
    });
  }, [
    active,
    claimableEpochCount,
    claimableEpochs.length,
    enabled,
    hasLoaded,
    isLoading,
    isPageVisible,
    isSupported,
    payloadVersion,
    rebateAddress,
    refetchRebateInfo,
  ]);

  useEffect(() => {
    if (!enabled || !CONTRACT_HAS_REBATE_API) {
      if (mountedRef.current) {
        setClaimPlanKind("none");
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (!rebateAddress || !publicClient) {
      if (mountedRef.current) {
        setClaimPlanKind("unknown");
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (claimableEpochs.length === 0) {
      if (mountedRef.current) {
        setClaimPlanKind("none");
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (!active || !isPageVisible) {
      if (mountedRef.current) {
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    let cancelled = false;
    const epochArgs = claimableEpochs.map((epoch) => BigInt(epoch));
    const cachedPlan = readClaimPlanCache(rebateAddress, claimableEpochs);
    if (cachedPlan && Date.now() - cachedPlan.savedAt < CLAIM_PLAN_CACHE_TTL_MS) {
      if (mountedRef.current) {
        setClaimPlanKind(cachedPlan.kind);
        setIsEstimatingClaimPlan(false);
      }
      return;
    }

    if (mountedRef.current) {
      setIsEstimatingClaimPlan(true);
    }
    void publicClient.estimateContractGas({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "claimEpochsRebate",
      args: [epochArgs],
      account: rebateAddress,
    }).then(() => {
      if (cancelled) return;
      setClaimPlanKind("single");
      writeClaimPlanCache(rebateAddress, claimableEpochs, "single");
    }).catch(() => {
      if (cancelled) return;
      const fallbackKind = claimableEpochs.length > 1 ? "split" : "unknown";
      setClaimPlanKind(fallbackKind);
      writeClaimPlanCache(rebateAddress, claimableEpochs, fallbackKind);
    }).finally(() => {
      if (cancelled) return;
      setIsEstimatingClaimPlan(false);
    });

    return () => {
      cancelled = true;
    };
  }, [active, claimableEpochs, enabled, isPageVisible, publicClient, readClaimPlanCache, rebateAddress, writeClaimPlanCache]);

  const claimRebates = useCallback(async () => {
    if (!CONTRACT_HAS_REBATE_API || !rebateAddress || !publicClient || rebateEpochs.length === 0) return;
    if (mountedRef.current) {
      setIsClaiming(true);
    }

    let claimedEpochCount = 0;
    let claimTxCount = 0;
    let usedSplitFallback = false;

    try {
      const connected = address ? getAddress(address) : null;
      const sender = silentSend ? rebateAddress : connected;
      if (!sender) {
        notify?.("Connect a wallet to claim rebates.", "warning");
        return;
      }

      if (!silentSend && sender.toLowerCase() !== rebateAddress.toLowerCase()) {
        throw new Error(
          `Rebate claim sender mismatch. Rebate is loaded for ${rebateAddress}, but your connected wallet is ${sender}. Switch wallets or use the embedded wallet and try again.`,
        );
      }

      const candidateEpochs = claimableEpochs.length > 0 ? claimableEpochs : rebateEpochs;
      const verifiedClaimableEpochs = await loadClaimableEpochsExact(
        publicClient,
        sender,
        candidateEpochs.map((epoch) => BigInt(epoch)),
      );

      if (verifiedClaimableEpochs.length === 0) {
        await refetchRebateInfo({ forceFresh: true });
        notify?.("No claimable rebate epochs were found. Rebate state has been refreshed.", "info");
        return;
      }

      const estimateClaimGas = async (epochArgs: bigint[]) => {
        try {
          const estimated = await publicClient.estimateContractGas({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochsRebate",
            args: [epochArgs],
            account: sender,
          });
          return ((estimated * CLAIM_GAS_HEADROOM_BPS) / 1_000n) + CLAIM_GAS_BUFFER;
        } catch {
          return GAS_CLAIM_REBATES;
        }
      };

      const estimateSingleClaimGas = async (epoch: bigint) => {
        try {
          const estimated = await publicClient.estimateContractGas({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimEpochRebate",
            args: [epoch],
            account: sender,
          });
          return ((estimated * CLAIM_GAS_HEADROOM_BPS) / 1_000n) + CLAIM_GAS_BUFFER;
        } catch {
          return GAS_CLAIM_REBATES;
        }
      };

      const submitClaimBatch = async (epochArgs: bigint[]) => {
        const gas = await estimateClaimGas(epochArgs);

        if (silentSend) {
          const data = encodeFunctionData({
            abi: GAME_ABI,
            functionName: "claimEpochsRebate",
            args: [epochArgs],
          });
          const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
          claimTxCount += 1;
          await confirmClaimBatch(hash, sender, epochArgs);
          return;
        }

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimEpochsRebate",
          args: [epochArgs],
          chainId: APP_CHAIN_ID,
          gas,
        });
        claimTxCount += 1;
        await confirmClaimBatch(hash, sender, epochArgs);
      };

      const submitSingleClaim = async (epoch: bigint) => {
        const gas = await estimateSingleClaimGas(epoch);

        if (silentSend) {
          const data = encodeFunctionData({
            abi: GAME_ABI,
            functionName: "claimEpochRebate",
            args: [epoch],
          });
          const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas });
          claimTxCount += 1;
          await confirmClaimBatch(hash, sender, [epoch]);
          return;
        }

        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimEpochRebate",
          args: [epoch],
          chainId: APP_CHAIN_ID,
          gas,
        });
        claimTxCount += 1;
        await confirmClaimBatch(hash, sender, [epoch]);
      };

      const claimBatches = async (epochArgs: bigint[]): Promise<number> => {
        if (epochArgs.length === 0) return 0;

        const queue: bigint[][] =
          claimPlanKind === "split" && epochArgs.length > 1
            ? [
                epochArgs.slice(0, Math.ceil(epochArgs.length / 2)),
                epochArgs.slice(Math.ceil(epochArgs.length / 2)),
              ]
            : [epochArgs];

        if (queue.length > 1) {
          usedSplitFallback = true;
          notify?.("Rebate claim is being sent in multiple transactions. Please wait until all parts finish.", "info");
        }

        let localClaimedCount = 0;
        while (queue.length > 0) {
          const batch = queue.shift();
          if (!batch || batch.length === 0) continue;

          try {
            await submitClaimBatch(batch);
            localClaimedCount += batch.length;
          } catch (err) {
            if (batch.length === 1) {
              usedSplitFallback = true;
              log.warn("Rebate", "batch claim failed for single epoch, trying claimEpochRebate fallback", {
                epoch: Number(batch[0]),
                err,
              });
              await submitSingleClaim(batch[0]);
              localClaimedCount += 1;
              continue;
            }

            usedSplitFallback = true;
            const middle = Math.ceil(batch.length / 2);
            queue.unshift(batch.slice(middle));
            queue.unshift(batch.slice(0, middle));
          }
        }

        return localClaimedCount;
      };

      claimedEpochCount = await claimBatches(
        verifiedClaimableEpochs.map((epoch) => BigInt(epoch)),
      );

      log.info("Rebate", "claimed", {
        epochs: claimedEpochCount,
        txCount: claimTxCount,
        split: usedSplitFallback,
      });
      notify?.(
        claimedEpochCount === 1
          ? claimTxCount <= 1
            ? "Rebate claimed successfully in 1 transaction."
            : `Rebate claimed successfully in ${claimTxCount} transactions.`
          : claimTxCount <= 1
            ? `Claimed rebates for ${claimedEpochCount} epochs in 1 transaction.`
            : `Claimed rebates for ${claimedEpochCount} epochs in ${claimTxCount} transactions.`,
        "success",
      );
      await refetchRebateInfo({ forceFresh: true });
    } catch (err) {
      await refetchRebateInfo({ forceFresh: true });

      if (isUserRejection(err)) {
        log.warn("Rebate", "claim cancelled", err);
        if (claimedEpochCount > 0) {
          notify?.(
            `Claimed rebates for ${claimedEpochCount} epochs in ${claimTxCount} transaction${claimTxCount === 1 ? "" : "s"} before the remaining claim flow was cancelled.`,
            "warning",
          );
        }
      } else {
        log.error("Rebate", "claim failed", err);
        const message = formatRebateError(err);
        if (claimedEpochCount > 0) {
          notify?.(
            `Claimed rebates for ${claimedEpochCount} epochs in ${claimTxCount} transaction${claimTxCount === 1 ? "" : "s"}, but some epochs still failed: ${message}`,
            "warning",
          );
        } else {
          notify?.(`Rebate claim failed: ${message}`, "danger");
        }
      }
    } finally {
      if (mountedRef.current) {
        setIsClaiming(false);
      }
    }
  }, [
    address,
    claimPlanKind,
    claimableEpochs,
    formatRebateError,
    notify,
    publicClient,
    rebateAddress,
    rebateEpochs,
    refetchRebateInfo,
    silentSend,
    confirmClaimBatch,
    writeContractAsync,
  ]);

  const rebateInfo = useMemo(
    () => ({
      isSupported,
      pendingRebateWei,
      pendingRebate: formatUnits(pendingRebateWei, 18),
      claimableEpochs: claimableEpochCount,
      totalEpochs: rebateEpochs.length,
      recentEpochs: details,
      isLoading,
      hasLoaded,
      claimPlanKind,
      isEstimatingClaimPlan,
    }),
    [
      claimPlanKind,
      claimableEpochCount,
      details,
      hasLoaded,
      isEstimatingClaimPlan,
      isLoading,
      isSupported,
      pendingRebateWei,
      rebateEpochs.length,
    ],
  );

  return {
    rebateInfo,
    isClaiming,
    claimRebates,
    refetchRebateInfo,
  };
}
