const MAX_ENTRIES = 500;
const STORAGE_KEY = "lineaore:logs";

export type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  ts: string;
  lvl: LogLevel;
  tag: string;
  msg: string;
  data?: unknown;
}

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.slice(0, 400),
    };
  }
  return value;
}

function safeJsonStringify(value: unknown, space?: number) {
  return JSON.stringify(value, jsonReplacer, space);
}

function formatUnknownForLog(value: unknown): string {
  if (value instanceof Error) {
    const parts = [value.message];
    if (value.name && value.name !== "Error" && !parts.some((part) => part.includes(value.name))) {
      parts.unshift(value.name);
    }
    const withStatus = value as Error & { status?: unknown; code?: unknown; details?: unknown; cause?: unknown };
    if (withStatus.status !== undefined) parts.push(`Status: ${String(withStatus.status)}`);
    if (withStatus.code !== undefined) parts.push(`Code: ${String(withStatus.code)}`);
    if (typeof withStatus.details === "string" && withStatus.details) parts.push(`Details: ${withStatus.details}`);
    if (withStatus.cause instanceof Error && withStatus.cause.message) parts.push(`Cause: ${withStatus.cause.message}`);
    return parts.join(" | ");
  }
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const candidate = value as { message?: unknown; name?: unknown; code?: unknown; status?: unknown; details?: unknown };
    const parts: string[] = [];
    if (typeof candidate.name === "string" && candidate.name) parts.push(candidate.name);
    if (typeof candidate.message === "string" && candidate.message) parts.push(candidate.message);
    if (candidate.status !== undefined) parts.push(`Status: ${String(candidate.status)}`);
    if (candidate.code !== undefined) parts.push(`Code: ${String(candidate.code)}`);
    if (typeof candidate.details === "string" && candidate.details) parts.push(`Details: ${candidate.details}`);
    if (parts.length > 0) return parts.join(" | ");
  }
  return String(value);
}

function loadBuffer(): LogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    const trimmed = buffer.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, safeJsonStringify(trimmed));
    buffer = trimmed;
  } catch {
    // Storage full - try to save what we can
    try {
      // Keep most recent entries that fit
      const maxThatFit = Math.floor(MAX_ENTRIES / 2);
      const trimmed = buffer.slice(-maxThatFit);
      localStorage.setItem(STORAGE_KEY, safeJsonStringify(trimmed));
      buffer = trimmed;
    } catch {
      // Give up - clear oldest half and try again
      buffer = buffer.slice(-Math.floor(MAX_ENTRIES / 2));
      try {
        localStorage.setItem(STORAGE_KEY, safeJsonStringify(buffer));
      } catch {
        // Last resort - keep only last 50 entries
        buffer = buffer.slice(-50);
        localStorage.setItem(STORAGE_KEY, safeJsonStringify(buffer));
      }
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    persist();
  }, 1000);
}

function push(lvl: LogLevel, tag: string, msg: string, data?: unknown) {
  if (buffer.length === 0) buffer = loadBuffer();
  const safeData = data !== undefined ? sanitize(data) : undefined;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    lvl,
    tag,
    msg,
    ...(safeData !== undefined && { data: safeData }),
  };
  buffer.push(entry);

  if (lvl === "error") {
    console.error(`[${tag}]`, msg, safeData ?? "");
  } else if (lvl === "warn") {
    console.warn(`[${tag}]`, msg, safeData ?? "");
  }

  scheduleFlush();
}

function sanitize(v: unknown): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack?.slice(0, 400) };
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object" && v !== null) {
    try {
      const serialized = safeJsonStringify(v);
      if (serialized && serialized !== "{}") {
        return JSON.parse(serialized);
      }
      return formatUnknownForLog(v);
    } catch {
      return formatUnknownForLog(v);
    }
  }
  return v;
}

export const log = {
  info: (tag: string, msg: string, data?: unknown) => push("info", tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => push("warn", tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => push("error", tag, msg, data),
  debug: (tag: string, msg: string, data?: unknown) => push("debug", tag, msg, data),
};

export function exportLogs(): string {
  if (buffer.length === 0) buffer = loadBuffer();
  const meta = {
    exportedAt: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    entries: buffer.length,
  };
  const lines = buffer.map((e) => {
    const d = e.data !== undefined ? ` | ${safeJsonStringify(e.data)}` : "";
    return `${e.ts} [${e.lvl.toUpperCase().padEnd(5)}] <${e.tag}> ${e.msg}${d}`;
  });
  return `=== LORE DApp Logs ===\n${safeJsonStringify(meta, 2)}\n${"=".repeat(40)}\n${lines.join("\n")}\n`;
}

export function downloadLogs() {
  const text = exportLogs();
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lore-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function clearLogs() {
  buffer = [];
  if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
}

// Get current log count for debugging
export function getLogCount(): number {
  if (buffer.length === 0) buffer = loadBuffer();
  return buffer.length;
}
