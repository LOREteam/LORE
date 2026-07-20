const CONTRACT_ERROR_KINDS: Readonly<Record<string, string>> = Object.freeze({
  AlreadyResolved: "already-resolved",
  EpochClosing: "late-bet",
  EpochEnded: "late-bet",
  ERC20InsufficientAllowance: "insufficient-allowance",
  ERC20InsufficientBalance: "insufficient-balance",
  TimerNotEnded: "timer-not-ended",
});

const KNOWN_CONTRACT_ERRORS = new Set([
  "AlreadyClaimed",
  "ArraysMismatch",
  "CanOnlyResolveCurrent",
  "DustAlreadySettled",
  "DustSettlementDelayNotReached",
  "EmptyArray",
  "InvalidEpochDuration",
  "InvalidFeeRecipient",
  "InvalidInitialOwner",
  "InvalidTile",
  "InvalidTileMask",
  "InvalidTokenAddress",
  "NoPendingEpochDurationChange",
  "NoPendingFeeRecipientChange",
  "NoRebateAvailable",
  "NoWinningBet",
  "NotResolved",
  "NothingToClaim",
  "NothingToFlush",
  "OwnershipRenounceDisabled",
  "RebateAlreadyClaimed",
  "RewardClaimWindowExpired",
  "ZeroAmount",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function classifyCanaryContractError(error: unknown): { kind: string; message: string } | null {
  const pending: unknown[] = [error];
  const visited = new Set<object>();

  for (let depth = 0; depth < 8 && pending.length > 0; depth += 1) {
    const current = asRecord(pending.shift());
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const errorName = typeof current.errorName === "string"
      ? current.errorName
      : asRecord(current.data)?.errorName;
    if (typeof errorName === "string") {
      const kind = CONTRACT_ERROR_KINDS[errorName] ?? (KNOWN_CONTRACT_ERRORS.has(errorName) ? "contract-revert" : null);
      if (kind) return { kind, message: `contract custom error ${errorName}` };
    }

    pending.push(current.cause, current.data);
  }

  return null;
}
