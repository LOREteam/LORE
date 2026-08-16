import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const MAX_HOST_EVIDENCE_BYTES = 512 * 1024;
export const MAX_HOST_KEY_VALUE_MARKERS = 64;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const DECIMAL_NUMBER_RE = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,6})?$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function hostEvidenceRegularFileStat(filePath, statFile = statSync) {
  try {
    const stats = statFile(filePath);
    return stats?.isFile?.() === true ? stats : null;
  } catch {
    return null;
  }
}

export function requireDistinctHostEvidenceArtifacts(entries, { cwd = process.cwd(), skip = false } = {}) {
  if (skip) return;
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftName, leftPath] = entries[leftIndex];
      const [rightName, rightPath] = entries[rightIndex];
      if (!leftPath || !rightPath) continue;
      const left = resolve(cwd, leftPath).toLowerCase();
      const right = resolve(cwd, rightPath).toLowerCase();
      if (left === right) {
        throw new Error(`--${leftName} and --${rightName} must point to distinct host evidence files`);
      }
    }
  }
}

export function readHostEvidenceLog(
  name,
  filePath,
  {
    required = false,
    cwd = process.cwd(),
    statFile = statSync,
    readText = readFileSync,
    maxBytes = MAX_HOST_EVIDENCE_BYTES,
  } = {},
) {
  if (!filePath) {
    if (required) throw new Error(`--${name} must point to an existing redacted artifact`);
    return "";
  }
  const resolved = resolve(cwd, filePath);
  const stats = hostEvidenceRegularFileStat(resolved, statFile);
  if (!stats) throw new Error(`--${name} must point to an existing redacted artifact`);
  if (!Number.isSafeInteger(stats.size) || stats.size < 0 || stats.size > maxBytes) {
    throw new Error(`--${name} artifact is too large to validate safely`);
  }
  return readText(resolved, "utf8");
}

export function parseHostEvidenceKeyValues(line = "") {
  const result = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9]*)=([^\s]+)/g;
  let inspected = 0;
  let match = pattern.exec(String(line));
  while (match) {
    inspected += 1;
    if (inspected > MAX_HOST_KEY_VALUE_MARKERS) {
      throw new Error("host health evidence has too many key/value markers to validate safely");
    }
    result[match[1]] = match[2];
    match = pattern.exec(String(line));
  }
  return result;
}

export function parseHostEvidenceNonNegativeInteger(value, fallback) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !DECIMAL_INTEGER_RE.test(normalized)) return fallback;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : fallback;
}

export function parseHostEvidenceNonNegativeDecimal(value, fallback) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !DECIMAL_NUMBER_RE.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseHostLoadMaxErrorRate(raw = process.env.LOAD_MAX_ERROR_RATE) {
  if (raw == null || raw === "") return 0.01;
  const parsed = parseHostEvidenceNonNegativeDecimal(raw, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("LOAD_MAX_ERROR_RATE must be a canonical decimal rate between 0 and 1");
  }
  return parsed;
}

export function parseHostLoadMaxP95Ms(raw = process.env.LOAD_MAX_P95_MS) {
  if (raw == null || raw === "") return 1500;
  const parsed = parseHostEvidenceNonNegativeInteger(raw, Number.NaN);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("LOAD_MAX_P95_MS must be a canonical positive integer of milliseconds");
  }
  return parsed;
}
