const BASE_URL =
  process.env.PROD_HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000";
const TIMEOUT_MS = Number(process.env.PROD_HEALTH_TIMEOUT_MS || "15000");
const ALLOW_DEGRADED = process.env.PROD_HEALTH_ALLOW_DEGRADED === "1";
const DIAGNOSTICS_SECRET = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim() || "";

function parseOptionalNumber(rawValue) {
  if (rawValue == null || rawValue === "") return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

const EXPLICIT_MAX_LAG_BLOCKS = parseOptionalNumber(process.env.PROD_HEALTH_MAX_LAG_BLOCKS);
const EXPLICIT_MAX_INDEXER_STALE_MS = parseOptionalNumber(process.env.PROD_HEALTH_MAX_INDEXER_STALE_MS);

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function formatProblems(problems) {
  return problems.map((problem) => `- ${problem}`).join("\n");
}

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {
    "cache-control": "no-cache",
  };
  if (DIAGNOSTICS_SECRET) {
    headers["x-health-diagnostics-secret"] = DIAGNOSTICS_SECRET;
  }

  try {
    const response = await fetch(new URL(pathname, BASE_URL), {
      signal: controller.signal,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${pathname} returned ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeDataSync(payload) {
  const lagBlocks = payload?.storage?.lagBlocks;
  const maxLagBlocks = isFiniteNumber(EXPLICIT_MAX_LAG_BLOCKS)
    ? EXPLICIT_MAX_LAG_BLOCKS
    : payload?.env?.lagWarnBlocks;
  const runCompletedAgeMs = payload?.indexer?.run?.runCompletedAgeMs;
  const maxIndexerStaleMs = isFiniteNumber(EXPLICIT_MAX_INDEXER_STALE_MS)
    ? EXPLICIT_MAX_INDEXER_STALE_MS
    : payload?.env?.indexerHeartbeatStaleMs;
  const missingCount = Number(payload?.epochs?.missingCount ?? 0);
  const catchUpPhase = String(payload?.catchUp?.phase ?? "");
  const reconcileIsStale = Boolean(payload?.indexer?.reconcile?.stale);
  const problems = [];

  if (!payload || typeof payload !== "object") {
    problems.push("data-sync payload is missing or invalid");
    return { problems, lagBlocks, runCompletedAgeMs };
  }

  if (payload.status !== "healthy" && !(ALLOW_DEGRADED && payload.status === "degraded")) {
    problems.push(`data-sync status is ${String(payload.status)}`);
  }

  if (payload.redacted && DIAGNOSTICS_SECRET) {
    problems.push("data-sync payload is still redacted; diagnostics secret was not accepted");
  }

  if (isFiniteNumber(lagBlocks) && isFiniteNumber(maxLagBlocks) && lagBlocks > maxLagBlocks) {
    problems.push(`indexer lag is ${lagBlocks} blocks, above limit ${maxLagBlocks}`);
  }

  if (
    isFiniteNumber(runCompletedAgeMs) &&
    isFiniteNumber(maxIndexerStaleMs) &&
    runCompletedAgeMs > maxIndexerStaleMs
  ) {
    problems.push(
      `indexer heartbeat is stale: ${runCompletedAgeMs}ms since last completed run, limit ${maxIndexerStaleMs}ms`,
    );
  }

  if (payload?.indexer?.run?.stale) {
    problems.push("indexer run status is marked stale");
  }

  if (missingCount > 0 && (catchUpPhase === "catching_up" || reconcileIsStale)) {
    problems.push(`indexed epoch gaps detected: ${missingCount}`);
  }

  if (!payload?.jackpots?.hasLatestDailyInDb || !payload?.jackpots?.hasLatestWeeklyInDb) {
    problems.push("latest jackpot rows are not fully indexed yet");
  }

  return { problems, lagBlocks, runCompletedAgeMs };
}

async function main() {
  const runtime = await fetchJson("/api/health/runtime");
  const dataSync = await fetchJson("/api/health/data-sync");
  const runtimeProblems = [];

  if (runtime?.status !== "ok") {
    runtimeProblems.push(`runtime status is ${String(runtime?.status)}`);
  }

  if (runtime?.redacted && DIAGNOSTICS_SECRET) {
    runtimeProblems.push("runtime payload is still redacted; diagnostics secret was not accepted");
  }

  const dataSyncSummary = summarizeDataSync(dataSync);
  const problems = [...runtimeProblems, ...dataSyncSummary.problems];

  if (problems.length > 0) {
    console.error("[prod-health] FAILED");
    console.error(formatProblems(problems));
    if (Array.isArray(dataSync?.hints) && dataSync.hints.length > 0) {
      console.error("[prod-health] hints:");
      console.error(formatProblems(dataSync.hints));
    }
    process.exitCode = 1;
    return;
  }

  console.log("[prod-health] OK");
  console.log(
    [
      `base=${BASE_URL}`,
      `runtime=${runtime.status}`,
      `dataSync=${dataSync.status}`,
      `lagBlocks=${String(dataSyncSummary.lagBlocks ?? "n/a")}`,
      `indexerRunAgeMs=${String(dataSyncSummary.runCompletedAgeMs ?? "n/a")}`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error("[prod-health] FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
