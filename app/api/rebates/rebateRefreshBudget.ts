export type RebateRefreshRpcKind = "summary" | "recent" | "exact" | "fallback";

export type RebateRefreshBudgetSnapshot = {
  epochCount: number;
  rpcCount: number;
  fallbackRpcCount: number;
  elapsedMs: number;
};

export type RebateRefreshTotals = {
  pendingRebateWei: bigint;
  summaryClaimableCount: number;
  claimableEpochs: number[];
  processedEpochs: number;
};

type RebateRefreshBudgetOptions = {
  maxEpochs: number;
  maxRpcCalls: number;
  maxFallbackRpcCalls: number;
  maxDurationMs: number;
  now?: () => number;
};

export class RebateRefreshBudgetExceededError extends Error {
  readonly reason: "epoch" | "rpc" | "fallback" | "deadline";

  constructor(reason: RebateRefreshBudgetExceededError["reason"]) {
    super(`Safety Pool refresh ${reason} budget exceeded`);
    this.name = "RebateRefreshBudgetExceededError";
    this.reason = reason;
  }
}

export function isRebateRefreshBudgetExceededError(
  error: unknown,
): error is RebateRefreshBudgetExceededError {
  return error instanceof RebateRefreshBudgetExceededError;
}

function requirePositiveSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

export function createRebateRefreshBudget(options: RebateRefreshBudgetOptions) {
  const maxEpochs = requirePositiveSafeInteger(options.maxEpochs, "maxEpochs");
  const maxRpcCalls = requirePositiveSafeInteger(options.maxRpcCalls, "maxRpcCalls");
  const maxFallbackRpcCalls = requireNonNegativeSafeInteger(
    options.maxFallbackRpcCalls,
    "maxFallbackRpcCalls",
  );
  const maxDurationMs = requirePositiveSafeInteger(options.maxDurationMs, "maxDurationMs");
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  let epochCount = 0;
  let rpcCount = 0;
  let fallbackRpcCount = 0;

  const assertWithinDeadline = () => {
    const remainingMs = maxDurationMs - (now() - startedAt);
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      throw new RebateRefreshBudgetExceededError("deadline");
    }
    return Math.max(1, Math.ceil(remainingMs));
  };

  return {
    reserveEpochs(count: number) {
      assertWithinDeadline();
      requireNonNegativeSafeInteger(count, "epoch count");
      if (count > maxEpochs - epochCount) {
        throw new RebateRefreshBudgetExceededError("epoch");
      }
      epochCount += count;
    },

    async runRpc<T>(kind: RebateRefreshRpcKind, operation: () => Promise<T>): Promise<T> {
      const remainingMs = assertWithinDeadline();
      if (rpcCount >= maxRpcCalls) {
        throw new RebateRefreshBudgetExceededError("rpc");
      }
      if (kind === "fallback" && fallbackRpcCount >= maxFallbackRpcCalls) {
        throw new RebateRefreshBudgetExceededError("fallback");
      }

      rpcCount += 1;
      if (kind === "fallback") fallbackRpcCount += 1;

      let timeout: ReturnType<typeof setTimeout> | null = null;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new RebateRefreshBudgetExceededError("deadline")),
          remainingMs,
        );
      });

      try {
        return await Promise.race([Promise.resolve().then(operation), deadline]);
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
    },

    snapshot(): RebateRefreshBudgetSnapshot {
      return {
        epochCount,
        rpcCount,
        fallbackRpcCount,
        elapsedMs: Math.max(0, now() - startedAt),
      };
    },
  };
}

export function selectRebateRefreshWindow<T>(
  items: readonly T[],
  requestedOffset: number,
  limit: number,
) {
  const normalizedLimit = requirePositiveSafeInteger(limit, "limit");
  const offset =
    Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 && requestedOffset < items.length
      ? requestedOffset
      : 0;
  const selected = items.slice(offset, offset + normalizedLimit);
  const endOffset = offset + selected.length;
  return {
    items: selected,
    offset,
    nextOffset: endOffset < items.length ? endOffset : null,
    complete: endOffset >= items.length,
  };
}

export function createEmptyRebateRefreshTotals(): RebateRefreshTotals {
  return {
    pendingRebateWei: 0n,
    summaryClaimableCount: 0,
    claimableEpochs: [],
    processedEpochs: 0,
  };
}

export function appendRebateRefreshTotals(
  current: RebateRefreshTotals,
  window: {
    pendingRebateWei: bigint;
    summaryClaimableCount: number;
    claimableEpochs: readonly number[];
    processedEpochs: number;
  },
): RebateRefreshTotals {
  if (window.pendingRebateWei < 0n) {
    throw new RangeError("pendingRebateWei must be non-negative");
  }
  requireNonNegativeSafeInteger(window.summaryClaimableCount, "summaryClaimableCount");
  requireNonNegativeSafeInteger(window.processedEpochs, "processedEpochs");
  const processedEpochs = current.processedEpochs + window.processedEpochs;
  if (!Number.isSafeInteger(processedEpochs)) {
    throw new RangeError("processedEpochs total must be a safe integer");
  }
  const summaryClaimableCount = Math.min(
    Number.MAX_SAFE_INTEGER,
    current.summaryClaimableCount + window.summaryClaimableCount,
  );
  const claimableEpochs = [...new Set([...current.claimableEpochs, ...window.claimableEpochs])]
    .filter((epoch) => Number.isSafeInteger(epoch) && epoch > 0)
    .sort((a, b) => b - a);
  return {
    pendingRebateWei: current.pendingRebateWei + window.pendingRebateWei,
    summaryClaimableCount,
    claimableEpochs,
    processedEpochs,
  };
}
