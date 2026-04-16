import { parseUnits } from "viem";
import { log } from "../logger";
import { delay, normalizeDecimalInput, validateBetAmount } from "../utils";
import {
  isAllowanceError,
  isReceiptTimeoutError,
  isRetryableError,
} from "../../hooks/useMining.shared";
import type { GasOverrides } from "../../hooks/useMining.types";

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
}: RunManualMineAttemptOptions) {
  const validationError = validateBetAmount(betAmountStr);
  if (validationError) throw new Error(validationError);
  const normalized = normalizeDecimalInput(betAmountStr.trim());
  const singleAmountRaw = parseUnits(normalized, 18);
  const totalAmountRaw = singleAmountRaw * BigInt(normalizedTiles.length);

  try {
    const state = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw);
    if (state === "pending") {
      log.warn(source, "bet tx is pending, skip immediate retry");
      finalizeMineSuccess();
      return true;
    }
  } catch (error) {
    if (!isRetryableError(error)) throw error;
    if (isAllowanceError(error)) {
      await ensureAllowance(totalAmountRaw);
    }
    if (isReceiptTimeoutError(error)) {
      log.warn(source, "bet receipt timeout, avoid duplicate resend");
      finalizeMineSuccess();
      return true;
    }
    const alreadyConfirmed = await checkBetAlreadyConfirmed(actorAddress, normalizedTiles);
    if (alreadyConfirmed) {
      log.info(source, "skipping retry - bets already on-chain", {
        confirmedTiles: normalizedTiles.length,
      });
      finalizeMineSuccess();
      return true;
    }
    await delay(1500);
    const bumpedFees = await getBumpedFees(BigInt(130));
    const retryState = await placeBetsPreferSilent(normalizedTiles, singleAmountRaw, bumpedFees);
    if (retryState === "pending") {
      log.warn(source, "retry bet tx still pending, skip additional resend");
    }
  }

  finalizeMineSuccess();
  return true;
}
