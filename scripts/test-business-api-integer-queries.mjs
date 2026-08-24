import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as boundedJsonBodyModule from "../app/api/_lib/boundedJsonBody.ts";
import * as queryParamsModule from "../app/api/_lib/queryParams.ts";

function runClaimCandidatesPaginationProbe() {
  const poisonRoot = join(tmpdir(), `lore-claim-candidates-pagination-${process.pid}-${Date.now()}`);
  const urls = {
    route: new URL("../app/api/claim-candidates/route.ts", import.meta.url).href,
    storage: new URL("../server/storage.ts", import.meta.url).href,
    limiter: new URL("../app/api/_lib/sharedRateLimit.ts", import.meta.url).href,
  };
  const script = [
    'const { mock } = await import("node:test");',
    `const urls = ${JSON.stringify(urls)};`,
    'const pageOptions = [];',
    'const storageMock = mock.module(urls.storage, { namedExports: {',
    '  getUserParticipatingEpochPage: (_user, options) => {',
    '    pageOptions.push(options);',
    '    return { epochs: [500, 499], hasMore: true, nextCursor: 499 };',
    '  },',
    '} });',
    'const limiterMock = mock.module(urls.limiter, { namedExports: { enforceSharedRateLimit: async () => null } });',
    'try {',
    '  const { NextRequest } = await import("next/server");',
    '  const routeModule = await import(urls.route + "?claim-candidates-pagination=1");',
    '  const route = routeModule.default ?? routeModule;',
    '  const user = "0x0000000000000000000000000000000000000001";',
    '  const oversized = await route.GET(new NextRequest(`https://example.test/api/claim-candidates?user=${user}&limit=401`));',
    '  const bounded = await route.GET(new NextRequest(`https://example.test/api/claim-candidates?user=${user}&limit=400`));',
    '  console.log(JSON.stringify({',
    '    oversized: { status: oversized.status, cacheControl: oversized.headers.get("cache-control"), body: await oversized.json() },',
    '    bounded: { status: bounded.status, cacheControl: bounded.headers.get("cache-control"), body: await bounded.json() },',
    '    pageOptions,',
    '  }));',
    '} finally {',
    '  limiterMock.restore();',
    '  storageMock.restore();',
    '}',
  ].join("\n");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        script,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, LORE_DB_PATH: join(poisonRoot, "lore-v10.sqlite"), TSX_DISABLE_CACHE: "1" },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr.trim() || result.error?.message || "claim-candidates pagination probe failed");
    assert.equal(existsSync(poisonRoot), false, "claim-candidates pagination validation must not open its poisoned DB path");
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      oversized: {
        status: 400,
        cacheControl: "no-store, no-cache, must-revalidate",
        body: { error: "Invalid limit" },
      },
      bounded: {
        status: 200,
        cacheControl: "no-store, no-cache, must-revalidate",
        body: { epochs: [500, 499], hasMore: true, nextCursor: 499 },
      },
      pageOptions: [{ beforeEpoch: null, limit: 400 }],
    });
  } finally {
    rmSync(poisonRoot, { recursive: true, force: true });
  }
}

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
  runClaimCandidatesPaginationProbe();
}
