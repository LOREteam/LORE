import { createHash } from "node:crypto";

type ExternalRateLimitResult = {
  allowed: boolean;
  retryAfter?: number;
};

export type ExternalKeeperDailyBudgetReservationInput = {
  chainId: number;
  contractAddress: string;
  signerAddress: string;
  nonce: number;
  epoch: bigint;
  signingIntentHash: string;
  reservedMaxCostWei: bigint;
  policy: {
    maxSignatures: number;
    maxReservedCostWei: bigint;
  };
};

export type ExternalKeeperDailyBudgetReservationResult = {
  status: "reserved" | "already_reserved";
  utcDay: number;
  reservedSignatureCount: number;
  reservedMaxCostWei: bigint;
};

type FetchLike = typeof fetch;

const MAX_EXTERNAL_RATE_LIMIT_RESPONSE_BYTES = 8_192;
const INVALID_EXTERNAL_RATE_LIMIT_CONTENT_LENGTH = -1;
const MAX_EXTERNAL_RATE_LIMIT_BUCKET_LENGTH = 80;
const MAX_EXTERNAL_RATE_LIMIT_KEY_LENGTH = 128;
const EXTERNAL_RATE_LIMIT_ID_RE = /^[a-z0-9:_-]+$/i;
const EXTERNAL_NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const EXTERNAL_POSITIVE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`;

const KEEPER_DAILY_BUDGET_SCRIPT = `
local function canonical_decimal(value)
  if type(value) ~= "string" then return false end
  if value == "0" then return true end
  return string.match(value, "^[1-9][0-9]*$") ~= nil
end

local function compare_decimal(left, right)
  if string.len(left) < string.len(right) then return -1 end
  if string.len(left) > string.len(right) then return 1 end
  if left == right then return 0 end
  if left < right then return -1 end
  return 1
end

local function add_decimal(left, right)
  local carry = 0
  local result = ""
  local left_index = string.len(left)
  local right_index = string.len(right)
  while left_index > 0 or right_index > 0 or carry > 0 do
    local left_digit = left_index > 0 and tonumber(string.sub(left, left_index, left_index)) or 0
    local right_digit = right_index > 0 and tonumber(string.sub(right, right_index, right_index)) or 0
    local sum = left_digit + right_digit + carry
    result = tostring(sum % 10) .. result
    carry = math.floor(sum / 10)
    left_index = left_index - 1
    right_index = right_index - 1
  end
  return result
end

local redis_time = redis.call("TIME")
local now_seconds = tonumber(redis_time[1])
if now_seconds == nil or now_seconds < 0 then return {"invalid_time"} end
local utc_day_number = math.floor(now_seconds / 86400)
local utc_day = string.format("%d", utc_day_number)
local field_count = redis.call("HLEN", KEYS[1])
if field_count > 0 then
  local stored_day = redis.call("HGET", KEYS[1], "__day")
  if not canonical_decimal(stored_day) then return {"invalid_state"} end
  local stored_day_number = tonumber(stored_day)
  if stored_day_number > utc_day_number then return {"invalid_state"} end
  if stored_day_number < utc_day_number then
    redis.call("DEL", KEYS[1])
    field_count = 0
  end
end

local count_text = "0"
local total_cost = "0"
if field_count > 0 then
  count_text = redis.call("HGET", KEYS[1], "__count")
  total_cost = redis.call("HGET", KEYS[1], "__cost")
  if not canonical_decimal(count_text) or not canonical_decimal(total_cost) then
    return {"invalid_state"}
  end
  local count = tonumber(count_text)
  if count == nil or field_count - 3 ~= count then return {"invalid_state"} end
end

if not canonical_decimal(ARGV[3]) or not canonical_decimal(ARGV[4]) or not canonical_decimal(ARGV[5]) then
  return {"invalid_input"}
end
local count = tonumber(count_text)
local max_count = tonumber(ARGV[3])
if count == nil or max_count == nil or max_count < 1 then return {"invalid_input"} end
if count > max_count or compare_decimal(total_cost, ARGV[5]) > 0 then
  return {"stored_usage_exceeds"}
end

local existing = redis.call("HGET", KEYS[1], ARGV[1])
if existing ~= false then
  if existing ~= ARGV[2] then return {"reservation_conflict"} end
  return {"already_reserved", utc_day, count_text, total_cost}
end
if count >= max_count then return {"signature_exhausted"} end
local next_cost = add_decimal(total_cost, ARGV[4])
if compare_decimal(next_cost, ARGV[5]) > 0 then return {"cost_exhausted"} end

local next_count = count + 1
local next_count_text = string.format("%d", next_count)
redis.call("HSET", KEYS[1], "__day", utc_day, "__count", next_count_text, "__cost", next_cost, ARGV[1], ARGV[2])
local ttl_seconds = ((utc_day_number + 1) * 86400) - now_seconds
redis.call("PEXPIRE", KEYS[1], ttl_seconds * 1000)
return {"reserved", utc_day, next_count_text, next_cost}
`;

function parseExternalReplicaCount(value: string | undefined): number | null {
  const normalized = value?.trim();
  if (!normalized || !EXTERNAL_POSITIVE_INTEGER_RE.test(normalized)) return null;
  const parsed = BigInt(normalized);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function requiresExternalSharedLock() {
  if (process.env.NODE_ENV !== "production") return false;
  if (!process.env.WEB_REPLICA_COUNT?.trim()) return false;
  const replicaCount = parseExternalReplicaCount(process.env.WEB_REPLICA_COUNT);
  if (replicaCount === null) return true;
  return replicaCount > 1;
}

export function hasExternalRateLimitStore() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export function hasPublicExternalRateLimitStore() {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return Boolean(baseUrl && token && parsePublicRateLimitEndpoint(baseUrl));
}

function isDisallowedIpv4Host(host: string) {
  return (
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
    /^203\.0\.113\./.test(host)
  );
}

function isDisallowedIpv4MappedIpv6Host(host: string) {
  const match = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!match) return false;
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  const mappedIpv4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  return isDisallowedIpv4Host(mappedIpv4);
}

function isDisallowedRateLimitHost(host: string) {
  return (
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
    isDisallowedIpv4Host(host) ||
    isDisallowedIpv4MappedIpv6Host(host) ||
    /^f[cd][0-9a-f]*:/i.test(host) ||
    /^fe[89ab][0-9a-f]*:/i.test(host) ||
    /^2001:db8:/i.test(host)
  );
}

function parsePublicRateLimitEndpoint(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    if (!host.includes(".") && !host.includes(":")) return null;
    if (isDisallowedRateLimitHost(host)) return null;
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseExternalRateLimitInteger(value: unknown, min: number): number | null {
  if (!Number.isSafeInteger(min)) return null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= min ? value : null;
  }
  if (typeof value === "string" && EXTERNAL_NON_NEGATIVE_INTEGER_RE.test(value)) {
    const parsed = BigInt(value);
    if (parsed > MAX_SAFE_INTEGER_BIGINT || parsed < BigInt(min)) return null;
    return Number(parsed);
  }
  return null;
}

function parseExternalCanonicalBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  return BigInt(value);
}

function normalizeKeeperBudgetAddress(value: string) {
  const normalized = value.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

function keeperBudgetError(message: string) {
  const error = new Error(`external keeper daily budget ${message}`);
  error.name = "ExternalKeeperDailyBudgetError";
  return error;
}

function hasValidExternalRateLimitRequest(bucket: string, key: string, limit: number, windowMs: number, now: number) {
  return (
    typeof bucket === "string" &&
    bucket.length > 0 &&
    bucket.length <= MAX_EXTERNAL_RATE_LIMIT_BUCKET_LENGTH &&
    EXTERNAL_RATE_LIMIT_ID_RE.test(bucket) &&
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= MAX_EXTERNAL_RATE_LIMIT_KEY_LENGTH &&
    EXTERNAL_RATE_LIMIT_ID_RE.test(key) &&
    Number.isSafeInteger(limit) &&
    limit > 0 &&
    Number.isSafeInteger(windowMs) &&
    windowMs > 0 &&
    Number.isSafeInteger(now) &&
    now >= 0
  );
}

function parseExternalRateLimitContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!EXTERNAL_NON_NEGATIVE_INTEGER_RE.test(value)) return INVALID_EXTERNAL_RATE_LIMIT_CONTENT_LENGTH;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return INVALID_EXTERNAL_RATE_LIMIT_CONTENT_LENGTH;
  return Number(parsed);
}

async function readExternalRateLimitJson(response: Response): Promise<{ result?: unknown; error?: unknown } | null> {
  const contentLength = parseExternalRateLimitContentLength(response.headers.get("content-length"));
  if (
    contentLength === INVALID_EXTERNAL_RATE_LIMIT_CONTENT_LENGTH ||
    (contentLength !== null && contentLength > MAX_EXTERNAL_RATE_LIMIT_RESPONSE_BYTES)
  ) {
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_EXTERNAL_RATE_LIMIT_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as { result?: unknown; error?: unknown };
  } catch {
    return null;
  }
}

export async function consumeExternalRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
  fetchImpl: FetchLike = fetch,
): Promise<ExternalRateLimitResult> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("external rate-limit store is not configured");
  const endpoint = parsePublicRateLimitEndpoint(baseUrl);
  if (!endpoint) throw new Error("external rate-limit store must use a public HTTPS endpoint");
  if (!hasValidExternalRateLimitRequest(bucket, key, limit, windowMs, now)) {
    throw new Error("external rate-limit request parameters are invalid");
  }

  const windowStartedAt = now - (now % windowMs);
  const redisKey = `lore:rate-limit:${bucket}:${key}:${windowStartedAt}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["EVAL", RATE_LIMIT_SCRIPT, "1", redisKey, String(windowMs)]),
    signal: AbortSignal.timeout(3_000),
  });
  const payload = await readExternalRateLimitJson(response);
  if (!response.ok || payload?.error) {
    throw new Error(`external rate-limit store rejected request (${response.status})`);
  }
  if (!Array.isArray(payload?.result) || payload.result.length < 2) {
    throw new Error("external rate-limit store returned an invalid response");
  }

  const count = parseExternalRateLimitInteger(payload.result[0], 1);
  const ttlMs = parseExternalRateLimitInteger(payload.result[1], 0);
  if (count === null || ttlMs === null) {
    throw new Error("external rate-limit store returned invalid counters");
  }
  return count <= limit
    ? { allowed: true }
    : { allowed: false, retryAfter: Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000)) };
}

export async function acquireExternalExpiringLock(
  lockName: string,
  ttlMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("external rate-limit store is not configured");
  const endpoint = parsePublicRateLimitEndpoint(baseUrl);
  if (!endpoint) throw new Error("external rate-limit store must use a public HTTPS endpoint");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("shared lock TTL must be positive");

  const key = createHash("sha256").update(lockName).digest("hex");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["SET", `lore:proof-lock:${key}`, "1", "NX", "PX", String(ttlMs)]),
    signal: AbortSignal.timeout(3_000),
  });
  const payload = await readExternalRateLimitJson(response);
  if (!response.ok || payload?.error) {
    throw new Error(`external rate-limit store rejected request (${response.status})`);
  }
  if (payload?.result === "OK") return true;
  if (payload?.result === null) return false;
  throw new Error("external rate-limit store returned an invalid shared lock response");
}

export async function reserveExternalKeeperDailyBudget(
  input: ExternalKeeperDailyBudgetReservationInput,
  fetchImpl: FetchLike = fetch,
): Promise<ExternalKeeperDailyBudgetReservationResult> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!baseUrl || !token) throw keeperBudgetError("store is not configured");
  const endpoint = parsePublicRateLimitEndpoint(baseUrl);
  if (!endpoint) throw keeperBudgetError("store must use a public HTTPS endpoint");

  const contractAddress = normalizeKeeperBudgetAddress(input.contractAddress);
  const signerAddress = normalizeKeeperBudgetAddress(input.signerAddress);
  if (
    contractAddress === null ||
    signerAddress === null ||
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0 ||
    !Number.isSafeInteger(input.nonce) ||
    input.nonce < 0 ||
    input.epoch < 0n ||
    !/^0x[0-9a-f]{64}$/.test(input.signingIntentHash) ||
    input.reservedMaxCostWei <= 0n ||
    !Number.isSafeInteger(input.policy.maxSignatures) ||
    input.policy.maxSignatures <= 0 ||
    input.policy.maxReservedCostWei <= 0n ||
    input.reservedMaxCostWei > input.policy.maxReservedCostWei
  ) {
    throw keeperBudgetError("request parameters are invalid");
  }

  const scopeHash = createHash("sha256")
    .update(`${input.chainId}:${contractAddress}`)
    .digest("hex");
  const reservationField = `r:${createHash("sha256")
    .update(`${signerAddress}:${input.nonce}`)
    .digest("hex")}`;
  const reservationFingerprint = createHash("sha256")
    .update([
      signerAddress,
      input.nonce,
      input.epoch.toString(),
      input.signingIntentHash,
      input.reservedMaxCostWei.toString(),
    ].join(":"))
    .digest("hex");
  const redisKey = `lore:keeper-budget:v1:${scopeHash}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      "EVAL",
      KEEPER_DAILY_BUDGET_SCRIPT,
      "1",
      redisKey,
      reservationField,
      reservationFingerprint,
      String(input.policy.maxSignatures),
      input.reservedMaxCostWei.toString(),
      input.policy.maxReservedCostWei.toString(),
    ]),
    signal: AbortSignal.timeout(3_000),
  });
  const payload = await readExternalRateLimitJson(response);
  if (!response.ok || payload?.error) {
    throw keeperBudgetError(`store rejected request (${response.status})`);
  }
  if (!Array.isArray(payload?.result) || typeof payload.result[0] !== "string") {
    throw keeperBudgetError("store returned an invalid response");
  }
  const status = payload.result[0];
  const failureMessages: Record<string, string> = {
    invalid_time: "store clock is invalid",
    invalid_state: "state invalid; manual reconciliation required",
    invalid_input: "store rejected reservation parameters",
    stored_usage_exceeds: "stored usage exceeds active policy",
    reservation_conflict: "reservation conflict",
    signature_exhausted: "signature count exhausted",
    cost_exhausted: "reserved cost exhausted",
  };
  if (Object.hasOwn(failureMessages, status)) {
    throw keeperBudgetError(failureMessages[status]);
  }
  if (
    (status !== "reserved" && status !== "already_reserved") ||
    payload.result.length !== 4
  ) {
    throw keeperBudgetError("store returned an invalid reservation status");
  }
  const utcDay = parseExternalRateLimitInteger(payload.result[1], 0);
  const reservedSignatureCount = parseExternalRateLimitInteger(payload.result[2], 1);
  const reservedMaxCostWei = parseExternalCanonicalBigInt(payload.result[3]);
  if (
    utcDay === null ||
    reservedSignatureCount === null ||
    reservedMaxCostWei === null ||
    reservedSignatureCount > input.policy.maxSignatures ||
    reservedMaxCostWei < input.reservedMaxCostWei ||
    reservedMaxCostWei > input.policy.maxReservedCostWei
  ) {
    throw keeperBudgetError("store returned invalid reservation counters");
  }
  return {
    status,
    utcDay,
    reservedSignatureCount,
    reservedMaxCostWei,
  };
}

export { requiresExternalSharedLock };
