import "dotenv/config";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";
import { assertTrustedHealthCredentialOrigin } from "./health-credential-origin.mjs";
import { redactProofText } from "./redact-proof-output.mjs";

const BASE_URL =
  process.env.PROD_HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000";
const TIMEOUT_MS = parsePositiveIntegerEnv(process.env.PROD_HEALTH_TIMEOUT_MS, 15_000);
const ALLOW_DEGRADED = process.env.PROD_HEALTH_ALLOW_DEGRADED === "1";
const ALLOW_LOCAL = process.env.PROD_HEALTH_ALLOW_LOCAL === "1";
const summaryOnly = process.argv.includes("--summary-only");
const selfTest = process.argv.includes("--self-test");
const MAX_HEALTH_RESPONSE_BYTES = 256 * 1024;
const MAX_PROD_HEALTH_ERROR_CHARS = 500;
const CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const POSITIVE_SAFE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 32;
const MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const EXPECT_EPOCH_BOUND_BETS = ["1", "true", "yes", "on"].includes(
  (process.env.NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS ?? "").trim().toLowerCase(),
);

function describeProdHealthError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_PROD_HEALTH_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_PROD_HEALTH_ERROR_CHARS - 15)}...<truncated>`;
}

function isNonLocalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^0\./.test(host) ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^192\.0\.2\./.test(host) ||
        /^198\.(1[89])\./.test(host) ||
        /^198\.51\.100\./.test(host) ||
        /^203\.0\.113\./.test(host) ||
        /^::ffff:/i.test(host) ||
        /^f[cd][0-9a-f]*:/i.test(host) ||
        /^fe[89ab][0-9a-f]*:/i.test(host) ||
        /^2001:db8:/i.test(host)
      );
  } catch {
    return false;
  }
}
function parseOptionalNonNegativeIntegerEnv(name) {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue === "") return { value: null, issue: null };
  const normalized = rawValue.trim();
  if (!CONTENT_LENGTH_RE.test(normalized)) {
    return { value: null, issue: `${name} must be a canonical non-negative decimal integer` };
  }
  const parsed = BigInt(normalized);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    return { value: null, issue: `${name} must be a safe non-negative integer` };
  }
  return { value: Number(parsed), issue: null };
}

function parseOptionalPositiveIntegerValue(name, rawValue) {
  if (rawValue == null || rawValue === "") return { value: null, issue: null };
  const normalized = String(rawValue).trim();
  if (!POSITIVE_SAFE_INTEGER_RE.test(normalized)) {
    return { value: null, issue: `${name} must be a canonical positive decimal integer` };
  }
  const parsed = BigInt(normalized);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    return { value: null, issue: `${name} must be a safe positive integer` };
  }
  return { value: Number(parsed), issue: null };
}

function parseOptionalPositiveIntegerEnv(name) {
  return parseOptionalPositiveIntegerValue(name, process.env[name]);
}

function parseHealthDiagnosticsSecretEnv(name) {
  const secret = process.env[name]?.trim();
  if (!secret) return { value: "", issue: null };
  if (
    secret.length < MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH ||
    secret.length > MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH ||
    CONTROL_CHAR_RE.test(secret)
  ) {
    return { value: "", issue: `${name} must be 32..256 non-control characters` };
  }
  return { value: secret, issue: null };
}

const EXPLICIT_MAX_LAG_BLOCKS_ENV = parseOptionalNonNegativeIntegerEnv("PROD_HEALTH_MAX_LAG_BLOCKS");
const EXPLICIT_MAX_INDEXER_STALE_MS_ENV = parseOptionalNonNegativeIntegerEnv("PROD_HEALTH_MAX_INDEXER_STALE_MS");
const EXPLICIT_MAX_LAG_BLOCKS = EXPLICIT_MAX_LAG_BLOCKS_ENV.value;
const EXPLICIT_MAX_INDEXER_STALE_MS = EXPLICIT_MAX_INDEXER_STALE_MS_ENV.value;
const PUBLIC_CHAIN_ID_ENV = parseOptionalPositiveIntegerEnv("NEXT_PUBLIC_LINEA_CHAIN_ID");
const SERVER_CHAIN_ID_ENV = parseOptionalPositiveIntegerEnv("LINEA_CHAIN_ID");
const DIAGNOSTICS_SECRET_ENV = parseHealthDiagnosticsSecretEnv("HEALTH_DIAGNOSTICS_SECRET");
const DIAGNOSTICS_SECRET = DIAGNOSTICS_SECRET_ENV.value;
const CONFIGURED_CHAIN_ID = PUBLIC_CHAIN_ID_ENV.value ?? SERVER_CHAIN_ID_ENV.value;
const THRESHOLD_ENV_ISSUES = [
  EXPLICIT_MAX_LAG_BLOCKS_ENV.issue,
  EXPLICIT_MAX_INDEXER_STALE_MS_ENV.issue,
  PUBLIC_CHAIN_ID_ENV.issue,
  SERVER_CHAIN_ID_ENV.issue,
  DIAGNOSTICS_SECRET_ENV.issue,
  PUBLIC_CHAIN_ID_ENV.value !== null &&
    SERVER_CHAIN_ID_ENV.value !== null &&
    PUBLIC_CHAIN_ID_ENV.value !== SERVER_CHAIN_ID_ENV.value
    ? "LINEA_CHAIN_ID and NEXT_PUBLIC_LINEA_CHAIN_ID must match"
    : null,
].filter(Boolean);

function isFiniteNumber(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function parsePayloadNonNegativeNumber(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const normalized = String(value ?? "").trim();
  if (!CONTENT_LENGTH_RE.test(normalized)) return null;
  const parsed = BigInt(normalized);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function formatProblems(problems) {
  return problems.map((problem) => `- ${problem}`).join("\n");
}

function emitFailure(problems, hints = []) {
  if (summaryOnly) {
    console.log(
      JSON.stringify({
        status: "fail",
        issues: problems.length,
        hints: Array.isArray(hints) ? hints.length : 0,
        firstIssue: describeProdHealthError(problems[0] ?? "unknown production health failure"),
      }),
    );
    return;
  }

  console.error("[prod-health] FAILED");
  console.error(formatProblems(problems));
  if (Array.isArray(hints) && hints.length > 0) {
    console.error("[prod-health] hints:");
    console.error(formatProblems(hints));
  }
}

function parseContentLengthHeader(value) {
  if (value == null || value === "") return null;
  if (!CONTENT_LENGTH_RE.test(value)) throw new Error("invalid response content-length");
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error("invalid response content-length");
  return Number(parsed);
}

async function readBoundedResponseText(response) {
  const contentLength = parseContentLengthHeader(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_HEALTH_RESPONSE_BYTES) {
    throw new Error("response body too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_HEALTH_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("response body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchJson(origin, pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {
    "cache-control": "no-cache",
  };
  if (DIAGNOSTICS_SECRET) {
    headers["x-health-diagnostics-secret"] = DIAGNOSTICS_SECRET;
  }

  try {
    const response = await fetch(new URL(pathname, origin), {
      signal: controller.signal,
      headers,
      redirect: "error",
    });
    let text;
    try {
      text = await readBoundedResponseText(response);
    } catch (error) {
      throw new Error(`${pathname} returned an unreadable response: ${error instanceof Error ? error.message : "unknown error"}`);
    }
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

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  for (const value of ["1", "59141", "59144"]) {
    assertSelfTest(parseOptionalPositiveIntegerValue("SELF_TEST_CHAIN_ID", value).value !== null, `expected valid chain id ${value}`);
  }
  for (const value of ["", "0", "01", "59144.0", "5e4", "9007199254740992"]) {
    const parsed = parseOptionalPositiveIntegerValue("SELF_TEST_CHAIN_ID", value);
    assertSelfTest(value === "" ? parsed.issue === null : parsed.value === null, `expected malformed chain id ${String(value)}`);
  }
  for (const value of [0, 1, "0", "42", "9007199254740991"]) {
    assertSelfTest(parsePayloadNonNegativeNumber(value) !== null, `expected valid payload integer ${String(value)}`);
  }
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "", "01", "1.0", "1e3", "9007199254740992"]) {
    assertSelfTest(parsePayloadNonNegativeNumber(value) === null, `expected malformed payload integer ${String(value)}`);
  }
  const malformedSummary = summarizeDataSync({
    status: "healthy",
    storage: { lagBlocks: "1", lagToFinalityTargetBlocks: "1e2" },
    env: { lagWarnBlocks: "10", indexerHeartbeatStaleMs: "60000" },
    indexer: { run: { runCompletedAgeMs: "1000" } },
    epochs: { missingCount: "0" },
    jackpots: { hasLatestDailyInDb: true, hasLatestWeeklyInDb: true },
  });
  assertSelfTest(
    malformedSummary.problems.includes("data-sync finality-target lag is missing"),
    "malformed finality lag payload must fail closed before launch health acceptance",
  );
  if (summaryOnly) {
    console.log(JSON.stringify({ status: "pass", payloadIntegerParser: true }));
  } else {
    console.log("[prod-health:self-test] OK payloadIntegerParser=true");
  }
}

async function main() {
  if (THRESHOLD_ENV_ISSUES.length > 0) {
    emitFailure(THRESHOLD_ENV_ISSUES);
    process.exitCode = 1;
    return;
  }

  if (!ALLOW_LOCAL && !isNonLocalHttpsOrigin(BASE_URL)) {
    emitFailure([
      "PROD_HEALTH_BASE_URL or NEXT_PUBLIC_SITE_URL must be a public HTTPS origin for production health checks; localhost/private/reserved/example/test origins are launch-proof invalid. Set PROD_HEALTH_ALLOW_LOCAL=1 only for local smoke checks",
    ]);
    process.exitCode = 1;
    return;
  }

  if (!DIAGNOSTICS_SECRET) {
    emitFailure(["HEALTH_DIAGNOSTICS_SECRET is required for production health checks"]);
    process.exitCode = 1;
    return;
  }

  let trustedBaseUrl;
  try {
    trustedBaseUrl = assertTrustedHealthCredentialOrigin({
      target: BASE_URL,
      canonicalOrigin: process.env.NEXT_PUBLIC_SITE_URL,
      targetName: "PROD_HEALTH_BASE_URL",
    });
  } catch (error) {
    emitFailure([describeProdHealthError(error)]);
    process.exitCode = 1;
    return;
  }

  const runtime = await fetchJson(trustedBaseUrl, "/api/health/runtime");
  const dataSync = await fetchJson(trustedBaseUrl, "/api/health/data-sync");
  const runtimeProblems = [];

  if (runtime?.status !== "ok") {
    runtimeProblems.push(`runtime status is ${String(runtime?.status)}`);
  }

  if (runtime?.redacted && DIAGNOSTICS_SECRET) {
    runtimeProblems.push("runtime payload is still redacted; diagnostics secret was not accepted");
  }
  for (const field of ["uptimeSeconds", "rssBytes", "heapUsedBytes", "heapTotalBytes", "externalBytes"]) {
    if (parsePayloadNonNegativeNumber(runtime?.process?.[field]) === null) {
      runtimeProblems.push(`runtime process.${field} is missing`);
    }
  }
  if (runtime?.publicConfig && typeof runtime.publicConfig === "object") {
    const publicConfig = runtime.publicConfig;
    if (!Number.isSafeInteger(publicConfig.chainId) || publicConfig.chainId <= 0) {
      runtimeProblems.push("runtime publicConfig.chainId is missing");
    } else if (CONFIGURED_CHAIN_ID !== null && publicConfig.chainId !== CONFIGURED_CHAIN_ID) {
      runtimeProblems.push("runtime publicConfig.chainId must match configured Linea chain id");
    }
    if (typeof publicConfig.privyAppIdConfigured !== "boolean") {
      runtimeProblems.push("runtime publicConfig.privyAppIdConfigured is missing");
    }
    if (typeof publicConfig.privyFallbackActive !== "boolean") {
      runtimeProblems.push("runtime publicConfig.privyFallbackActive is missing");
    }
    if (typeof publicConfig.readOnlyMode !== "boolean") {
      runtimeProblems.push("runtime publicConfig.readOnlyMode is missing");
    }
    if (typeof publicConfig.contractRequiresEpochBoundBets !== "boolean") {
      runtimeProblems.push("runtime publicConfig.contractRequiresEpochBoundBets is missing");
    }
    if (typeof publicConfig.productionLikeMonitoring !== "boolean") {
      runtimeProblems.push("runtime publicConfig.productionLikeMonitoring is missing");
    }
    if (typeof publicConfig.backupMonitorConfigured !== "boolean") {
      runtimeProblems.push("runtime publicConfig.backupMonitorConfigured is missing");
    }
    if (typeof publicConfig.backupMonitorMaxAgeConfigured !== "boolean") {
      runtimeProblems.push("runtime publicConfig.backupMonitorMaxAgeConfigured is missing");
    }
    if (typeof publicConfig.emailAlertConfigured !== "boolean") {
      runtimeProblems.push("runtime publicConfig.emailAlertConfigured is missing");
    }
    if (typeof publicConfig.multiReplicaWeb !== "boolean") {
      runtimeProblems.push("runtime publicConfig.multiReplicaWeb is missing");
    }
    if (typeof publicConfig.externalRateLimitConfigured !== "boolean") {
      runtimeProblems.push("runtime publicConfig.externalRateLimitConfigured is missing");
    }
    if (typeof publicConfig.trustedProxyConfigured !== "boolean") {
      runtimeProblems.push("runtime publicConfig.trustedProxyConfigured is missing");
    }
    if (typeof publicConfig.weakRateLimitIdentityAllowed !== "boolean") {
      runtimeProblems.push("runtime publicConfig.weakRateLimitIdentityAllowed is missing");
    }
    if (EXPECT_EPOCH_BOUND_BETS && publicConfig.contractRequiresEpochBoundBets !== true) {
      runtimeProblems.push("runtime build does not require protected V10 bets");
    }
    if (publicConfig.productionLikeMonitoring && publicConfig.backupMonitorConfigured !== true) {
      runtimeProblems.push("production-like runtime is missing backup monitoring directory configuration");
    }
    if (publicConfig.productionLikeMonitoring && publicConfig.backupMonitorMaxAgeConfigured !== true) {
      runtimeProblems.push("production-like runtime is missing backup freshness window configuration");
    }
    if (publicConfig.productionLikeMonitoring && publicConfig.emailAlertConfigured !== true) {
      runtimeProblems.push("production-like runtime is missing Resend email alert configuration");
    }
    if (publicConfig.multiReplicaWeb && publicConfig.externalRateLimitConfigured !== true) {
      runtimeProblems.push("multi-replica runtime is missing external shared rate-limit configuration");
    }
    if (!ALLOW_LOCAL && publicConfig.productionLikeMonitoring && publicConfig.trustedProxyConfigured !== true) {
      runtimeProblems.push("production-like runtime is missing trusted proxy identity configuration");
    }
    if (!ALLOW_LOCAL && publicConfig.productionLikeMonitoring && publicConfig.weakRateLimitIdentityAllowed) {
      runtimeProblems.push("production-like runtime allows weak rate-limit identity");
    }
    if (publicConfig.chainId === 59144) {
      if (publicConfig.privyAppIdConfigured !== true) {
        runtimeProblems.push("mainnet runtime is missing NEXT_PUBLIC_PRIVY_APP_ID");
      }
      if (publicConfig.privyFallbackActive) {
        runtimeProblems.push("mainnet runtime is using the development Privy fallback");
      }
    }
  } else {
    runtimeProblems.push("runtime publicConfig diagnostics are missing");
  }

  const dataSyncSummary = summarizeDataSync(dataSync);
  const problems = [...runtimeProblems, ...dataSyncSummary.problems];

  if (problems.length > 0) {
    emitFailure(problems, dataSync?.hints);
    process.exitCode = 1;
    return;
  }

  const readOnlyMode = Boolean(runtime?.publicConfig?.readOnlyMode);
  const summaryParts = [
    `runtime=${runtime.status}`,
    `dataSync=${dataSync.status}`,
    `readOnlyMode=${String(readOnlyMode)}`,
    `backupMonitorConfigured=${String(Boolean(runtime?.publicConfig?.backupMonitorConfigured))}`,
    `backupMonitorMaxAgeConfigured=${String(Boolean(runtime?.publicConfig?.backupMonitorMaxAgeConfigured))}`,
    `emailAlertConfigured=${String(Boolean(runtime?.publicConfig?.emailAlertConfigured))}`,
    `externalRateLimitConfigured=${String(Boolean(runtime?.publicConfig?.externalRateLimitConfigured))}`,
    `trustedProxyConfigured=${String(Boolean(runtime?.publicConfig?.trustedProxyConfigured))}`,
    `finalityLagBlocks=${String(dataSyncSummary.finalityLagBlocks ?? "n/a")}`,
    `effectiveLagBlocks=${String(dataSyncSummary.effectiveLagBlocks ?? "n/a")}`,
    `rawLagBlocks=${String(dataSyncSummary.lagBlocks ?? "n/a")}`,
    `indexerRunAgeMs=${String(dataSyncSummary.runCompletedAgeMs ?? "n/a")}`,
    `rssBytes=${String(parsePayloadNonNegativeNumber(runtime?.process?.rssBytes) ?? "n/a")}`,
    `heapUsedBytes=${String(parsePayloadNonNegativeNumber(runtime?.process?.heapUsedBytes) ?? "n/a")}`,
    `dbBytes=${String(parsePayloadNonNegativeNumber(dataSync?.storage?.dbBytes) ?? "n/a")}`,
    `walBytes=${String(parsePayloadNonNegativeNumber(dataSync?.storage?.walBytes) ?? "n/a")}`,
  ];
  if (summaryOnly) {
    console.log(
      JSON.stringify({
        status: "pass",
        runtime: runtime.status,
        dataSync: dataSync.status,
        readOnlyMode,
        backupMonitorConfigured: Boolean(runtime?.publicConfig?.backupMonitorConfigured),
        backupMonitorMaxAgeConfigured: Boolean(runtime?.publicConfig?.backupMonitorMaxAgeConfigured),
        emailAlertConfigured: Boolean(runtime?.publicConfig?.emailAlertConfigured),
        externalRateLimitConfigured: Boolean(runtime?.publicConfig?.externalRateLimitConfigured),
        trustedProxyConfigured: Boolean(runtime?.publicConfig?.trustedProxyConfigured),
        finalityLagBlocks: dataSyncSummary.finalityLagBlocks ?? null,
        effectiveLagBlocks: dataSyncSummary.effectiveLagBlocks ?? null,
        rawLagBlocks: dataSyncSummary.lagBlocks ?? null,
      }),
    );
    return;
  }
  console.log("[prod-health] OK");
  console.log([`base=${BASE_URL}`, ...summaryParts].join(" "));
}

if (selfTest) {
  try {
    runSelfTest();
  } catch (error) {
    emitFailure([describeProdHealthError(error)]);
    process.exitCode = 1;
  }
} else {
  main().catch((error) => {
    emitFailure([describeProdHealthError(error)]);
    process.exitCode = 1;
  });
}
