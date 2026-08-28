import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isFinalHttpsOrigin, sameProofOrigin } from "./collect-proof-common.mjs";
import {
  hostEvidenceRegularFileStat,
  parseHostEvidenceKeyValues as parseKeyValues,
  parseHostEvidenceNonNegativeDecimal as parseNonNegativeDecimal,
  parseHostEvidenceNonNegativeInteger as parseNonNegativeInteger,
  parseHostLoadMaxErrorRate as parseLoadMaxErrorRate,
  parseHostLoadMaxP95Ms as parseLoadMaxP95Ms,
  readHostEvidenceLog,
  requireDistinctHostEvidenceArtifacts,
} from "./host-evidence-policy.mjs";

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/host-proof.json") {
    throw new Error("Host proof draft generator writes incomplete drafts only; use --out=docs/host-proof.draft.json, then promote to docs/host-proof.json only after real production host, health, load, and persistence evidence passes strict validation");
  }
}


function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : process.env[name.toUpperCase().replaceAll("-", "_")] || fallback;
}

function requireConcreteValue(name, value) {
  if (!String(value ?? "").trim() || /^(?:TODO|TBD|REPLACE|<)/i.test(String(value).trim())) {
    throw new Error(`--${name} is required when drafting host launch evidence`);
  }
  return value;
}

function requireExistingArtifact(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!hostEvidenceRegularFileStat(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return filePath;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function pathInsideOrSame(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function isAnyPlatformAbsolute(value) {
  const raw = String(value ?? "").trim();
  return path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw) || raw.startsWith("/");
}

function externalPathStatus(value) {
  const raw = String(value ?? "").trim();
  const foreignWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw);
  // A redacted Windows production path remains external when Linux CI checks
  // the draft; POSIX resolve() would otherwise reinterpret it under the repo.
  const absolute = foreignWindowsAbsolute && process.platform !== "win32"
    ? raw
    : isAnyPlatformAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw || ".");
  return {
    insideRepo: foreignWindowsAbsolute && process.platform !== "win32"
      ? false
      : pathInsideOrSame(absolute, process.cwd()),
    isAbsolute: isAnyPlatformAbsolute(raw),
  };
}

function requireExternalDbPath(value) {
  const status = externalPathStatus(value);
  requireCondition(status.isAbsolute && !status.insideRepo, "--db-path/LORE_DB_PATH must be an absolute path outside the repo checkout");
}

function sameOrigin(left, right) {
  return sameProofOrigin(left, right);
}

function firstMatchingLine(text, pattern) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line));
}

function parseHealth(log) {
  const ok = /\[prod-health\]\s+OK/i.test(log);
  const summary = firstMatchingLine(log, /\bbase=|\bruntime=|\bdataSync=/i) || "TODO: paste npm.cmd run health:prod summary";
  const values = parseKeyValues(summary);

  return {
    status: ok ? "pass" : "TODO",
    command: "npm.cmd run health:prod",
    url: values.base || argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || "TODO: https://final-origin"),
    runtimeHealthPassed: ok && /^(ok|pass|healthy)$/i.test(values.runtime ?? ""),
    dataSyncHealthPassed: ok && /^(ok|pass|healthy)$/i.test(values.dataSync ?? ""),
    diagnosticsAuthPassed: ok,
    finalityLagChecked: parseNonNegativeInteger(values.finalityLagBlocks, null) !== null,
    jackpotRowsChecked: false,
    summary,
    timestamp: new Date().toISOString(),
  };
}

function requireValidHealthArtifact(health, origin) {
  requireCondition(health.status === "pass", "--health-log must include [prod-health] OK");
  requireCondition(/\bbase=\S+/i.test(health.summary), "--health-log must include base=<production origin>");
  requireCondition(sameOrigin(health.url, origin), "--health-log base must match --origin");
  requireCondition(health.runtimeHealthPassed === true, "--health-log must include runtime=ok/pass/healthy");
  requireCondition(health.dataSyncHealthPassed === true, "--health-log must include dataSync=ok/pass/healthy");
  requireCondition(health.finalityLagChecked === true, "--health-log must include canonical non-negative decimal finalityLagBlocks=<number>");
}

function parseLoad(log) {
  const baseLine = firstMatchingLine(log, /^Load base URL:/i) || "";
  const configLine = firstMatchingLine(log, /^Concurrency:/i) || "";
  const totalLine = firstMatchingLine(log, /^TOTAL\s+/i) || "";
  const summary = totalLine || "TODO: paste npm.cmd run load:http TOTAL summary";
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

  return {
    status: total.count > 0 && total.fail === 0 ? "pass" : "TODO",
    command: "npm.cmd run load:http",
    hostType: argValue("load-host-type", "TODO: staging or canary"),
    url: baseLine.match(/^Load base URL:\s*(\S+)/i)?.[1] || argValue("load-origin", process.env.LOAD_BASE_URL || process.env.LOAD_HTTP_BASE_URL || "TODO: https://staging-or-canary-origin"),
    durationMs: config.durationMs,
    concurrency: config.concurrency,
    requestCount: total.count,
    errorRate,
    maxErrorRate: parseLoadMaxErrorRate(),
    p95Ms: total.p95Ms,
    maxP95Ms: parseLoadMaxP95Ms(),
    summary: [baseLine, summary].filter(Boolean).join(" | "),
    timestamp: new Date().toISOString(),
  };
}

function requireValidLoadArtifact(load, loadOrigin) {
  requireCondition(/^Load base URL:/im.test(load.summary), "--load-log must include Load base URL line");
  requireCondition(sameOrigin(load.url, loadOrigin), "--load-log Load base URL must match --load-origin");
  requireCondition(load.requestCount > 0, "--load-log TOTAL line must include positive count");
  requireCondition(load.durationMs > 0, "--load-log Concurrency line must include positive duration");
  requireCondition(load.concurrency > 0, "--load-log Concurrency line must include positive concurrency");
  requireCondition(load.errorRate <= load.maxErrorRate, "--load-log error rate must be <= LOAD_MAX_ERROR_RATE");
  requireCondition(load.p95Ms > 0 && load.p95Ms <= load.maxP95Ms, "--load-log p95 must be positive and <= LOAD_MAX_P95_MS");
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/host-proof.draft.json"));
refuseFinalProofOutput(outPath);
const healthLogPath = argValue("health-log");
const loadLogPath = argValue("load-log");
const processEvidencePath = argValue("process-evidence", "");
requireDistinctHostEvidenceArtifacts([["process-evidence", processEvidencePath], ["health-log", healthLogPath], ["load-log", loadLogPath]]);
const healthLog = readHostEvidenceLog("health-log", requireConcreteValue("health-log", healthLogPath), { required: true });
const loadLog = readHostEvidenceLog("load-log", requireConcreteValue("load-log", loadLogPath), { required: true });
const origin = requireConcreteValue("origin", argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || ""));
const hostType = argValue("host-type", "production");
const loadOrigin = requireConcreteValue("load-origin", argValue("load-origin", process.env.LOAD_BASE_URL || process.env.LOAD_HTTP_BASE_URL || ""));
const loadHostType = requireConcreteValue("load-host-type", argValue("load-host-type", ""));
const dbPath = requireConcreteValue("db-path", argValue("db-path", process.env.LORE_DB_PATH || ""));
const supervisor = requireConcreteValue("supervisor", argValue("supervisor", ""));
const processEvidence = requireExistingArtifact("process-evidence", processEvidencePath);
requireCondition(isFinalHttpsOrigin(origin), "--origin must be a public HTTPS origin without path, query, or hash");
requireCondition(hostType === "production", "--host-type must be production for launch host evidence");
requireCondition(isFinalHttpsOrigin(loadOrigin), "--load-origin must be a public HTTPS origin without path, query, or hash");
requireCondition(["staging", "canary"].includes(loadHostType), "--load-host-type must be staging or canary");
requireCondition(origin.toLowerCase() !== loadOrigin.toLowerCase(), "--load-origin must differ from the production --origin");
requireExternalDbPath(dbPath);
const healthProd = parseHealth(healthLog);
const loadHttp = parseLoad(loadLog);
requireValidHealthArtifact(healthProd, origin);
requireValidLoadArtifact(loadHttp, loadOrigin);
const now = new Date().toISOString();

const manifest = {
  origin,
  hostType,
  loadOrigin,
  loadHostType,
  processModel: {
    supervisor,
    "lore-site": {
      supervised: true,
      running: false,
      status: "TODO",
      command: "TODO: exact supervised command for lore-site",
      evidence: processEvidence,
      checkedAt: now,
    },
    "lore-bot": {
      supervised: true,
      running: false,
      status: "TODO",
      command: "TODO: exact supervised command for lore-bot",
      evidence: processEvidence,
      checkedAt: now,
    },
    "lore-indexer": {
      supervised: true,
      running: false,
      status: "TODO",
      command: "TODO: exact supervised command for lore-indexer",
      evidence: processEvidence,
      checkedAt: now,
    },
  },
  persistentDb: {
    path: dbPath,
    absolutePathOutsideRepo: true,
    restartSurvived: false,
    rebootSurvived: false,
    evidence: "TODO: paste restart/reboot persistence proof",
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
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Host proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields before copying to docs/host-proof.json and running npm.cmd run proof:host -- --strict.");
