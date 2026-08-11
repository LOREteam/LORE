import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as responseHeadersModule from "../app/api/_lib/responseHeaders.ts";
import * as sharedRateLimitModule from "../app/api/_lib/sharedRateLimit.ts";

export async function runApiRequestBoundaryTests() {
  const responseHeaders = responseHeadersModule.default ?? responseHeadersModule;
  const sharedRateLimit = sharedRateLimitModule.default ?? sharedRateLimitModule;
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
  assert.match(
    readFileSync("app/api/epochs/route.ts", "utf8"),
    /parsePositiveIntegerParam\(value\)[\s\S]*value === null \|\| value > 1_000_000[\s\S]*Invalid epochs/,
    "epochs query parsing must reject non-decimal epoch IDs before cache-key and storage work",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /parsePositiveIntegerValue\(value\)[\s\S]*parsed === null \|\| parsed > 1_000_000[\s\S]*Invalid epochs/,
    "rewards body epoch parsing must reject non-decimal string IDs before cache-key and storage work",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /epochsRaw\.length > MAX_EPOCHS_PER_REQUEST[\s\S]*Too many epochs[\s\S]*const epochs = new Set<number>\(\);[\s\S]*for \(const value of epochsRaw\)[\s\S]*parsePositiveIntegerValue\(value\)/,
    "rewards body epoch parsing must reject over-limit epoch arrays before cache-key and storage work",
  );
  assert.doesNotMatch(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /epochs\.size >= MAX_EPOCHS_PER_REQUEST|Array\.isArray\(epochsRaw\)[\s\S]*\.map\(\(value\) => parsePositiveIntegerValue\(value\)\)[\s\S]*\.slice\(0, MAX_EPOCHS_PER_REQUEST\)/,
    "rewards body epoch parsing must not silently truncate or map an entire submitted array before rejecting over-limit requests",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Rewards payload must be JSON[\s\S]*415/,
    "rewards API must fail closed with no-store 415 on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Message payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "chat message sends must fail closed with no-store/Vary 415 on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /const text = typeof body\.text === "string" \? body\.text\.trim\(\) : ""[\s\S]*text\.length > MAX_TEXT_LENGTH[\s\S]*Message text is too long[\s\S]*const senderName = typeof body\.senderName === "string" \? body\.senderName\.trim\(\) : null[\s\S]*senderName\.length > MAX_NAME_LENGTH[\s\S]*Sender name is too long/,
    "chat message sends must reject over-limit text and sender names instead of silently truncating authenticated payloads",
  );
  assert.doesNotMatch(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /body\.(?:text|senderName)\.trim\(\)\.slice\(0, MAX_(?:TEXT|NAME)_LENGTH\)/,
    "chat message sends must not silently truncate authenticated text or sender names before storage",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /reason === "unsupported-content-type"[\s\S]*Profile payload must be JSON[\s\S]*status: 415[\s\S]*varyCookie: true/,
    "chat profile writes must fail closed with no-store/Vary 415 on non-JSON payloads",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /const name = typeof body\.name === "string" \? body\.name\.trim\(\) : null[\s\S]*name\.length > MAX_NAME_LENGTH[\s\S]*Profile name is too long/,
    "chat profile writes must reject over-limit names instead of silently truncating authenticated payloads",
  );
  assert.doesNotMatch(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /body\.name\.trim\(\)\.slice\(0, MAX_NAME_LENGTH\)/,
    "chat profile writes must not silently truncate authenticated names before storage",
  );
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
