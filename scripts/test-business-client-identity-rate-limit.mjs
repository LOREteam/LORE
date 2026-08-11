import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as clientIdentityModule from "../app/api/_lib/clientIdentity.ts";
import * as externalRateLimitModule from "../app/api/_lib/externalRateLimit.ts";

const clientIdentity = clientIdentityModule.default ?? clientIdentityModule;
const externalRateLimit = externalRateLimitModule.default ?? externalRateLimitModule;

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
