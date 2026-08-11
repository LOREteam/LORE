import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as queryParamsModule from "../app/api/_lib/queryParams.ts";

export function runApiIntegerQueryTests() {
  const queryParams = queryParamsModule.default ?? queryParamsModule;
  const boundedJsonBodySource = readFileSync("app/api/_lib/boundedJsonBody.ts", "utf8");
  assert.ok(
    boundedJsonBodySource.includes("const JSON_CONTENT_TYPE_RE = /^application\\/(?:json|[a-z0-9!#$&^_.+-]+\\+json)$/;")
      && /function isJsonContentType[\s\S]*JSON_CONTENT_TYPE_RE\.test\(contentType\)[\s\S]*if \(!isJsonContentType\(request\.headers\.get\("content-type"\)\)\)/.test(boundedJsonBodySource),
    "bounded JSON body parser must require an explicit application JSON Content-Type",
  );
  assert.match(
    boundedJsonBodySource,
    /new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "bounded JSON body parser must use fatal UTF-8 decoding",
  );
  assert.equal(queryParams.parsePositiveIntegerParam("1"), 1);
  assert.equal(queryParams.parsePositiveIntegerParam("400"), 400);
  assert.equal(queryParams.parsePositiveIntegerParam("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(queryParams.parsePositiveIntegerValue(7), 7);
  assert.equal(queryParams.parsePositiveIntegerValue("8"), 8);
  assert.equal(queryParams.parsePositiveIntegerValue("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("64", 64), 64);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("65", 64), null);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("1", 0), null);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("1", 1.5), null);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("9007199254740991", Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.equal(queryParams.parseBoundedPositiveIntegerParam("9007199254740992", Number.MAX_SAFE_INTEGER), null);
  for (const value of [null, "", "0", "001", "-1", "1.0", "1e2", "0x10", " 1", "1 ", "9007199254740992", "9007199254740993", "9999999999999999", "12345678901234567"]) {
    assert.equal(
      queryParams.parsePositiveIntegerParam(value),
      null,
      `strict API integer query parsing must reject ${String(value)}`,
    );
    assert.equal(
      queryParams.parsePositiveIntegerValue(value),
      null,
      `strict API integer value parsing must reject ${String(value)}`,
    );
  }
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 9_007_199_254_740_992]) {
    assert.equal(
      queryParams.parsePositiveIntegerValue(value),
      null,
      `strict API integer value parsing must reject numeric ${String(value)}`,
    );
  }
  assert.match(
    readFileSync("app/api/_lib/queryParams.ts", "utf8"),
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed <= 0n \|\| parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "shared API query parsing must bound decimal strings as BigInt before narrowing to JS numbers",
  );
  assert.doesNotMatch(
    readFileSync("app/api/_lib/queryParams.ts", "utf8"),
    /const parsed = Number\(value\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "shared API query parsing must not narrow attacker-controlled decimal strings before range checks",
  );
  assert.match(
    readFileSync("app/api/claim-candidates/route.ts", "utf8"),
    /parsePositiveIntegerParam\(cursorParam\)[\s\S]*parseBoundedPositiveIntegerParam\(limitParam, MAX_PAGE_SIZE\)[\s\S]*limit: requestedLimit/,
    "claim-candidates pagination must reject out-of-range limits instead of silently clamping them",
  );
  assert.doesNotMatch(
    readFileSync("app/api/claim-candidates/route.ts", "utf8"),
    /Math\.min\(requestedLimit, MAX_PAGE_SIZE\)/,
    "claim-candidates pagination must keep max-limit rejection explicit instead of reintroducing silent clamping",
  );
}
