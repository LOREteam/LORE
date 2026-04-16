export type AutoMineLoopRuntimeCommand =
  | { type: "clear-pending-bet" }
  | { type: "sleep"; ms: number }
  | {
      type: "confirmation-start";
      clearSelection?: boolean;
      progressMessage: string;
      refetchEpoch?: boolean;
    };

export function clearPendingBetCommand(): AutoMineLoopRuntimeCommand {
  return { type: "clear-pending-bet" };
}

export function sleepCommand(ms: number): AutoMineLoopRuntimeCommand {
  return { type: "sleep", ms };
}

export function confirmationStartCommand(params: {
  clearSelection?: boolean;
  progressMessage: string;
  refetchEpoch?: boolean;
}): AutoMineLoopRuntimeCommand {
  return {
    type: "confirmation-start",
    clearSelection: params.clearSelection,
    progressMessage: params.progressMessage,
    refetchEpoch: params.refetchEpoch,
  };
}
