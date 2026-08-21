"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { readJsonResponse } from "../lib/readJsonResponse";

export type UserActivityType =
  | "bet"
  | "reward_claim"
  | "reward_batch_claim"
  | "rebate_claim"
  | "rebate_batch_claim";

export interface UserActivityEntry {
  eventId: string;
  activityType: UserActivityType;
  epoch?: string;
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
}

interface ActivityPayload {
  rows?: unknown;
  hasMore?: unknown;
  nextCursor?: unknown;
  coverage?: unknown;
  indexedThroughBlock?: unknown;
  error?: unknown;
}

const ACTIVITY_LOAD_ERROR = "Indexed activity is temporarily unavailable. Refresh Analytics to retry.";
const ACTIVITY_TYPES = new Set<UserActivityType>([
  "bet", "reward_claim", "reward_batch_claim", "rebate_claim", "rebate_batch_claim",
]);

function parseEntry(value: unknown): UserActivityEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const eventId = typeof row.eventId === "string" ? row.eventId.toLowerCase() : "";
  const activityType = row.activityType as UserActivityType;
  const epoch = typeof row.epoch === "string" && /^[1-9]\d*$/.test(row.epoch) ? row.epoch : undefined;
  const amount = typeof row.amount === "string" && row.amount.length <= 128 ? row.amount : "";
  const amountNum = typeof row.amountNum === "number" && Number.isFinite(row.amountNum) ? row.amountNum : null;
  const txHash = typeof row.txHash === "string" ? row.txHash.toLowerCase() : "";
  const blockNumber = typeof row.blockNumber === "string" ? row.blockNumber : "";
  if (!/^(?:[1-9]\d*_0x[0-9a-f]{64}_\d+|0x[0-9a-f]{64}:\d+)$/.test(eventId) ||
    !ACTIVITY_TYPES.has(activityType) || !amount || amountNum === null ||
    !/^0x[0-9a-f]{64}$/.test(txHash) || !/^\d+$/.test(blockNumber)) return null;
  return { eventId, activityType, ...(epoch ? { epoch } : {}), amount, amountNum, txHash, blockNumber };
}

function normalizeWalletAddress(value: string | null | undefined) {
  try {
    return getAddress(value ?? "").toLowerCase();
  } catch {
    return null;
  }
}
export function createUserActivityRequestGuard() {
  let generation = 0;
  let activeAddress: string | null = null;
  const capture = () => ({ address: activeAddress, generation });
  return {
    activate(address: string | null) {
      activeAddress = address;
      generation += 1;
      return capture();
    },
    ensure(address: string | null) {
      if (activeAddress !== address) {
        activeAddress = address;
        generation += 1;
      }
      return capture();
    },
    capture,
    isCurrent(candidate: { address: string | null; generation: number }) {
      return candidate.generation === generation && candidate.address === activeAddress;
    },
  };
}

async function fetchActivity(address: string, cursor: string | null) {
  const params = new URLSearchParams({ user: address });
  if (cursor) params.set("cursor", cursor);
  const response = await fetchWithTimeout(`/api/activity?${params.toString()}`, { cache: "no-store" });
  const payload = await readJsonResponse<ActivityPayload>(response);
  if (!response.ok || !payload || typeof payload.error === "string") {
    throw new Error(`Activity request failed (HTTP ${response.status})`);
  }
  const rows = Array.isArray(payload.rows)
    ? payload.rows.map(parseEntry).filter((row): row is UserActivityEntry => row !== null)
    : null;
  if (rows === null || payload.coverage !== "partial") throw new Error("Activity response is invalid");
  return {
    rows,
    hasMore: payload.hasMore === true,
    nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null,
    indexedThroughBlock: typeof payload.indexedThroughBlock === "string" ? payload.indexedThroughBlock : "0",
  };
}

export function useUserActivityHistory(walletAddress?: string | null) {
  const address = normalizeWalletAddress(walletAddress);
  const [items, setItems] = useState<UserActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [indexedThroughBlock, setIndexedThroughBlock] = useState("0");
  const runningRef = useRef(false);
  const mountedRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);
  const requestGuardRef = useRef(createUserActivityRequestGuard());
  const activeRequest = requestGuardRef.current.ensure(address);
  const activeRequestAddress = activeRequest.address;
  const activeRequestGeneration = activeRequest.generation;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async (
    mode: "refresh" | "more",
    request = requestGuardRef.current.capture(),
  ) => {
    const cursor = nextCursorRef.current;
    if (!address || !requestGuardRef.current.isCurrent(request) ||
      runningRef.current || (mode === "more" && !cursor)) return;
    runningRef.current = true;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const payload = await fetchActivity(address, mode === "more" ? cursor : null);
      if (!mountedRef.current || !requestGuardRef.current.isCurrent(request)) return;
      setItems((previous) => mode === "more" && previous !== null ? [...previous, ...payload.rows] : payload.rows);
      setHasMore(payload.hasMore);
      nextCursorRef.current = payload.nextCursor;
      setIndexedThroughBlock(payload.indexedThroughBlock);
    } catch {
      if (mountedRef.current && requestGuardRef.current.isCurrent(request)) {
        setError(ACTIVITY_LOAD_ERROR);
      }
    } finally {
      if (requestGuardRef.current.isCurrent(request)) {
        if (mountedRef.current) setLoading(false);
        runningRef.current = false;
      }
    }
  }, [address]);

  useEffect(() => {
    const request = { address: activeRequestAddress, generation: activeRequestGeneration };
    runningRef.current = false;
    setItems(null);
    setError(null);
    setHasMore(false);
    nextCursorRef.current = null;
    setIndexedThroughBlock("0");
    if (address) void load("refresh", request);
  }, [activeRequestAddress, activeRequestGeneration, address, load]);

  return {
    address,
    items,
    loading,
    error,
    hasMore,
    indexedThroughBlock,
    refresh: () => load("refresh"),
    loadMore: () => load("more"),
  };
}
