"use client";

import { useCallback, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbi, decodeEventLog, formatUnits, encodeEventTopics, pad, type Log, type Hex } from "viem";
import {
  CONTRACT_ADDRESS,
  LINEA_TOKEN_ADDRESS,
  APP_CHAIN_ID,
} from "../lib/constants";

const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const CHUNK_BLOCKS = 100_000;
const CACHE_MS = 120_000;

export interface WalletTransfer {
  direction: "in" | "out";
  counterparty: string;
  amount: string;
  amountNum: number;
  txHash: string;
}

export interface WalletTransfersSummary {
  transfers: WalletTransfer[];
  totalIn: number;
  totalOut: number;
}

export function useWalletTransfers(embeddedAddress?: string, externalWalletAddress?: string | null) {
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WalletTransfersSummary | null>(null);
  const cachedAtRef = useRef(0);
  const cachedForRef = useRef<string | null>(null);
  const dataRef = useRef<WalletTransfersSummary | null>(null);

  const fetch = useCallback(async () => {
    if (!publicClient || !embeddedAddress) return;

    const addr = embeddedAddress.toLowerCase();
    const externalAddr = externalWalletAddress?.toLowerCase() ?? null;
    const cacheKey = `${addr}:${externalAddr ?? "any"}`;
    if (
      Date.now() - cachedAtRef.current < CACHE_MS &&
      cachedForRef.current === cacheKey &&
      dataRef.current !== null
    ) {
      return;
    }

    setLoading(true);
    try {
      const toBlock = await publicClient.getBlockNumber();
      const fromBlock = BigInt(0);

      const transferSig = encodeEventTopics({ abi: TRANSFER_ABI, eventName: "Transfer" })[0];
      if (!transferSig) {
        setData({ transfers: [], totalIn: 0, totalOut: 0 });
        return;
      }
      const paddedAddr = pad(embeddedAddress as Hex, { size: 32 }).toLowerCase() as Hex;

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

      // Try both queries in parallel; if incoming fails (null gap not supported), fallback
      const [outResult, inResult] = await Promise.allSettled([
        fetchChunked(outTopics),
        fetchChunked(inTopics),
      ]);

      if (outResult.status === "fulfilled") outLogs = outResult.value;

      if (inResult.status === "fulfilled") {
        inLogs = inResult.value;
      } else {
        // Fallback: fetch all Transfer events (only by sig) and filter client-side
        // Use smaller chunks to avoid RPC limits
        const FALLBACK_CHUNK = 20_000;
        const allLogs: Log[] = [];
        for (let from = fromBlock; from <= toBlock; from += BigInt(FALLBACK_CHUNK)) {
          const to = from + BigInt(FALLBACK_CHUNK) > toBlock ? toBlock : from + BigInt(FALLBACK_CHUNK - 1);
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
            // If even this fails, skip this chunk
          }
        }
        inLogs = allLogs;
      }

      const contractAddr = CONTRACT_ADDRESS.toLowerCase();
      const transfers: WalletTransfer[] = [];
      let totalIn = 0;
      let totalOut = 0;
      const seenTx = new Set<string>();

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
          const amountNum = parseFloat(formatUnits(args.value, 18));
          totalOut += amountNum;
          const txHash = log.transactionHash ?? "";
          seenTx.add(txHash);
          transfers.push({ direction: "out", counterparty: args.to, amount: amountNum.toFixed(2), amountNum, txHash });
        } catch { /* skip */ }
      }

      for (const log of inLogs) {
        try {
          const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
          const args = decoded.args as { from: string; to: string; value: bigint };
          if (args.to.toLowerCase() !== addr) continue;
          if (args.from.toLowerCase() === contractAddr) continue;
          if (!isDepositOrWithdrawal("in", args.from)) continue;
          const txHash = log.transactionHash ?? "";
          if (seenTx.has(txHash)) continue;
          const amountNum = parseFloat(formatUnits(args.value, 18));
          totalIn += amountNum;
          transfers.push({ direction: "in", counterparty: args.from, amount: amountNum.toFixed(2), amountNum, txHash });
        } catch { /* skip */ }
      }

      transfers.sort((a, b) => b.amountNum - a.amountNum);

      const summary: WalletTransfersSummary = { transfers, totalIn, totalOut };
      cachedAtRef.current = Date.now();
      cachedForRef.current = cacheKey;
      dataRef.current = summary;
      setData(summary);
    } catch {
      setData({ transfers: [], totalIn: 0, totalOut: 0 });
    } finally {
      setLoading(false);
    }
  }, [publicClient, embeddedAddress, externalWalletAddress]);

  return { data, loading, fetch };
}
