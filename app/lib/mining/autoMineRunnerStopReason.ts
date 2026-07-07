import type { AutoMineDiagnosticsStopReason } from "./autoMineDiagnostics";

export function getAutoMineRunnerCatchStopReason(params: {
  insufficientFunds: boolean;
  sessionExpired: boolean;
  shouldAutoResume: boolean;
}): AutoMineDiagnosticsStopReason {
  if (params.insufficientFunds) return "insufficient-balance";
  if (params.sessionExpired) return "session-expired";
  if (params.shouldAutoResume) return "retry-wait";
  return "error";
}
