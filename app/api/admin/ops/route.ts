import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRouteRequest } from "../../_lib/adminRouteAuth";
import { getEpochMap, getMetaBigInt, getMetaNumber, getRecentJackpots, getRecentRewardClaims } from "../../../../server/storage";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";

type LogSourceSummary = {
  key: string;
  label: string;
  file: string;
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

function sanitizeLogText(line: string) {
  return line
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u0000/g, "")
    .replace(/тЦ▓|тЬУ|тАФ|тЖТ|вЂњ|вЂќ|вЂ"/g, " ")
    .replace(/[^\x20-\x7E\u0400-\u04FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimestamp(line: string) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  return match?.[1] ?? null;
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

function summarizeLogSource(file: string, key: string, label: string): LogSourceSummary {
  if (!existsSync(file)) {
    return {
      key,
      label,
      file,
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
  const raw = readFileSync(file, "utf8");
  const lines = splitLogLines(raw);
  return {
    key,
    label,
    file,
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
  if (!existsSync(file)) {
    return {
      source: {
        key,
        label,
        file,
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
  const lines = splitLogLines(readFileSync(file, "utf8"));
  return {
    source: {
      key,
      label,
      file,
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
    if (!existsSync(source.file)) return `${source.key}:missing`;
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
      const leftTs = left.ts ? Date.parse(left.ts) : Number.NEGATIVE_INFINITY;
      const rightTs = right.ts ? Date.parse(right.ts) : Number.NEGATIVE_INFINITY;
      return rightTs - leftTs;
    })
    .slice(0, limit);
}

function getRecentResolvedEpochs(limit = 8): RecentResolvedEpoch[] {
  const epochs = getEpochMap();
  return Object.entries(epochs)
    .map(([epoch, row]) => ({
      epoch: Number(epoch),
      winningTile: row.winningTile,
      totalPool: row.totalPool,
      rewardPool: row.rewardPool,
      resolvedBlock: row.resolvedBlock ?? null,
      isDailyJackpot: row.isDailyJackpot,
      isWeeklyJackpot: row.isWeeklyJackpot,
    }))
    .filter((row) => Number.isInteger(row.epoch) && row.epoch > 0)
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
      scanBlockCount = Number(scanMatch[3] ?? 0) || null;
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
      chunkIndex = Number(chunkMatch[1] ?? 0) || null;
      chunkTotal = Number(chunkMatch[2] ?? 0) || null;
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
      fetchedLogs = Number(fetchedMatch[3] ?? 0) || 0;
      continue;
    }

    const parsedMatch = line.match(
      /\[indexer\]\s+Chunk\s+(\d+)\/(\d+)\s+parsed:\s+(\d+)\s+bets,\s+(\d+)\s+epochs,\s+(\d+)\s+jackpots,\s+(\d+)\s+claims/i,
    );
    if (parsedMatch) {
      parsedBets = Number(parsedMatch[3] ?? 0) || 0;
      parsedEpochs = Number(parsedMatch[4] ?? 0) || 0;
      parsedJackpots = Number(parsedMatch[5] ?? 0) || 0;
      parsedClaims = Number(parsedMatch[6] ?? 0) || 0;
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
  if (rateLimited) return rateLimited;

  if (!isAuthorizedAdminRouteRequest(request)) {
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
