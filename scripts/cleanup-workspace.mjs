import { lstat, readdir, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const summaryOnly = process.argv.includes("--summary-only");
const DECIMAL_HOURS_RE = /^(0|[1-9]\d{0,5})(?:\.(\d{1,3}))?$/;
const DECIMAL_HOUR_SCALE = 1000n;
const DECIMAL_HOUR_SCALE_NUMBER = 1000;
const MILLISECONDS_PER_HOUR = 60n * 60n * 1000n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const minAge = parseDecimalHoursEnv("CLEANUP_MIN_AGE_HOURS", 8, { min: 0, max: 100_000 });
const minAgeHours = minAge.hours;
const minAgeMs = minAge.milliseconds;

function parseDecimalHoursEnv(name, fallback, { min, max }) {
  const raw = process.env[name]?.trim();
  const value = raw && raw.length > 0 ? raw : String(fallback);
  const minScaled = parseDecimalHoursToThousandths(String(min), name);
  const maxScaled = parseDecimalHoursToThousandths(String(max), name);
  const thousandths = parseDecimalHoursToThousandths(value, name);
  if (thousandths < minScaled || thousandths > maxScaled) {
    throw new Error(`${name} must be a decimal hour value between ${min} and ${max}`);
  }
  const milliseconds = (thousandths * MILLISECONDS_PER_HOUR) / DECIMAL_HOUR_SCALE;
  if (milliseconds > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be a decimal hour value between ${min} and ${max}`);
  }
  return {
    hours: Number(thousandths) / DECIMAL_HOUR_SCALE_NUMBER,
    milliseconds: Number(milliseconds),
  };
}

function parseDecimalHoursToThousandths(value, name) {
  const match = value.match(DECIMAL_HOURS_RE);
  if (!match) {
    throw new Error(`${name} must be a decimal hour value between 0 and 100000`);
  }
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(3, "0") || "0");
  return whole * DECIMAL_HOUR_SCALE + fraction;
}

const deleteWholeTargets = [
  ".next/cache",
  "playwright-report",
  "test-results",
  "coverage",
].map((entry) => resolve(root, entry));

const agedChildTargets = [
  ".tmp",
].map((entry) => resolve(root, entry));

function isInsideRoot(target) {
  const rel = relative(root, resolve(target));
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("\\") && !rel.startsWith("/");
}

function normalizeByteCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function formatBytes(bytes) {
  bytes = normalizeByteCount(bytes);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function sizeOf(target) {
  try {
    const info = await lstat(target);
    if (!info.isDirectory()) return info.size;
    const entries = await readdir(target, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) total += normalizeByteCount(await sizeOf(join(target, entry.name)));
    return normalizeByteCount(total);
  } catch {
    return 0;
  }
}

async function newestMtimeMs(target) {
  const info = await lstat(target);
  if (!info.isDirectory()) return info.mtimeMs;
  const entries = await readdir(target, { withFileTypes: true });
  let newest = info.mtimeMs;
  for (const entry of entries) newest = Math.max(newest, await newestMtimeMs(join(target, entry.name)));
  return newest;
}

async function maybeDelete(target, requireAge = false) {
  if (!isInsideRoot(target)) return { target, skipped: true, reason: "outside-root", bytes: 0 };
  const info = await lstat(target).catch(() => null);
  if (!info) return { target, skipped: true, reason: "missing", bytes: 0 };
  if (requireAge) {
    const ageMs = Date.now() - (await newestMtimeMs(target));
    if (ageMs < minAgeMs) return { target, skipped: true, reason: "too-new", bytes: 0 };
  }
  const bytes = await sizeOf(target);
  if (!dryRun) await rm(target, { recursive: true, force: true });
  return { target, skipped: false, reason: dryRun ? "dry-run" : "deleted", bytes };
}

async function agedChildren(parent) {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    const now = Date.now();
    const targets = [];
    for (const entry of entries) {
      const target = join(parent, entry.name);
      const info = await lstat(target).catch(() => null);
      if (!info) continue;
      const ageMs = now - (await newestMtimeMs(target));
      if (ageMs >= minAgeMs) targets.push(target);
    }
    return targets;
  } catch {
    return [];
  }
}

const results = [];
for (const target of deleteWholeTargets) results.push(await maybeDelete(target, true));
for (const parent of agedChildTargets) {
  for (const target of await agedChildren(parent)) results.push(await maybeDelete(target));
}

const deleted = results.filter((item) => !item.skipped);
const skipped = results.length - deleted.length;
const bytes = normalizeByteCount(deleted.reduce((sum, item) => sum + normalizeByteCount(item.bytes), 0));
const summary = {
  status: "ok",
  mode: dryRun ? "dry-run" : "apply",
  minAgeHours,
  matchedTargets: deleted.length,
  deletedTargets: dryRun ? 0 : deleted.length,
  wouldDeleteTargets: dryRun ? deleted.length : 0,
  skippedTargets: skipped,
  bytes,
  bytesFormatted: formatBytes(bytes),
};

if (!summaryOnly) {
  summary.targets = deleted
    .slice(0, 12)
    .map((item) => relative(root, item.target).replace(/\\/g, "/"))
    .join(",") || "none";
}

console.log(JSON.stringify(summary));
