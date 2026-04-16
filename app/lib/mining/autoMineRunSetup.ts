import { parseUnits } from "viem";
import type { PublicClient } from "viem";
import { log } from "../logger";
import { delay, normalizeDecimalInput, validateBetAmount } from "../utils";
import type { GasOverrides, SilentSendFn } from "../../hooks/useMining.types";
import type { PendingApproveState, ReceiptState } from "../../hooks/useMining.stateTypes";
import { prepareAutoMineBootstrap } from "./autoMineBootstrap";

interface PrepareAutoMineRunSetupOptions {
  acquireTabLock: () => boolean;
  actorAddress: string | null;
  approveRetryMax: number;
  assertNativeGasBalance: (gas: bigint, gasOverrides?: GasOverrides) => Promise<void>;
  autoMineActive: () => boolean;
  betStr: string;
  blocks: number;
  clearPendingApprove: () => void;
  ensurePreferredWallet: () => Promise<void> | void;
  getUrgentFees: () => Promise<GasOverrides | undefined>;
  markRunStarted: () => void;
  maxNetworkAttempts: number;
  maxNetworkMs: number;
  minGasApprove: bigint;
  networkInitialMs: number;
  onClearPersistedSession: () => void;
  onProgress: (message: string | null) => void;
  pendingApproveRef: { current: PendingApproveState | null };
  publicClient: PublicClient | undefined;
  readSilentSend: () => SilentSendFn | undefined;
  recoverOrphanedTabLock: () => Promise<boolean>;
  refetchAllowance: () => void;
  rounds: number;
  setIsAutoMining: (value: boolean) => void;
  setRunningParams: (value: { betStr: string; blocks: number; rounds: number } | null) => void;
  setSelectedTiles: (tiles: number[]) => void;
  setSelectedTilesEpoch: (epoch: string | null) => void;
  startRoundIndex: number;
  waitReceipt: (hash: `0x${string}`, client?: PublicClient) => Promise<ReceiptState>;
  writeApprove: (args: unknown) => Promise<`0x${string}`>;
}

interface PreparedAutoMineRun {
  actorAddress: `0x${string}`;
  client: PublicClient;
  singleAmountRaw: bigint;
}

export async function prepareAutoMineRunSetup({
  acquireTabLock,
  actorAddress,
  approveRetryMax,
  assertNativeGasBalance,
  autoMineActive,
  betStr,
  blocks,
  clearPendingApprove,
  ensurePreferredWallet,
  getUrgentFees,
  markRunStarted,
  maxNetworkAttempts,
  maxNetworkMs,
  minGasApprove,
  networkInitialMs,
  onClearPersistedSession,
  onProgress,
  pendingApproveRef,
  publicClient,
  readSilentSend,
  recoverOrphanedTabLock,
  refetchAllowance,
  rounds,
  setIsAutoMining,
  setRunningParams,
  setSelectedTiles,
  setSelectedTilesEpoch,
  startRoundIndex,
  waitReceipt,
  writeApprove,
}: PrepareAutoMineRunSetupOptions): Promise<PreparedAutoMineRun | null> {
  const client = publicClient;
  if (!actorAddress || !client) {
    onProgress("Embedded wallet not ready. Create it in Settings and retry.");
    setIsAutoMining(false);
    setRunningParams(null);
    return null;
  }

  if (!(acquireTabLock() || ((await recoverOrphanedTabLock()) && acquireTabLock()))) {
    log.warn("AutoMine", "another tab is already mining - aborting start");
    onProgress("Another tab is mining. Close it first.");
    await delay(5000);
    setIsAutoMining(false);
    setRunningParams(null);
    onProgress(null);
    return null;
  }

  markRunStarted();
  setIsAutoMining(true);
  setSelectedTiles([]);
  setSelectedTilesEpoch(null);
  setRunningParams({ betStr, blocks, rounds });
  onProgress(`${startRoundIndex} / ${rounds}`);
  log.info("AutoMine", "started", { betStr, blocks, rounds, startRoundIndex });

  if (!readSilentSend()) {
    onProgress("Waiting for wallet...");
    for (let waitIndex = 0; waitIndex < 20; waitIndex += 1) {
      await delay(500);
      if (readSilentSend()) break;
    }
    if (!readSilentSend()) {
      log.warn("AutoMine", "wallet not ready after 10s, falling back to writeContract");
    }
  }

  const validationError = validateBetAmount(betStr);
  if (validationError) throw new Error(validationError);
  const normalized = normalizeDecimalInput(betStr.trim());
  const singleAmountRaw = parseUnits(normalized, 18);
  const roundCost = singleAmountRaw * BigInt(blocks);
  const absoluteTotal = roundCost * BigInt(Math.max(0, rounds - startRoundIndex));

  const bootstrapReady = await prepareAutoMineBootstrap({
    absoluteTotal,
    actorAddress: actorAddress as `0x${string}`,
    approveRetryMax,
    assertNativeGasBalance,
    autoMineActive,
    clearPendingApprove,
    ensurePreferredWallet,
    getUrgentFees,
    maxNetworkAttempts,
    maxNetworkMs,
    minGasApprove,
    networkInitialMs,
    onCannotStart: async (message: string) => {
      onProgress(message);
      onClearPersistedSession();
      await delay(5000);
      setIsAutoMining(false);
      setRunningParams(null);
      onProgress(null);
    },
    onProgress: (message) => onProgress(message),
    pendingApproveRef,
    publicClient: client,
    readSilentSend,
    refetchAllowance,
    roundCost,
    waitReceipt,
    writeApprove,
  });

  if (!bootstrapReady) {
    return null;
  }

  return {
    actorAddress: actorAddress as `0x${string}`,
    client,
    singleAmountRaw,
  };
}
