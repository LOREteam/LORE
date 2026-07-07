import { parseUnits } from "viem";
import { log } from "../logger";
import { delay, normalizeDecimalInput, validateBetAmount } from "../utils";
import {
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
  checkBetAlreadyConfirmed: (actorAddress: string, normalizedTiles: number[]) => Promise<boolean>;
  ensureAllowance: (requiredAmount: bigint) => Promise<void>;
  finalizeMineSuccess: () => void;
  getBumpedFees: (stepBps?: bigint) => Promise<GasOverrides | undefined>;
  normalizedTiles: number[];
  placeBetsPreferSilent: (
    tileIds: number[],
    amountRawPerTile: bigint,
    gasOverrides?: GasOverrides,
  ) => Promise<"confirmed" | "pending">;
  source: MineAttemptSource;
}

export async function runManualMineAttempt({
  actorAddress,
  betAmountStr,
  checkBetAlreadyConfirmed,
  ensureAllowance,
  finalizeMineSuccess,
  getBumpedFees,
  normalizedTiles,
  placeBetsPreferSilent,
  source,
}: RunManualMineAttemptOptions): Promise<ReceiptState> {
  const validationError = validateBetAmount(betAmountStr);
  if (validationError) throw new Error(validationError);
  const normalized = normalizeDecimalInput(betAmountStr.trim());
  const singleAmountRaw = parseUnits(normalized, 18);
  const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);

  try {
    const state = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw);
    if (state === "pending") {
      log.warn(source, "bet tx is pending, skip immediate retry");
      return "pending";
    }
  } catch (error) {
    const allowanceRetry = isAllowanceError(error);
    if (isDeterministicBetExecutionError(error) && !allowanceRetry) {
      try {
        const alreadyConfirmed = await checkBetAlreadyConfirmed(actorAddress, normalizedTiles);
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
    if (isAllowanceError(error)) {
      await ensureAllowance(totalAmountRaw);
    }
    if (isReceiptTimeoutError(error)) {
      log.warn(source, "bet receipt timeout, avoid duplicate resend");
      return "pending";
    }
    let alreadyConfirmed = false;
    try {
      alreadyConfirmed = await checkBetAlreadyConfirmed(actorAddress, normalizedTiles);
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
    await delay(1500);
    const bumpedFees = await getBumpedFees(BigInt(130));
    const retryState = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw, bumpedFees);
    if (retryState === "pending") {
      log.warn(source, "retry bet tx still pending, skip additional resend");
      return "pending";
    }
  }

  finalizeMineSuccess();
  return "confirmed";
}
