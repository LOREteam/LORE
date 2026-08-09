import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "../../_lib/adminSession";
import { getEpochMap, getMetaBigInt, getMetaJson, getMetaNumber, getRecentJackpots, getRecentRewardClaims } from "../../../../server/storage";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";

type LogSourceSummary = {
  key: string;
  label: string;
  fileName: string;
  exists: boolean;
  status: "fresh" | "stale" | "missing";
  ageMs: number | null;
  lineCount: number;
  lastLine: string | null;
};

type RecentLogEntry = {
  ts: string | null;
  level: "error" | "warn" | "info";
  source: string;
  message: string;
};

type RecentResolvedEpoch = {
  epoch: number;
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  resolvedBlock: string | null;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
};

type LiveIndexerProgress = {
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

type IndexerRunStatus = {
  headBlock?: string;
  finalityBlocks?: string;
  targetBlock?: string | null;
  lastProcessedBlock?: string;
};

type LoadedLogSource = {
  source: LogSourceSummary;
  lines: string[];
};

const LOG_SOURCES = [
  { key: "site", label: "Site", file: resolve(process.cwd(), "artifacts", "start-3000.log") },
  { key: "indexer", label: "Indexer", file: resolve(process.cwd(), "artifacts", "indexer-watch.log") },
  { key: "bot", label: "Bot / Keeper", file: resolve(process.cwd(), "artifacts", "bot.log") },
] as const;

const ERROR_PATTERNS = [
  /\[ERROR\]/i,
  /\berror\b/i,
  /\bfailed\b/i,
  /\bcrash(?:ed)?\b/i,
  /\bexception\b/i,
  /\bdegraded\b/i,
] as const;

const EVENT_PATTERNS = [
  /\bresolved\b/i,
  /\bresolve\b/i,
  /\bstarted\b/i,
  /\bhealthy\b/i,
  /\breconcile\b/i,
  /\brepair\b/i,
  /\bjackpot\b/i,
  /\bround\b/i,
] as const;

const OPS_LOG_CACHE_MS = 5_000;
const MAX_OPS_LOG_TAIL_BYTES = 256 * 1024;
const ISO_LOG_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;

let loadedLogSourcesCache:
  | {
      key: string;
      expiresAt: number;
      value: LoadedLogSource[];
    }
  | null = null;

function splitLogLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => sanitizeLogText(line))
    .filter(Boolean);
}

function pathIsRegularFile(file: string) {
  try {
    return existsSync(file) && statSync(file).isFile();
  } catch {
    return false;
  }
}

function readBoundedLogTail(file: string) {
  const stat = statSync(file);
  if (stat.size <= 0) return "";
  const length = Math.min(stat.size, MAX_OPS_LOG_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, stat.size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

function sanitizeLogText(line: string) {
  return line
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u0000/g, "")
    .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|KEY|PRIVATE|PASSWORD|RPC|DSN|WEBHOOK)[A-Z0-9_]*)=([^\s]+)/gi, "$1=<redacted>")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<redacted-url>")
    .replace(/\b0x[a-fA-F0-9]{80,}\b/g, "<redacted-calldata>")
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, "<redacted-address>")
    .replace(/\u0442\u0426\u2593|\u0442\u042c\u0423|\u0442\u0410\u0424|\u0442\u0416\u0422|\u0432\u0402\u045A|\u0432\u0402\u045C|\u0432\u0402"/g, " ")
    .replace(/[^\x20-\x7E\u0400-\u04FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimestamp(line: string) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)/);
  return match?.[1] ?? null;
}

function parseLogTimestampMs(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const match = value.match(ISO_LOG_TIMESTAMP_RE);
  if (!match) return Number.NEGATIVE_INFINITY;
  const canonical = `${match[1]}.${match[2] ?? "000"}Z`;
  const timestampMs = Date.parse(canonical);
  return Number.isSafeInteger(timestampMs) && new Date(timestampMs).toISOString() === canonical
    ? timestampMs
    : Number.NEGATIVE_INFINITY;
}

function detectLevel(line: string): "error" | "warn" | "info" {
  if (/\[ERROR\]/i.test(line) || /\berror\b/i.test(line) || /\bfailed\b/i.test(line)) return "error";
  if (/\[WARN\]/i.test(line) || /\bwarn(?:ing)?\b/i.test(line)) return "warn";
  return "info";
}

function trimLogPrefix(line: string) {
  return line
    .replace(/^(\d{4}-\d{2}-\d{2}T[^ ]+\s+)?\[[A-Z ]+\]\s*/i, "")
    .replace(/^npm\.cmd\s*:\s*/i, "")
    .replace(/^>\s+/, "")
    .trim();
}

function matchesAny(line: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(line));
}

const SAFE_DECIMAL_INTEGER_RE = /^[1-9]\d{0,15}$/;
const SAFE_ZERO_DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseSafeDecimalInteger(value: string | null | undefined, options: { allowZero?: boolean } = {}) {
  if (!value) return null;
  const allowZero = options.allowZero === true;
  const pattern = allowZero ? SAFE_ZERO_DECIMAL_INTEGER_RE : SAFE_DECIMAL_INTEGER_RE;
  if (!pattern.test(value)) return null;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  if (!allowZero && parsed <= 0n) return null;
  return Number(parsed);
}

function parseStoredEpochNumber(value: string | null | undefined) {
  return parseSafeDecimalInteger(value) ?? 0;
}

function parseLogCounter(value: string | null | undefined, options: { allowZero?: boolean } = {}) {
  return parseSafeDecimalInteger(value, options);
}

function summarizeLogSource(file: string, key: string, label: string): LogSourceSummary {
  if (!pathIsRegularFile(file)) {
    return {
      key,
      label,
      fileName: basename(file),
      exists: false,
      status: "missing",
      ageMs: null,
      lineCount: 0,
      lastLine: null,
    };
  }

  const stat = statSync(file);
  const ageMs = Date.now() - stat.mtimeMs;
  const raw = readBoundedLogTail(file);
  const lines = splitLogLines(raw);
  return {
    key,
    label,
    fileName: basename(file),
    exists: true,
    status: key === "site" ? "fresh" : ageMs <= 90_000 ? "fresh" : "stale",
    ageMs,
    lineCount: lines.length,
    lastLine: lines.at(-1) ?? (key === "site" ? "Process is serving requests." : null),
  };
}
void summarizeLogSource;

function loadLogSource(file: string, key: string, label: string): LoadedLogSource {
  if (!pathIsRegularFile(file)) {
    return {
      source: {
        key,
        label,
        fileName: basename(file),
        exists: false,
        status: "missing",
        ageMs: null,
        lineCount: 0,
        lastLine: null,
      },
      lines: [],
    };
  }

  const stat = statSync(file);
  const ageMs = Date.now() - stat.mtimeMs;
  const lines = splitLogLines(readBoundedLogTail(file));
  return {
    source: {
      key,
      label,
      fileName: basename(file),
      exists: true,
      status: key === "site" ? "fresh" : ageMs <= 90_000 ? "fresh" : "stale",
      ageMs,
      lineCount: lines.length,
      lastLine: lines.at(-1) ?? (key === "site" ? "Process is serving requests." : null),
    },
    lines,
  };
}

function getLoadedLogSources(): LoadedLogSource[] {
  const signature = LOG_SOURCES.map((source) => {
    if (!pathIsRegularFile(source.file)) return `${source.key}:missing`;
    const stat = statSync(source.file);
    return `${source.key}:${stat.mtimeMs}:${stat.size}`;
  }).join("|");

  const now = Date.now();
  if (
    loadedLogSourcesCache &&
    loadedLogSourcesCache.key === signature &&
    loadedLogSourcesCache.expiresAt > now
  ) {
    return loadedLogSourcesCache.value;
  }

  const value = LOG_SOURCES.map((source) => loadLogSource(source.file, source.key, source.label));
  loadedLogSourcesCache = {
    key: signature,
    expiresAt: now + OPS_LOG_CACHE_MS,
    value,
  };
  return value;
}

function collectRecentLogEntries(
  loadedSources: LoadedLogSource[],
  patterns: readonly RegExp[],
  limit: number,
): RecentLogEntry[] {
  const rows: RecentLogEntry[] = [];

  for (const loaded of loadedSources) {
    const matched = loaded.lines
      .filter((line) => matchesAny(line, patterns))
      .slice(-Math.max(limit, 20));

    for (const line of matched) {
      rows.push({
        ts: extractTimestamp(line),
        level: detectLevel(line),
        source: loaded.source.label,
        message: trimLogPrefix(line),
      });
    }
  }

  return rows
    .sort((left, right) => {
      const leftTs = parseLogTimestampMs(left.ts);
      const rightTs = parseLogTimestampMs(right.ts);
      return rightTs - leftTs;
    })
    .slice(0, limit);
}

function getRecentResolvedEpochs(limit = 8): RecentResolvedEpoch[] {
  const epochs = getEpochMap();
  return Object.entries(epochs)
    .map(([epoch, row]) => {
      const epochNumber = parseStoredEpochNumber(epoch);
      return {
        epoch: epochNumber,
        winningTile: row.winningTile,
        totalPool: row.totalPool,
        rewardPool: row.rewardPool,
        resolvedBlock: row.resolvedBlock ?? null,
        isDailyJackpot: row.isDailyJackpot,
        isWeeklyJackpot: row.isWeeklyJackpot,
      };
    })
    .filter((row) => row.epoch > 0)
    .sort((left, right) => right.epoch - left.epoch)
    .slice(0, limit);
}

function parseLiveIndexerProgress(lines: string[]): LiveIndexerProgress | null {
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
      scanBlockCount = parseLogCounter(scanMatch[3], { allowZero: false });
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
      chunkIndex = parseLogCounter(chunkMatch[1], { allowZero: false });
      chunkTotal = parseLogCounter(chunkMatch[2], { allowZero: false });
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
      fetchedLogs = parseLogCounter(fetchedMatch[3], { allowZero: true }) ?? 0;
      continue;
    }

    const parsedMatch = line.match(
      /\[indexer\]\s+Chunk\s+(\d+)\/(\d+)\s+parsed:\s+(\d+)\s+bets,\s+(\d+)\s+epochs,\s+(\d+)\s+jackpots,\s+(\d+)\s+claims/i,
    );
    if (parsedMatch) {
      parsedBets = parseLogCounter(parsedMatch[3], { allowZero: true }) ?? 0;
      parsedEpochs = parseLogCounter(parsedMatch[4], { allowZero: true }) ?? 0;
      parsedJackpots = parseLogCounter(parsedMatch[5], { allowZero: true }) ?? 0;
      parsedClaims = parseLogCounter(parsedMatch[6], { allowZero: true }) ?? 0;
      continue;
    }

    const wroteMatch = line.match(/\[indexer\]\s+Chunk\s+(\d+)\/(\d+)\s+written to local SQLite/i);
    if (wroteMatch) {
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

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-ops",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  if (!readAdminSession(request)) {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Admin auth required" }, { status: 401 }),
      { varyCookie: true },
    );
  }

  const loadedLogSources = getLoadedLogSources();
  const logSources = loadedLogSources.map((loaded) => loaded.source);
  const recentErrors = collectRecentLogEntries(loadedLogSources, ERROR_PATTERNS, 12);
  const recentEvents = collectRecentLogEntries(loadedLogSources, EVENT_PATTERNS, 16);
  const recentResolvedEpochs = getRecentResolvedEpochs(8);
  const recentJackpots = getRecentJackpots(6);
  const recentRewardClaims = getRecentRewardClaims(6);
  const liveIndexer = parseLiveIndexerProgress(
    loadedLogSources.find((loaded) => loaded.source.key === "indexer")?.lines ?? [],
  );
  const currentEpochMeta = getMetaNumber("currentEpoch");
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock")?.toString() ?? null;
  const repairCursorBlock = getMetaBigInt("repairCursorBlock")?.toString() ?? null;
  const indexerRunStatus = getMetaJson<IndexerRunStatus>("indexerRunStatus");

  const payload = {
    status: "ok" as const,
    generatedAt: Date.now(),
    logSources,
    recentErrors,
    recentEvents,
    recentResolvedEpochs,
    recentJackpots,
    recentRewardClaims,
    liveIndexer,
    storage: {
      currentEpochMeta,
      lastIndexedBlock,
      repairCursorBlock,
      headBlock: indexerRunStatus?.headBlock ?? null,
      finalityBlocks: indexerRunStatus?.finalityBlocks ?? null,
      targetBlock: indexerRunStatus?.targetBlock ?? null,
      lastProcessedBlock: indexerRunStatus?.lastProcessedBlock ?? null,
    },
  };

  return applyNoStoreHeaders(
    NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }),
    { varyCookie: true },
  );
}
