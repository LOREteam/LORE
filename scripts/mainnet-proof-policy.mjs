const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export const REQUIRED_MAINNET_SECURITY_GATES = Object.freeze([
  "trusted proxy secret length",
  "health diagnostics secret length",
  "chat auth secret length",
  "purpose-separated runtime secrets",
  "admin auth secret length",
  "admin wallet address shape",
  "bootstrap resolve secret length",
  "bootstrap keeper key shape",
  "keeper key shape",
  "web replica count",
  "external rate limit for multi-replica web",
  "server backup monitoring directory",
]);

export function mainnetProofGateCoverageIssues(checks) {
  const counts = new Map();
  for (const check of Array.isArray(checks) ? checks : []) {
    const gate = typeof check?.gate === "string" ? check.gate : "";
    counts.set(gate, (counts.get(gate) ?? 0) + 1);
  }
  return REQUIRED_MAINNET_SECURITY_GATES.flatMap((gate) => {
    const count = counts.get(gate) ?? 0;
    if (count === 1) return [];
    return [`${gate}:${count === 0 ? "missing" : "duplicate"}`];
  });
}

export function withMainnetProofGateCoverage(checks) {
  const normalizedChecks = Array.isArray(checks) ? [...checks] : [];
  const issues = mainnetProofGateCoverageIssues(normalizedChecks);
  if (issues.length === 0) return normalizedChecks;
  normalizedChecks.push({
    gate: "required mainnet security gate coverage",
    status: "fail",
    value: issues.join(", "),
    ok: false,
  });
  return normalizedChecks;
}

export function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

export function isPositiveInteger(value) {
  return parsePositiveInteger(value) !== null;
}

export function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (host.includes(".") || host.includes(":")) &&
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
  } catch {
    return false;
  }
}

export function gateGroup(gate) {
  const normalized = String(gate ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (normalized.includes("network") || normalized.includes("chain id")) return "network";
  if (normalized.includes("contract") || normalized.includes("token address") || normalized.includes("protected bets")) return "contract";
  if (normalized.includes("indexer") || normalized.includes("deploy block") || normalized.includes("finality") || normalized.includes("db path")) return "indexer";
  if (normalized.includes("rpc") || normalized.includes("site url")) return "rpc-site";
  if (normalized.includes("privy")) return "privy";
  if (normalized.includes("proxy")) return "proxy";
  if (normalized.includes("rate limit") || normalized.includes("replica")) return "rate-limit";
  if (normalized.includes("backup")) return "backup";
  if (normalized.includes("admin wallet")) return "admin";
  if (normalized.includes("secret") || normalized.includes("key shape") || normalized.includes("auth")) return "credentials";
  return "other";
}

export function failingGateGroups(failedChecks) {
  const groupCounts = new Map();
  for (const check of failedChecks) {
    const group = gateGroup(check.gate);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }
  return [...groupCounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, count]) => `${group}=${count}`)
    .join(", ") || "none";
}

export function gateToken(gate) {
  return String(gate ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
}

export function failingGateTokens(failedChecks) {
  return failedChecks.map((check) => gateToken(check.gate)).join(", ") || "none";
}

export function compactFailingGateTokens(failedChecks, maxTokens = 10) {
  const tokens = failedChecks.map((check) => gateToken(check.gate));
  if (tokens.length === 0) return "none";
  const shown = tokens.slice(0, maxTokens).join(", ");
  return tokens.length > maxTokens ? `${shown}, ... (+${tokens.length - maxTokens} more)` : shown;
}

export function buildMainnetProofOutputLines({ checks, compactOnly, strict, summaryOnly, timestamp }) {
  const failed = checks.filter((check) => !check.ok);
  if (compactOnly) {
    return [
      "# Mainnet Env Proof Compact Status",
      "",
      `Timestamp: ${timestamp}`,
      `Strict: ${strict ? "yes" : "no"}`,
      `Gates checked: ${checks.length}`,
      `Failing gates: ${failed.length}`,
      `Failing gate groups: ${failingGateGroups(failed)}`,
      `Failing gate tokens sample: ${compactFailingGateTokens(failed)}`,
      "",
      `Summary: ${failed.length === 0 ? "all checked env gates passed" : `${failed.length} env gate(s) missing or failing`}.`,
    ];
  }
  if (summaryOnly) {
    return [
      "# Mainnet Env Proof Snapshot",
      "",
      `Timestamp: ${timestamp}`,
      `Strict: ${strict ? "yes" : "no"}`,
      `Gates checked: ${checks.length}`,
      `Failing gates: ${failed.length}`,
      `Failing gate names: ${failed.map((check) => check.gate).join(", ") || "none"}`,
      `Failing gate tokens: ${failingGateTokens(failed)}`,
      `Failing gate groups: ${failingGateGroups(failed)}`,
      "",
      `Summary: ${failed.length === 0 ? "all checked env gates passed" : `${failed.length} env gate(s) missing or failing`}.`,
    ];
  }
  return [
    "# Mainnet Env Proof Snapshot",
    "",
    `Timestamp: ${timestamp}`,
    `Strict: ${strict ? "yes" : "no"}`,
    "",
    "| Gate | Status | Value |",
    "| --- | --- | --- |",
    ...checks.map((check) => `| ${check.gate} | ${check.status} | ${check.value} |`),
    "",
    `Summary: ${failed.length === 0 ? "all checked env gates passed" : `${failed.length} env gate(s) missing or failing`}.`,
    "",
    "Copy this summary into `docs/mainnet-proof-record.md` only after verifying it was run against the intended host/env.",
  ];
}
