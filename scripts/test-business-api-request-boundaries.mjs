import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as responseHeadersModule from "../app/api/_lib/responseHeaders.ts";
import * as sharedRateLimitModule from "../app/api/_lib/sharedRateLimit.ts";
import * as liveStateRuntimePolicyModule from "../app/api/live-state/runtimePolicy.ts";
import * as publicReadModelPolicyModule from "../app/api/_lib/publicReadModelPolicy.ts";

export async function runApiRequestBoundaryTests() {
  const responseHeaders = responseHeadersModule.default ?? responseHeadersModule;
  const sharedRateLimit = sharedRateLimitModule.default ?? sharedRateLimitModule;
  const liveStateRuntimePolicy = liveStateRuntimePolicyModule.default ?? liveStateRuntimePolicyModule;
  const publicReadModelPolicy = publicReadModelPolicyModule.default ?? publicReadModelPolicyModule;
  assert.match(
    readFileSync("app/api/rebate-history/route.ts", "utf8"),
    /parsePositiveIntegerParam\(cursorParam\)[\s\S]*parseBoundedPositiveIntegerParam\(limitParam, MAX_PAGE_SIZE\)[\s\S]*limit: requestedLimit/,
    "rebate-history pagination must reject out-of-range limits instead of silently clamping them",
  );
  assert.doesNotMatch(
    readFileSync("app/api/rebate-history/route.ts", "utf8"),
    /Math\.min\(requestedLimit, MAX_PAGE_SIZE\)/,
    "rebate-history pagination must keep max-limit rejection explicit instead of reintroducing silent clamping",
  );
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
  assert.match(
    readFileSync("app/api/admin/processes/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Process payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "admin process controls must fail closed with no-store/Vary 415 on non-JSON payloads",
  );
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
  assert.match(
    readFileSync("app/api/_lib/responseHeaders.ts", "utf8"),
    /HEADER_TOKEN_RE[\s\S]*function normalizeHeaderToken[\s\S]*HEADER_TOKEN_RE\.test\(trimmed\)[\s\S]*const nextToken = normalizeHeaderToken\(next\)[\s\S]*const trimmed = normalizeHeaderToken\(value\)/,
    "session API no-store helper must validate Vary header tokens before merging Cookie",
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
  assert.match(
    readFileSync("app/api/_lib/sharedRateLimit.ts", "utf8"),
    /MAX_RETRY_AFTER_SECONDS\s*=\s*86_400[\s\S]*Math\.min\(MAX_RETRY_AFTER_SECONDS, Math\.max\(1, Math\.ceil\(value\)\)\)/,
    "shared rate-limit 429 retry-after values must stay bounded",
  );
  assert.match(
    readFileSync("app/api/admin/auth/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Auth payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "admin auth must fail closed with no-store/Vary on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/auth/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Auth payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "chat auth must fail closed with no-store/Vary on non-JSON payloads",
  );
}
