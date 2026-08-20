import { resolveJackpotVisualKind, type JackpotVisualKind } from "./jackpotVisualTheme";

export type JackpotShareEvent = {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  txHash: string;
};

export type VerifiedJackpotShare = {
  txHash: `0x${string}`;
  epoch: string;
  kind: JackpotVisualKind;
  /** An amount is displayed only when one exact jackpot event matches the transaction. */
  amount: string | null;
};

export function normalizeJackpotShareTxHash(value: string | null | undefined): `0x${string}` | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized as `0x${string}` : null;
}

/**
 * Derives public share fields exclusively from indexed jackpot events. Query
 * parameters are only an event lookup key; they never supply a reward amount,
 * tile, epoch, or visual mode.
 */
export function selectVerifiedJackpotShare(
  events: readonly JackpotShareEvent[],
  txHash: string | null | undefined,
): VerifiedJackpotShare | null {
  const normalizedTxHash = normalizeJackpotShareTxHash(txHash);
  if (!normalizedTxHash) return null;

  const rows = events.filter((row) => normalizeJackpotShareTxHash(row.txHash) === normalizedTxHash);
  if (rows.length === 0) return null;

  const first = rows[0]!;
  if (!first.epoch || rows.some((row) => row.epoch !== first.epoch)) return null;
  const kind = resolveJackpotVisualKind(
    rows.some((row) => row.kind === "daily"),
    rows.some((row) => row.kind === "weekly"),
  );

  return {
    txHash: normalizedTxHash,
    epoch: first.epoch,
    kind,
    amount: rows.length === 1 && first.amount.trim() ? first.amount : null,
  };
}
