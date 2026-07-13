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
      cooldowns.set(key, timestamp);
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
        return response.ok;
      } catch {
        console.error("[runtime-monitor] alert delivery failed");
        return false;
      }
    },
  };
}
