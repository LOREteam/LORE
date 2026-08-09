import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { argValue, baseCollectorMeta, hasFlag, isFinalHttpsOrigin, printPlan, requireCondition, writeJson, refuseFinalProofOutput } from "./collect-proof-common.mjs";

const origin = argValue("origin");
const hostType = argValue("host-type", "production");
const loadOrigin = argValue("load-origin");
const loadHostType = argValue("load-host-type");
const out = argValue("out", "docs/host-proof.draft.json");
refuseFinalProofOutput(out, "host");
const MAX_KEY_VALUE_MARKERS = 64;
const MAX_HOST_EVIDENCE_BYTES = 512 * 1024;

requireCondition(isFinalHttpsOrigin(origin), "--origin must be a public HTTPS origin without path, query, or hash");
requireCondition(hostType === "production", "--host-type must be production for launch host evidence");
requireCondition(isFinalHttpsOrigin(loadOrigin), "--load-origin must be a public HTTPS origin without path, query, or hash");
requireCondition(["staging", "canary"].includes(loadHostType), "--load-host-type must be staging or canary");
requireCondition(origin.toLowerCase() !== loadOrigin.toLowerCase(), "--load-origin must differ from the production --origin");

const now = new Date().toISOString();
const printPlanMode = hasFlag("print-plan");
const dbPath = argValue("db-path", process.env.LORE_DB_PATH || "");
const supervisor = argValue("supervisor", "");
const processEvidence = argValue("process-evidence", "");
const healthLogPath = argValue("health-log");
const loadLogPath = argValue("load-log");
requireConcreteValue("db-path", dbPath);
requireConcreteValue("supervisor", supervisor);
requireDistinctArtifactInputs([["process-evidence", processEvidence], ["health-log", healthLogPath], ["load-log", loadLogPath]]);
requireExistingArtifact("process-evidence", processEvidence);
requireExternalDbPath(dbPath);
requireArtifact("health-log", healthLogPath);
requireArtifact("load-log", loadLogPath);
const healthLog = readOptionalLog("health-log", healthLogPath);
const loadLog = readOptionalLog("load-log", loadLogPath);

function hasConcreteValue(value) {
  return Boolean(String(value ?? "").trim()) && !/^(?:TODO|TBD|REPLACE|<)/i.test(String(value).trim());
}

function pathInsideOrSame(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel));
}

function requireConcreteValue(name, value) {
  if (!printPlanMode) requireCondition(hasConcreteValue(value), `--${name} is required when collecting launch host evidence`);
}

function requireArtifact(name, value) {
  if (!printPlanMode) requireCondition(Boolean(value), `--${name} is required when collecting launch host evidence`);
}

function regularFileStat(filePath) {
  try {
    const stat = statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function requireExistingArtifact(name, value) {
  requireConcreteValue(name, value);
  if (printPlanMode) return;
  const resolved = resolve(process.cwd(), value);
  requireCondition(Boolean(regularFileStat(resolved)), `--${name} must point to an existing redacted artifact`);
}

function sameArtifact(left, right) {
  return resolve(process.cwd(), left).toLowerCase() === resolve(process.cwd(), right).toLowerCase();
}

function requireDistinctArtifactInputs(entries) {
  if (printPlanMode) return;
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftName, leftPath] = entries[i];
      const [rightName, rightPath] = entries[j];
      if (!leftPath || !rightPath) continue;
      if (sameArtifact(leftPath, rightPath)) {
        throw new Error(`--${leftName} and --${rightName} must point to distinct host evidence files`);
      }
    }
  }
}

function requireExternalDbPath(value) {
  if (printPlanMode) return;
  const absolute = resolve(value);
  requireCondition(isAbsolute(value) && !pathInsideOrSame(absolute, process.cwd()), "--db-path/LORE_DB_PATH must be an absolute path outside the repo checkout");
}

function readOptionalLog(name, filePath) {
  if (!filePath) return "";
  const resolved = resolve(process.cwd(), filePath);
  const stat = regularFileStat(resolved);
  if (!stat) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  if (stat.size > MAX_HOST_EVIDENCE_BYTES) {
    throw new Error(`--${name} artifact is too large to validate safely`);
  }
  return readFileSync(resolved, "utf8");
}

function firstMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function parseKeyValues(line = "") {
  const result = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9]*)=([^\s]+)/g;
  let inspected = 0;
  let match = pattern.exec(line);
  while (match) {
    inspected += 1;
    if (inspected > MAX_KEY_VALUE_MARKERS) {
      throw new Error("host health evidence has too many key/value markers to validate safely");
    }
    result[match[1]] = match[2];
    match = pattern.exec(line);
  }
  return result;
}

const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const DECIMAL_NUMBER_RE = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,6})?$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseNonNegativeInteger(value, fallback) {
  const normalized = String(value ?? "").trim();
  if (normalized === "") return fallback;
  if (!DECIMAL_INTEGER_RE.test(normalized)) return fallback;
  const parsed = BigInt(normalized);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return fallback;
  return Number(parsed);
}

function parseNonNegativeDecimal(value, fallback) {
  const normalized = String(value ?? "").trim();
  if (normalized === "") return fallback;
  if (!DECIMAL_NUMBER_RE.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseLoadMaxErrorRate() {
  const raw = process.env.LOAD_MAX_ERROR_RATE;
  if (raw == null || raw === "") return 0.01;
  const parsed = parseNonNegativeDecimal(raw, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("LOAD_MAX_ERROR_RATE must be a canonical decimal rate between 0 and 1");
  }
  return parsed;
}

function parseLoadMaxP95Ms() {
  const raw = process.env.LOAD_MAX_P95_MS;
  if (raw == null || raw === "") return 1500;
  const parsed = parseNonNegativeInteger(raw, Number.NaN);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("LOAD_MAX_P95_MS must be a canonical positive integer of milliseconds");
  }
  return parsed;
}

function normalizedOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.username || url.password) return "";
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function sameOrigin(left, right) {
  const normalizedLeft = normalizedOrigin(left);
  const normalizedRight = normalizedOrigin(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function parseHealth(log, logPath) {
  const ok = /\[prod-health\]\s+OK/i.test(log);
  const summary = firstMatchingLine(log, /\bbase=|\bruntime=|\bdataSync=/i) || "TODO: paste health:prod output with numeric finalityLagBlocks=<number>";
  const values = parseKeyValues(summary);
  const finalityLagChecked = parseNonNegativeInteger(values.finalityLagBlocks, null) !== null;

  return {
    status: ok ? "pass" : "TODO",
    command: "npm.cmd run health:prod",
    url: values.base || origin,
    runtimeHealthPassed: ok && /^(ok|pass|healthy)$/i.test(values.runtime ?? ""),
    dataSyncHealthPassed: ok && /^(ok|pass|healthy)$/i.test(values.dataSync ?? ""),
    diagnosticsAuthPassed: ok,
    finalityLagChecked,
    jackpotRowsChecked: ok,
    summary,
    commandOutputPath: logPath || "TODO: path to redacted health:prod log",
    timestamp: now,
  };
}

function requireValidHealthArtifact(health) {
  if (printPlanMode) return;
  requireCondition(health.status === "pass", "--health-log must include [prod-health] OK");
  requireCondition(/\bbase=\S+/i.test(health.summary), "--health-log must include base=<production origin>");
  requireCondition(sameOrigin(health.url, origin), "--health-log base must match --origin");
  requireCondition(health.runtimeHealthPassed === true, "--health-log must include runtime=ok/pass/healthy");
  requireCondition(health.dataSyncHealthPassed === true, "--health-log must include dataSync=ok/pass/healthy");
  requireCondition(health.finalityLagChecked === true, "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>");
}

function parseLoad(log, logPath) {
  const baseLine = firstMatchingLine(log, /^Load base URL:/i) || "";
  const configLine = firstMatchingLine(log, /^Concurrency:/i) || "";
  const totalLine = firstMatchingLine(log, /^TOTAL\s+/i) || "";
  const config = {
    durationMs: parseNonNegativeInteger(configLine.match(/duration:\s*(\d+)ms/i)?.[1], 0),
    concurrency: parseNonNegativeInteger(configLine.match(/Concurrency:\s*(\d+)/i)?.[1], 0),
  };
  const total = {
    count: parseNonNegativeInteger(totalLine.match(/\bcount=\s*(\d+)/i)?.[1], 0),
    fail: parseNonNegativeInteger(totalLine.match(/\bfail=\s*(\d+)/i)?.[1], 0),
    errorPercent: parseNonNegativeDecimal(totalLine.match(/\berr=\s*((?:0|[1-9]\d*)(?:\.\d+)?)%/i)?.[1], 100),
    p95Ms: parseNonNegativeInteger(totalLine.match(/\bp95=\s*(\d+)\s*ms/i)?.[1], 0),
  };
  const errorRate = total.errorPercent / 100;
  const url = baseLine.match(/^Load base URL:\s*(\S+)/i)?.[1] || loadOrigin;
  const summary = [baseLine, totalLine || "TODO: paste load:http TOTAL line for staging/canary host"].filter(Boolean).join(" | ");

  return {
    status: total.count > 0 && total.fail === 0 ? "pass" : "TODO",
    command: "npm.cmd run load:http",
    hostType: loadHostType,
    url,
    durationMs: config.durationMs,
    concurrency: config.concurrency,
    requestCount: total.count,
    errorRate,
    maxErrorRate: parseLoadMaxErrorRate(),
    p95Ms: total.p95Ms,
    maxP95Ms: parseLoadMaxP95Ms(),
    summary,
    commandOutputPath: logPath || "TODO: path to redacted load:http log",
    timestamp: now,
  };
}

function requireValidLoadArtifact(load) {
  if (printPlanMode) return;
  requireCondition(/^Load base URL:/im.test(load.summary), "--load-log must include Load base URL line");
  requireCondition(sameOrigin(load.url, loadOrigin), "--load-log Load base URL must match --load-origin");
  requireCondition(load.requestCount > 0, "--load-log TOTAL line must include positive count");
  requireCondition(load.durationMs > 0, "--load-log Concurrency line must include positive duration");
  requireCondition(load.concurrency > 0, "--load-log Concurrency line must include positive concurrency");
  requireCondition(load.errorRate <= load.maxErrorRate, "--load-log error rate must be <= LOAD_MAX_ERROR_RATE");
  requireCondition(load.p95Ms > 0 && load.p95Ms <= load.maxP95Ms, "--load-log p95 must be positive and <= LOAD_MAX_P95_MS");
}

function processDraft(command) {
  return {
    supervised: true,
    running: false,
    status: "TODO",
    command,
    evidence: `artifact: ${processEvidence}`,
    checkedAt: now,
  };
}

const healthProd = parseHealth(healthLog, healthLogPath);
const loadHttp = parseLoad(loadLog, loadLogPath);
requireValidHealthArtifact(healthProd);
requireValidLoadArtifact(loadHttp);

const manifest = {
  ...baseCollectorMeta("host"),
  origin,
  hostType,
  loadOrigin,
  loadHostType,
  processModel: {
    supervisor,
    "lore-site": processDraft("npm.cmd run start"),
    "lore-bot": processDraft("npm.cmd run bot"),
    "lore-indexer": processDraft("npm.cmd run indexer"),
  },
  persistentDb: {
    path: dbPath,
    absolutePathOutsideRepo: true,
    restartSurvived: false,
    rebootSurvived: false,
    evidence: "TODO: paste or link concrete restart/reboot persistence proof",
    checkedAt: now,
  },
  healthProd,
  loadHttp,
  externalRateLimit: {
    status: "TODO",
    webReplicaCount: 2,
    distinctReplicas: 2,
    failClosed: false,
    sharedBucketVerified: false,
    evidence: "TODO: paste redacted two-replica shared rate-limit bucket proof",
    checkedAt: now,
  },
  requiredManualEvidence: [
    "set running=true/status=pass for separately supervised lore-site/lore-bot/lore-indexer after concrete supervisor evidence",
    "set persistentDb booleans true only after restart and reboot survival proof for LORE_DB_PATH outside repo",
    "pass --health-log=<redacted-health-prod-log> from final public HTTPS origin including canonical non-negative decimal finalityLagBlocks",
    "pass --load-log=<redacted-load-http-log> from a separate staging/canary HTTPS origin",
    "prove two web replicas consume one shared external rate-limit bucket and fail closed when the store is unavailable",
  ],
};

if (printPlanMode) {
  printPlan("Host Evidence Collection Plan", manifest);
} else {
  const written = writeJson(out, manifest);
  console.log(`Host evidence draft written: ${written}`);
  console.log("Review TODO/false fields before promoting to docs/host-proof.json and running npm.cmd run proof:host -- --strict.");
}
