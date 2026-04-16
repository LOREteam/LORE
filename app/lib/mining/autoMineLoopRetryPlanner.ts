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

export function planAutoMineLoopNetworkRetry(params: {
  currentRetryCount: number;
  initialMs: number;
  maxExponent?: number;
  maxMs: number;
  retryMax: number;
}): AutoMineLoopNetworkRetryDecision {
  const nextRetryCount = params.currentRetryCount + 1;
  if (nextRetryCount > params.retryMax) {
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
      params.initialMs,
      params.maxMs,
      params.maxExponent,
    ),
  };
}
