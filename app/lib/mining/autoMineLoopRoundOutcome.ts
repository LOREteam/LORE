import type { AutoMineLoopEvent } from "./autoMineLoopModel";

export type AutoMineLoopConfirmedRoundSource =
  | "finalized"
  | "detected-on-chain"
  | "recovered-after-network-error";

export interface AutoMineLoopConfirmedRoundOutcome {
  kind: "confirmed";
  source: AutoMineLoopConfirmedRoundSource;
  placedEpoch: bigint;
}

export type AutoMineLoopRoundAttemptOutcome =
  | { kind: "submitted" }
  | { kind: "stopped" }
  | { kind: "epoch-ended"; liveEpoch: bigint }
  | AutoMineLoopConfirmedRoundOutcome;

export type AutoMineLoopRoundRecoveryOutcome =
  | { kind: "retry" }
  | AutoMineLoopConfirmedRoundOutcome;

export function toAutoMineLoopConfirmedEvent(params: {
  outcome: AutoMineLoopConfirmedRoundOutcome;
  tiles: number[];
}): AutoMineLoopEvent {
  const { outcome, tiles } = params;

  switch (outcome.source) {
    case "finalized":
      return {
        type: "round-confirmed",
        placedEpoch: outcome.placedEpoch,
        tiles,
      };

    case "detected-on-chain":
      return {
        type: "round-detected-on-chain",
        placedEpoch: outcome.placedEpoch,
        tiles,
      };

    case "recovered-after-network-error":
      return {
        type: "round-recovered-after-network-error",
        placedEpoch: outcome.placedEpoch,
        tiles,
      };
  }
}
