import type { CurrentRoundEvidence } from "./currentRoundEvidence";

export const COUNTDOWN_ZERO_WINDOW_MS = 1_000;
/** Matches the operational keeper-delay SLO used by the runtime monitor. */
export const KEEPER_DELAY_THRESHOLD_MS = 120_000;
const MAX_SAFE_EPOCH_END_SECONDS = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000));

export type RoundSourceHealth = "unknown" | "fresh" | "stale";

export interface RoundHealth {
  rpc: RoundSourceHealth;
  indexer: RoundSourceHealth;
}

export type RoundPhase =
  | "syncing"
  | "countdown-zero"
  | "active"
  | "active-empty"
  | "settlement-pending"
  | "keeper-delayed"
  | "expired-empty"
  | "resolved-next-round";

export type RoundPresentationKind = RoundPhase | "stale-rpc" | "stale-indexer";

export interface RoundPresentationInput {
  actualCurrentEpoch?: bigint | string | null;
  gridDisplayEpoch?: string | null;
  visualEpoch?: string | null;
  isRevealing: boolean;
  liveStateReady: boolean;
  timerReady: boolean;
  timeLeft: number;
  currentRoundEvidence: CurrentRoundEvidence;
  nowMs: number;
  health?: Partial<RoundHealth>;
}

export interface RoundPresentation {
  kind: RoundPresentationKind;
  phase: RoundPhase;
  health: RoundHealth;
  epochHeading: "Epoch" | "Resolved";
  epoch: string | null;
  nextEpoch: string | null;
  timerHeading: string;
  timerDisplay: "countdown" | "placeholder";
  statusLabel: string;
  statusDescription: string;
  accent: "violet" | "amber" | "danger" | "muted";
  showMiningIndicator: boolean;
  showSettlementIndicator: boolean;
  timerStalled: boolean;
  /** Presentation state must never become a second source of betting policy. */
  blocksBetting: false;
}

function normalizeEpoch(value: bigint | string | null | undefined): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  return BigInt(value).toString();
}

export function normalizeRoundEpochEndMs(value: unknown): number | null {
  if (
    typeof value !== "bigint" ||
    value <= 0n ||
    value > MAX_SAFE_EPOCH_END_SECONDS
  ) {
    return null;
  }
  const endMs = Number(value) * 1000;
  return Number.isSafeInteger(endMs) ? endMs : null;
}

function syncingPresentation(epoch: string | null, health: RoundHealth): RoundPresentation {
  return {
    kind: "syncing",
    phase: "syncing",
    health,
    epochHeading: "Epoch",
    epoch,
    nextEpoch: null,
    timerHeading: "Timer",
    timerDisplay: "placeholder",
    statusLabel: "Syncing",
    statusDescription: "Round state is syncing",
    accent: "muted",
    showMiningIndicator: false,
    showSettlementIndicator: false,
    timerStalled: false,
    blocksBetting: false,
  };
}

export function deriveRoundPresentation({
  actualCurrentEpoch,
  gridDisplayEpoch,
  visualEpoch,
  isRevealing,
  liveStateReady,
  timerReady,
  timeLeft,
  currentRoundEvidence,
  nowMs,
  health: healthInput,
}: RoundPresentationInput): RoundPresentation {
  const currentEpoch = normalizeEpoch(actualCurrentEpoch) ?? normalizeEpoch(visualEpoch);
  const displayedGridEpoch = normalizeEpoch(gridDisplayEpoch);
  const health: RoundHealth = {
    rpc: healthInput?.rpc ?? "unknown",
    indexer: healthInput?.indexer ?? "unknown",
  };

  if (!liveStateReady || !timerReady) return syncingPresentation(currentEpoch, health);

  if (health.rpc === "stale") {
    return {
      ...syncingPresentation(currentEpoch, health),
      kind: "stale-rpc",
      statusLabel: "RPC stale",
      statusDescription: "Chain round data is stale",
      accent: "danger",
    };
  }

  const evidenceEpoch = normalizeEpoch(currentRoundEvidence.currentEpoch);
  const currentEpochTotalPoolWei = currentRoundEvidence.currentEpochTotalPoolWei;
  const effectiveEpochEndMs = normalizeRoundEpochEndMs(
    currentRoundEvidence.effectiveEpochEndTime,
  );
  if (
    !currentEpoch ||
    evidenceEpoch !== currentEpoch ||
    typeof currentEpochTotalPoolWei !== "bigint" ||
    currentEpochTotalPoolWei < 0n ||
    effectiveEpochEndMs === null ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  ) {
    return syncingPresentation(currentEpoch, health);
  }

  let presentation: RoundPresentation;
  if (isRevealing) {
    if (
      !currentEpoch ||
      !displayedGridEpoch ||
      BigInt(displayedGridEpoch) >= BigInt(currentEpoch)
    ) {
      return syncingPresentation(currentEpoch, health);
    }

    presentation = {
      kind: "resolved-next-round",
      phase: "resolved-next-round",
      health,
      epochHeading: "Resolved",
      epoch: displayedGridEpoch,
      nextEpoch: currentEpoch,
      timerHeading: `Next #${currentEpoch}`,
      timerDisplay: "countdown",
      statusLabel: "Resolved",
      statusDescription: `Round #${displayedGridEpoch} resolved; next round #${currentEpoch} is active`,
      accent: "amber",
      showMiningIndicator: false,
      showSettlementIndicator: true,
      timerStalled: false,
      blocksBetting: false,
    };
  } else if (nowMs < effectiveEpochEndMs) {
    const millisecondsUntilEnd = effectiveEpochEndMs - nowMs;
    if (timeLeft <= 0) {
      if (millisecondsUntilEnd >= COUNTDOWN_ZERO_WINDOW_MS) {
        return syncingPresentation(currentEpoch, health);
      }
      presentation = {
        kind: "countdown-zero",
        phase: "countdown-zero",
        health,
        epochHeading: "Epoch",
        epoch: currentEpoch,
        nextEpoch: null,
        timerHeading: "Timer",
        timerDisplay: "countdown",
        statusLabel: "00:00",
        statusDescription: "Countdown reached 00:00; round end is imminent",
        accent: "amber",
        showMiningIndicator: false,
        showSettlementIndicator: true,
        timerStalled: true,
        blocksBetting: false,
      };
    } else {
      const isEmpty = currentEpochTotalPoolWei === 0n;
      presentation = {
        kind: isEmpty ? "active-empty" : "active",
        phase: isEmpty ? "active-empty" : "active",
        health,
        epochHeading: "Epoch",
        epoch: currentEpoch,
        nextEpoch: null,
        timerHeading: "Timer",
        timerDisplay: "countdown",
        statusLabel: isEmpty ? "No bets yet" : "Mining",
        statusDescription: isEmpty ? "Round is active and has no bets yet" : "Round is active",
        accent: "violet",
        showMiningIndicator: true,
        showSettlementIndicator: false,
        timerStalled: false,
        blocksBetting: false,
      };
    }
  } else if (currentEpochTotalPoolWei === 0n) {
    presentation = {
      kind: "expired-empty",
      phase: "expired-empty",
      health,
      epochHeading: "Epoch",
      epoch: currentEpoch,
      nextEpoch: null,
      timerHeading: "Timer",
      timerDisplay: "countdown",
      statusLabel: "No bets",
      statusDescription: "Round expired without bets; selecting tiles can start the next round",
      accent: "amber",
      showMiningIndicator: false,
      showSettlementIndicator: false,
      timerStalled: true,
      blocksBetting: false,
    };
  } else {
    const overdueMs = nowMs - effectiveEpochEndMs;
    const keeperDelayed = overdueMs > KEEPER_DELAY_THRESHOLD_MS;
    presentation = {
      kind: keeperDelayed ? "keeper-delayed" : "settlement-pending",
      phase: keeperDelayed ? "keeper-delayed" : "settlement-pending",
      health,
      epochHeading: "Epoch",
      epoch: currentEpoch,
      nextEpoch: null,
      timerHeading: "Timer",
      timerDisplay: "countdown",
      statusLabel: keeperDelayed ? "Keeper delayed" : "Settling",
      statusDescription: keeperDelayed
        ? "Settlement is delayed while waiting for a keeper"
        : "Settlement is pending",
      accent: keeperDelayed ? "danger" : "amber",
      showMiningIndicator: false,
      showSettlementIndicator: true,
      timerStalled: true,
      blocksBetting: false,
    };
  }

  if (health.indexer === "stale") {
    return {
      ...presentation,
      kind: "stale-indexer",
      statusLabel: "Indexer stale",
      statusDescription: `${presentation.statusDescription}; indexed data is stale`,
      accent: "danger",
      showMiningIndicator: false,
      showSettlementIndicator: false,
    };
  }

  return presentation;
}
