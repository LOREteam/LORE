import { resolveJackpotVisualKind, type JackpotVisualKind } from "./jackpotVisualTheme";

export type JackpotShareEvent = {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  txHash: string;
  /** Immutable event identity: lowercase transaction hash plus decimal log index. */
  eventId?: string;
  logIndex?: string;
  blockHash?: string;
  finalizedAtBlock?: string;
  blockNumber?: string;
};

export type VerifiedJackpotShare = {
  eventId: `${`0x${string}`}:${string}`;
  txHash: `0x${string}`;
  logIndex: string;
  epoch: string;
  kind: JackpotVisualKind;
  /** An amount is displayed only when one exact canonical jackpot event matches. */
  amount: string | null;
};

const EVENT_ID_RE = /^(0x[0-9a-f]{64}):([0-9]+)$/;
const BLOCK_HASH_RE = /^0x[0-9a-f]{64}$/;
const BLOCK_NUMBER_RE = /^(?:0|[1-9]\d*)$/;

export function normalizeJackpotShareTxHash(value: string | null | undefined): `0x${string}` | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized as `0x${string}` : null;
}

export function normalizeJackpotShareEventId(value: string | null | undefined): `${`0x${string}`}:${string}` | null {
  const match = EVENT_ID_RE.exec(String(value ?? "").trim().toLowerCase());
  if (!match) return null;
  const logIndex = BigInt(match[2]!);
  if (logIndex > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return `${match[1]!}:${logIndex}` as `${`0x${string}`}:${string}`;
}

function getCanonicalEventIdentity(row: JackpotShareEvent) {
  const eventId = normalizeJackpotShareEventId(row.eventId);
  const txHash = normalizeJackpotShareTxHash(row.txHash);
  const logIndex = String(row.logIndex ?? "").trim();
  const blockHash = String(row.blockHash ?? "").trim().toLowerCase();
  const blockNumber = String(row.blockNumber ?? "").trim();
  const finalizedAtBlock = String(row.finalizedAtBlock ?? "").trim();
  if (
    eventId === null ||
    txHash === null ||
    !/^[0-9]+$/.test(logIndex) ||
    !BLOCK_HASH_RE.test(blockHash) ||
    !BLOCK_NUMBER_RE.test(blockNumber) ||
    !/^[1-9]\d*$/.test(finalizedAtBlock)
  ) return null;

  const normalizedLogIndex = BigInt(logIndex);
  const finalizedBlock = BigInt(finalizedAtBlock);
  if (
    normalizedLogIndex > BigInt(Number.MAX_SAFE_INTEGER) ||
    finalizedBlock < BigInt(blockNumber) ||
    eventId !== `${txHash}:${normalizedLogIndex}`
  ) return null;
  return { eventId, txHash, logIndex: normalizedLogIndex.toString() };
}

/**
 * Derives public share fields exclusively from canonical finalized jackpot
 * events. URL parameters are lookup keys only; amount, tile, epoch and mode
 * are never accepted from the URL.
 */
export function selectVerifiedJackpotShare(
  events: readonly JackpotShareEvent[],
  eventIdOrLegacyTx: string | null | undefined,
): VerifiedJackpotShare | null {
  const requestedEventId = normalizeJackpotShareEventId(eventIdOrLegacyTx);
  const requestedTxHash = requestedEventId === null
    ? normalizeJackpotShareTxHash(eventIdOrLegacyTx)
    : null;
  if (requestedEventId === null && requestedTxHash === null) return null;

  const canonicalRows = events.flatMap((row) => {
    const identity = getCanonicalEventIdentity(row);
    return identity === null ? [] : [{ row, identity }];
  });
  const matches = requestedEventId !== null
    ? canonicalRows.filter(({ identity }) => identity.eventId === requestedEventId)
    : canonicalRows.filter(({ identity }) => identity.txHash === requestedTxHash);
  // A legacy transaction URL is retained only as a one-event transition. It
  // cannot select an arbitrary log from a transaction containing multiple wins.
  if (matches.length !== 1) return null;

  const { row, identity } = matches[0]!;
  if (!row.epoch) return null;
  return {
    eventId: identity.eventId,
    txHash: identity.txHash,
    logIndex: identity.logIndex,
    epoch: row.epoch,
    kind: resolveJackpotVisualKind(row.kind === "daily", row.kind === "weekly"),
    amount: row.amount.trim() ? row.amount : null,
  };
}