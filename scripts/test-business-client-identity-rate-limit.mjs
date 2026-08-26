import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as clientIdentityModule from "../app/api/_lib/clientIdentity.ts";
import * as externalRateLimitModule from "../app/api/_lib/externalRateLimit.ts";
import * as sharedRateLimitModule from "../app/api/_lib/sharedRateLimit.ts";

const clientIdentity = clientIdentityModule.default ?? clientIdentityModule;
const externalRateLimit = externalRateLimitModule.default ?? externalRateLimitModule;
const sharedRateLimit = sharedRateLimitModule.default ?? sharedRateLimitModule;

function withTemporaryEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withTemporaryEnvAsync(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withTemporaryFetch(fetchImpl, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previous;
  }
}

async function withTemporaryNow(now, fn) {
  const previous = Date.now;
  Date.now = () => now;
  try {
    return await fn();
  } finally {
    Date.now = previous;
  }
}

async function assertRateLimitError(response, expectedStatus, expectedBody, label) {
  assert.ok(response, `${label} must return a response`);
  assert.equal(response.status, expectedStatus, `${label} status`);
  assert.equal(response.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate", `${label} cache`);
  assert.equal(response.headers.get("Pragma"), "no-cache", `${label} pragma`);
  assert.equal(response.headers.get("Expires"), "0", `${label} expires`);
  assert.equal(response.headers.get("Vary"), null, `${label} must not vary a non-cacheable response`);
  assert.deepEqual(await response.json(), expectedBody, `${label} body`);
}

function trustedRateLimitRequest(ip, secret) {
  return new Request("https://play.example/api/live-state", {
    headers: {
      "user-agent": "shared-rate-limit-behavior-probe",
      "x-forwarded-for": ip,
      "x-lore-proxy-secret": secret,
    },
  });
}

export async function runClientIdentityAndRateLimitTests() {
  withTemporaryEnv(
    { TRUST_PROXY_HEADERS: "1", TRUST_PROXY_SECRET: "test-proxy-secret-with-at-least-32-characters" },
    () => {
      const directSpoof = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "accept-language": "en-US",
          "user-agent": "same-nat-browser",
          "x-forwarded-for": "203.0.113.7",
        },
      }));
      assert.equal(directSpoof.weak, true, "proxy IP headers without the private proxy secret must be ignored");

      const trustedForward = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "203.0.113.7, 10.0.0.2",
          "x-lore-proxy-secret": "test-proxy-secret-with-at-least-32-characters",
        },
      }));
      assert.deepEqual(trustedForward, { key: "xff:203.0.113.7", weak: false });

      const invalidTrustedForward = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "not-an-ip, 10.0.0.2",
          "x-lore-proxy-secret": "test-proxy-secret-with-at-least-32-characters",
        },
      }));
      assert.equal(invalidTrustedForward.weak, true, "invalid trusted proxy IPs must fail closed");

      const trustedIpv6 = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "cf-connecting-ip": "2001:db8::7",
          "x-lore-proxy-secret": "test-proxy-secret-with-at-least-32-characters",
        },
      }));
      assert.deepEqual(trustedIpv6, { key: "cf:2001:db8::7", weak: false });

      const wrongSecret = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "user-agent": "same-nat-browser",
          "x-forwarded-for": "198.51.100.9",
          "x-lore-proxy-secret": "wrong-secret",
        },
      }));
      assert.equal(wrongSecret.weak, true, "a wrong proxy secret must not unlock forwarded IP trust");

      const shortSecret = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "203.0.113.8",
          "x-lore-proxy-secret": "short",
        },
      }));
      assert.equal(shortSecret.weak, true, "short proxy trust secrets must not unlock forwarded IP trust");

      const oversizedHeaderSecret = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "x-forwarded-for": "203.0.113.9",
          "x-lore-proxy-secret": "t".repeat(257),
        },
      }));
      assert.equal(oversizedHeaderSecret.weak, true, "oversized proxy trust secret headers must fail before trusted IP parsing");

      const sameNatIdentity = clientIdentity.getClientIdentity(new Request("https://play.example/api/live-state", {
        headers: {
          "accept-language": "en-US",
          "user-agent": "same-nat-browser",
          "x-forwarded-for": "192.0.2.99",
        },
      }));
      assert.equal(sameNatIdentity.key, directSpoof.key, "spoofed IP rotation must not bypass the weak identity bucket");

      const productionRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
      assert.match(
        productionRunbookSource,
        /remove client-supplied `x-lore-proxy-secret`/,
        "production proxy guidance must require stripping the client-supplied trust secret",
      );
      assert.match(
        productionRunbookSource,
        /overwrite exactly one supported\s+client-IP header/,
        "production proxy guidance must require overwriting the trusted client IP",
      );
      assert.match(
        productionRunbookSource,
        /App origins must reject\s+direct public traffic/,
        "production proxy guidance must require blocking direct app-origin traffic",
      );
    },
  );
  const clientIdentitySource = readFileSync("app/api/_lib/clientIdentity.ts", "utf8");
  assert.ok(
    clientIdentitySource.includes("const MIN_PROXY_SECRET_LENGTH = 32") &&
      clientIdentitySource.includes("const MAX_PROXY_SECRET_LENGTH = 256") &&
      clientIdentitySource.includes("const CONTROL_CHAR_RE = /[\\u0000-\\u001f\\u007f]/;") &&
      /function normalizeProxySecret[\s\S]*secret\.length < MIN_PROXY_SECRET_LENGTH[\s\S]*secret\.length > MAX_PROXY_SECRET_LENGTH[\s\S]*CONTROL_CHAR_RE\.test\(secret\)/.test(clientIdentitySource),
    "client identity must bound and sanitize proxy trust secrets before comparing them",
  );
  assert.match(
    clientIdentitySource,
    /const expected = normalizeProxySecret\(process\.env\.TRUST_PROXY_SECRET\)[\s\S]*const provided = normalizeProxySecret\(request\.headers\.get\(PROXY_SECRET_HEADER\)\)[\s\S]*secretsMatch\(provided, expected\)/,
    "client identity must normalize both expected and provided proxy trust secrets before HMAC comparison",
  );
  const sanitizedLogBucket = sharedRateLimit.formatRateLimitLogBucket("api/bucket path\r\n".repeat(20));
  assert.ok(sanitizedLogBucket.length <= 80, "rate-limit log labels must stay bounded");
  assert.match(sanitizedLogBucket, /^[a-z0-9:_-]+$/i, "rate-limit log labels must remove control and path syntax");
  assert.equal(sharedRateLimit.formatRateLimitLogBucket(""), "unknown");
  assert.equal(sharedRateLimit.normalizeRetryAfterSeconds(Number.NaN), 1);
  assert.equal(sharedRateLimit.normalizeRetryAfterSeconds(-1), 1);
  assert.equal(sharedRateLimit.normalizeRetryAfterSeconds(1.2), 2);
  assert.equal(sharedRateLimit.normalizeRetryAfterSeconds(100_000), 86_400);

  const activeWindowState = { count: 1, windowStartedAt: 120_000, resetAt: 180_000 };
  const fullLocalState = new Map([
    ["active-a", activeWindowState],
    ["active-b", activeWindowState],
  ]);
  const fullLocalDecision = sharedRateLimit.consumeBoundedRateLimitState({
    stateMap: fullLocalState,
    key: "active-c",
    limit: 2,
    windowMs: 60_000,
    now: 120_001,
    maxEntries: 2,
  });
  assert.equal(fullLocalDecision.allowed, false, "an active local state map at capacity must fail closed");
  assert.equal(fullLocalState.size, 2, "capacity rejection must not grow the local state map");
  assert.equal(
    sharedRateLimit.normalizeRetryAfterSeconds(fullLocalDecision.retryAfterSeconds),
    60,
    "capacity rejection must bind Retry-After to the current window",
  );

  const expiredLocalState = new Map([
    ["expired-a", { count: 9, windowStartedAt: 60_000, resetAt: 120_000 }],
    ["expired-b", { count: 9, windowStartedAt: 60_000, resetAt: 120_000 }],
  ]);
  assert.deepEqual(
    sharedRateLimit.consumeBoundedRateLimitState({
      stateMap: expiredLocalState,
      key: "fresh-c",
      limit: 2,
      windowMs: 60_000,
      now: 120_001,
      maxEntries: 2,
    }),
    { allowed: true },
    "expired entries must be reclaimed before rejecting a fresh key",
  );
  assert.deepEqual([...expiredLocalState.keys()], ["fresh-c"]);
  assert.deepEqual(expiredLocalState.get("fresh-c"), {
    count: 1,
    windowStartedAt: 120_000,
    resetAt: 180_000,
  });

  const weakStateBlockedByLocalCapacity = new Map();
  const localStateAtCapacity = new Map([
    ["active-a", activeWindowState],
    ["active-b", activeWindowState],
  ]);
  const localCapacityDecision = sharedRateLimit.consumeWeakIdentityRateLimitState({
    weakBucketMap: weakStateBlockedByLocalCapacity,
    localMap: localStateAtCapacity,
    bucket: "api-weak-local-cap",
    key: "new-client",
    limit: 1,
    windowMs: 60_000,
    now: 120_001,
    maxWeakEntries: 2,
    maxLocalEntries: 2,
  });
  assert.equal(localCapacityDecision.allowed, false);
  assert.equal(
    weakStateBlockedByLocalCapacity.size,
    0,
    "a rejected per-client insert must not consume the weak shared-bucket allowance",
  );
  assert.equal(localStateAtCapacity.size, 2);

  const weakBucketState = new Map();
  const weakClientState = new Map();
  for (let index = 0; index < 11; index += 1) {
    assert.deepEqual(
      sharedRateLimit.consumeWeakIdentityRateLimitState({
        weakBucketMap: weakBucketState,
        localMap: weakClientState,
        bucket: "api-weak-shared-cap",
        key: `client-${index}`,
        limit: 1,
        windowMs: 60_000,
        now: 120_001,
        maxWeakEntries: 2,
        maxLocalEntries: 20,
      }),
      { allowed: true },
    );
  }
  const weakBucketLimitDecision = sharedRateLimit.consumeWeakIdentityRateLimitState({
    weakBucketMap: weakBucketState,
    localMap: weakClientState,
    bucket: "api-weak-shared-cap",
    key: "client-11",
    limit: 1,
    windowMs: 60_000,
    now: 120_001,
    maxWeakEntries: 2,
    maxLocalEntries: 20,
  });
  assert.equal(weakBucketLimitDecision.allowed, false, "weak identities must share a bounded bucket cap");
  assert.equal(
    weakClientState.size,
    11,
    "the weak shared-bucket cap must run before inserting another per-client key",
  );

  const fullWeakBucketState = new Map([
    ["active-bucket-a", activeWindowState],
    ["active-bucket-b", activeWindowState],
  ]);
  const untouchedLocalState = new Map();
  const weakCapacityDecision = sharedRateLimit.consumeWeakIdentityRateLimitState({
    weakBucketMap: fullWeakBucketState,
    localMap: untouchedLocalState,
    bucket: "active-bucket-c",
    key: "client-c",
    limit: 1,
    windowMs: 60_000,
    now: 120_001,
    maxWeakEntries: 2,
    maxLocalEntries: 20,
  });
  assert.equal(weakCapacityDecision.allowed, false, "an active weak-bucket map at capacity must fail closed");
  assert.equal(fullWeakBucketState.size, 2);
  assert.equal(untouchedLocalState.size, 0, "weak map capacity must be checked before local state insertion");

  const proxySecret = "behavior-proxy-secret-with-at-least-32-characters";
  await withTemporaryEnvAsync(
    {
      NODE_ENV: "production",
      TRUST_PROXY_HEADERS: undefined,
      TRUST_PROXY_SECRET: undefined,
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: undefined,
      WEB_REPLICA_COUNT: "1",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: undefined,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      const response = await sharedRateLimit.enforceSharedRateLimit(
        new Request("https://play.example/api/live-state"),
        { bucket: "api-production-weak-reject", limit: 1, windowMs: 60_000 },
      );
      await assertRateLimitError(
        response,
        503,
        { error: "Trusted proxy identity unavailable" },
        "production weak identity",
      );
    },
  );
  await withTemporaryEnvAsync(
    {
      NODE_ENV: "production",
      TRUST_PROXY_HEADERS: undefined,
      TRUST_PROXY_SECRET: undefined,
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
      WEB_REPLICA_COUNT: "1",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: undefined,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...values) => warnings.push(values.map(String).join(" "));
      try {
        await withTemporaryNow(120_001, async () => {
          const options = { bucket: "api-production-weak-fallback", limit: 1, windowMs: 60_000 };
          const first = await sharedRateLimit.enforceSharedRateLimit(
            new Request("https://play.example/api/live-state"),
            options,
          );
          assert.equal(first, null);
          const second = await sharedRateLimit.enforceSharedRateLimit(
            new Request("https://play.example/api/live-state"),
            options,
          );
          await assertRateLimitError(
            second,
            429,
            { error: "Too many requests", retryAfter: 60 },
            "explicitly allowed production weak fallback",
          );
        });
      } finally {
        console.warn = originalWarn;
      }
      assert.deepEqual(
        warnings,
        ["[rate-limit:api-production-weak-fallback] weak identity - using fallback rate limiting"],
      );
    },
  );
  for (const [label, webReplicaCount, failClosed, externalUrl, externalToken] of [
    ["multi-replica", "2", undefined, undefined, undefined],
    ["explicit fail-closed", "1", "1", undefined, undefined],
    ["malformed replica count", "01", undefined, undefined, undefined],
    ["partial URL-only configuration", "1", undefined, "https://redis.playlore.xyz", undefined],
    ["partial token-only configuration", "1", undefined, undefined, "partial-store-token"],
  ]) {
    await withTemporaryEnvAsync(
      {
        NODE_ENV: "production",
        TRUST_PROXY_HEADERS: "1",
        TRUST_PROXY_SECRET: proxySecret,
        ALLOW_WEAK_RATE_LIMIT_IDENTITY: undefined,
        WEB_REPLICA_COUNT: webReplicaCount,
        RATE_LIMIT_EXTERNAL_FAIL_CLOSED: failClosed,
        UPSTASH_REDIS_REST_URL: externalUrl,
        UPSTASH_REDIS_REST_TOKEN: externalToken,
      },
      async () => {
        let fetchCalls = 0;
        await withTemporaryFetch(async () => {
          fetchCalls += 1;
          throw new Error("partial external-store configuration reached fetch");
        }, async () => {
          const response = await sharedRateLimit.enforceSharedRateLimit(
            trustedRateLimitRequest("203.0.113.31", proxySecret),
            { bucket: `api-partial-store-${label.replaceAll(" ", "-")}`, limit: 1, windowMs: 60_000 },
          );
          await assertRateLimitError(
            response,
            503,
            { error: "Rate limit service unavailable" },
            `${label} external store with partial configuration`,
          );
          assert.equal(fetchCalls, 0, `${label} partial external-store configuration must fail before fetch`);
        });
      },
    );
  }
  await withTemporaryEnvAsync(
    {
      NODE_ENV: "production",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: proxySecret,
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: undefined,
      WEB_REPLICA_COUNT: "2",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      UPSTASH_REDIS_REST_URL: "https://redis.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "behavior-store-token",
    },
    async () => {
      const counts = new Map();
      const redisKeys = [];
      await withTemporaryFetch(async (_url, init) => {
        const command = JSON.parse(String(init?.body));
        const redisKey = String(command[3]);
        redisKeys.push(redisKey);
        const count = (counts.get(redisKey) ?? 0) + 1;
        counts.set(redisKey, count);
        return new Response(JSON.stringify({ result: [count, 60_000] }), { status: 200 });
      }, async () => {
        await withTemporaryNow(120_001, async () => {
          const options = { bucket: "api-shared-identity-probe", limit: 1, windowMs: 60_000 };
          const firstReplica = await sharedRateLimit.enforceSharedRateLimit(
            trustedRateLimitRequest("203.0.113.41", proxySecret),
            options,
          );
          const secondClient = await sharedRateLimit.enforceSharedRateLimit(
            trustedRateLimitRequest("203.0.113.42", proxySecret),
            options,
          );
          const secondReplica = await sharedRateLimit.enforceSharedRateLimit(
            trustedRateLimitRequest("203.0.113.41", proxySecret),
            options,
          );
          assert.equal(firstReplica, null, "the first replica must admit the first client request");
          assert.equal(secondClient, null, "a distinct trusted client must consume a distinct shared bucket");
          await assertRateLimitError(
            secondReplica,
            429,
            { error: "Too many requests", retryAfter: 60 },
            "same client through a second replica",
          );
          assert.equal(counts.size, 2, "two trusted clients must produce exactly two shared Redis keys");
          assert.equal(redisKeys[0], redisKeys[2], "replicas must derive the same key for the same trusted client");
          assert.notEqual(redisKeys[0], redisKeys[1], "different trusted clients must not share an identity key");
          for (const redisKey of redisKeys) {
            assert.match(redisKey, /^lore:rate-limit:api-shared-identity-probe:[a-f0-9]{32}:120000$/);
            assert.doesNotMatch(redisKey, /203\.0\.113\.(?:41|42)|behavior-proxy-secret|behavior-store-token/);
          }
          const globalOptions = { bucket: "api-shared-global-probe", limit: 1, windowMs: 60_000 };
          const firstGlobal = await sharedRateLimit.enforceSharedGlobalRateLimit(globalOptions);
          const secondGlobal = await sharedRateLimit.enforceSharedGlobalRateLimit(globalOptions);
          assert.equal(firstGlobal, null, "the first shared global admission must pass");
          await assertRateLimitError(
            secondGlobal,
            429,
            { error: "Too many requests", retryAfter: 60 },
            "shared global admission across replicas",
          );
          assert.equal(counts.size, 3, "the global budget must add exactly one shared Redis key");
          assert.equal(redisKeys.length, 5);
          assert.equal(redisKeys[3], redisKeys[4], "all replicas must derive the same global budget key");
          assert.match(redisKeys[3], /^lore:rate-limit:api-shared-global-probe:[a-f0-9]{32}:120000$/);
          assert.doesNotMatch(redisKeys[3], /203\.0\.113\.|behavior-proxy-secret|behavior-store-token/);
        });
      });
    },
  );
  await withTemporaryEnvAsync(
    {
      NODE_ENV: "production",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: proxySecret,
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: undefined,
      WEB_REPLICA_COUNT: "2",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      UPSTASH_REDIS_REST_URL: "https://redis.playlore.xyz/private-path",
      UPSTASH_REDIS_REST_TOKEN: "behavior-outage-token",
    },
    async () => {
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...values) => warnings.push(values.map(String).join(" "));
      try {
        await withTemporaryFetch(async () => {
          throw new Error("store outage at https://redis.playlore.xyz/private-path token=behavior-outage-token");
        }, async () => {
          const response = await sharedRateLimit.enforceSharedRateLimit(
            trustedRateLimitRequest("203.0.113.51", proxySecret),
            { bucket: "api-outage-probe", limit: 1, windowMs: 60_000 },
          );
          await assertRateLimitError(
            response,
            503,
            { error: "Rate limit service unavailable" },
            "external store outage",
          );
        });
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(warnings.length, 1, "external store outage must emit one bounded warning per bucket");
      assert.equal(warnings[0], "[rate-limit:api-outage-probe] external store fallback: Error");
      assert.doesNotMatch(
        warnings[0],
        /redis\.playlore\.xyz|private-path|behavior-outage-token|203\.0\.113\.51|behavior-proxy-secret/,
        "external store outage warning must redact endpoint, token, and client identity",
      );
    },
  );
  await withTemporaryEnvAsync(
    {
      NODE_ENV: "production",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: proxySecret,
      WEB_REPLICA_COUNT: "2",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      UPSTASH_REDIS_REST_URL: "https://redis.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "behavior-store-token",
    },
    async () => {
      let fetchCalls = 0;
      await withTemporaryFetch(async () => {
        fetchCalls += 1;
        throw new Error("malformed limiter options reached fetch");
      }, async () => {
        for (const options of [
          { bucket: "", limit: 1, windowMs: 60_000 },
          { bucket: "api invalid bucket", limit: 1, windowMs: 60_000 },
          { bucket: "https://rpc.example.test/private", limit: 1, windowMs: 60_000 },
          { bucket: "a".repeat(81), limit: 1, windowMs: 60_000 },
          { bucket: "api-malformed-limit", limit: Number.NaN, windowMs: 60_000 },
          { bucket: "api-malformed-limit", limit: 0, windowMs: 60_000 },
          { bucket: "api-malformed-limit", limit: 1.5, windowMs: 60_000 },
          { bucket: "api-malformed-limit", limit: 10_001, windowMs: 60_000 },
          { bucket: "api-malformed-window", limit: 1, windowMs: Number.NaN },
          { bucket: "api-malformed-window", limit: 1, windowMs: Number.POSITIVE_INFINITY },
          { bucket: "api-malformed-window", limit: 1, windowMs: 1.5 },
          { bucket: "api-malformed-window", limit: 1, windowMs: 86_400_001 },
          { bucket: "api/malformed-bucket", limit: 1, windowMs: 60_000 },
        ]) {
          const response = await sharedRateLimit.enforceSharedRateLimit(
            trustedRateLimitRequest("203.0.113.61", proxySecret),
            options,
          );
          await assertRateLimitError(
            response,
            503,
            { error: "Rate limit configuration unavailable" },
            "malformed shared limiter options",
          );
        }
        assert.equal(fetchCalls, 0, "malformed shared limiter options must fail before external-store access");
      });
    },
  );
  await withTemporaryEnvAsync(
    {
      UPSTASH_REDIS_REST_URL: "https://redis.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "server-only-token",
    },
    async () => {
      let sentBody = null;
      const allowed = await externalRateLimit.consumeExternalRateLimit(
        "api-live-state",
        "identity-hash",
        2,
        60_000,
        60_001,
        async (_url, init) => {
          sentBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ result: [1, 59_999] }), { status: 200 });
        },
      );
      assert.deepEqual(allowed, { allowed: true });
      assert.deepEqual(sentBody.slice(0, 3), ["EVAL", sentBody[1], "1"]);
      assert.match(sentBody[3], /^lore:rate-limit:api-live-state:identity-hash:60000$/);

      const blocked = await externalRateLimit.consumeExternalRateLimit(
        "api-live-state",
        "identity-hash",
        2,
        60_000,
        60_001,
        async () => new Response(JSON.stringify({ result: [3, 12_001] }), { status: 200 }),
      );
      assert.deepEqual(blocked, { allowed: false, retryAfter: 13 });
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ result: ["1e3", 12_001] }), { status: 200 }),
        ),
        /invalid counters/,
        "external rate-limit counters must reject scientific notation instead of broad Number coercion",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ result: [3, "12.5"] }), { status: 200 }),
        ),
        /invalid counters/,
        "external rate-limit TTL must reject fractional values instead of broad Number coercion",
      );
      for (const [invalidBucket, invalidKey, invalidLimit, invalidWindowMs, invalidNow] of [
        ["", "identity-hash", 2, 60_000, 60_001],
        ["api/live-state", "identity-hash", 2, 60_000, 60_001],
        ["a".repeat(81), "identity-hash", 2, 60_000, 60_001],
        ["api-live-state", "", 2, 60_000, 60_001],
        ["api-live-state", "identity/hash", 2, 60_000, 60_001],
        ["api-live-state", "a".repeat(129), 2, 60_000, 60_001],
        ["api-live-state", "identity-hash", 0, 60_000, 60_001],
        ["api-live-state", "identity-hash", 2, 0, 60_001],
        ["api-live-state", "identity-hash", 2, 60_000, 60_001.5],
      ]) {
        await assert.rejects(
          () => externalRateLimit.consumeExternalRateLimit(
            invalidBucket,
            invalidKey,
            invalidLimit,
            invalidWindowMs,
            invalidNow,
            async () => {
              throw new Error("invalid external rate-limit request reached fetch");
            },
          ),
          /external rate-limit request parameters are invalid/,
          "external rate-limit must reject malformed request parameters before composing Redis keys",
        );
      }
      const sharedCounts = new Map();
      const sharedStoreFetch = async (_url, init) => {
        const command = JSON.parse(String(init?.body));
        const redisKey = String(command[3]);
        const count = (sharedCounts.get(redisKey) ?? 0) + 1;
        sharedCounts.set(redisKey, count);
        return new Response(JSON.stringify({ result: [count, 60_000] }), { status: 200 });
      };
      const replicaResults = await Promise.all([
        externalRateLimit.consumeExternalRateLimit("api-chat", "shared-user", 2, 60_000, 120_001, sharedStoreFetch),
        externalRateLimit.consumeExternalRateLimit("api-chat", "shared-user", 2, 60_000, 120_001, sharedStoreFetch),
        externalRateLimit.consumeExternalRateLimit("api-chat", "shared-user", 2, 60_000, 120_001, sharedStoreFetch),
      ]);
      assert.deepEqual(
        replicaResults.map((result) => result.allowed),
        [true, true, false],
        "multiple web replicas must consume one shared external rate-limit bucket",
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: "2",
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "multiple production web replicas must use the shared proof replay lock",
          );
          let proofCommand = null;
          const acquired = await externalRateLimit.acquireExternalExpiringLock(
            "admin-auth:proof",
            30_000,
            async (_url, init) => {
              proofCommand = JSON.parse(String(init?.body));
              return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
            },
          );
          assert.equal(acquired, true);
          assert.deepEqual(proofCommand.slice(0, 2), ["SET", proofCommand[1]]);
          assert.match(proofCommand[1], /^lore:proof-lock:[a-f0-9]{64}$/);
          assert.deepEqual(proofCommand.slice(2), ["1", "NX", "PX", "30000"]);
          const replayed = await externalRateLimit.acquireExternalExpiringLock(
            "admin-auth:proof",
            30_000,
            async () => new Response(JSON.stringify({ result: null }), { status: 200 }),
          );
          assert.equal(replayed, false, "a shared proof replay must not issue a second session");
        },
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: "not-a-number",
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "invalid production replica count must fail closed by requiring the shared replay lock",
          );
        },
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: "01",
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "leading-zero production replica count must fail closed by requiring the shared replay lock",
          );
        },
      );
      await withTemporaryEnvAsync(
        {
          NODE_ENV: "production",
          WEB_REPLICA_COUNT: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
        },
        async () => {
          assert.equal(
            externalRateLimit.requiresExternalSharedLock(),
            true,
            "unsafe production replica count must fail closed by requiring the shared replay lock",
          );
        },
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ error: "ERR test" }), { status: 400 }),
        ),
        /rejected request/,
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => new Response(JSON.stringify({ result: ["x".repeat(8_300), 60_000] }), { status: 200 }),
        ),
        /invalid response/,
        "external rate-limit responses must be bounded before JSON parsing",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () =>
            new Response(
              new Uint8Array([
                ...new TextEncoder().encode('{"result":[1,60000],"note":"'),
                0xff,
                ...new TextEncoder().encode('"}'),
              ]),
              { status: 200 },
            ),
        ),
        /invalid response/,
        "external rate-limit responses must fail closed on malformed UTF-8 instead of accepting replacement characters",
      );
      for (const malformedCounter of ["01", (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()]) {
        await assert.rejects(
          () => externalRateLimit.consumeExternalRateLimit(
            "api-live-state",
            "identity-hash",
            2,
            60_000,
            60_001,
            async () => new Response(JSON.stringify({ result: [malformedCounter, 60_000] }), { status: 200 }),
          ),
          /invalid counters/,
          `external rate-limit counters must reject ${malformedCounter}`,
        );
      }
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? "8193" : null) },
            get body() {
              throw new Error("oversized external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject oversized Content-Length before body reads",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(Number.MAX_SAFE_INTEGER) : null) },
            get body() {
              throw new Error("safe-max external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject safe-max oversized Content-Length before body reads",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? "1e3" : null) },
            get body() {
              throw new Error("malformed external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject malformed Content-Length before body reads",
      );
      await assert.rejects(
        () => externalRateLimit.consumeExternalRateLimit(
          "api-live-state",
          "identity-hash",
          2,
          60_000,
          60_001,
          async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name.toLowerCase() === "content-length" ? (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString() : null) },
            get body() {
              throw new Error("unsafe external rate-limit response body must not be read");
            },
          }),
        ),
        /invalid response/,
        "external rate-limit responses must reject unsafe Content-Length before body reads",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseExternalRateLimitInteger[\s\S]*EXTERNAL_NON_NEGATIVE_INTEGER_RE\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*parseExternalRateLimitInteger\(payload\.result\[0\], 1\)[\s\S]*parseExternalRateLimitInteger\(payload\.result\[1\], 0\)/,
        "external rate-limit counter parsing must remain strict and fail closed on malformed Redis counters",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /function parseExternalReplicaCount[\s\S]*EXTERNAL_POSITIVE_INTEGER_RE\.test\(normalized\)[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*requiresExternalSharedLock[\s\S]*parseExternalReplicaCount\(process\.env\.WEB_REPLICA_COUNT\)[\s\S]*replicaCount === null/,
        "production external shared lock detection must canonical-parse WEB_REPLICA_COUNT",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /function parseExternalRateLimitContentLength[\s\S]*EXTERNAL_NON_NEGATIVE_INTEGER_RE\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*response\.headers\.get\("content-length"\)[\s\S]*MAX_EXTERNAL_RATE_LIMIT_RESPONSE_BYTES[\s\S]*response\.body\.getReader\(\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)/,
        "external rate-limit response parsing must preflight strict Content-Length and use fatal UTF-8 decoding before parsing JSON",
      );
      assert.match(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /function hasValidExternalRateLimitRequest[\s\S]*MAX_EXTERNAL_RATE_LIMIT_BUCKET_LENGTH[\s\S]*MAX_EXTERNAL_RATE_LIMIT_KEY_LENGTH[\s\S]*EXTERNAL_RATE_LIMIT_ID_RE[\s\S]*Number\.isSafeInteger\(windowMs\)[\s\S]*Number\.isSafeInteger\(now\)/,
        "external rate-limit request parameters must be bounded before Redis key composition",
      );
      assert.doesNotMatch(
        readFileSync("app/api/_lib/externalRateLimit.ts", "utf8"),
        /Number\(payload\.result\[[01]\]\)|Number\(replicaCountRaw\)/,
        "external rate-limit counters and replica count must not use broad Number coercion",
      );
    },
  );
  for (const unsafeRateLimitEndpoint of [
    "http://redis.playlore.xyz",
    "https://user:pass@redis.playlore.xyz",
    "https://localhost:6379",
    "https://192.168.1.10",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:10.0.0.1]",
    "https://[fe90::1]",
    "https://[2001:db8::1]",
    "https://redis.example",
    "https://redis.test",
  ]) {
    await withTemporaryEnvAsync(
      {
        UPSTASH_REDIS_REST_URL: unsafeRateLimitEndpoint,
        UPSTASH_REDIS_REST_TOKEN: "server-only-token",
      },
      async () => {
        await assert.rejects(
          () => externalRateLimit.consumeExternalRateLimit(
            "api-live-state",
            "identity-hash",
            2,
            60_000,
            60_001,
            async () => {
              throw new Error("unsafe external rate-limit endpoint reached fetch");
            },
          ),
          /external rate-limit store must use a public HTTPS endpoint/,
        );
      },
    );
  }
  await withTemporaryEnvAsync(
    {
      UPSTASH_REDIS_REST_URL: "https://localhost:6379",
      UPSTASH_REDIS_REST_TOKEN: "server-only-token",
    },
    async () => {
      assert.equal(
        externalRateLimit.hasPublicExternalRateLimitStore(),
        false,
        "runtime health must not report an unsafe external rate-limit endpoint as configured",
      );
    },
  );
  await withTemporaryEnvAsync(
    {
      UPSTASH_REDIS_REST_URL: "https://redis.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "server-only-token",
    },
    async () => {
      assert.equal(
        externalRateLimit.hasPublicExternalRateLimitStore(),
        true,
        "runtime health must report a public HTTPS external rate-limit endpoint as configured",
      );
    },
  );
}
