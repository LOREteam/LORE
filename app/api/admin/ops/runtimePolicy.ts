const SAFE_DECIMAL_INTEGER_RE = /^[1-9]\d{0,15}$/;
const SAFE_ZERO_DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ISO_LOG_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;

export type LiveIndexerProgress = {
  scanFromBlock: string | null;
  scanToBlock: string | null;
  scanBlockCount: number | null;
  chunkIndex: number | null;
  chunkTotal: number | null;
  chunkFromBlock: string | null;
  chunkToBlock: string | null;
  fetchedLogs: number | null;
  parsedBets: number | null;
  parsedEpochs: number | null;
  parsedJackpots: number | null;
  parsedClaims: number | null;
  wroteChunk: boolean;
  progressPct: number | null;
};

export function parseAdminSafeDecimalInteger(
  value: string | null | undefined,
  options: { allowZero?: boolean } = {},
) {
  if (!value) return null;
  const allowZero = options.allowZero === true;
  const pattern = allowZero ? SAFE_ZERO_DECIMAL_INTEGER_RE : SAFE_DECIMAL_INTEGER_RE;
  if (!pattern.test(value)) return null;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  if (!allowZero && parsed <= 0n) return null;
  return Number(parsed);
}

export function parseStoredEpochNumber(value: string | null | undefined) {
  return parseAdminSafeDecimalInteger(value) ?? 0;
}

export function extractOpsLogTimestamp(line: string) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)/);
  return match?.[1] ?? null;
}

export function parseOpsLogTimestampMs(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const match = value.match(ISO_LOG_TIMESTAMP_RE);
  if (!match) return Number.NEGATIVE_INFINITY;
  const canonical = `${match[1]}.${match[2] ?? "000"}Z`;
  const timestampMs = Date.parse(canonical);
  return Number.isSafeInteger(timestampMs) && new Date(timestampMs).toISOString() === canonical
    ? timestampMs
    : Number.NEGATIVE_INFINITY;
}

export function parseLiveIndexerProgress(lines: readonly string[]): LiveIndexerProgress | null {
  let scanFromBlock: string | null = null;
  let scanToBlock: string | null = null;
  let scanBlockCount: number | null = null;
  let chunkIndex: number | null = null;
  let chunkTotal: number | null = null;
  let chunkFromBlock: string | null = null;
  let chunkToBlock: string | null = null;
  let fetchedLogs: number | null = null;
  let parsedBets: number | null = null;
  let parsedEpochs: number | null = null;
  let parsedJackpots: number | null = null;
  let parsedClaims: number | null = null;
  let wroteChunk = false;

  for (const line of lines) {
    const scanMatch = line.match(/\[indexer\]\s+Scanning blocks\s+(\d+)\D+(\d+)\s+\((\d+)\s+blocks\)/i);
    if (scanMatch) {
      scanFromBlock = scanMatch[1] ?? null;
      scanToBlock = scanMatch[2] ?? null;
      scanBlockCount = parseAdminSafeDecimalInteger(scanMatch[3]);
      chunkIndex = null;
      chunkTotal = null;
      chunkFromBlock = null;
      chunkToBlock = null;
      fetchedLogs = null;
      parsedBets = null;
      parsedEpochs = null;
      parsedJackpots = null;
      parsedClaims = null;
      wroteChunk = false;
      continue;
    }

    const chunkMatch = line.match(/\[indexer\]\s+Chunk\s+(\d+)\/(\d+):\s+(\d+)\s+->\s+(\d+)/i);
    if (chunkMatch) {
      chunkIndex = parseAdminSafeDecimalInteger(chunkMatch[1]);
      chunkTotal = parseAdminSafeDecimalInteger(chunkMatch[2]);
      chunkFromBlock = chunkMatch[3] ?? null;
      chunkToBlock = chunkMatch[4] ?? null;
      fetchedLogs = null;
      parsedBets = null;
      parsedEpochs = null;
      parsedJackpots = null;
      parsedClaims = null;
      wroteChunk = false;
      continue;
    }

    const fetchedMatch = line.match(/\[indexer\]\s+Chunk\s+(\d+)\/(\d+)\s+fetched\s+(\d+)\s+logs/i);
    if (fetchedMatch) {
      fetchedLogs = parseAdminSafeDecimalInteger(fetchedMatch[3], { allowZero: true });
      continue;
    }

    const parsedMatch = line.match(
      /\[indexer\]\s+Chunk\s+(\d+)\/(\d+)\s+parsed:\s+(\d+)\s+bets,\s+(\d+)\s+epochs,\s+(\d+)\s+jackpots,\s+(\d+)\s+claims/i,
    );
    if (parsedMatch) {
      parsedBets = parseAdminSafeDecimalInteger(parsedMatch[3], { allowZero: true });
      parsedEpochs = parseAdminSafeDecimalInteger(parsedMatch[4], { allowZero: true });
      parsedJackpots = parseAdminSafeDecimalInteger(parsedMatch[5], { allowZero: true });
      parsedClaims = parseAdminSafeDecimalInteger(parsedMatch[6], { allowZero: true });
      continue;
    }

    if (/\[indexer\]\s+Chunk\s+(\d+)\/(\d+)\s+written to local SQLite/i.test(line)) {
      wroteChunk = true;
    }
  }

  if (!scanFromBlock && !chunkFromBlock) return null;

  const progressPct =
    chunkIndex != null && chunkTotal != null && chunkTotal > 0
      ? Math.max(0, Math.min(100, (chunkIndex / chunkTotal) * 100))
      : null;

  return {
    scanFromBlock,
    scanToBlock,
    scanBlockCount,
    chunkIndex,
    chunkTotal,
    chunkFromBlock,
    chunkToBlock,
    fetchedLogs,
    parsedBets,
    parsedEpochs,
    parsedJackpots,
    parsedClaims,
    wroteChunk,
    progressPct,
  };
}
