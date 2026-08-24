import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as responseHeadersModule from "../app/api/_lib/responseHeaders.ts";
import * as sharedRateLimitModule from "../app/api/_lib/sharedRateLimit.ts";
import * as liveStateRuntimePolicyModule from "../app/api/live-state/runtimePolicy.ts";
import * as publicReadModelPolicyModule from "../app/api/_lib/publicReadModelPolicy.ts";

const PROCESS_CONTENT_TYPE_PROBE = process.env.API_REQUEST_BOUNDARY_MODE === "process-content-type-probe";

async function runProcessContentTypeProbe() {
  process.env.NODE_ENV = "development";
  process.env.ADMIN_PROCESS_ROUTE_ENABLED = "1";
  process.env.WEB_REPLICA_COUNT = "1";
  process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "1";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const { mock } = await import("node:test");
  mock.module(new URL("../app/api/_lib/adminSession.ts", import.meta.url).href, {
    namedExports: {
      readAdminSession: async () => ({ address: "0x0000000000000000000000000000000000000001" }),
    },
  });
  const [{ NextRequest }, routeModule] = await Promise.all([
    import("next/server"),
    import("../app/api/admin/processes/route.ts"),
  ]);
  const route = routeModule.default ?? routeModule;
  const response = await route.POST(new NextRequest("http://localhost:3000/api/admin/processes", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "user-agent": "lore-process-content-type-probe",
    },
    body: "{}",
  }));
  assert.equal(response.status, 415, "admin process route must reject non-JSON bodies");
  assert.deepEqual(await response.json(), { error: "Process payload must be JSON" });
  assert.match(response.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store(?:,|$)/);
  assert.match(response.headers.get("vary") ?? "", /(?:^|,)\s*Cookie(?:,|$)/i);
}

function runProcessContentTypeProbeChild() {
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", fileURLToPath(import.meta.url)],
    {
      cwd: process.cwd(),
      env: { ...process.env, API_REQUEST_BOUNDARY_MODE: "process-content-type-probe" },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `process content-type child failed: ${result.stderr || result.stdout}`);
}

if (PROCESS_CONTENT_TYPE_PROBE) {
  await runProcessContentTypeProbe();
  process.exit(0);
}

export async function runApiRequestBoundaryTests() {
  const responseHeaders = responseHeadersModule.default ?? responseHeadersModule;
  const sharedRateLimit = sharedRateLimitModule.default ?? sharedRateLimitModule;
  const liveStateRuntimePolicy = liveStateRuntimePolicyModule.default ?? liveStateRuntimePolicyModule;
  const publicReadModelPolicy = publicReadModelPolicyModule.default ?? publicReadModelPolicyModule;
  const parsePositiveInteger = (value) => {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  assert.deepEqual(
    liveStateRuntimePolicy.parseRequestedEpochsParam("1e2", parsePositiveInteger, 100),
    { ok: false, error: "Invalid epochs" },
    "epochs query parsing must reject non-decimal epoch IDs before cache-key and storage work",
  );
  assert.deepEqual(
    liveStateRuntimePolicy.parseRequestedEpochsParam("1000001", parsePositiveInteger, 100),
    { ok: false, error: "Invalid epochs" },
    "epochs query parsing must reject out-of-range epoch IDs before cache-key and storage work",
  );
  assert.deepEqual(
    publicReadModelPolicy.parsePublicRewardsEpochs(["1e2"]),
    { ok: false, error: "Invalid epochs" },
    "rewards body epoch parsing must reject non-decimal string IDs before cache-key and storage work",
  );
  assert.deepEqual(
    publicReadModelPolicy.parsePublicRewardsEpochs(["1000001"]),
    { ok: false, error: "Invalid epochs" },
    "rewards body epoch parsing must reject out-of-range IDs before cache-key and storage work",
  );
  let overLimitElementReads = 0;
  const overLimitEpochs = new Proxy(
    Array.from({ length: publicReadModelPolicy.PUBLIC_REWARDS_MAX_EPOCHS + 1 }, (_, index) => index + 1),
    {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) overLimitElementReads += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  assert.deepEqual(
    publicReadModelPolicy.parsePublicRewardsEpochs(overLimitEpochs),
    { ok: false, error: "Too many epochs" },
    "rewards body epoch parsing must reject over-limit arrays before cache-key and storage work",
  );
  assert.equal(overLimitElementReads, 0, "over-limit rewards arrays must be rejected before parsing any submitted element");
  runProcessContentTypeProbeChild();
  const cookieVaryResponse = new Response("{}", { headers: { Vary: "Accept-Encoding, cookie, Cookie" } });
  responseHeaders.applyNoStoreHeaders(cookieVaryResponse, { varyCookie: true });
  assert.equal(cookieVaryResponse.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
  assert.equal(cookieVaryResponse.headers.get("Pragma"), "no-cache");
  assert.equal(cookieVaryResponse.headers.get("Expires"), "0");
  assert.equal(
    cookieVaryResponse.headers.get("Vary"),
    "Accept-Encoding, Cookie",
    "session API no-store helper must merge Vary: Cookie case-insensitively",
  );
  const wildcardVaryResponse = new Response("{}", { headers: { Vary: "*" } });
  responseHeaders.applyNoStoreHeaders(wildcardVaryResponse, { varyCookie: true });
  assert.equal(
    wildcardVaryResponse.headers.get("Vary"),
    "*",
    "session API no-store helper must preserve Vary wildcard instead of appending Cookie",
  );
  const invalidVaryResponse = new Response("{}", { headers: { Vary: "Accept-Encoding, bad token, X-Lore, Cookie" } });
  responseHeaders.applyNoStoreHeaders(invalidVaryResponse, { varyCookie: true });
  assert.equal(
    invalidVaryResponse.headers.get("Vary"),
    "Accept-Encoding, X-Lore, Cookie",
    "session API no-store helper must discard invalid Vary tokens while preserving valid tokens and Cookie",
  );
  const retryAfterLimitRequest = new Request("https://play.example/api/retry-limit", {
    headers: {
      "accept-language": "en-US",
      "user-agent": "retry-after-boundary",
    },
  });
  const retryAfterBucket = `test-retry-after-${Date.now()}`;
  assert.equal(
    await sharedRateLimit.enforceSharedRateLimit(retryAfterLimitRequest, {
      bucket: retryAfterBucket,
      limit: 1,
      windowMs: 86_400_000,
    }),
    null,
  );
  const retryAfterLimited = await sharedRateLimit.enforceSharedRateLimit(retryAfterLimitRequest, {
    bucket: retryAfterBucket,
    limit: 1,
    windowMs: 86_400_000,
  });
  assert.equal(retryAfterLimited?.status, 429, "shared rate-limit second hit must return 429");
  const retryAfterLimitHeader = Number.parseInt(retryAfterLimited?.headers.get("Retry-After") ?? "", 10);
  assert.ok(
    Number.isSafeInteger(retryAfterLimitHeader) && retryAfterLimitHeader >= 1 && retryAfterLimitHeader <= 86_400,
    "429 Retry-After header must be bounded to at most one day",
  );
  assert.equal(
    (await retryAfterLimited?.json())?.retryAfter,
    retryAfterLimitHeader,
    "429 retryAfter JSON field must be bounded with the same limit as the header",
  );
  assert.equal(sharedRateLimit.normalizeRetryAfterSeconds(0), 1, "Retry-After must reject zero seconds");
  assert.equal(sharedRateLimit.normalizeRetryAfterSeconds(1.1), 2, "Retry-After must round fractional seconds up");
  assert.equal(
    sharedRateLimit.normalizeRetryAfterSeconds(86_400.1),
    86_400,
    "Retry-After must cap values above one day",
  );
}
