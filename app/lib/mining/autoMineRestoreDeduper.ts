import type { PersistedAutoMinerSession } from "../../hooks/useMining.shared";

export const AUTO_MINE_RESTORE_DEDUP_MS = 4_000;

export function getAutoMineRestoreFingerprint(session: PersistedAutoMinerSession): string {
  return [
    session.betStr,
    String(session.blocks),
    String(session.rounds),
    String(session.nextRoundIndex),
    session.lastPlacedEpoch ?? "",
  ].join("|");
}

export function shouldSuppressDuplicateAutoMineRestore(params: {
  previousAt: number | null | undefined;
  previousFingerprint: string | null | undefined;
  nextFingerprint: string;
  now?: number;
  cooldownMs?: number;
}): boolean {
  const {
    previousAt,
    previousFingerprint,
    nextFingerprint,
    now = Date.now(),
    cooldownMs = AUTO_MINE_RESTORE_DEDUP_MS,
  } = params;

  if (!previousFingerprint || previousFingerprint !== nextFingerprint) {
    return false;
  }
  if (!Number.isFinite(previousAt)) {
    return false;
  }
  return now - Number(previousAt) < cooldownMs;
}
