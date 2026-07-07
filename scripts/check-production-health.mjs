import "dotenv/config";
import { parseNonNegativeNumberEnv, parsePositiveIntegerEnv } from "./env-parsing.mjs";

const BASE_URL =
  process.env.PROD_HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000";
const TIMEOUT_MS = parsePositiveIntegerEnv(process.env.PROD_HEALTH_TIMEOUT_MS, 15_000);
const ALLOW_DEGRADED = process.env.PROD_HEALTH_ALLOW_DEGRADED === "1";
const ALLOW_LOCAL = process.env.PROD_HEALTH_ALLOW_LOCAL === "1";
const DIAGNOSTICS_SECRET = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim() || "";


function isNonLocalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) &&
      !host.endsWith(".local");
  } catch {
    return false;
  }
}
function parseOptionalNumber(rawValue) {
  if (rawValue == null || rawValue === "") return null;
  const value = parseNonNegativeNumberEnv(rawValue, Number.NaN);
  return Number.isFinite(value) ? value : null;
}

const EXPLICIT_MAX_LAG_BLOCKS = parseOptionalNumber(process.env.PROD_HEALTH_MAX_LAG_BLOCKS);
const EXPLICIT_MAX_INDEXER_STALE_MS = parseOptionalNumber(process.env.PROD_HEALTH_MAX_INDEXER_STALE_MS);

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function parsePayloadNonNegativeNumber(value) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : null;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
  const lagBlocks = parsePayloadNonNegativeNumber(payload?.storage?.lagBlocks);
  const finalityLagBlocks = parsePayloadNonNegativeNumber(payload?.storage?.lagToFinalityTargetBlocks);
  const effectiveLagBlocks = finalityLagBlocks ?? lagBlocks;
  const effectiveLagLabel = finalityLagBlocks !== null
    ? "finality-target lag"
    : "head lag";
  const maxLagBlocks = isFiniteNumber(EXPLICIT_MAX_LAG_BLOCKS)
    ? EXPLICIT_MAX_LAG_BLOCKS
    : parsePayloadNonNegativeNumber(payload?.env?.lagWarnBlocks);
  const runCompletedAgeMs = parsePayloadNonNegativeNumber(payload?.indexer?.run?.runCompletedAgeMs);
  const maxIndexerStaleMs = isFiniteNumber(EXPLICIT_MAX_INDEXER_STALE_MS)
    ? EXPLICIT_MAX_INDEXER_STALE_MS
    : parsePayloadNonNegativeNumber(payload?.env?.indexerHeartbeatStaleMs);
  const missingCount = parsePayloadNonNegativeNumber(payload?.epochs?.missingCount) ?? 0;
  const catchUpPhase = String(payload?.catchUp?.phase ?? "");
  const reconcileIsStale = Boolean(payload?.indexer?.reconcile?.stale);
  const problems = [];

  if (!payload || typeof payload !== "object") {
    problems.push("data-sync payload is missing or invalid");
    return { problems, finalityLagBlocks, effectiveLagBlocks, lagBlocks, runCompletedAgeMs };
  }

  if (payload.status !== "healthy" && !(ALLOW_DEGRADED && payload.status === "degraded")) {
    problems.push(`data-sync status is ${String(payload.status)}`);
  }

  if (payload.redacted && DIAGNOSTICS_SECRET) {
    problems.push("data-sync payload is still redacted; diagnostics secret was not accepted");
  }

  if (!isFiniteNumber(finalityLagBlocks)) {
    problems.push("data-sync finality-target lag is missing");
  }

  if (isFiniteNumber(effectiveLagBlocks) && isFiniteNumber(maxLagBlocks) && effectiveLagBlocks > maxLagBlocks) {
    problems.push(`indexer ${effectiveLagLabel} is ${effectiveLagBlocks} blocks, above limit ${maxLagBlocks}`);
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

  return { problems, finalityLagBlocks, effectiveLagBlocks, lagBlocks, runCompletedAgeMs };
}

async function main() {
  if (!ALLOW_LOCAL && !isNonLocalHttpsOrigin(BASE_URL)) {
    console.error("[prod-health] FAILED");
    console.error("- PROD_HEALTH_BASE_URL or NEXT_PUBLIC_SITE_URL must be a non-local HTTPS origin for production health checks; set PROD_HEALTH_ALLOW_LOCAL=1 only for local smoke checks");
    process.exitCode = 1;
    return;
  }

  if (!DIAGNOSTICS_SECRET) {
    console.error("[prod-health] FAILED");
    console.error("- HEALTH_DIAGNOSTICS_SECRET is required for production health checks");
    process.exitCode = 1;
    return;
  }

  const runtime = await fetchJson("/api/health/runtime");
  const dataSync = await fetchJson("/api/health/data-sync");
  const runtimeProblems = [];

  if (runtime?.status !== "ok") {
    runtimeProblems.push(`runtime status is ${String(runtime?.status)}`);
  }

  if (runtime?.redacted && DIAGNOSTICS_SECRET) {
    runtimeProblems.push("runtime payload is still redacted; diagnostics secret was not accepted");
  }
  if (runtime?.publicConfig && typeof runtime.publicConfig === "object") {
    const publicConfig = runtime.publicConfig;
    if (!Number.isInteger(publicConfig.chainId)) {
      runtimeProblems.push("runtime publicConfig.chainId is missing");
    }
    if (typeof publicConfig.privyAppIdConfigured !== "boolean") {
      runtimeProblems.push("runtime publicConfig.privyAppIdConfigured is missing");
    }
    if (typeof publicConfig.privyFallbackActive !== "boolean") {
      runtimeProblems.push("runtime publicConfig.privyFallbackActive is missing");
    }
    if (typeof publicConfig.eip7702Enabled !== "boolean") {
      runtimeProblems.push("runtime publicConfig.eip7702Enabled is missing");
    }
    if (typeof publicConfig.eip7702MiningEnabled !== "boolean") {
      runtimeProblems.push("runtime publicConfig.eip7702MiningEnabled is missing");
    }
    if (typeof publicConfig.readOnlyMode !== "boolean") {
      runtimeProblems.push("runtime publicConfig.readOnlyMode is missing");
    }
    if (publicConfig.chainId === 59144) {
      if (publicConfig.privyAppIdConfigured !== true) {
        runtimeProblems.push("mainnet runtime is missing NEXT_PUBLIC_PRIVY_APP_ID");
      }
      if (publicConfig.privyFallbackActive) {
        runtimeProblems.push("mainnet runtime is using the development Privy fallback");
      }
      if (publicConfig.eip7702Enabled !== false || publicConfig.eip7702MiningEnabled !== false) {
        runtimeProblems.push("mainnet runtime has EIP-7702 enabled");
      }
    }
  } else {
    runtimeProblems.push("runtime publicConfig diagnostics are missing");
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
  const readOnlyMode = Boolean(runtime?.publicConfig?.readOnlyMode);
  console.log(
    [
      `base=${BASE_URL}`,
      `runtime=${runtime.status}`,
      `dataSync=${dataSync.status}`,
      `readOnlyMode=${String(readOnlyMode)}`,
      `finalityLagBlocks=${String(dataSyncSummary.finalityLagBlocks ?? "n/a")}`,
      `effectiveLagBlocks=${String(dataSyncSummary.effectiveLagBlocks ?? "n/a")}`,
      `rawLagBlocks=${String(dataSyncSummary.lagBlocks ?? "n/a")}`,
      `indexerRunAgeMs=${String(dataSyncSummary.runCompletedAgeMs ?? "n/a")}`,
    ].join(" "),
  );
}

main().catch((error) => {
  console.error("[prod-health] FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
