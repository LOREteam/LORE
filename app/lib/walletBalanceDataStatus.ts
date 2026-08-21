export interface WalletBalanceDataStatus {
  fetching: boolean;
  error: boolean;
  stale: boolean;
  updatedAt: number | null;
}

export const UNKNOWN_WALLET_BALANCE_DATA_STATUS: WalletBalanceDataStatus = {
  fetching: false,
  error: false,
  stale: false,
  updatedAt: null,
};

export function toWalletBalanceDataStatus({
  dataUpdatedAt,
  isError,
  isFetching,
  isStale,
}: {
  dataUpdatedAt?: number;
  isError?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
}): WalletBalanceDataStatus {
  return {
    fetching: Boolean(isFetching),
    error: Boolean(isError),
    stale: Boolean(isStale),
    updatedAt: Number.isSafeInteger(dataUpdatedAt) && (dataUpdatedAt ?? 0) > 0 ? dataUpdatedAt! : null,
  };
}
