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

function readOptionalLog(filePath) {
  if (!filePath) return "";
  const resolved = path.resolve(process.cwd(), filePath);
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
  const normalized = String(value ?? "").replace(/[,%]/g, "");
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
    p95Ms: parseNumber(totalLine.match(/\bp95=\s*(\d+)ms/i)?.[1], 0),
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

const outPath = path.resolve(process.cwd(), argValue("out", "docs/host-proof.draft.json"));
refuseFinalProofOutput(outPath);
const healthLog = readOptionalLog(argValue("health-log"));
const loadLog = readOptionalLog(argValue("load-log"));
const origin = argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || "TODO: https://final-origin");
const hostType = argValue("host-type", "production");
const dbPath = argValue("db-path", process.env.LORE_DB_PATH || "TODO: absolute DB path outside repo");
const processEvidence = argValue("process-evidence", "TODO: paste pm2/supervisor output");
const now = new Date().toISOString();

const manifest = {
  origin,
  hostType,
  processModel: {
    supervisor: argValue("supervisor", "pm2"),
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
    absolutePathOutsideRepo: false,
    restartSurvived: false,
    rebootSurvived: false,
    evidence: "TODO: paste restart/reboot persistence proof",
    checkedAt: now,
  },
  healthProd: parseHealth(healthLog),
  loadHttp: parseLoad(loadLog),
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Host proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields before copying to docs/host-proof.json and running npm.cmd run proof:host -- --strict.");
