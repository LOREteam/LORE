import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as boundedJsonBodyModule from "../app/api/_lib/boundedJsonBody.ts";
import * as queryParamsModule from "../app/api/_lib/queryParams.ts";

export async function runApiIntegerQueryTests() {
  const boundedJsonBody = boundedJsonBodyModule.default ?? boundedJsonBodyModule;
  const queryParams = queryParamsModule.default ?? queryParamsModule;
  const request = (body, contentType = "application/json", extraHeaders = {}) => new Request("https://play.example/api/test", {
    method: "POST",
    headers: { "content-type": contentType, ...extraHeaders },
    body,
  });

  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(request('{"ok":true}', "application/problem+json; charset=utf-8"), 64),
    { ok: true, value: { ok: true } },
    "bounded JSON body parser must accept explicit application vendor JSON content types",
  );
  for (const contentType of ["", "text/json", "text/plain", "application/jsonp"]) {
    assert.deepEqual(
      await boundedJsonBody.readBoundedJsonBody(request("{}", contentType), 64),
      { ok: false, reason: "unsupported-content-type" },
      `bounded JSON body parser must reject unsupported content type ${contentType || "<empty>"}`,
    );
  }
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      request("{}", "application/json", { "content-length": "65" }),
      64,
    ),
    { ok: false, reason: "too-large" },
    "bounded JSON body parser must reject an oversized declared body before parsing",
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(request("x".repeat(65)), 64),
    { ok: false, reason: "too-large" },
    "bounded JSON body parser must enforce the byte limit while streaming an undeclared body",
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(request(new Uint8Array([0xc3, 0x28])), 64),
    { ok: false, reason: "invalid" },
    "bounded JSON body parser must fail closed on malformed UTF-8",
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(request("{"), 64),
    { ok: false, reason: "invalid" },
    "bounded JSON body parser must fail closed on malformed JSON",
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
