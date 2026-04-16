import type { PublicClient } from "viem";

export interface AutoMineLoopReadyRoundCommand {
  client: PublicClient;
  effectiveBlocks: number;
  epochNeedsResolve: boolean;
  liveEpoch: bigint;
  roundCandidateEpochs: bigint[];
  selectionEpoch: string;
  tilesToBet: number[];
}

export type AutoMineLoopPrepareRoundCommandResult =
  | { kind: "stop-no-client" }
  | { kind: "skip-existing"; liveEpoch: bigint; alreadyBetTiles: number[]; effectiveBlocks: number }
  | { kind: "stop-insufficient-balance"; neededAmount: number; currentAmount: number }
  | { kind: "ready"; command: AutoMineLoopReadyRoundCommand; alreadyBetTiles: number[] };
