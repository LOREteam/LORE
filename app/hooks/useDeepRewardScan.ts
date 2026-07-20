"use client";

import { log } from "../lib/logger";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePublicClient, useAccount } from "wagmi";
import { encodeFunctionData, getAddress } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI, TX_RECEIPT_TIMEOUT_MS } from "../lib/constants";
import type { UnclaimedWin } from "../lib/types";
import { formatRewardClaimError, isRewardClaimWindowOpen } from "./useRewardScanner";
import { isUserRejection, delay } from "../lib/utils";
import { getExplorerTxUrl } from "../lib/explorerLinks";
import { isAmbiguousPendingTxError } from "./useMining.shared";

type EpochTuple = readonly [bigint, bigint, bigint, boolean];
type ReceiptState = "confirmed" | "pending";

const MAX_BATCH_CLAIM_EPOCHS = 128;
const CLAIM_GAS_FALLBACK = 200_000n;
const CLAIM_GAS_BUFFER = 20_000n;
const CLAIM_GAS_HEADROOM_BPS = 12_000n;
const BPS_DENOMINATOR = 10_000n;
const CANDIDATE_PAGE_SIZE = 200;

type ClaimCandidatePage = {
  epochs: number[];
  hasMore: boolean;
  nextCursor: number | null;
  error?: string;
};

function formatClaimTxMessage(message: string, hash: `0x${string}`) {
  const txUrl = getExplorerTxUrl(hash);
  return txUrl ? `${message} ${txUrl}` : message;
}

function chunkEpochIds(epochIds: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < epochIds.length; index += size) {
    chunks.push(epochIds.slice(index, index + size));
  }
  return chunks;
}

export function useDeepRewardScan(
  sendTransactionSilent?: (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>,
  onNotify?: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
  preferredAddress?: string | null,
) {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const address = useMemo(() => {
    const candidate = preferredAddress ?? connectedAddress;
    if (!candidate) return null;
    try {
      return getAddress(candidate);
    } catch {
      return null;
    }
  }, [connectedAddress, preferredAddress]);

  const [wins, setWins] = useState<UnclaimedWin[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [progress, setProgress] = useState("");
  const abortRef = useRef(false);
  const scanRunningRef = useRef(false);
  const scanAddressRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current = true;
      scanRunningRef.current = false;
      scanAddressRef.current = null;
    };
  }, []);

  const waitReceipt = useCallback(
    async (hash: `0x${string}`): Promise<ReceiptState> => {
      if (!publicClient) throw new Error("publicClient unavailable");
      const isReceiptTimeoutLike = (value: unknown) => {
        const message = value instanceof Error ? value.message.toLowerCase() : String(value).toLowerCase();
        const name = value instanceof Error ? value.name : "";
        return (
          name === "TimeoutError" ||
          name === "TransactionReceiptNotFoundError" ||
          name === "TransactionReceiptTimeoutError" ||
          message.includes("timed out") ||
          message.includes("timeout") ||
          message.includes("receipt could not be found")
        );
      };
      const isTxLookupMissing = (value: unknown) => {
        const message = value instanceof Error ? value.message.toLowerCase() : String(value).toLowerCase();
        const name = value instanceof Error ? value.name : "";
        return (
          name === "TransactionNotFoundError" ||
          message.includes("transaction not found") ||
          message.includes("transaction could not be found")
        );
      };

      try {
        const receipt = await Promise.race([
          publicClient.waitForTransactionReceipt({ hash }),
          delay(TX_RECEIPT_TIMEOUT_MS).then(() => {
            const timeoutError = new Error("Transaction receipt timeout");
            timeoutError.name = "TransactionReceiptTimeoutError";
            throw timeoutError;
          }),
        ]);
        if (receipt.status !== "success") {
          throw new Error(`Transaction reverted: ${hash}`);
        }
        return "confirmed";
      } catch (error) {
        try {
          const lateReceipt = await publicClient.getTransactionReceipt({ hash });
          if (lateReceipt.status !== "success") {
            throw new Error(`Transaction reverted: ${hash}`);
          }
          return "confirmed";
        } catch (lateReceiptError) {
          if (isReceiptTimeoutLike(error)) {
            try {
              await publicClient.getTransaction({ hash });
              return "pending";
            } catch (txLookupError) {
              if (!isTxLookupMissing(txLookupError)) {
                throw txLookupError;
              }
              throw error;
            }
          }
          if (!isTxLookupMissing(lateReceiptError)) {
            throw lateReceiptError;
          }
          throw error;
        }
      }
    },
    [publicClient],
  );

  const estimateClaimGas = useCallback(
    async (epochId: string) => {
      if (!publicClient || !address) return CLAIM_GAS_FALLBACK;
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimReward",
        args: [BigInt(epochId)],
      });
      try {
        const estimatedGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: CONTRACT_ADDRESS,
          data,
        });
        return (estimatedGas * CLAIM_GAS_HEADROOM_BPS) / BPS_DENOMINATOR + CLAIM_GAS_BUFFER;
      } catch {
        return CLAIM_GAS_FALLBACK;
      }
    },
    [address, publicClient],
  );

  const estimateBatchClaimGas = useCallback(
    async (epochIds: string[]) => {
      if (epochIds.length === 0) return CLAIM_GAS_FALLBACK;
      if (!publicClient || !address) {
        return CLAIM_GAS_FALLBACK * BigInt(epochIds.length);
      }
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimRewards",
        args: [epochIds.map((epochId) => BigInt(epochId))],
      });
      try {
        const estimatedGas = await publicClient.estimateGas({
          account: address as `0x${string}`,
          to: CONTRACT_ADDRESS,
          data,
        });
        return (estimatedGas * CLAIM_GAS_HEADROOM_BPS) / BPS_DENOMINATOR + CLAIM_GAS_BUFFER;
      } catch {
        return CLAIM_GAS_FALLBACK * BigInt(epochIds.length);
      }
    },
    [address, publicClient],
  );

  const prepareClaimTx = useCallback(
    async (epochId: string) => {
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimReward",
        args: [BigInt(epochId)],
      });

      if (publicClient && address) {
        await publicClient.simulateContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimReward",
          args: [BigInt(epochId)],
          account: address as `0x${string}`,
        });
      }

      const gas = await estimateClaimGas(epochId);
      return { data, gas };
    },
    [address, estimateClaimGas, publicClient],
  );

  const prepareBatchClaimTx = useCallback(
    async (epochIds: string[]) => {
      const epochArgs = epochIds.map((epochId) => BigInt(epochId));
      const data = encodeFunctionData({
        abi: GAME_ABI,
        functionName: "claimRewards",
        args: [epochArgs],
      });

      if (publicClient && address) {
        await publicClient.simulateContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimRewards",
          args: [epochArgs],
          account: address as `0x${string}`,
        });
      }

      const gas = await estimateBatchClaimGas(epochIds);
      return { data, gas };
    },
    [address, estimateBatchClaimGas, publicClient],
  );

  const confirmClaimedEpochs = useCallback(
    async (epochIds: string[]) => {
      if (!publicClient || !address || epochIds.length === 0) {
        return new Set(epochIds);
      }
      const results = await publicClient.multicall({
        contracts: epochIds.map((epochId) => ({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "hasClaimed" as const,
          args: [address, BigInt(epochId)],
        })),
      });
      const claimed = new Set<string>();
      epochIds.forEach((epochId, index) => {
        if (results[index]?.result === true) {
          claimed.add(epochId);
        }
      });
      return claimed;
    },
    [address, publicClient],
  );

  const scan = useCallback(async () => {
    if (!publicClient || !address) return;
    const normalizedAddress = address.toLowerCase();
    if (scanRunningRef.current) return;
    scanRunningRef.current = true;
    scanAddressRef.current = normalizedAddress;
    abortRef.current = false;
    if (mountedRef.current) {
      setScanning(true);
      setWins(null);
      setProgress("Loading indexed wallet activity...");
    }

    try {
      const chainTimestamp = (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
      const found: UnclaimedWin[] = [];
      let scanned = 0;
      let cursor: number | null = null;

      while (!abortRef.current) {
        if (scanAddressRef.current !== normalizedAddress) return;
        const query = new URLSearchParams({
          user: normalizedAddress,
          limit: String(CANDIDATE_PAGE_SIZE),
        });
        if (cursor !== null) query.set("cursor", String(cursor));
        const response = await fetch(`/api/claim-candidates?${query.toString()}`, { cache: "no-store" });
        const page = await response.json() as ClaimCandidatePage;
        if (!response.ok || page.error) {
          throw new Error(page.error || `Claim candidate lookup failed (HTTP ${response.status})`);
        }
        const epochIds = [...new Set(Array.isArray(page.epochs) ? page.epochs : [])]
          .filter((epoch) => Number.isSafeInteger(epoch) && epoch > 0)
          .map((epoch) => BigInt(epoch));
        if (epochIds.length === 0) {
          if (page.hasMore) throw new Error("Claim candidate pagination returned an empty page");
          break;
        }

        if (mountedRef.current) {
          setProgress(`Checking ${scanned + epochIds.length} indexed epochs... (${found.length} found)`);
        }

        const [epochResults, claimResults, dustSettledResults] = await Promise.all([
          publicClient.multicall({
            contracts: epochIds.map((id) => ({
              address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs" as const, args: [id],
            })),
          }),
          publicClient.multicall({
            contracts: epochIds.map((id) => ({
              address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "hasClaimed" as const, args: [address, id],
            })),
          }),
          publicClient.multicall({
            contracts: epochIds.map((id) => ({
              address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochDustSettled" as const, args: [id],
            })),
          }),
        ]);
        if (scanAddressRef.current !== normalizedAddress) return;

        const potentialWins: { id: bigint; winTile: bigint; rewardPool: bigint }[] = [];
        epochIds.forEach((id, index) => {
          const epRes = epochResults[index]?.result as unknown as EpochTuple | undefined;
          const claimed = claimResults[index]?.result as unknown as boolean | undefined;
          const dustSettled = dustSettledResults[index]?.result as unknown as boolean | undefined;
          if (epRes && claimed === false && dustSettled !== true && epRes[3]) {
            potentialWins.push({ id, rewardPool: epRes[1], winTile: epRes[2] });
          }
        });

        if (potentialWins.length > 0) {
          const [betResults, tilePoolResults, resolvedAtResults] = await Promise.all([
            publicClient.multicall({
              contracts: potentialWins.map((w) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "userBets" as const, args: [w.id, w.winTile, address],
              })),
            }),
            publicClient.multicall({
              contracts: potentialWins.map((w) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "tilePools" as const, args: [w.id, w.winTile],
              })),
            }),
            publicClient.multicall({
              contracts: potentialWins.map((w) => ({
                address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochResolvedAt" as const, args: [w.id],
              })),
            }),
          ]);
          if (scanAddressRef.current !== normalizedAddress) return;

          potentialWins.forEach((w, index) => {
            const betAmt = betResults[index]?.result as unknown as bigint | undefined;
            const tileTotal = tilePoolResults[index]?.result as unknown as bigint | undefined;
            const resolvedAt = resolvedAtResults[index]?.result as unknown as bigint | undefined;
            if (
              betAmt && betAmt > 0n && tileTotal && tileTotal > 0n && resolvedAt !== undefined
              && isRewardClaimWindowOpen(resolvedAt, chainTimestamp)
            ) {
              const amountWei = (w.rewardPool * betAmt) / tileTotal;
              if (amountWei === 0n) return;
              found.push({
                epoch: w.id.toString(),
                amountWei: amountWei.toString(),
              });
            }
          });
        }

        scanned += epochIds.length;
        if (!page.hasMore) break;
        if (!page.nextCursor || page.nextCursor === cursor) {
          throw new Error("Claim candidate pagination did not advance");
        }
        cursor = page.nextCursor;
      }

      if (scanAddressRef.current === normalizedAddress && mountedRef.current) {
        setWins(found);
      }
      if (scanAddressRef.current === normalizedAddress && mountedRef.current) {
        setProgress(abortRef.current ? "Cancelled" : `Done - ${found.length} unclaimed reward${found.length !== 1 ? "s" : ""} in indexed history`);
      }
    } catch (e) {
      if (scanAddressRef.current === normalizedAddress && mountedRef.current) {
        setProgress("Error during scan");
      }
      log.warn("DeepScan", "scan error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (scanAddressRef.current === normalizedAddress || !mountedRef.current) {
        if (mountedRef.current) {
          setScanning(false);
        }
        scanRunningRef.current = false;
        scanAddressRef.current = null;
      }
    }
  }, [publicClient, address]);

  useEffect(() => {
    abortRef.current = true;
    scanRunningRef.current = false;
    scanAddressRef.current = address ? address.toLowerCase() : null;
    if (mountedRef.current) {
      setWins(null);
      setScanning(false);
      setProgress("");
    }
  }, [address]);

  const stop = useCallback(() => { abortRef.current = true; }, []);

  const claimOne = useCallback(async (epochId: string) => {
    if (!sendTransactionSilent) return;
    if (mountedRef.current) {
      setClaiming(true);
    }
    try {
      const { data, gas } = await prepareClaimTx(epochId);
      const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas });
      const receiptState = await waitReceipt(hash);
      if (receiptState === "pending") {
        onNotify?.(
          formatClaimTxMessage("Claim transaction submitted and is still pending. Rewards will refresh after confirmation.", hash),
          "info",
        );
        return;
      }
      if (mountedRef.current) {
        setWins((prev) => prev ? prev.filter((w) => w.epoch !== epochId) : prev);
      }
      onNotify?.(formatClaimTxMessage("Reward claimed successfully.", hash), "success");
    } catch (err) {
      if (isAmbiguousPendingTxError(err)) {
        onNotify?.("Reward claim may already be pending. Check wallet activity before retrying.", "warning");
      } else if (!isUserRejection(err)) {
        onNotify?.(formatRewardClaimError(err), "danger");
      }
    } finally {
      if (mountedRef.current) {
        setClaiming(false);
      }
    }
  }, [onNotify, prepareClaimTx, sendTransactionSilent, waitReceipt]);

  const claimAllDeep = useCallback(async () => {
    if (!wins || wins.length === 0 || !sendTransactionSilent) return;
    if (mountedRef.current) {
      setClaiming(true);
    }
    try {
      const all = [...wins];
      const claimedEpochs = new Set<string>();
      let skippedEpochs = 0;
      let claimTxCount = 0;
      let lastRewardClaimTxHash: `0x${string}` | null = null;

      const submitSingleClaim = async (epochId: string) => {
        const { data, gas } = await prepareClaimTx(epochId);
        const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas });
        lastRewardClaimTxHash = hash;
        claimTxCount += 1;
        const receiptState = await waitReceipt(hash);
        if (receiptState === "pending") return receiptState;
        claimedEpochs.add(epochId);
        return receiptState;
      };

      const submitBatchClaim = async (epochIds: string[]) => {
        const { data, gas } = await prepareBatchClaimTx(epochIds);
        const hash = await sendTransactionSilent({ to: CONTRACT_ADDRESS, data, gas });
        lastRewardClaimTxHash = hash;
        claimTxCount += 1;
        const receiptState = await waitReceipt(hash);
        if (receiptState === "pending") return receiptState;
        const confirmedClaimed = await confirmClaimedEpochs(epochIds);
        confirmedClaimed.forEach((epochId) => claimedEpochs.add(epochId));
        if (confirmedClaimed.size === 0) {
          throw new Error("Batch claim confirmed without claimed epochs");
        }
        return receiptState;
      };

      const queue: string[][] = chunkEpochIds(
        all.map((win) => win.epoch),
        MAX_BATCH_CLAIM_EPOCHS,
      );
      let pendingClaimTx = false;

      while (queue.length > 0) {
        const batch = queue.shift();
        if (!batch || batch.length === 0) continue;

        try {
          let receiptState: ReceiptState;
          if (batch.length === 1) {
            receiptState = await submitSingleClaim(batch[0]);
          } else {
            receiptState = await submitBatchClaim(batch);
          }
          if (receiptState === "pending") {
            pendingClaimTx = true;
            break;
          }
        } catch (err) {
          if (isAmbiguousPendingTxError(err)) {
            pendingClaimTx = true;
            break;
          }
          if (isUserRejection(err)) break;
          if (batch.length === 1) {
            skippedEpochs += 1;
            continue;
          }
          const middle = Math.ceil(batch.length / 2);
          queue.unshift(batch.slice(middle));
          queue.unshift(batch.slice(0, middle));
        }
      }

      if (claimedEpochs.size > 0) {
        if (mountedRef.current) {
          setWins((prev) => prev ? prev.filter((w) => !claimedEpochs.has(w.epoch)) : prev);
        }
        onNotify?.(
          lastRewardClaimTxHash
            ? formatClaimTxMessage(
                claimedEpochs.size === 1
                  ? claimTxCount <= 1
                    ? "1 reward claimed successfully."
                    : `1 reward claimed successfully in ${claimTxCount} transactions.`
                  : claimTxCount <= 1
                    ? `${claimedEpochs.size} rewards claimed successfully in 1 transaction.`
                    : `${claimedEpochs.size} rewards claimed successfully in ${claimTxCount} transactions.`,
                lastRewardClaimTxHash,
              )
            : claimedEpochs.size === 1
              ? claimTxCount <= 1
                ? "1 reward claimed successfully."
                : `1 reward claimed successfully in ${claimTxCount} transactions.`
              : claimTxCount <= 1
                ? `${claimedEpochs.size} rewards claimed successfully in 1 transaction.`
                : `${claimedEpochs.size} rewards claimed successfully in ${claimTxCount} transactions.`,
          "success",
        );
      }
      if (skippedEpochs > 0 && claimedEpochs.size === 0) {
        onNotify?.("Some rewards are no longer claimable.", "info");
      }
      if (pendingClaimTx) {
        onNotify?.(
          lastRewardClaimTxHash
            ? formatClaimTxMessage("Claim transaction submitted and is still pending. Rewards will refresh after confirmation.", lastRewardClaimTxHash)
            : "Claim transaction submitted and is still pending. Rewards will refresh after confirmation.",
          "info",
        );
      }
    } finally {
      if (mountedRef.current) {
        setClaiming(false);
      }
    }
  }, [
    confirmClaimedEpochs,
    onNotify,
    prepareBatchClaimTx,
    prepareClaimTx,
    wins,
    sendTransactionSilent,
    waitReceipt,
  ]);

  return { wins, scanning, claiming, progress, scan, stop, claimOne, claimAllDeep };
}
