const CHAIN_LAUNCH_GATES = Object.freeze(["G1"]);
const CHAIN_LAUNCH_GATE_GROUPS = "chain=1";
const MAX_TILE_ID = 25;
const CANONICAL_POSITIVE_INTEGER_RE = /^[1-9]\d{0,15}$/;

export function launchGateSummary(issueCount) {
  const label = issueCount > 0 ? "blocked" : "covered";
  return `${label} gates: ${CHAIN_LAUNCH_GATES.join(", ")}; groups: ${CHAIN_LAUNCH_GATE_GROUPS}`;
}

export function isHttpsRpcUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function toSafeDisplayInteger(label, value, min, max) {
  if (typeof value !== "bigint" || value < BigInt(min) || value > BigInt(max)) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the safe integer display range`);
  }
  return Number(value);
}

export function parseChainTileId(value, tileCount = MAX_TILE_ID) {
  if (!Number.isSafeInteger(tileCount) || tileCount < 1) return null;
  if (typeof value !== "bigint" || value < 1n || value > BigInt(tileCount)) return null;
  return toSafeDisplayInteger("chain tile id", value, 1, tileCount);
}

function compareBigIntAscending(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function parseCanonicalPositiveBigInt(value) {
  const text = String(value ?? "").trim();
  if (!CANONICAL_POSITIVE_INTEGER_RE.test(text)) return null;
  return BigInt(text);
}

export function parseEpochArgValues(raw) {
  if (!raw) return [];
  return raw.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseCanonicalPositiveBigInt);
}

export function parseEpochs(raw, currentEpoch) {
  if (raw) {
    const values = parseEpochArgValues(raw).filter((value) => value !== null);
    return [...new Set(values)].sort(compareBigIntAscending);
  }
  const epochs = [];
  const start = currentEpoch > 3n ? currentEpoch - 3n : 1n;
  for (let epoch = start; epoch <= currentEpoch; epoch += 1n) epochs.push(epoch);
  return epochs;
}

export function validateEpochArg(raw) {
  if (!raw) return [];
  const rawValues = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const values = parseEpochArgValues(raw);
  const errors = [];
  let positiveCount = 0;
  for (const value of values) {
    if (value === null) {
      errors.push("epoch values must be canonical positive decimal integers");
    } else if (value > 0n) {
      positiveCount += 1;
    }
  }
  if (rawValues.length === 0 || positiveCount === 0) {
    errors.push("at least one positive epoch must be checked");
  }
  return [...new Set(errors)];
}
