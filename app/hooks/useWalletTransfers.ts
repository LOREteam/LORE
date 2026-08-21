"use client";

import { log } from "../lib/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { decodeEventLog, encodeEventTopics, getAddress, pad, type Log, type Hex } from "viem";
import { formatLineaAmountFixed, formatLineaWeiDisplayNumber } from "../lib/tokenAmountMath";
import {
  CONTRACT_DEPLOY_BLOCK,
  CONTRACT_ADDRESS,
  LINEA_TOKEN_ADDRESS,
  APP_CHAIN_ID,
  TOKEN_ABI as TRANSFER_ABI,
} from "../lib/constants";

const CHUNK_BLOCKS = 100_000;
const FALLBACK_CHUNK_BLOCKS = 20_000;
const FALLBACK_MAX_BLOCKS = 250_000n;
const CACHE_MS = 120_000;
const PERSISTED_CACHE_PREFIX = "lore:wallet-transfer-history:v3";
const MAX_PERSISTED_TRANSFERS = 500;

export type WalletTransferDataStatus = "live" | "stale" | "partial" | "error";
export type WalletTransferScanCoverage = "full" | "partial";

function toDisplayNumberWei(value: bigint) {
  return formatLineaWeiDisplayNumber(value);
}

function toDisplayAmountWei(value: bigint) {
  return formatLineaAmountFixed(value, 2);
}

export function getWalletTransferScanFromBlock(headBlock: bigint, deployBlock = CONTRACT_DEPLOY_BLOCK): bigint | null {
  if (deployBlock <= 0n) return 0n;
  return deployBlock <= headBlock ? deployBlock : null;
}

export function getWalletTransferFallbackFromBlock(
  fromBlock: bigint,
  toBlock: bigint,
  maxBlocks = FALLBACK_MAX_BLOCKS,
): bigint {
  if (maxBlocks <= 0n) return toBlock;
  const windowStart = toBlock >= maxBlocks ? toBlock - maxBlocks + 1n : 0n;
  return windowStart > fromBlock ? windowStart : fromBlock;
}

export function getWalletTransferLogKey(log: Pick<Log, "transactionHash" | "blockNumber" | "transactionIndex" | "logIndex">): string {
  const txHash = log.transactionHash ?? "missing-tx";
  const block = log.blockNumber?.toString() ?? "missing-block";
  const transactionIndex = log.transactionIndex ?? -1;
  const logIndex = log.logIndex ?? -1;
  return `${txHash}:${block}:${transactionIndex}:${logIndex}`;
}

export function normalizeWalletTransferTxHash(value: unknown): `0x${string}` | "" {
  const normalized = String(value ?? "").toLowerCase().trim();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as `0x${string}`) : "";
}

export function normalizeWalletTransferAddress(value: string | null | undefined): `0x${string}` | null {
  if (!value) return null;
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

export interface WalletTransfer {
  direction: "in" | "out";
  counterparty: string;
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber?: bigint;
  transactionIndex?: number;
  logIndex?: number;
}

export interface WalletTransfersSummary {
  transfers: WalletTransfer[];
  totalIn: number;
  totalOut: number;
  totalInDisplay: string;
  totalOutDisplay: string;
  dataStatus: WalletTransferDataStatus;
  scanCoverage: WalletTransferScanCoverage | null;
  historyRowsTruncated: boolean;
  updatedAt: number | null;
  statusMessage: string | null;
}

function createEmptyWalletTransfersSummary(
  dataStatus: WalletTransferDataStatus = "live",
  statusMessage: string | null = null,
): WalletTransfersSummary {
  return {
    transfers: [],
    totalIn: 0,
    totalOut: 0,
    totalInDisplay: "0.00",
    totalOutDisplay: "0.00",
    dataStatus,
    scanCoverage: dataStatus === "error" ? null : dataStatus === "partial" ? "partial" : "full",
    historyRowsTruncated: false,
    updatedAt: dataStatus === "error" ? null : Date.now(),
    statusMessage,
  };
}

interface PersistedWalletTransfersSummary {
  version: 3;
  savedAt: number;
  transfers: Array<Omit<WalletTransfer, "blockNumber"> & { blockNumber?: string }>;
  totalIn: number;
  totalOut: number;
  totalInDisplay: string;
  totalOutDisplay: string;
  scanCoverage: WalletTransferScanCoverage;
  historyRowsTruncated: boolean;
}

export function getWalletTransferPersistedCacheKey(
  cacheKey: string,
  tokenAddress: string = LINEA_TOKEN_ADDRESS,
  deployBlock: bigint = CONTRACT_DEPLOY_BLOCK,
) {
  const normalizedTokenAddress = normalizeWalletTransferAddress(tokenAddress);
  if (!normalizedTokenAddress) {
    throw new Error("Wallet transfer cache requires a valid LINEA token address.");
  }
  return `${PERSISTED_CACHE_PREFIX}:${APP_CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${normalizedTokenAddress}:${deployBlock.toString()}:${cacheKey}`;
}

export function serializeWalletTransfersSummary(summary: WalletTransfersSummary): PersistedWalletTransfersSummary {
  const historyRowsTruncated = summary.historyRowsTruncated || summary.transfers.length > MAX_PERSISTED_TRANSFERS;
  return {
    version: 3,
    savedAt: summary.updatedAt ?? Date.now(),
    transfers: summary.transfers.slice(0, MAX_PERSISTED_TRANSFERS).map((transfer) => ({
      ...transfer,
      blockNumber: transfer.blockNumber?.toString(),
    })),
    totalIn: summary.totalIn,
    totalOut: summary.totalOut,
    totalInDisplay: summary.totalInDisplay,
    totalOutDisplay: summary.totalOutDisplay,
    scanCoverage: summary.scanCoverage === "full" ? "full" : "partial",
    historyRowsTruncated,
  };
}

export function parsePersistedWalletTransfersSummary(value: unknown): WalletTransfersSummary | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedWalletTransfersSummary>;
  if (
    candidate.version !== 3 ||
    typeof candidate.savedAt !== "number" ||
    !Number.isFinite(candidate.savedAt) ||
    !Array.isArray(candidate.transfers) ||
    candidate.transfers.length > MAX_PERSISTED_TRANSFERS ||
    typeof candidate.totalIn !== "number" ||
    !Number.isFinite(candidate.totalIn) ||
    typeof candidate.totalOut !== "number" ||
    !Number.isFinite(candidate.totalOut) ||
    typeof candidate.totalInDisplay !== "string" ||
    typeof candidate.totalOutDisplay !== "string" ||
    (candidate.scanCoverage !== "full" && candidate.scanCoverage !== "partial") ||
    typeof candidate.historyRowsTruncated !== "boolean"
  ) return null;
  const transfers: WalletTransfer[] = [];
  for (const transfer of candidate.transfers) {
    if (
      !transfer ||
      (transfer.direction !== "in" && transfer.direction !== "out") ||
      typeof transfer.counterparty !== "string" ||
      typeof transfer.amount !== "string" ||
      !Number.isFinite(transfer.amountNum) ||
      !normalizeWalletTransferTxHash(transfer.txHash)
    ) return null;
    let blockNumber: bigint | undefined;
    if (transfer.blockNumber !== undefined) {
      if (typeof transfer.blockNumber !== "string" || !/^\d+$/.test(transfer.blockNumber)) return null;
      try {
        blockNumber = BigInt(transfer.blockNumber);
      } catch {
        return null;
      }
    }
    const restoredTransfer: WalletTransfer = {
      direction: transfer.direction,
      counterparty: transfer.counterparty,
      amount: transfer.amount,
      amountNum: transfer.amountNum,
      txHash: normalizeWalletTransferTxHash(transfer.txHash),
    };
    if (blockNumber !== undefined) restoredTransfer.blockNumber = blockNumber;
    if (Number.isSafeInteger(transfer.transactionIndex)) restoredTransfer.transactionIndex = transfer.transactionIndex;
    if (Number.isSafeInteger(transfer.logIndex)) restoredTransfer.logIndex = transfer.logIndex;
    transfers.push(restoredTransfer);
  }
  return {
    transfers,
    totalIn: candidate.totalIn,
    totalOut: candidate.totalOut,
    totalInDisplay: candidate.totalInDisplay,
    totalOutDisplay: candidate.totalOutDisplay,
    dataStatus: "stale",
    scanCoverage: candidate.scanCoverage,
    historyRowsTruncated: candidate.historyRowsTruncated,
    updatedAt: candidate.savedAt,
    statusMessage: candidate.scanCoverage === "partial"
      ? "Showing the last checked partial transfer history. Totals are observed lower bounds; more transfers may exist. Refresh to check for newer activity."
      : candidate.historyRowsTruncated
        ? `Showing the last checked transfer history. Saved transfer list is capped at ${MAX_PERSISTED_TRANSFERS} rows; totals are from the full last check. Refresh to check for newer activity.`
        : "Showing the last checked full transfer history. Refresh to check for newer activity.",
  };
}

function readPersistedWalletTransfers(cacheKey: string): WalletTransfersSummary | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePersistedWalletTransfersSummary(JSON.parse(window.localStorage.getItem(getWalletTransferPersistedCacheKey(cacheKey)) ?? "null"));
  } catch {
    return null;
  }
}

function persistWalletTransfers(cacheKey: string, summary: WalletTransfersSummary) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getWalletTransferPersistedCacheKey(cacheKey), JSON.stringify(serializeWalletTransfersSummary(summary)));
  } catch {
    // Storage is an optional offline convenience; a quota/privacy failure must not hide live data.
  }
}

export function useWalletTransfers(embeddedAddress?: string, externalWalletAddress?: string | null) {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WalletTransfersSummary | null>(null);
  const mountedRef = useRef(false);
  const cachedAtRef = useRef(0);
  const cachedForRef = useRef<string | null>(null);
  const dataRef = useRef<WalletTransfersSummary | null>(null);
  const requestIdRef = useRef(0);
  const runningForRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
    runningForRef.current = null;
    const addr = normalizeWalletTransferAddress(embeddedAddress);
    const externalAddr = externalWalletAddress ? normalizeWalletTransferAddress(externalWalletAddress) : null;
    const cached = addr && (!externalWalletAddress || externalAddr)
      ? readPersistedWalletTransfers(`${addr}:${externalAddr ?? "any"}`)
      : null;
    dataRef.current = cached;
    if (mountedRef.current) {
      setLoading(false);
      setData(cached);
    }
  }, [embeddedAddress, externalWalletAddress]);

  const fetch = useCallback(async () => {
    const addr = normalizeWalletTransferAddress(embeddedAddress);
    const externalAddr = externalWalletAddress ? normalizeWalletTransferAddress(externalWalletAddress) : null;
    if (!addr || (externalWalletAddress && !externalAddr)) {
      const unavailableSummary = createEmptyWalletTransfersSummary("error", "Wallet address is unavailable. Transfer history was not loaded.");
      dataRef.current = unavailableSummary;
      if (mountedRef.current) {
        setData(unavailableSummary);
      }
      return;
    }
    const cacheKey = `${addr}:${externalAddr ?? "any"}`;
    if (!publicClient) {
      const unavailableSummary = dataRef.current ?? readPersistedWalletTransfers(cacheKey) ?? createEmptyWalletTransfersSummary(
        "error",
        "Transfer history is temporarily unavailable. Check your network connection and try again.",
      );
      const errorSummary = {
        ...unavailableSummary,
        dataStatus: unavailableSummary.dataStatus === "stale" ? "stale" as const : "error" as const,
        statusMessage: unavailableSummary.statusMessage ?? "Transfer history is temporarily unavailable. Check your network connection and try again.",
      };
      dataRef.current = errorSummary;
      if (mountedRef.current) setData(errorSummary);
      return;
    }
    if (loading && runningForRef.current === cacheKey) {
      return;
    }
    if (
      Date.now() - cachedAtRef.current < CACHE_MS &&
      cachedForRef.current === cacheKey &&
      dataRef.current !== null
    ) {
      return;
    }

    const requestId = ++requestIdRef.current;
    runningForRef.current = cacheKey;
    if (mountedRef.current) {
      setLoading(true);
    }
    try {
      const toBlock = await publicClient.getBlockNumber();
      const fromBlock = getWalletTransferScanFromBlock(toBlock);
      if (fromBlock === null) {
        const emptySummary = createEmptyWalletTransfersSummary();
        cachedAtRef.current = Date.now();
        cachedForRef.current = cacheKey;
        dataRef.current = emptySummary;
        if (mountedRef.current && requestId === requestIdRef.current) {
          setData(emptySummary);
        }
        return;
      }

      const transferSig = encodeEventTopics({ abi: TRANSFER_ABI, eventName: "Transfer" })[0];
      if (!transferSig) {
        const unavailableSummary = dataRef.current ?? createEmptyWalletTransfersSummary(
          "error",
          "Transfer history is temporarily unavailable. Check your network connection and try again.",
        );
        if (mountedRef.current && requestId === requestIdRef.current) {
          setData({
            ...unavailableSummary,
            dataStatus: unavailableSummary.dataStatus === "stale" ? "stale" : "error",
            statusMessage: unavailableSummary.statusMessage ?? "Transfer history is temporarily unavailable. Check your network connection and try again.",
          });
        }
        return;
      }
      const paddedAddr = pad(addr as Hex, { size: 32 }).toLowerCase() as Hex;

      const fetchChunked = async (topics: (Hex | Hex[] | null)[]) => {
        const result: Log[] = [];
        for (let from = fromBlock; from <= toBlock; from += BigInt(CHUNK_BLOCKS)) {
          const to = from + BigInt(CHUNK_BLOCKS) > toBlock ? toBlock : from + BigInt(CHUNK_BLOCKS - 1);
          const request = {
            address: LINEA_TOKEN_ADDRESS,
            topics,
            fromBlock: from,
            toBlock: to,
          } as unknown as Parameters<typeof publicClient.getLogs>[0];
          const chunk = await publicClient.getLogs(request);
          result.push(...chunk);
        }
        return result;
      };

      // Query 1: outgoing – Transfer(from=embedded, to=any)
      // topics: [sig, paddedAddr]  (no null gap)
      const outTopics: (Hex | null)[] = [transferSig, paddedAddr];

      // Query 2: incoming – Transfer(from=any, to=embedded)
      // topics: [sig, null, paddedAddr]  (null gap for topic[1])
      const inTopics: (Hex | null)[] = [transferSig, null, paddedAddr];

      let outLogs: Log[] = [];
      let inLogs: Log[] = [];
      let hasPartialCoverage = false;

      // Try both queries in parallel; if incoming fails (null gap not supported), fallback
      const [outResult, inResult] = await Promise.allSettled([
        fetchChunked(outTopics),
        fetchChunked(inTopics),
      ]);

      if (outResult.status === "fulfilled") {
        outLogs = outResult.value;
      } else {
        hasPartialCoverage = true;
        log.warn("WalletTransfers", "outgoing fetch failed", { reason: String(outResult.reason) });
      }

      if (inResult.status === "fulfilled") {
        inLogs = inResult.value;
      } else {
        // Fallback: fetch all Transfer events (only by sig) and filter client-side
        // Limit the unfiltered scan window; full-token Transfer scans are too heavy on mainnet.
        const allLogs: Log[] = [];
        const fallbackFromBlock = getWalletTransferFallbackFromBlock(fromBlock, toBlock);
        if (fallbackFromBlock > fromBlock) {
          hasPartialCoverage = true;
        }
        for (let from = fallbackFromBlock; from <= toBlock; from += BigInt(FALLBACK_CHUNK_BLOCKS)) {
          const to = from + BigInt(FALLBACK_CHUNK_BLOCKS) > toBlock ? toBlock : from + BigInt(FALLBACK_CHUNK_BLOCKS - 1);
          try {
            const request = {
              address: LINEA_TOKEN_ADDRESS,
              topics: [transferSig],
              fromBlock: from,
              toBlock: to,
            } as unknown as Parameters<typeof publicClient.getLogs>[0];
            const chunk = await publicClient.getLogs(request);
            allLogs.push(...chunk);
          } catch {
            hasPartialCoverage = true;
            // If even this fails, skip this chunk
          }
        }
        inLogs = allLogs;
      }

      const contractAddr = CONTRACT_ADDRESS.toLowerCase();
      const transfers: WalletTransfer[] = [];
      let totalInWei = 0n;
      let totalOutWei = 0n;
      const seenLogs = new Set<string>();

      // Deposits and withdrawals only: between embedded and external wallets (game rewards remain claimable separately)
      const isDepositOrWithdrawal = (dir: "in" | "out", counterparty: string) => {
        if (!externalAddr) return true; // no external wallet - keep current logic (exclude contract only)
        const c = counterparty.toLowerCase();
        if (dir === "in") return c === externalAddr;  // deposit: from external to embedded
        if (dir === "out") return c === externalAddr; // withdrawal: from embedded to external
        return false;
      };

      for (const log of outLogs) {
        try {
          const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
          const args = decoded.args as { from: string; to: string; value: bigint };
          if (args.from.toLowerCase() !== addr) continue;
          if (args.to.toLowerCase() === contractAddr) continue;
          if (!isDepositOrWithdrawal("out", args.to)) continue;
          const amountNum = toDisplayNumberWei(args.value);
          totalOutWei += args.value;
          const txHash = normalizeWalletTransferTxHash(log.transactionHash);
          seenLogs.add(getWalletTransferLogKey(log));
          transfers.push({
            direction: "out",
            counterparty: args.to,
            amount: formatLineaAmountFixed(args.value, 2),
            amountNum,
            txHash,
            blockNumber: log.blockNumber ?? undefined,
            transactionIndex: log.transactionIndex ?? undefined,
            logIndex: log.logIndex ?? undefined,
          });
        } catch {
          hasPartialCoverage = true;
        }
      }

      for (const log of inLogs) {
        try {
          const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
          const args = decoded.args as { from: string; to: string; value: bigint };
          if (args.to.toLowerCase() !== addr) continue;
          if (args.from.toLowerCase() === contractAddr) continue;
          if (!isDepositOrWithdrawal("in", args.from)) continue;
          const txHash = normalizeWalletTransferTxHash(log.transactionHash);
          if (seenLogs.has(getWalletTransferLogKey(log))) continue;
          const amountNum = toDisplayNumberWei(args.value);
          totalInWei += args.value;
          transfers.push({
            direction: "in",
            counterparty: args.from,
            amount: formatLineaAmountFixed(args.value, 2),
            amountNum,
            txHash,
            blockNumber: log.blockNumber ?? undefined,
            transactionIndex: log.transactionIndex ?? undefined,
            logIndex: log.logIndex ?? undefined,
          });
        } catch {
          hasPartialCoverage = true;
        }
      }

      transfers.sort((a, b) => {
        const aBlock = a.blockNumber ?? 0n;
        const bBlock = b.blockNumber ?? 0n;
        if (aBlock !== bBlock) return bBlock > aBlock ? 1 : -1;
        const txDelta = (b.transactionIndex ?? -1) - (a.transactionIndex ?? -1);
        if (txDelta !== 0) return txDelta;
        const logDelta = (b.logIndex ?? -1) - (a.logIndex ?? -1);
        if (logDelta !== 0) return logDelta;
        return (b.txHash ?? "").localeCompare(a.txHash ?? "");
      });

      const summary: WalletTransfersSummary = {
        transfers,
        totalIn: toDisplayNumberWei(totalInWei),
        totalOut: toDisplayNumberWei(totalOutWei),
        totalInDisplay: toDisplayAmountWei(totalInWei),
        totalOutDisplay: toDisplayAmountWei(totalOutWei),
        dataStatus: hasPartialCoverage ? "partial" : "live",
        scanCoverage: hasPartialCoverage ? "partial" : "full",
        historyRowsTruncated: false,
        updatedAt: Date.now(),
        statusMessage: hasPartialCoverage ? "Transfer history is partial; observed records may be missing." : null,
      };
      cachedAtRef.current = Date.now();
      cachedForRef.current = cacheKey;
      dataRef.current = summary;
      persistWalletTransfers(cacheKey, summary);
      if (mountedRef.current && requestId === requestIdRef.current) {
        setData(summary);
      }
    } catch {
      if (mountedRef.current && requestId === requestIdRef.current) {
        const unavailableSummary = dataRef.current ?? readPersistedWalletTransfers(cacheKey) ?? createEmptyWalletTransfersSummary(
          "error",
          "Transfer history is temporarily unavailable. Check your network connection and try again.",
        );
        const errorSummary: WalletTransfersSummary = {
          ...unavailableSummary,
          dataStatus: unavailableSummary.dataStatus === "stale" ? "stale" : "error",
          statusMessage: unavailableSummary.dataStatus === "stale"
            ? "Transfer history is temporarily unavailable. Showing the last verified result."
            : "Transfer history is temporarily unavailable. Check your network connection and try again.",
        };
        dataRef.current = errorSummary;
        setData(errorSummary);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
      if (requestId === requestIdRef.current || runningForRef.current === cacheKey) {
        runningForRef.current = null;
      }
    }
  }, [publicClient, embeddedAddress, externalWalletAddress, loading]);

  return { data, loading, fetch };
}
