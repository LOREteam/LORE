import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

function readRequiredLog(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return readFileSync(resolved, "utf8");
}

function requireExistingArtifact(name, filePath) {
  requireConcreteValue(name, filePath);
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
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

function requireExternalDbPath(value) {
  const absolute = path.resolve(value);
  requireCondition(path.isAbsolute(value) && !pathInsideOrSame(absolute, process.cwd()), "--db-path/LORE_DB_PATH must be an absolute path outside the repo checkout");
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value ?? "").trim()).origin.toLowerCase();
  } catch {
    return "";
  }
}

function isFinalHttpsOrigin(value) {
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

function sameOrigin(left, right) {
  const normalizedLeft = normalizedOrigin(left);
  const normalizedRight = normalizedOrigin(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
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
    finalityLagChecked: Number.isFinite(Number(values.finalityLagBlocks)),
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
  requireCondition(health.finalityLagChecked === true, "--health-log must include numeric finalityLagBlocks=<number>");
}

function parseLoad(log) {
  const baseLine = firstMatchingLine(log, /^Load base URL:/i) || "";
  const configLine = firstMatchingLine(log, /^Concurrency:/i) || "";
  const totalLine = firstMatchingLine(log, /^TOTAL\s+/i) || "";
  const summary = totalLine || "TODO: paste npm.cmd run load:http TOTAL summary";
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

  return {
    status: total.count > 0 && total.fail === 0 ? "pass" : "TODO",
    command: "npm.cmd run load:http",
    hostType: argValue("load-host-type", "TODO: staging or canary"),
    url: baseLine.match(/^Load base URL:\s*(\S+)/i)?.[1] || argValue("load-origin", process.env.LOAD_BASE_URL || process.env.LOAD_HTTP_BASE_URL || "TODO: https://staging-or-canary-origin"),
    durationMs: config.durationMs,
    concurrency: config.concurrency,
    requestCount: total.count,
    errorRate,
    maxErrorRate: parseNumber(process.env.LOAD_MAX_ERROR_RATE, 0.01),
    p95Ms: total.p95Ms,
    maxP95Ms: parseNumber(process.env.LOAD_MAX_P95_MS, 1500),
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
const healthLog = readRequiredLog("health-log", argValue("health-log"));
const loadLog = readRequiredLog("load-log", argValue("load-log"));
const origin = requireConcreteValue("origin", argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || ""));
const hostType = argValue("host-type", "production");
const loadOrigin = requireConcreteValue("load-origin", argValue("load-origin", process.env.LOAD_BASE_URL || process.env.LOAD_HTTP_BASE_URL || ""));
const loadHostType = requireConcreteValue("load-host-type", argValue("load-host-type", ""));
const dbPath = requireConcreteValue("db-path", argValue("db-path", process.env.LORE_DB_PATH || ""));
const supervisor = requireConcreteValue("supervisor", argValue("supervisor", ""));
const processEvidence = requireExistingArtifact("process-evidence", argValue("process-evidence", ""));
requireCondition(isFinalHttpsOrigin(origin), "--origin must be a non-local HTTPS origin without path, query, or hash");
requireCondition(hostType === "production", "--host-type must be production for launch host evidence");
requireCondition(isFinalHttpsOrigin(loadOrigin), "--load-origin must be a non-local HTTPS origin without path, query, or hash");
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
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Host proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields before copying to docs/host-proof.json and running npm.cmd run proof:host -- --strict.");
