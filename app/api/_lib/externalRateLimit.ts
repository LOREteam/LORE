type ExternalRateLimitResult = {
  allowed: boolean;
  retryAfter?: number;
};

type FetchLike = typeof fetch;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`;

export function hasExternalRateLimitStore() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
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
  if (!baseUrl.startsWith("https://")) throw new Error("external rate-limit store must use HTTPS");

  const windowStartedAt = now - (now % windowMs);
  const redisKey = `lore:rate-limit:${bucket}:${key}:${windowStartedAt}`;
  const response = await fetchImpl(baseUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["EVAL", RATE_LIMIT_SCRIPT, "1", redisKey, String(windowMs)]),
    signal: AbortSignal.timeout(3_000),
  });
  const payload = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
  if (!response.ok || payload?.error) {
    throw new Error(`external rate-limit store rejected request (${response.status})`);
  }
  if (!Array.isArray(payload?.result) || payload.result.length < 2) {
    throw new Error("external rate-limit store returned an invalid response");
  }

  const count = Number(payload.result[0]);
  const ttlMs = Number(payload.result[1]);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttlMs)) {
    throw new Error("external rate-limit store returned invalid counters");
  }
  return count <= limit
    ? { allowed: true }
    : { allowed: false, retryAfter: Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000)) };
}
