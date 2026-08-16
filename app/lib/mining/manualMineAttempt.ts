import { parseUnits } from "viem";
import { log } from "../logger";
import { delay, normalizeDecimalInput, validateBetAmount } from "../utils";
import {
  isAmbiguousPendingTxError,
  isAllowanceError,
  isDeterministicBetExecutionError,
  isReceiptTimeoutError,
  isRetryableError,
} from "../../hooks/useMining.shared";
import type { GasOverrides } from "../../hooks/useMining.types";
import type { ReceiptState } from "../../hooks/useMining.stateTypes";

type MineAttemptSource = "ManualMine" | "DirectMine";

interface RunManualMineAttemptOptions {
  actorAddress: string;
  betAmountStr: string;
  ensureAllowance: (requiredAmount: bigint) => Promise<void>;
  expectedEpoch: bigint;
  finalizeMineSuccess: () => void;
  getBumpedFees: (stepBps?: bigint) => Promise<GasOverrides | undefined>;
  normalizedTiles: number[];
  placeBetsPreferSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
    txNonce?: number,
    expectedEpoch?: bigint,
  ) => Promise<"confirmed" | "pending">;
  prepareBetConfirmation: (
    actorAddress: string,
    normalizedTiles: number[],
    expectedEpoch: bigint,
    amountRawPerTile: bigint,
  ) => Promise<() => Promise<boolean>>;
  source: MineAttemptSource;
}

export async function runManualMineAttempt(options: RunManualMineAttemptOptions): Promise<ReceiptState> {
  const {
    actorAddress,
    betAmountStr,
    expectedEpoch,
    finalizeMineSuccess,
    getBumpedFees,
    normalizedTiles,
    placeBetsPreferSilent,
    prepareBetConfirmation,
    source,
  } = options;
  const validationError = validateBetAmount(betAmountStr);
  if (validationError) throw new Error(validationError);
  const normalized = normalizeDecimalInput(betAmountStr.trim());
  const singleAmountRaw = parseUnits(normalized, 18);
  let confirmBetAfterError: (() => Promise<boolean>) | null = null;
  try {
    confirmBetAfterError = await prepareBetConfirmation(
      actorAddress,
      normalizedTiles,
      expectedEpoch,
      singleAmountRaw,
    );
  } catch (statusError) {
    log.warn(source, "bet confirmation baseline unavailable", statusError);
  }

  try {
    const state = await placeBetsPreferSilent(
      normalizedTiles,
      singleAmountRaw,
      undefined,
      undefined,
      expectedEpoch,
    );
    if (state === "pending") {
      log.warn(source, "bet tx is pending, skip immediate retry");
      return "pending";
    }
  } catch (error) {
    const allowanceRetry = isAllowanceError(error);
    if (isDeterministicBetExecutionError(error) && !allowanceRetry) {
      try {
        const alreadyConfirmed = confirmBetAfterError
          ? await confirmBetAfterError()
          : false;
        if (alreadyConfirmed) {
          log.info(source, "skipping error - bets already on-chain", {
            confirmedTiles: normalizedTiles.length,
          });
          finalizeMineSuccess();
          return "confirmed";
        }
      } catch (statusError) {
        log.warn(source, "bet status check failed after contract error", statusError);
      }
      throw error;
    }
    if (!isRetryableError(error)) throw error;
    if (isReceiptTimeoutError(error) || isAmbiguousPendingTxError(error)) {
      log.warn(source, "bet submission is ambiguous, avoid duplicate resend");
      return "pending";
    }
    if (!allowanceRetry) await delay(1500);
    let alreadyConfirmed = false;
    try {
      if (!confirmBetAfterError) {
        throw new Error("Bet confirmation baseline unavailable.");
      }
      alreadyConfirmed = await confirmBetAfterError();
    } catch (statusError) {
      if (!allowanceRetry) {
        log.warn(source, "bet status check failed after retryable send error; skipping duplicate resend", statusError);
        throw new Error("Bet status could not be verified after an RPC error. Wait a moment before retrying.");
      }
    }
    if (alreadyConfirmed) {
      log.info(source, "skipping retry - bets already on-chain", {
        confirmedTiles: normalizedTiles.length,
      });
      finalizeMineSuccess();
      return "confirmed";
    }
    if (allowanceRetry) await delay(1500);
    const bumpedFees = await getBumpedFees(BigInt(130));
    const retryState = await placeBetsPreferSilent(
      normalizedTiles,
      singleAmountRaw,
      bumpedFees,
      undefined,
      expectedEpoch,
    );
    if (retryState === "pending") {
      log.warn(source, "retry bet tx still pending, skip additional resend");
      return "pending";
    }
  }

  finalizeMineSuccess();
  return "confirmed";
}
