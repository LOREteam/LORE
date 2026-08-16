import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "../../_lib/adminSession";
import { getEpochMap, getMetaBigInt, getMetaJson, getMetaNumber, getRecentJackpots, getRecentRewardClaims } from "../../../../server/storage";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import {
  extractOpsLogTimestamp,
  parseLiveIndexerProgress,
  parseOpsLogTimestampMs,
  parseStoredEpochNumber,
} from "./runtimePolicy";

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
        ts: extractOpsLogTimestamp(line),
        level: detectLevel(line),
        source: loaded.source.label,
        message: trimLogPrefix(line),
      });
    }
  }

  return rows
    .sort((left, right) => {
      const leftTs = parseOpsLogTimestampMs(left.ts);
      const rightTs = parseOpsLogTimestampMs(right.ts);
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

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-ops",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  if (!(await readAdminSession(request))) {
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
