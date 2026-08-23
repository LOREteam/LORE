import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const DECIMAL_HOURS_RE = /^(0|[1-9]\d{0,5})(?:\.(\d{1,3}))?$/;
const DECIMAL_HOUR_SCALE = 1000n;
const DECIMAL_HOUR_SCALE_NUMBER = 1000;
const MILLISECONDS_PER_HOUR = 60n * 60n * 1000n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export const WORKSPACE_CLEANUP_WHOLE_TARGETS = Object.freeze([
  ".next/cache",
  "playwright-report",
  "test-results",
  "coverage",
]);

export const WORKSPACE_CLEANUP_AGED_CHILD_PARENTS = Object.freeze([".tmp"]);

// These prefixes identify staged SQLite recovery assets. They are never cleanup candidates.
export const WORKSPACE_CLEANUP_PROTECTED_AGED_CHILD_PREFIXES = Object.freeze([
  "protected-db-recovery-exact-",
  "shm-reconstruct-",
]);

export function parseDecimalHoursToThousandths(value, name = "decimal hours") {
  const match = typeof value === "string" ? value.match(DECIMAL_HOURS_RE) : null;
  if (!match) throw new Error(`${name} must be a canonical decimal hour value`);
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(3, "0") || "0");
  return whole * DECIMAL_HOUR_SCALE + fraction;
}

export function parseDecimalHoursValue(
  raw,
  fallback,
  { name = "decimal hours", min, max },
) {
  const normalized = typeof raw === "string" ? raw.trim() : "";
  const value = normalized || String(fallback);
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

export function parseCleanupMinAgeHours(raw) {
  return parseDecimalHoursValue(raw, 8, {
    name: "CLEANUP_MIN_AGE_HOURS",
    min: 0,
    max: 100_000,
  });
}

export function createWorkspaceCleanupPlan(root) {
  const resolvedRoot = resolve(root);
  return {
    root: resolvedRoot,
    wholeTargets: WORKSPACE_CLEANUP_WHOLE_TARGETS.map((entry) => resolve(resolvedRoot, entry)),
    agedChildParents: WORKSPACE_CLEANUP_AGED_CHILD_PARENTS.map((entry) => resolve(resolvedRoot, entry)),
  };
}

export function isInsideWorkspaceRoot(root, target) {
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolve(target));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function sameWorkspaceCleanupPath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function resolveOrdinaryWorkspaceCleanupRoot(root) {
  const resolvedRoot = resolve(root);
  const info = await lstat(resolvedRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("workspace cleanup root must be an ordinary non-reparse directory");
  }
  const canonicalRoot = resolve(await realpath(resolvedRoot));
  if (!sameWorkspaceCleanupPath(resolvedRoot, canonicalRoot)) {
    throw new Error("workspace cleanup root must not resolve through a symlink, junction, or reparse point");
  }
  return canonicalRoot;
}

async function inspectWorkspaceCleanupTarget(canonicalRoot, target) {
  const info = await lstat(target).catch(() => null);
  if (!info) return { info: null, reason: "missing" };
  if (info.isSymbolicLink()) return { info, reason: "reparse-point" };
  try {
    const canonicalTarget = resolve(await realpath(target));
    if (!isInsideWorkspaceRoot(canonicalRoot, canonicalTarget)) {
      return { info, reason: "outside-canonical-root" };
    }
  } catch {
    return { info, reason: "canonicalization-failed" };
  }
  return { info, reason: null };
}

export function normalizeWorkspaceCleanupByteCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function isProtectedWorkspaceCleanupAgedChildName(name) {
  const normalized = typeof name === "string" ? name.toLowerCase() : "";
  return WORKSPACE_CLEANUP_PROTECTED_AGED_CHILD_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

export function formatWorkspaceCleanupBytes(value) {
  const bytes = normalizeWorkspaceCleanupByteCount(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function sizeOf(target) {
  try {
    const info = await lstat(target);
    if (!info.isDirectory()) return normalizeWorkspaceCleanupByteCount(info.size);
    const entries = await readdir(target, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      total += normalizeWorkspaceCleanupByteCount(await sizeOf(join(target, entry.name)));
    }
    return normalizeWorkspaceCleanupByteCount(total);
  } catch {
    return 0;
  }
}

async function newestMtimeMs(target) {
  const info = await lstat(target);
  if (!info.isDirectory()) return info.mtimeMs;
  const entries = await readdir(target, { withFileTypes: true });
  let newest = info.mtimeMs;
  for (const entry of entries) {
    newest = Math.max(newest, await newestMtimeMs(join(target, entry.name)));
  }
  return newest;
}

async function maybeDelete({ root, canonicalRoot, target, requireAge, dryRun, minAgeMs, now }) {
  if (!isInsideWorkspaceRoot(root, target)) {
    return { target, skipped: true, reason: "outside-root", bytes: 0 };
  }
  const candidate = await inspectWorkspaceCleanupTarget(canonicalRoot, target);
  if (!candidate.info || candidate.reason) {
    return { target, skipped: true, reason: candidate.reason, bytes: 0 };
  }
  if (requireAge) {
    const ageMs = now - (await newestMtimeMs(target));
    if (ageMs < minAgeMs) return { target, skipped: true, reason: "too-new", bytes: 0 };
  }
  const bytes = await sizeOf(target);
  if (!dryRun) {
    const finalCandidate = await inspectWorkspaceCleanupTarget(canonicalRoot, target);
    if (!finalCandidate.info || finalCandidate.reason) {
      return { target, skipped: true, reason: finalCandidate.reason, bytes: 0 };
    }
    await rm(target, { recursive: true, force: true });
  }
  return { target, skipped: false, reason: dryRun ? "dry-run" : "deleted", bytes };
}

async function agedChildren({ root, canonicalRoot, parent, minAgeMs, now }) {
  if (!isInsideWorkspaceRoot(root, parent)) return [];
  const parentCandidate = await inspectWorkspaceCleanupTarget(canonicalRoot, parent);
  if (!parentCandidate.info || parentCandidate.reason) return [];
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    const targets = [];
    for (const entry of entries) {
      if (isProtectedWorkspaceCleanupAgedChildName(entry.name)) continue;
      const target = join(parent, entry.name);
      const candidate = await inspectWorkspaceCleanupTarget(canonicalRoot, target);
      if (!candidate.info || candidate.reason) continue;
      const ageMs = now - (await newestMtimeMs(target));
      if (ageMs >= minAgeMs) targets.push(target);
    }
    return targets;
  } catch {
    return [];
  }
}

export async function runWorkspaceCleanup({
  root,
  dryRun = false,
  summaryOnly = false,
  minAgeHours,
  minAgeMs,
  now = Date.now(),
}) {
  if (!Number.isSafeInteger(minAgeMs) || minAgeMs < 0) {
    throw new Error("workspace cleanup minAgeMs must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("workspace cleanup now must be a non-negative safe integer");
  }
  const plan = createWorkspaceCleanupPlan(root);
  const canonicalRoot = await resolveOrdinaryWorkspaceCleanupRoot(plan.root);
  const results = [];
  for (const target of plan.wholeTargets) {
    results.push(await maybeDelete({
      root: plan.root,
      canonicalRoot,
      target,
      requireAge: true,
      dryRun,
      minAgeMs,
      now,
    }));
  }
  for (const parent of plan.agedChildParents) {
    const targets = await agedChildren({
      root: plan.root,
      canonicalRoot,
      parent,
      minAgeMs,
      now,
    });
    for (const target of targets) {
      results.push(await maybeDelete({
        root: plan.root,
        canonicalRoot,
        target,
        requireAge: false,
        dryRun,
        minAgeMs,
        now,
      }));
    }
  }

  const matched = results.filter((item) => !item.skipped);
  const bytes = normalizeWorkspaceCleanupByteCount(
    matched.reduce(
      (sum, item) => sum + normalizeWorkspaceCleanupByteCount(item.bytes),
      0,
    ),
  );
  const summary = {
    status: "ok",
    mode: dryRun ? "dry-run" : "apply",
    minAgeHours,
    matchedTargets: matched.length,
    deletedTargets: dryRun ? 0 : matched.length,
    wouldDeleteTargets: dryRun ? matched.length : 0,
    skippedTargets: results.length - matched.length,
    bytes,
    bytesFormatted: formatWorkspaceCleanupBytes(bytes),
  };
  if (!summaryOnly) {
    summary.targets = matched
      .slice(0, 12)
      .map((item) => relative(plan.root, item.target).replace(/\\/g, "/"))
      .join(",") || "none";
  }
  return summary;
}
