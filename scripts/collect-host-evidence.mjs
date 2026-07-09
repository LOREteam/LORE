import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { argValue, baseCollectorMeta, hasFlag, isFinalHttpsOrigin, printPlan, requireCondition, writeJson, refuseFinalProofOutput } from "./collect-proof-common.mjs";

const origin = argValue("origin");
const hostType = argValue("host-type", "production");
const loadOrigin = argValue("load-origin");
const loadHostType = argValue("load-host-type");
const out = argValue("out", "docs/host-proof.draft.json");
refuseFinalProofOutput(out, "host");

requireCondition(isFinalHttpsOrigin(origin), "--origin must be a non-local HTTPS origin without path, query, or hash");
requireCondition(hostType === "production", "--host-type must be production for launch host evidence");
requireCondition(isFinalHttpsOrigin(loadOrigin), "--load-origin must be a non-local HTTPS origin without path, query, or hash");
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
requireExistingArtifact("process-evidence", processEvidence);
requireExternalDbPath(dbPath);
requireArtifact("health-log", healthLogPath);
requireArtifact("load-log", loadLogPath);
const healthLog = readOptionalLog(healthLogPath);
const loadLog = readOptionalLog(loadLogPath);

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

function requireExistingArtifact(name, value) {
  requireConcreteValue(name, value);
  if (!printPlanMode) requireCondition(existsSync(resolve(process.cwd(), value)), `--${name} must point to an existing redacted artifact`);
}

function requireExternalDbPath(value) {
  if (printPlanMode) return;
  const absolute = resolve(value);
  requireCondition(isAbsolute(value) && !pathInsideOrSame(absolute, process.cwd()), "--db-path/LORE_DB_PATH must be an absolute path outside the repo checkout");
}

function readOptionalLog(filePath) {
  if (!filePath) return "";
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`${filePath} does not exist`);
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
  for (const match of line.matchAll(/([a-zA-Z][a-zA-Z0-9]*)=([^\s]+)/g)) {
    result[match[1]] = match[2];
  }
  return result;
}

function parseNumber(value, fallback) {
  const normalized = String(value ?? "").replace(/[,%]/g, "").trim();
  if (normalized === "") return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value ?? "").trim()).origin.toLowerCase();
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
  const finalityLagChecked = Number.isFinite(Number(values.finalityLagBlocks));

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
  requireCondition(health.finalityLagChecked === true, "--health-log must include numeric finalityLagBlocks=<number>");
}

function parseLoad(log, logPath) {
  const baseLine = firstMatchingLine(log, /^Load base URL:/i) || "";
  const configLine = firstMatchingLine(log, /^Concurrency:/i) || "";
  const totalLine = firstMatchingLine(log, /^TOTAL\s+/i) || "";
  const config = {
    durationMs: parseNumber(configLine.match(/duration:\s*(\d+)ms/i)?.[1], 0),
    concurrency: parseNumber(configLine.match(/Concurrency:\s*(\d+)/i)?.[1], 0),
  };
  const total = {
    count: parseNumber(totalLine.match(/\bcount=\s*(\d+)/i)?.[1], 0),
    fail: parseNumber(totalLine.match(/\bfail=\s*(\d+)/i)?.[1], 0),
    errorPercent: parseNumber(totalLine.match(/\berr=\s*([\d.]+)%/i)?.[1], 100),
    p95Ms: parseNumber(totalLine.match(/\bp95=\s*(\d+)\s*ms/i)?.[1], 0),
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
    maxErrorRate: parseNumber(process.env.LOAD_MAX_ERROR_RATE, 0.01),
    p95Ms: total.p95Ms,
    maxP95Ms: parseNumber(process.env.LOAD_MAX_P95_MS, 1500),
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
  requiredManualEvidence: [
    "set running=true/status=pass for separately supervised lore-site/lore-bot/lore-indexer after concrete supervisor evidence",
    "set persistentDb booleans true only after restart and reboot survival proof for LORE_DB_PATH outside repo",
    "pass --health-log=<redacted-health-prod-log> from final HTTPS origin including numeric finalityLagBlocks",
    "pass --load-log=<redacted-load-http-log> from a separate staging/canary HTTPS origin",
  ],
};

if (printPlanMode) {
  printPlan("Host Evidence Collection Plan", manifest);
} else {
  const written = writeJson(out, manifest);
  console.log(`Host evidence draft written: ${written}`);
  console.log("Review TODO/false fields before promoting to docs/host-proof.json and running npm.cmd run proof:host -- --strict.");
}

