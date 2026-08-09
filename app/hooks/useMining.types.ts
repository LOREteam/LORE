"use client";

export type GasOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint };

export type SilentSendFn = (
  tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint; nonce?: number },
  gasOverrides?: GasOverrides,
) => Promise<`0x${string}`>;

export type RefreshSessionFn = () => Promise<void>;
export type MiningNotifyFn = (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
export type RunningParams = { betStr: string; blocks: number; rounds: number } | null;
export type AutoMinePhase =
  | "idle"
  | "starting"
  | "restoring"
  | "running"
  | "retry-wait"
  | "session-expired";

export interface AutoMineUiState {
  phase: AutoMinePhase;
  progress: string | null;
  runningParams: RunningParams;
}

export interface UseMiningOptions {
  refetchAllowance: () => void;
  refetchTileData: () => void;
  refetchUserBets: () => void;
  refetchEpoch?: () => void;
  refetchGridEpochData?: () => void;
  preferredAddress?: `0x${string}` | string | null;
  ensurePreferredWallet?: () => Promise<void> | void;
  sendTransactionSilent?: SilentSendFn;
  refreshSession?: RefreshSessionFn;
  onAutoMineBetConfirmed?: () => void;
  onNotify?: MiningNotifyFn;
}
