export function isFinalizedDepositsRecoveryEnabled(
  recoveryEnabled: boolean,
  finalityBlocks: bigint,
) {
  return recoveryEnabled && finalityBlocks > 0n;
}

export function planFinalizedDepositsRecoveryRange(input: {
  enabled: boolean;
  headBlock: bigint;
  finalityBlocks: bigint;
  contractDeployBlock: bigint;
  latestIndexedBlock: bigint | null;
  recentWindowBlocks: bigint;
}): { fromBlock: bigint; toBlock: bigint } | null {
  const {
    enabled,
    headBlock,
    finalityBlocks,
    contractDeployBlock,
    latestIndexedBlock,
    recentWindowBlocks,
  } = input;
  if (
    !isFinalizedDepositsRecoveryEnabled(enabled, finalityBlocks) ||
    headBlock < 0n ||
    contractDeployBlock < 0n ||
    recentWindowBlocks <= 0n ||
    headBlock <= finalityBlocks
  ) {
    return null;
  }

  const toBlock = headBlock - finalityBlocks;
  if (toBlock < contractDeployBlock) return null;
  const recoveryWindowStart =
    toBlock >= recentWindowBlocks
      ? toBlock - recentWindowBlocks + 1n
      : 0n;
  const boundedWindowStart =
    recoveryWindowStart > contractDeployBlock ? recoveryWindowStart : contractDeployBlock;
  const indexedStart =
    latestIndexedBlock !== null && latestIndexedBlock >= contractDeployBlock
      ? latestIndexedBlock + 1n
      : contractDeployBlock;
  const fromBlock = indexedStart > boundedWindowStart ? indexedStart : boundedWindowStart;
  return fromBlock > toBlock ? null : { fromBlock, toBlock };
}
