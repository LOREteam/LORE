import { getNetworkRetryDelayMs } from "./networkRetry";

export type AutoMineLoopNetworkRetryDecision =
  | {
      kind: "retry";
      retryCount: number;
      waitMs: number;
    }
  | {
      kind: "give-up";
      retryCount: number;
    };

function normalizeNonNegativeSafeInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizePositiveSafeInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function planAutoMineLoopNetworkRetry(params: {
  currentRetryCount: number;
  initialMs: number;
  maxExponent?: number;
  maxMs: number;
  retryMax: number;
}): AutoMineLoopNetworkRetryDecision {
  const currentRetryCount = normalizeNonNegativeSafeInteger(params.currentRetryCount);
  const retryMax = normalizeNonNegativeSafeInteger(params.retryMax);
  const initialMs = normalizePositiveSafeInteger(params.initialMs);
  const maxMs = normalizePositiveSafeInteger(params.maxMs);
  const maxExponent = params.maxExponent === undefined
    ? undefined
    : normalizeNonNegativeSafeInteger(params.maxExponent);

  if (
    currentRetryCount === null ||
    retryMax === null ||
    initialMs === null ||
    maxMs === null ||
    maxMs < initialMs ||
    maxExponent === null
  ) {
    return {
      kind: "give-up",
      retryCount: currentRetryCount ?? 0,
    };
  }

  const nextRetryCount = currentRetryCount + 1;
  if (nextRetryCount > retryMax) {
    return {
      kind: "give-up",
      retryCount: nextRetryCount,
    };
  }

  return {
    kind: "retry",
    retryCount: nextRetryCount,
    waitMs: getNetworkRetryDelayMs(
      nextRetryCount - 1,
      initialMs,
      maxMs,
      maxExponent,
    ),
  };
}
