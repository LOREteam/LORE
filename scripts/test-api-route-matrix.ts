import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

type ResponseSnapshot = {
  status: number;
  headers: Record<string, string | null>;
  bodyBytes: number;
  bodySha256: string;
  prefixHex: string;
  json: unknown;
};

type MethodMatrix = {
  postMalformed: ResponseSnapshot;
  putOversized: ResponseSnapshot;
  patch: ResponseSnapshot;
  delete: ResponseSnapshot;
  options: ResponseSnapshot;
};

type WorkerResult = Record<string, unknown> & { scenario: string };

const WORKER_PATH = resolve("scripts/fixtures/api-route-matrix-worker.ts");
const TSX_CLI_PATH = resolve("node_modules/tsx/dist/cli.mjs");
const CHILD_TIMEOUT_MS = 45_000;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function asSnapshot(value: unknown, label: string): ResponseSnapshot {
  return asRecord(value, label) as ResponseSnapshot;
}

function asMethodMatrix(value: unknown, label: string): MethodMatrix {
  return asRecord(value, label) as MethodMatrix;
}

function parseWorkerOutput(stdout: string, label: string): WorkerResult {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, `${label} worker produced no JSON output`);
  return JSON.parse(lines.at(-1) as string) as WorkerResult;
}

function childEnvironment(dbPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "development" as const,
    LORE_DB_PATH: dbPath,
    API_DEPOSITS_CHAIN_RECOVERY: "0",
    NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
    KEEPER_RPC_URL: "https://rpc.playlore.xyz",
  };
}

function runWorker(tempRoot: string, mode: string) {
  const dbPath = join(tempRoot, `${mode}.sqlite`);
  const result = spawnSync(process.execPath, [TSX_CLI_PATH, WORKER_PATH, mode], {
    cwd: process.cwd(),
    env: childEnvironment(dbPath),
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${mode} worker failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return parseWorkerOutput(result.stdout, mode);
}

function assertNoStore(snapshot: ResponseSnapshot, label: string) {
  assert.equal(snapshot.headers["cache-control"], "no-store, no-cache, must-revalidate", `${label} cache`);
  assert.equal(snapshot.headers.pragma, "no-cache", `${label} pragma`);
  assert.equal(snapshot.headers.expires, "0", `${label} expires`);
  assert.equal(snapshot.headers.vary, null, `${label} must not rely on Vary when it is no-store`);
}

function assertNoCors(snapshot: ResponseSnapshot, label: string) {
  assert.equal(snapshot.headers["access-control-allow-origin"], null, `${label} must not reflect Origin`);
}

function assertJsonStatus(snapshot: ResponseSnapshot, status: number, label: string) {
  assert.equal(snapshot.status, status, `${label} status`);
  assert.match(snapshot.headers["content-type"] ?? "", /^application\/json(?:;|$)/, `${label} content type`);
  assert.ok(snapshot.json && typeof snapshot.json === "object", `${label} JSON body`);
}

function assertFrameworkMethodMatrix(matrix: MethodMatrix, label: string) {
  for (const [method, snapshot] of Object.entries({
    POST: matrix.postMalformed,
    PUT: matrix.putOversized,
    PATCH: matrix.patch,
    DELETE: matrix.delete,
  })) {
    assert.equal(snapshot.status, 405, `${label} ${method} must be rejected by Next method dispatch`);
    assert.equal(snapshot.bodyBytes, 0, `${label} ${method} must not read or reflect its body`);
    assert.equal(snapshot.headers.allow, null, `${label} ${method} 405 contract`);
    assertNoCors(snapshot, `${label} ${method}`);
  }
  assert.equal(matrix.options.status, 204, `${label} OPTIONS status`);
  assert.equal(matrix.options.headers.allow, "GET, HEAD, OPTIONS", `${label} OPTIONS Allow`);
  assert.equal(matrix.options.bodyBytes, 0, `${label} OPTIONS body`);
  assertNoCors(matrix.options, `${label} OPTIONS`);
}

function assertLogsRedacted(result: WorkerResult, label: string, forbidden: string[] = []) {
  const logs = Array.isArray(result.logs) ? result.logs.map(String).join("\n") : "";
  for (const value of forbidden) {
    assert.doesNotMatch(logs, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${label} logs`);
  }
}

function validateOg(result: WorkerResult) {
  assert.equal(result.scenario, "og");
  assert.deepEqual(result.headStatuses, [200, 200]);
  assert.deepEqual(result.headBodies, [false, false], "explicit OG HEAD responses must be bodyless");
  const afterHeads = asSnapshot(result.afterHeads, "OG after HEAD requests");
  assert.equal(afterHeads.status, 200, "HEAD requests must not consume OG render capacity");
  assert.equal(afterHeads.headers["content-type"], "image/png");
  assert.equal(afterHeads.prefixHex, "89504e470d0a1a0a");
  assert.deepEqual(result.heldStatuses, [200, 200]);
  const busy = asSnapshot(result.busy, "OG busy");
  assertJsonStatus(busy, 503, "OG busy");
  assertNoStore(busy, "OG busy");
  assertNoCors(busy, "OG busy");
  assert.equal(busy.headers["retry-after"], "1");
  assert.deepEqual(busy.json, { error: "OpenGraph render capacity is busy", retryAfter: 1 });

  const baseline = asSnapshot(result.baseline, "OG baseline");
  const oversized = asSnapshot(result.oversized, "OG oversized");
  assert.equal(baseline.status, 200);
  assert.equal(baseline.headers["content-type"], "image/png");
  assert.equal(baseline.prefixHex, "89504e470d0a1a0a", "OG must return a real PNG");
  assert.ok(baseline.bodyBytes > 100, "OG PNG must not be empty");
  assert.ok(
    !(baseline.headers["cache-control"] ?? "").includes("no-store"),
    "successful OG images must retain ImageResponse cache semantics",
  );
  assert.equal(baseline.headers.vary, null);
  assertNoCors(baseline, "OG baseline");
  assert.equal(oversized.status, 200);
  assert.equal(oversized.bodySha256, baseline.bodySha256, "invalid oversized OG inputs must be omitted, not rendered");

  const fetchUrls = Array.isArray(result.fetchUrls) ? result.fetchUrls.map(String) : [];
  assert.ok(fetchUrls.length > 0, "OG render must load its real local art through the fetch fixture");
  for (const rawUrl of fetchUrls) {
    const url = new URL(rawUrl);
    assert.equal(url.origin, "https://playlore.xyz", "hostile request Host must not control OG asset fetches");
    assert.match(url.pathname, /^\/jackpot-og-[a-z-]+\.png$/);
  }
  assertFrameworkMethodMatrix(asMethodMatrix(result.methods, "OG methods"), "OG");
  assertLogsRedacted(result, "OG", ["route-matrix-proxy-secret"]);
}

function validateJackpots(result: WorkerResult) {
  assert.equal(result.scenario, "jackpots");
  const baseline = asSnapshot(result.baseline, "jackpots baseline");
  const fresh = asSnapshot(result.fresh, "jackpots fresh");
  const oversized = asSnapshot(result.oversized, "jackpots oversized");
  for (const [label, snapshot] of Object.entries({ baseline, fresh, oversized })) {
    assertJsonStatus(snapshot, 200, `jackpots ${label}`);
    assertNoStore(snapshot, `jackpots ${label}`);
    assertNoCors(snapshot, `jackpots ${label}`);
    assert.deepEqual(snapshot.json, { jackpots: [] }, `jackpots ${label} payload`);
  }
  assert.equal(oversized.bodySha256, baseline.bodySha256, "unknown/oversized fresh input must not alter output");
  assertFrameworkMethodMatrix(asMethodMatrix(result.methods, "jackpots methods"), "jackpots");
  assertLogsRedacted(result, "jackpots", ["route-matrix-proxy-secret"]);
}

function validateDeposits(result: WorkerResult) {
  assert.equal(result.scenario, "deposits");
  for (const [label, raw] of Object.entries({
    missing: result.missing,
    malformed: result.malformed,
    oversized: result.oversized,
  })) {
    const snapshot = asSnapshot(raw, `deposits ${label}`);
    assertJsonStatus(snapshot, 400, `deposits ${label}`);
    assertNoStore(snapshot, `deposits ${label}`);
    assertNoCors(snapshot, `deposits ${label}`);
    assert.deepEqual(snapshot.json, { deposits: [], error: "Missing or invalid ?user=0x..." });
    assert.ok(snapshot.bodyBytes < 256, `deposits ${label} must not reflect attacker input`);
  }
  const valid = asSnapshot(result.valid, "deposits valid");
  assertJsonStatus(valid, 200, "deposits valid");
  assertNoStore(valid, "deposits valid");
  assertNoCors(valid, "deposits valid");
  assert.deepEqual(valid.json, { deposits: [] });
  assertFrameworkMethodMatrix(asMethodMatrix(result.methods, "deposits methods"), "deposits");
  assertLogsRedacted(result, "deposits", ["route-matrix-proxy-secret"]);
}

function validateHealthSuccess(result: WorkerResult, tempRoot: string) {
  assert.equal(result.scenario, "health-success");
  const publicResponse = asSnapshot(result.publicResponse, "health public");
  const malformedSecret = asSnapshot(result.malformedSecret, "health malformed secret");
  const privateResponse = asSnapshot(result.privateResponse, "health private");
  for (const [label, snapshot] of Object.entries({ publicResponse, malformedSecret, privateResponse })) {
    assertJsonStatus(snapshot, 200, label);
    assertNoStore(snapshot, label);
    assertNoCors(snapshot, label);
  }

  const publicJson = asRecord(publicResponse.json, "health public JSON");
  const malformedJson = asRecord(malformedSecret.json, "health malformed JSON");
  const privateJson = asRecord(privateResponse.json, "health private JSON");
  assert.equal(publicJson.visibility, "public");
  assert.equal(publicJson.redacted, true);
  assert.equal(asRecord(publicJson.contract, "health public contract").headBlock, null);
  assert.equal(asRecord(publicJson.env, "health public env").dbPath, null);
  assert.deepEqual(malformedJson, publicJson, "short diagnostics secret must remain public and use the same cached payload");
  assert.equal(privateJson.visibility, "private");
  assert.equal(privateJson.redacted, false);
  assert.equal(asRecord(privateJson.contract, "health private contract").headBlock, "100");
  const privateDbPath = String(asRecord(privateJson.env, "health private env").dbPath ?? "");
  assert.ok(privateDbPath.startsWith(`${resolve(tempRoot)}${sep}`), "private diagnostics should expose only the isolated fixture DB");
  assert.equal(publicJson.ts, privateJson.ts, "public/private responses must derive from one cached source payload");
  assert.equal(
    result.rpcCountAfterPrivate,
    result.rpcCountAfterPublic,
    "authorization changes must redact the cached source without rebuilding or poisoning it",
  );
  assertFrameworkMethodMatrix(asMethodMatrix(result.methods, "health methods"), "health data-sync");
  assertLogsRedacted(result, "health success", ["route-matrix-health-secret", "route-matrix-proxy-secret"]);
}

function validateHealthFailure(result: WorkerResult) {
  assert.equal(result.scenario, "health-failure");
  const publicResponse = asSnapshot(result.publicResponse, "health failure public");
  const privateResponse = asSnapshot(result.privateResponse, "health failure private");
  assertJsonStatus(publicResponse, 500, "health failure public");
  assertJsonStatus(privateResponse, 500, "health failure private");
  assertNoStore(publicResponse, "health failure public");
  assertNoStore(privateResponse, "health failure private");
  assertNoCors(publicResponse, "health failure public");
  assertNoCors(privateResponse, "health failure private");
  assert.deepEqual(publicResponse.json, { status: "error", error: "Internal error" });
  const privateJson = asRecord(privateResponse.json, "health private error");
  assert.equal(privateJson.status, "error");
  assert.equal(typeof privateJson.error, "string");
  const sentinel = String(result.errorSentinel);
  assert.doesNotMatch(String(privateJson.error), new RegExp(sentinel, "i"), "authorized errors must still redact credentials");
  assertLogsRedacted(result, "health failure", [sentinel, "matrix-password", "route-matrix-health-secret"]);
}

type LimiterRequestMessage = {
  type: "external-rate-limit-request";
  requestId: number;
  endpoint: string;
  method: string;
  contentType: string | null;
  authorizationValid: boolean;
  body: string;
};

type SpawnedLimiter = {
  child: ChildProcess;
  result: Promise<WorkerResult>;
};

function spawnLimiterWorker(tempRoot: string, label: string): SpawnedLimiter {
  const child: ChildProcess = spawn(process.execPath, [TSX_CLI_PATH, WORKER_PATH, "limiter"], {
    cwd: process.cwd(),
    env: childEnvironment(join(tempRoot, `limiter-${label}.sqlite`)),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: Buffer | string) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk: Buffer | string) => { stderr += String(chunk); });

  const result = new Promise<WorkerResult>((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => {
      child.kill();
      rejectResult(new Error(`limiter ${label} worker timed out`));
    }, CHILD_TIMEOUT_MS);
    child.once("error", (error: Error) => {
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectResult(new Error(
          `limiter ${label} worker failed code=${String(code)} signal=${String(signal)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ));
        return;
      }
      try {
        resolveResult(parseWorkerOutput(stdout, `limiter ${label}`));
      } catch (error) {
        rejectResult(error);
      }
    });
  });
  return { child, result };
}

async function validateTwoProcessSharedLimiter(tempRoot: string) {
  const counts = new Map<string, number>();
  const brokerRequests: LimiterRequestMessage[] = [];
  const brokerState = { failure: null as Error | null };
  const first = spawnLimiterWorker(tempRoot, "first");
  const second = spawnLimiterWorker(tempRoot, "second");

  const handleBrokerMessage = (child: ChildProcess, raw: unknown) => {
    const message = raw as Partial<LimiterRequestMessage>;
    if (message.type !== "external-rate-limit-request") return;
    try {
      assert.equal(typeof message.requestId, "number");
      assert.equal(message.endpoint, "https://unit-test.upstash.io");
      assert.equal(message.method, "POST");
      assert.equal(message.contentType, "application/json");
      assert.equal(message.authorizationValid, true);
      assert.equal(typeof message.body, "string");
      const command = JSON.parse(message.body as string) as unknown[];
      assert.equal(command[0], "EVAL");
      assert.equal(typeof command[1], "string");
      assert.equal(command[2], "1");
      assert.match(String(command[3]), /^lore:rate-limit:api-jackpots-og:[a-f0-9]{32}:120000$/);
      assert.equal(command[4], "60000");
      const redisKey = String(command[3]);
      const count = (counts.get(redisKey) ?? 0) + 1;
      counts.set(redisKey, count);
      brokerRequests.push(message as LimiterRequestMessage);
      assert.ok(counts.size <= 1, "bounded broker must observe exactly one shared Redis key");
      assert.ok(brokerRequests.length <= 2, "bounded broker must receive exactly one call per replica");
      child.send?.({
        type: "external-rate-limit-response",
        requestId: message.requestId,
        status: 200,
        payload: { result: [count, 60_000] },
      });
    } catch (error) {
      brokerState.failure ??= error instanceof Error ? error : new Error(String(error));
      child.send?.({
        type: "external-rate-limit-response",
        requestId: message.requestId,
        status: 500,
        payload: { error: "bounded broker rejected request" },
      });
    }
  };
  first.child.on("message", (message) => handleBrokerMessage(first.child, message));
  second.child.on("message", (message) => handleBrokerMessage(second.child, message));

  const results = await Promise.all([first.result, second.result]);
  if (brokerState.failure) throw brokerState.failure;
  assert.equal(brokerRequests.length, 2);
  assert.equal(counts.size, 1);
  assert.equal([...counts.values()][0], 2);
  const pids = results.map((result) => Number(result.pid));
  assert.equal(new Set(pids).size, 2, "shared limiter proof must use two distinct OS processes");
  assert.ok(pids.every((pid) => pid > 0 && pid !== process.pid));
  assert.deepEqual(results.map((result) => result.fetchCalls), [1, 1]);

  const allowed = results.filter((result) => result.allowed === true);
  const blocked = results.filter((result) => result.allowed === false);
  assert.equal(allowed.length, 1, "one aggregate request must be admitted");
  assert.equal(blocked.length, 1, "the second aggregate request must be rejected");
  const blockedResponse = asSnapshot(blocked[0].response, "two-process limiter rejection");
  assertJsonStatus(blockedResponse, 429, "two-process limiter rejection");
  assertNoStore(blockedResponse, "two-process limiter rejection");
  assert.equal(blockedResponse.headers["retry-after"], "60");
  assert.deepEqual(blockedResponse.json, { error: "Too many requests", retryAfter: 60 });
}

function assertSafeTemporaryRoot(tempRoot: string) {
  const resolvedTempRoot = resolve(tempRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  assert.ok(
    resolvedTempRoot.startsWith(`${resolvedSystemTemp}${sep}`) && basename(resolvedTempRoot).startsWith("lore-api-route-matrix-"),
    `refusing to clean unexpected temporary path: ${resolvedTempRoot}`,
  );
  assert.equal(dirname(resolvedTempRoot), resolvedSystemTemp);
}

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), "lore-api-route-matrix-"));
  try {
    validateOg(runWorker(tempRoot, "og"));
    validateJackpots(runWorker(tempRoot, "jackpots"));
    validateDeposits(runWorker(tempRoot, "deposits"));
    validateHealthSuccess(runWorker(tempRoot, "health-success"), tempRoot);
    validateHealthFailure(runWorker(tempRoot, "health-failure"));
    await validateTwoProcessSharedLimiter(tempRoot);
    console.log("API route matrix tests passed: 4 routes, real Next method dispatch, 2-process shared limiter");
  } finally {
    assertSafeTemporaryRoot(tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
