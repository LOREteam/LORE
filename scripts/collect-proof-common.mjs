import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

export function isPositiveInteger(value) {
  return parsePositiveInteger(value) !== null;
}

export function isAddress(value) {
  const text = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(text) && text.toLowerCase() !== ZERO_ADDRESS;
}

export function normalizeProofOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.username || url.password) return "";
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

export function sameProofOrigin(left, right) {
  const normalizedLeft = normalizeProofOrigin(left);
  const normalizedRight = normalizeProofOrigin(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isPublicProofHostname(host) {
  return (host.includes(".") || host.includes(":")) &&
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
}

export function hasPublicProofHttpsUrl(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) return false;
  try {
    const url = new URL(match[0].replace(/[),.;]+$/g, ""));
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      isPublicProofHostname(host);
  } catch {
    return false;
  }
}

export function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      isPublicProofHostname(host);
  } catch {
    return false;
  }
}

export function fail(message) {
  console.error(redactProofText(message));
  process.exit(1);
}

export function requireCondition(condition, message) {
  if (!condition) fail(message);
}

export function redactedArgs() {
  return process.argv.slice(2).map((arg) => redactProofText(arg));
}

export function writeJson(outPath, data) {
  const absolute = path.resolve(process.cwd(), outPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return absolute;
}

export function printPlan(title, plan) {
  console.log(redactProofText(`# ${title}`));
  console.log(redactProofText(JSON.stringify(plan, null, 2)));
}

export function baseCollectorMeta(kind) {
  return {
    collector: kind,
    collectedAt: new Date().toISOString(),
    redactedArgs: redactedArgs(),
    note: "Collector output is evidence input only. Strict proof validators decide launch readiness.",
  };
}
export function refuseFinalProofOutput(outPath, kind) {
  const absolute = path.resolve(process.cwd(), String(outPath ?? ""));
  const normalized = path.relative(process.cwd(), absolute).replace(/\\/g, "/");
  if (/^docs\/[a-z-]+-proof\.json$/i.test(normalized)) {
    fail(`${kind} collector writes incomplete evidence drafts only; use --out=docs/${kind}-proof.draft.json, then promote to docs/${kind}-proof.json only after real evidence and strict validation`);
  }
}
