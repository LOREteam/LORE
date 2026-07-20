import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_STATE_BYTES = 128 * 1024;
const MAX_ACTIVE_ISSUES = 100;
const MAX_ISSUE_KEY_LENGTH = 80;
const MAX_ISSUE_MESSAGE_LENGTH = 500;
const MAX_CANARY_TAIL_BYTES = 256 * 1024;
const MAX_AUDIT_BYTES = 128 * 1024;
const MAX_BACKUP_DIRECTORY_ENTRIES = 10_000;
const BACKUP_FILE_PATTERN = /^lore-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/;

function normalizedIssueEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => Array.isArray(entry) && entry.length === 2)
    .filter(([key, message]) => (
      typeof key === "string"
      && key.length > 0
      && key.length <= MAX_ISSUE_KEY_LENGTH
      && typeof message === "string"
      && message.length > 0
      && message.length <= MAX_ISSUE_MESSAGE_LENGTH
    ))
    .slice(0, MAX_ACTIVE_ISSUES);
}

export function readBoundedTextTail(filePath, maxBytes = MAX_CANARY_TAIL_BYTES) {
  const size = statSync(filePath).size;
  const boundedMaxBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0
    ? Math.min(maxBytes, MAX_CANARY_TAIL_BYTES)
    : MAX_CANARY_TAIL_BYTES;
  const length = Math.min(size, boundedMaxBytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const text = buffer.toString("utf8");
  return size > length ? text.slice(text.indexOf("\n") + 1) : text;
}

export function readBoundedJsonFile(filePath, maxBytes = MAX_AUDIT_BYTES) {
  const boundedMaxBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0
    ? Math.min(maxBytes, MAX_AUDIT_BYTES)
    : MAX_AUDIT_BYTES;
  if (statSync(filePath).size > boundedMaxBytes) throw new Error("JSON artifact exceeds size limit");
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function evaluateChainIndexerAudit(audit, {
  nowMs = Date.now(),
  maxAgeMs = 3_600_000,
} = {}) {
  const generatedAt = Date.parse(String(audit?.generatedAt ?? ""));
  const mismatches = Array.isArray(audit?.mismatches) ? audit.mismatches.length : null;
  if (
    !audit
    || typeof audit !== "object"
    || !Number.isFinite(generatedAt)
    || generatedAt > nowMs + 60_000
    || mismatches === null
  ) {
    return [{ key: "chain-indexer-audit-invalid", message: "Chain/indexer audit artifact is invalid." }];
  }
  if (audit.status !== "pass" || mismatches > 0) {
    return [{
      key: "chain-indexer-audit-mismatch",
      message: `Chain/indexer audit failed with ${mismatches} mismatch(es).`,
    }];
  }
  const boundedMaxAgeMs = Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : 3_600_000;
  if (nowMs - generatedAt > boundedMaxAgeMs) {
    return [{ key: "chain-indexer-audit-stale", message: "Chain/indexer audit artifact is stale." }];
  }
  return [];
}

export function readLatestBackupSnapshot(directoryPath) {
  if (!statSync(directoryPath).isDirectory()) throw new Error("Backup path is not a directory");
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  if (entries.length > MAX_BACKUP_DIRECTORY_ENTRIES) throw new Error("Backup directory exceeds entry limit");
  let latest = null;
  for (const entry of entries) {
    if (!entry.isFile() || !BACKUP_FILE_PATTERN.test(entry.name)) continue;
    const stats = statSync(path.join(directoryPath, entry.name));
    if (!latest || stats.mtimeMs > latest.mtimeMs) latest = { mtimeMs: stats.mtimeMs, bytes: stats.size };
  }
  return latest;
}

export function evaluateBackupFreshness(snapshot, {
  nowMs = Date.now(),
  maxAgeMs = 36 * 60 * 60 * 1000,
} = {}) {
  if (!snapshot) return [{ key: "sqlite-backup-missing", message: "No scheduled SQLite backup was found." }];
  const mtimeMs = Number(snapshot.mtimeMs);
  const bytes = Number(snapshot.bytes);
  if (!Number.isFinite(mtimeMs) || mtimeMs > nowMs + 60_000 || !Number.isFinite(bytes) || bytes <= 0) {
    return [{ key: "sqlite-backup-invalid", message: "Latest scheduled SQLite backup metadata is invalid." }];
  }
  const boundedMaxAgeMs = Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : 36 * 60 * 60 * 1000;
  return nowMs - mtimeMs > boundedMaxAgeMs
    ? [{ key: "sqlite-backup-stale", message: "Latest scheduled SQLite backup is stale." }]
    : [];
}

export function evaluateCanaryRevertWindow(text, {
  nowMs = Date.now(),
  windowMs = 300_000,
  threshold = 3,
} = {}) {
  if (!Number.isSafeInteger(threshold) || threshold <= 0) return [];
  const cutoff = nowMs - windowMs;
  const uniqueFailures = new Set();
  for (const line of String(text).split(/\r?\n/).slice(-500)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const timestamp = Date.parse(String(event?.timestamp ?? ""));
      const errorKind = String(event?.errorKind ?? "");
      const reverted = event?.txStatus === "reverted" || /^(?:tx-reverted|repeat-tx-reverted)$/.test(errorKind);
      if (!reverted || !Number.isFinite(timestamp) || timestamp < cutoff || timestamp > nowMs + 60_000) continue;
      uniqueFailures.add(event?.hash || `${event?.timestamp}:${event?.role}:${event?.round}:${event?.mode}`);
    } catch {
      // A partial trailing JSONL line is ignored until the next poll.
    }
  }
  return uniqueFailures.size >= threshold
    ? [{
        key: "canary-reverted-tx-series",
        message: `${uniqueFailures.size} reverted canary transactions occurred within ${Math.ceil(windowMs / 1000)} seconds.`,
      }]
    : [];
}

export function evaluateCanaryActivity(text, {
  nowMs = Date.now(),
  maxAgeMs = 300_000,
} = {}) {
  let latestTimestamp = null;
  let completedSummary = null;
  for (const line of String(text).split(/\r?\n/).slice(-500)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const timestamp = Date.parse(String(event?.timestamp ?? ""));
      if (!Number.isFinite(timestamp) || timestamp > nowMs + 60_000) continue;
      latestTimestamp = Math.max(latestTimestamp ?? timestamp, timestamp);
      if (
        event?.mode === "summary"
        && Number.isSafeInteger(event?.targetRounds)
        && event.targetRounds > 0
        && event?.round >= event.targetRounds
      ) {
        completedSummary = event;
      }
    } catch {
      // A partial trailing JSONL line is ignored until the next poll.
    }
  }
  if (completedSummary) {
    const failures = Number.isSafeInteger(completedSummary.failures) ? completedSummary.failures : 0;
    return failures > 0
      ? [{ key: "canary-completed-with-failures", message: `Canary completed with ${failures} failure(s).` }]
      : [];
  }
  if (latestTimestamp === null) {
    return [{ key: "canary-log-invalid", message: "Canary log has no valid timestamped events." }];
  }
  const boundedMaxAgeMs = Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : 300_000;
  return nowMs - latestTimestamp > boundedMaxAgeMs
    ? [{ key: "canary-log-stale", message: "Canary log stopped receiving events." }]
    : [];
}

function nonNegativeNumber(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveBigInt(value) {
  try {
    const parsed = BigInt(String(value));
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

export function evaluateRuntimeSnapshot({
  runtime,
  dataSync,
  liveState,
  nowMs = Date.now(),
  stuckGraceMs = 120_000,
  maxLiveStateAgeMs = 120_000,
  maxRssBytes = null,
  maxWalBytes = null,
  minDiskFreeBytes = null,
}) {
  const issues = [];
  if (runtime?.status !== "ok") {
    issues.push({ key: "runtime-health", message: "Runtime health is not OK." });
  }
  if (runtime?.redacted === true) {
    issues.push({ key: "runtime-redacted", message: "Runtime diagnostics are unexpectedly redacted." });
  }
  if (dataSync?.status !== "healthy") {
    issues.push({ key: "data-sync", message: "Indexer data-sync health is degraded." });
  }
  if (dataSync?.redacted === true) {
    issues.push({ key: "data-sync-redacted", message: "Indexer diagnostics are unexpectedly redacted." });
  }
  if (dataSync?.indexer?.run?.stale === true) {
    issues.push({ key: "indexer-heartbeat", message: "Indexer heartbeat is stale." });
  }

  const rssBytes = nonNegativeNumber(runtime?.process?.rssBytes);
  const rssLimit = nonNegativeNumber(maxRssBytes);
  if (rssBytes !== null && rssLimit !== null && rssLimit > 0 && rssBytes > rssLimit) {
    issues.push({ key: "runtime-rss", message: `Runtime RSS is ${rssBytes} bytes (limit ${rssLimit}).` });
  }
  const walBytes = nonNegativeNumber(dataSync?.storage?.walBytes);
  const walLimit = nonNegativeNumber(maxWalBytes);
  if (walBytes !== null && walLimit !== null && walLimit > 0 && walBytes > walLimit) {
    issues.push({ key: "sqlite-wal-size", message: `SQLite WAL is ${walBytes} bytes (limit ${walLimit}).` });
  }
  const diskFreeBytes = nonNegativeNumber(dataSync?.storage?.diskFreeBytes);
  const diskFreeLimit = nonNegativeNumber(minDiskFreeBytes);
  if (diskFreeBytes !== null && diskFreeLimit !== null && diskFreeLimit > 0 && diskFreeBytes < diskFreeLimit) {
    issues.push({ key: "disk-free-space", message: `Disk free space is ${diskFreeBytes} bytes (minimum ${diskFreeLimit}).` });
  }

  const lag = nonNegativeNumber(dataSync?.storage?.lagToFinalityTargetBlocks);
  const lagLimit = nonNegativeNumber(dataSync?.env?.lagWarnBlocks);
  if (lag !== null && lagLimit !== null && lag > lagLimit) {
    issues.push({ key: "indexer-lag", message: `Indexer finality lag is ${lag} blocks (limit ${lagLimit}).` });
  }

  const epoch = typeof liveState?.currentEpoch === "string" && /^\d+$/.test(liveState.currentEpoch)
    ? liveState.currentEpoch
    : null;
  const epochEndSeconds = nonNegativeNumber(liveState?.epochEndTime);
  const epochData = Array.isArray(liveState?.currentEpochData) ? liveState.currentEpochData : null;
  const totalPool = positiveBigInt(epochData?.[0]);
  const resolved = epochData?.[3] === true;
  const fetchedAt = nonNegativeNumber(liveState?.fetchedAt);
  const liveStateIsFresh = fetchedAt !== null && nowMs - fetchedAt <= maxLiveStateAgeMs;
  if (!liveStateIsFresh) {
    issues.push({ key: "live-state-stale", message: "Live-state snapshot is missing or stale." });
  }
  if (liveStateIsFresh && epoch && epochEndSeconds !== null && totalPool > 0n && !resolved) {
    const overdueMs = nowMs - epochEndSeconds * 1000;
    if (overdueMs > stuckGraceMs) {
      issues.push({
        key: "stuck-non-empty-epoch",
        message: `Non-empty epoch #${epoch} is overdue by ${Math.floor(overdueMs / 1000)}s and still unresolved.`,
      });
    }
  }
  return issues;
}

export function reconcileRuntimeIssues(activeIssues, issues) {
  const alerts = [];
  const recoveries = [];
  const nextKeys = new Set(issues.map((issue) => issue.key));

  for (const issue of issues) {
    if (!activeIssues.has(issue.key)) alerts.push(issue);
    activeIssues.set(issue.key, issue.message);
  }
  for (const [key, message] of activeIssues) {
    if (nextKeys.has(key)) continue;
    activeIssues.delete(key);
    recoveries.push({ key, message });
  }
  return { alerts, recoveries };
}

export function loadRuntimeIssueState(filePath) {
  try {
    if (statSync(filePath).size > MAX_STATE_BYTES) return new Map();
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return new Map(normalizedIssueEntries(parsed?.activeIssues));
  } catch {
    return new Map();
  }
}

export function saveRuntimeIssueState(filePath, activeIssues) {
  const resolved = path.resolve(filePath);
  const temporary = `${resolved}.tmp`;
  mkdirSync(path.dirname(resolved), { recursive: true });
  const entries = normalizedIssueEntries([...activeIssues.entries()]);
  writeFileSync(temporary, `${JSON.stringify({ activeIssues: entries }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, resolved);
}

export function applyRuntimeIssueDeliveryResult(activeIssues, transition, { configured, delivered }) {
  if (!configured || delivered) return;
  if (transition.kind === "alert") activeIssues.delete(transition.key);
  else activeIssues.set(transition.key, transition.message);
}

export function createTelegramAlertSender({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const token = env.ALERT_TELEGRAM_BOT_TOKEN?.trim() || "";
  const chatId = env.ALERT_TELEGRAM_CHAT_ID?.trim() || "";
  const threadId = env.ALERT_TELEGRAM_THREAD_ID?.trim() || "";
  const prefix = env.ALERT_PREFIX?.trim() || "LORE Runtime Monitor";
  const cooldowns = new Map();

  return {
    configured: Boolean(token && chatId),
    async send(message, key, cooldownMs = 300_000) {
      if (!token || !chatId) return false;
      const timestamp = now();
      if (timestamp - (cooldowns.get(key) ?? 0) < cooldownMs) return false;
      const body = new URLSearchParams({
        chat_id: chatId,
        text: `${prefix}\n${message}`,
        disable_web_page_preview: "true",
      });
      if (threadId) body.set("message_thread_id", threadId);
      try {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return false;
        cooldowns.set(key, timestamp);
        return true;
      } catch {
        console.error("[runtime-monitor] alert delivery failed");
        return false;
      }
    },
  };
}
