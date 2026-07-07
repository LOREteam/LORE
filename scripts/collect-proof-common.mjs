import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function isPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

export function isAddress(value) {
  const text = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(text) && text.toLowerCase() !== ZERO_ADDRESS;
}

export function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" && url.pathname === "/" && url.search === "" && url.hash === "" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname) && !url.hostname.endsWith(".local");
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
