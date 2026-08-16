import { statSync } from "node:fs";

const HOST_LAUNCH_GATES = Object.freeze(["G5", "G6"]);
const HOST_LAUNCH_GATE_GROUPS = "host=2";
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function hasHostProofIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || TEMPLATE_VALUE_RE.test(text) || !ISO_TIMESTAMP_RE.test(text)) return false;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = text.includes(".") ? text : text.replace("Z", ".000Z");
  return parsed.toISOString() === normalized;
}

export function hasNonFutureHostProofIsoTimestamp(value, nowMs = Date.now()) {
  if (!hasHostProofIsoTimestamp(value) || !Number.isFinite(nowMs)) return false;
  return new Date(value.trim()).getTime() <= nowMs + MAX_FUTURE_CLOCK_SKEW_MS;
}

export function hostProofRegularFileStat(filePath, statFile = statSync) {
  try {
    const stats = statFile(filePath);
    return stats?.isFile?.() === true ? stats : null;
  } catch {
    return null;
  }
}

export function hostProofFileSummaryStatus(filePath, statFile = statSync) {
  return hostProofRegularFileStat(filePath, statFile) ? "present" : "missing";
}

export function formatMissingHostArtifactRefs(findings, summaryOnly) {
  if (!Array.isArray(findings)) return "";
  const visible = summaryOnly
    ? findings.map((entry) => String(entry).split(" -> ")[0])
    : findings.map(String);
  return visible.slice(0, 5).join(", ");
}

export function formatHostLaunchGateSummary(issueCount) {
  const label = Number.isSafeInteger(issueCount) && issueCount === 0 ? "covered" : "blocked";
  return `${label} gates: ${HOST_LAUNCH_GATES.join(", ")}; groups: ${HOST_LAUNCH_GATE_GROUPS}`;
}
