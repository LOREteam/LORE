import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

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

type SupportedRouteMethodBoundary = {
  unsupported: ResponseSnapshot;
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

function runWorker(tempRoot: string, mode: string, options: { moduleMocks?: boolean } = {}) {
  const dbPath = join(tempRoot, `${mode}.sqlite`);
  const childArgs = options.moduleMocks === true
    ? ["--experimental-test-module-mocks", "--import", "tsx", WORKER_PATH, mode]
    : [TSX_CLI_PATH, WORKER_PATH, mode];
  const result = spawnSync(process.execPath, childArgs, {
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

function assertNoStore(snapshot: ResponseSnapshot, label: string, varyCookie = false) {
  assert.equal(snapshot.headers["cache-control"], "no-store, no-cache, must-revalidate", `${label} cache`);
  assert.equal(snapshot.headers.pragma, "no-cache", `${label} pragma`);
  assert.equal(snapshot.headers.expires, "0", `${label} expires`);
  assert.equal(snapshot.headers.vary, varyCookie ? "Cookie" : null, `${label} Vary`);
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

function assertSupportedRouteMethodBoundary(
  value: unknown,
  expectedAllow: string[],
  label: string,
) {
  const matrix = asRecord(value, `${label} methods`) as SupportedRouteMethodBoundary;
  assert.equal(matrix.unsupported.status, 405, `${label} unsupported method status`);
  assert.equal(matrix.unsupported.bodyBytes, 0, `${label} unsupported method body`);
  assert.equal(matrix.unsupported.headers.allow, null, `${label} unsupported method Allow`);
  assertNoCors(matrix.unsupported, `${label} unsupported method`);
  assert.equal(matrix.options.status, 204, `${label} OPTIONS status`);
  assert.equal(matrix.options.bodyBytes, 0, `${label} OPTIONS body`);
  assert.deepEqual(
    (matrix.options.headers.allow ?? "").split(/,\s*/).filter(Boolean).sort(),
    [...expectedAllow].sort(),
    `${label} OPTIONS Allow`,
  );
  assertNoCors(matrix.options, `${label} OPTIONS`);
}

function assertNoIssuedSessionCookie(snapshot: ResponseSnapshot, label: string) {
  const setCookie = snapshot.headers["set-cookie"];
  if (setCookie === null) return;
  assert.match(
    setCookie,
    /^lore_(?:admin|chat)_session=;/,
    `${label} may clear an invalid session but must not issue one`,
  );
}

function assertErrorResponse(
  value: unknown,
  status: number,
  error: string,
  label: string,
  varyCookie = false,
) {
  const snapshot = asSnapshot(value, label);
  assertJsonStatus(snapshot, status, label);
  assertNoStore(snapshot, label, varyCookie);
  assertNoCors(snapshot, label);
  assert.deepEqual(snapshot.json, { error }, `${label} error schema`);
  assert.ok(snapshot.bodyBytes < 256, `${label} must not reflect request input`);
  assertNoIssuedSessionCookie(snapshot, label);
  return snapshot;
}

function assertNoProtectedPersistenceChanges(
  result: WorkerResult,
  label: string,
  allowedMockedFetchUrls: string[] = [],
) {
  const before = asRecord(result.before, `${label} persistence before`);
  const after = asRecord(result.after, `${label} persistence after`);
  assert.deepEqual(after, before, `${label} invalid/unauthenticated requests must not persist protected state`);
  assert.deepEqual(before, {
    adminSessions: 0,
    authProofLocks: 0,
    chatMessages: 0,
    chatProfiles: 0,
  }, `${label} fixture must start empty`);
  const mockedFetchUrls = Array.isArray(result.mockedFetchUrls)
    ? result.mockedFetchUrls.map(String)
    : [];
  assert.ok(
    mockedFetchUrls.every((url) => allowedMockedFetchUrls.includes(url)),
    `${label} network-like calls must stay inside the explicit fetch mock`,
  );
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
  const assetFetchUrls = fetchUrls.filter((rawUrl) => new URL(rawUrl).pathname.endsWith(".png"));
  assert.ok(assetFetchUrls.length > 0, "OG render must load its real local art through the fetch fixture");
  for (const rawUrl of assetFetchUrls) {
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
  assert.deepEqual(valid.json, { deposits: [], coverage: "partial", indexedThroughBlock: "0" });
  for (const [label, raw] of Object.entries({
    invalidWatermark: result.invalidWatermark,
    negativeWatermark: result.negativeWatermark,
  })) {
    const snapshot = asSnapshot(raw, `deposits ${label}`);
    assertJsonStatus(snapshot, 503, `deposits ${label}`);
    assertNoStore(snapshot, `deposits ${label}`);
    assertNoCors(snapshot, `deposits ${label}`);
    assert.deepEqual(snapshot.json, { deposits: [], error: "Deposit index watermark is unavailable" });
    assert.notDeepEqual(snapshot.json, { deposits: [], coverage: "partial", indexedThroughBlock: "0" }, `${label} must not coerce invalid indexer metadata to a valid zero watermark`);
  }
  assertFrameworkMethodMatrix(asMethodMatrix(result.methods, "deposits methods"), "deposits");
  assertLogsRedacted(result, "deposits", ["route-matrix-proxy-secret"]);
}

function asDepositRows(value: unknown, label: string) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value.map((row, index) => asRecord(row, `${label}[${index}]`));
}

function assertNetworkStayedInsideBlocker(result: WorkerResult, label: string) {
  const urls = Array.isArray(result.mockedFetchUrls) ? result.mockedFetchUrls.map(String) : [];
  const expectedRpcOrigins = new Set([
    "https://rpc.playlore.xyz",
    "https://linea-sepolia.drpc.org",
    "https://rpc.sepolia.linea.build",
  ]);
  assert.ok(
    urls.every((rawUrl) => expectedRpcOrigins.has(new URL(rawUrl).origin)),
    `${label} fetch attempts must stay inside the explicit RPC blocker`,
  );
}

function validateDepositsPersistence(result: WorkerResult) {
  assert.equal(result.scenario, "deposits-persistence");
  const response = asSnapshot(result.response, "deposits persistence response");
  assertJsonStatus(response, 200, "deposits persistence response");
  assertNoStore(response, "deposits persistence response");
  assertNoCors(response, "deposits persistence response");

  const payload = asRecord(response.json, "deposits persistence payload");
  assert.equal(payload.coverage, "partial", "indexed deposits must never claim complete chain coverage");
  assert.equal(payload.indexedThroughBlock, "120", "indexed through block must preserve canonical indexer provenance");
  assert.deepEqual(Object.keys(asRecord(payload.epochs, "nonempty includeRewards epochs")).sort(), ["10", "12"], "nonempty includeRewards response must include its resolved epoch summaries");
  assert.deepEqual(payload.rewards, {}, "nonempty includeRewards response must preserve the rewards payload shape");
  assert.equal(payload.rewardsStatus, "available", "successful includeRewards enrichment must disclose its availability");
  const rows = asDepositRows(payload.deposits, "deposits persistence rows");
  assert.deepEqual(
    rows.map((row) => ({
      epoch: row.epoch,
      tileIds: row.tileIds,
      amounts: row.amounts,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
    })),
    [
      {
        epoch: "12",
        tileIds: [7],
        amounts: ["3"],
        txHash: `0x${"44".repeat(32)}`,
        blockNumber: "120",
      },
      {
        epoch: "10",
        tileIds: [9],
        amounts: ["1"],
        txHash: "",
        blockNumber: "118",
      },
    ],
    "stored rows must filter future epochs/invalid-only tiles, merge duplicate valid tiles, and normalize tx identity",
  );
  assert.equal(asDepositRows(result.storedRows, "deposits stored rows").length, 4, "read sanitization must not rewrite storage");
  assertNetworkStayedInsideBlocker(result, "deposits persistence");
}

function validateDepositsRewardsFallback(result: WorkerResult) {
  assert.equal(result.scenario, "deposits-rewards-fallback");
  const response = asSnapshot(result.response, "deposits rewards fallback response");
  assertJsonStatus(response, 200, "deposits rewards fallback response");
  assertNoStore(response, "deposits rewards fallback response");
  assertNoCors(response, "deposits rewards fallback response");
  const payload = asRecord(response.json, "deposits rewards fallback payload");
  assert.equal(payload.coverage, "partial", "reward enrichment failure must preserve lower-bound deposit coverage");
  assert.equal(payload.indexedThroughBlock, "120", "reward enrichment failure must preserve canonical indexed provenance");
  assert.equal(payload.rewardsStatus, "unavailable", "reward enrichment failure must be explicit");
  assert.deepEqual(payload.epochs, {}, "reward enrichment failure must not invent epoch summaries");
  assert.deepEqual(payload.rewards, {}, "reward enrichment failure must not invent rewards");
  assert.deepEqual(
    asDepositRows(payload.deposits, "deposits rewards fallback rows").map((row) => row.epoch),
    ["12", "10"],
    "reward enrichment failure must retain the recovered/indexed deposit rows",
  );
  assertNetworkStayedInsideBlocker(result, "deposits rewards fallback");
}

function validateDepositsRecovery(result: WorkerResult) {
  assert.equal(result.scenario, "deposits-recovery");
  const initial = asDepositRows(result.initial, "deposits recovery initial responses");
  const cached = asDepositRows(result.cached, "deposits recovery cached responses");
  const settled = asDepositRows(result.settled, "deposits recovery settled responses");
  assert.equal(initial.length, 2);
  assert.equal(cached.length, 2);
  assert.equal(settled.length, 2);
  const responseRows: Array<Array<Record<string, unknown>>> = [];
  for (const [index, raw] of [...initial, ...cached, ...settled].entries()) {
    const snapshot = raw as unknown as ResponseSnapshot;
    assertJsonStatus(snapshot, 200, `deposits recovery response ${index}`);
    assertNoStore(snapshot, `deposits recovery response ${index}`);
    assertNoCors(snapshot, `deposits recovery response ${index}`);
    const recoveryPayload = asRecord(snapshot.json, `deposits recovery payload ${index}`);
    assert.equal(recoveryPayload.coverage, "partial", "background recovery must retain lower-bound coverage evidence");
    assert.equal(recoveryPayload.indexedThroughBlock, "100", "recovered rows must not overstate the canonical indexer watermark");
    const deposits = asDepositRows(
      recoveryPayload.deposits,
      `deposits recovery payload ${index} rows`,
    );
    responseRows.push(deposits);
    assert.ok(deposits.length <= 1, "malformed recovery logs must not become public rows");
    for (const row of deposits) {
      assert.equal(row.epoch, "12", "unsafe chain epochs must fail closed");
      assert.deepEqual(row.tileIds, [7], "out-of-range chain tiles must fail closed");
      assert.match(String(row.txHash), /^0x[0-9a-f]{64}$/, "recovered rows need full transaction identity");
      assert.match(String(row.logIndex), /^\d+$/, "recovered rows need canonical log identity");
    }
  }
  assert.ok(responseRows.slice(0, 4).every((rows) => rows.length === 0), "slow recovery must stay off the foreground path");
  assert.equal(responseRows[4]?.length, 1, "the admitted user's settled cache must receive its recovered row");
  assert.equal(responseRows[5]?.length, 0, "the other user must not receive another user's in-flight recovery result");
  assert.equal(result.logCallCount, 4, "only one user's four event-family scans may acquire the global recovery slot");
  assert.equal(result.maxActiveLogCalls, 1, "recovery event-family RPC scans must remain sequential");
  assert.equal(result.activeLogCalls, 0, "background recovery must settle without orphan RPC calls");
  const storedRows = asRecord(result.storedRows, "deposits recovery stored rows");
  assert.deepEqual(storedRows.first, [], "public recovery must not persist first-user rows");
  assert.deepEqual(storedRows.second, [], "public recovery must not persist second-user rows");
  assertNetworkStayedInsideBlocker(result, "deposits recovery");
}

function assertDepositsGlobalBoundMutantRejected(tempRoot: string) {
  const mutant = runWorker(tempRoot, "deposits-recovery-global-bound-mutant");
  assert.ok(Number(mutant.logCallCount) > 4, "fault probe must admit both users' recovery scans");
  assert.throws(
    () => validateDepositsRecovery(mutant),
    /only one user's four event-family scans may acquire the global recovery slot/,
    "per-user/unbounded recovery admission must fail the executable global-bound contract",
  );
}

function proveDepositsRecoveryGlobalBound(tempRoot: string) {
  validateDepositsRecovery(runWorker(tempRoot, "deposits-recovery"));
  assertDepositsGlobalBoundMutantRejected(tempRoot);
  return { depositsRecoveryGlobalBound: true as const };
}

export function runDepositsRecoveryGlobalBoundTests() {
  const tempRoot = mkdtempSync(join(tmpdir(), "lore-api-route-matrix-"));
  try {
    return proveDepositsRecoveryGlobalBound(tempRoot);
  } finally {
    assertSafeTemporaryRoot(tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function validateRecoveryStorageAllowlist(result: WorkerResult) {
  assert.equal(result.scenario, "recovery-storage-allowlist");
  assert.deepEqual(result.forbiddenResults, [false, false, false, false]);
  const before = asRecord(result.before, "recovery storage before");
  assert.deepEqual(result.afterForbidden, before, "forbidden recovery paths must have no DB side effects");
  assert.equal(result.invalidUserPatch, true, "canonical wallet path remains an admitted recovery namespace");
  assert.deepEqual(result.afterMalformed, before, "malformed epoch/block rows must not persist after path admission");
  assertNetworkStayedInsideBlocker(result, "recovery storage allowlist");
}

function assertRecoveryStorageAllowlistMutantRejected(tempRoot: string) {
  const mutant = runWorker(tempRoot, "recovery-storage-allowlist-mutant");
  assert.notDeepEqual(mutant.afterForbidden, mutant.before, "fault probe must mutate durable state");
  assert.throws(
    () => validateRecoveryStorageAllowlist(mutant),
    /false|forbidden recovery paths must have no DB side effects/,
    "an overbroad recovery write path must fail the executable no-side-effect contract",
  );
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
  assert.equal(asRecord(publicJson.storage, "health public storage").diskFreeBytes, null);
  assert.deepEqual(malformedJson, publicJson, "short diagnostics secret must remain public and use the same cached payload");
  assert.equal(privateJson.visibility, "private");
  assert.equal(privateJson.redacted, false);
  assert.equal(asRecord(privateJson.contract, "health private contract").headBlock, "100");
  const privateStorage = asRecord(privateJson.storage, "health private storage");
  assert.ok(
    privateStorage.diskFreeBytes === null ||
      (typeof privateStorage.diskFreeBytes === "number" &&
        Number.isSafeInteger(privateStorage.diskFreeBytes) &&
        privateStorage.diskFreeBytes >= 0),
    "private disk capacity must remain null or a non-negative safe integer",
  );
  assert.equal(
    privateStorage.latestRewardClaimBlock,
    null,
    "malformed stored reward-claim blocks must not become a latest block",
  );
  const privateRecentWins = asRecord(privateJson.recentWins, "health private recent wins");
  assert.equal(privateRecentWins.totalStored, 1, "malformed reward-claim fixture must reach the real route");
  assert.equal(privateRecentWins.latestRewardClaimBlock, null);
  assert.equal(privateRecentWins.lagToHeadBlocks, null);
  assert.equal(privateRecentWins.lagToIndexerBlocks, null);
  const privateIndexer = asRecord(privateJson.indexer, "health private indexer");
  const privateRun = asRecord(privateIndexer.run, "health private indexer run");
  assert.equal("startedAt" in privateRun, false, "string timestamps must not reach the response");
  assert.equal(typeof privateRun.completedAt, "number");
  assert.equal(typeof privateRun.lastHeartbeatAt, "number");
  assert.equal(privateRun.fromBlock, "1");
  assert.equal(privateRun.toBlock, "100");
  assert.equal(privateRun.totalLogs, 0);
  assert.equal("currentChunk" in privateRun, false, "zero must not pass a positive-integer field");
  assert.equal(privateRun.totalChunks, 2);
  assert.equal("lastProcessedBlock" in privateRun, false, "exponent block strings must fail closed");
  assert.ok(typeof privateRun.runCompletedAgeMs === "number" && privateRun.runCompletedAgeMs >= 0);
  assert.ok(typeof privateRun.runHeartbeatAgeMs === "number" && privateRun.runHeartbeatAgeMs >= 0);
  const privateRepair = asRecord(privateIndexer.repair, "health private indexer repair");
  assert.equal(privateRepair.fromBlock, "1");
  assert.equal(privateRepair.toBlock, "100");
  assert.equal("repairedLogs" in privateRepair, false, "string counters must fail closed");
  assert.ok(typeof privateRepair.ageMs === "number" && privateRepair.ageMs >= 0);
  const privateReconcile = asRecord(privateIndexer.reconcile, "health private indexer reconcile");
  assert.equal(privateReconcile.currentEpoch, 10);
  assert.equal("missingEpochs" in privateReconcile, false, "string counters must fail closed");
  assert.equal(privateReconcile.repairedEpochs, 0);
  assert.deepEqual(privateReconcile.targetEpochs, [1, 2]);
  assert.ok(typeof privateReconcile.ageMs === "number" && privateReconcile.ageMs >= 0);
  const privateEnv = asRecord(privateJson.env, "health private env");
  for (const field of ["lagWarnBlocks", "jackpotRecoveryBlockLag", "recentWinsRecoveryBlockLag", "indexerHeartbeatStaleMs"]) {
    assert.ok(Number.isSafeInteger(privateEnv[field]) && Number(privateEnv[field]) >= 0, `${field} must be a safe non-negative integer`);
  }
  const privateStorageState = asRecord(privateJson.storage, "health private storage state");
  assert.equal(privateStorageState.lastIndexedBlock, "90");
  assert.equal(privateStorageState.repairCursorBlock, "80");
  assert.equal(privateStorageState.lagBlocks, 10);
  assert.equal(asRecord(privateJson.contract, "health private contract").currentEpoch, 10);
  const privateDbPath = String(asRecord(privateJson.env, "health private env").dbPath ?? "");
  assert.ok(privateDbPath.startsWith(`${resolve(tempRoot)}${sep}`), "private diagnostics should expose only the isolated fixture DB");
  const serializedResponses = JSON.stringify({ publicJson, malformedJson, privateJson });
  assert.doesNotMatch(
    serializedResponses,
    new RegExp(String(result.statusMetadataSentinel), "i"),
    "raw indexer status metadata must not be spread into public or private diagnostics",
  );
  assert.doesNotMatch(serializedResponses, /(?:NaN|Infinity)/, "health responses must not publish non-finite block data");
  assert.equal(publicJson.ts, privateJson.ts, "public/private responses must derive from one cached source payload");
  assert.equal(
    result.rpcCountAfterPrivate,
    result.rpcCountAfterPublic,
    "authorization changes must redact the cached source without rebuilding or poisoning it",
  );
  assertFrameworkMethodMatrix(asMethodMatrix(result.methods, "health methods"), "health data-sync");
  assertLogsRedacted(result, "health success", ["route-matrix-health-secret", "route-matrix-proxy-secret"]);
}

function assertHealthSuccessMutantsRejected(result: WorkerResult, tempRoot: string) {
  const rawStatusSpreadMutant = structuredClone(result);
  const rawStatusPrivateJson = asRecord(
    asSnapshot(rawStatusSpreadMutant.privateResponse, "health raw-status mutant private").json,
    "health raw-status mutant private JSON",
  );
  const rawStatusRun = asRecord(
    asRecord(rawStatusPrivateJson.indexer, "health raw-status mutant indexer").run,
    "health raw-status mutant run",
  );
  rawStatusRun.opaqueProviderMetadata = rawStatusSpreadMutant.statusMetadataSentinel;
  assert.throws(
    () => validateHealthSuccess(rawStatusSpreadMutant, tempRoot),
    /raw indexer status metadata must not be spread/,
    "a raw indexer-status spread must fail the executable response boundary",
  );

  const uncheckedRewardBlockMutant = structuredClone(result);
  const uncheckedPrivateJson = asRecord(
    asSnapshot(uncheckedRewardBlockMutant.privateResponse, "health unchecked-block mutant private").json,
    "health unchecked-block mutant private JSON",
  );
  asRecord(uncheckedPrivateJson.storage, "health unchecked-block mutant storage").latestRewardClaimBlock = "NaN";
  asRecord(uncheckedPrivateJson.recentWins, "health unchecked-block mutant recent wins").latestRewardClaimBlock = "NaN";
  assert.throws(
    () => validateHealthSuccess(uncheckedRewardBlockMutant, tempRoot),
    /malformed stored reward-claim blocks must not become a latest block/,
    "an unchecked malformed reward-claim block must fail the executable response boundary",
  );
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

function validateHealthFinality(result: WorkerResult) {
  assert.equal(result.scenario, "health-finality");
  const publicResponse = asSnapshot(result.publicResponse, "health finality public");
  const privateResponse = asSnapshot(result.privateResponse, "health finality private");
  for (const [label, snapshot] of Object.entries({ publicResponse, privateResponse })) {
    assertJsonStatus(snapshot, 200, label);
    assertNoStore(snapshot, label);
    assertNoCors(snapshot, label);
  }

  const publicJson = asRecord(publicResponse.json, "health finality public JSON");
  const privateJson = asRecord(privateResponse.json, "health finality private JSON");
  assert.equal(
    privateJson.status,
    "healthy",
    "finality-aware health must remain healthy when the cursor is ahead of the finality target",
  );
  assert.equal(publicJson.status, "healthy", "public finality-aware health must preserve healthy status");

  const publicStorage = asRecord(publicJson.storage, "health finality public storage");
  const privateStorage = asRecord(privateJson.storage, "health finality private storage");
  assert.equal(privateStorage.lagBlocks, 45, "raw head lag fixture");
  assert.equal(publicStorage.lagBlocks, 45, "public raw head lag fixture");
  assert.equal(privateStorage.lagToFinalityTargetBlocks, 0, "private finality-target lag");
  assert.equal(publicStorage.lagToFinalityTargetBlocks, 0, "public finality-target lag");
  assert.equal(
    asRecord(privateJson.contract, "health finality private contract").finalityTargetBlock,
    "50",
    "finality target block fixture",
  );

  const publicRepair = asRecord(
    asRecord(publicJson.indexer, "health finality public indexer").repair,
    "health finality public repair",
  );
  const privateRepair = asRecord(
    asRecord(privateJson.indexer, "health finality private indexer").repair,
    "health finality private repair",
  );
  assert.equal(privateRepair.stale, false, "old repair must not be stale at zero finality-target lag");
  assert.equal(publicRepair.stale, false, "public repair status must preserve finality-aware freshness");

  for (const [label, payload] of [["public", publicJson], ["private", privateJson]] as const) {
    const hints = Array.isArray(payload.hints) ? payload.hints.map(String) : [];
    assert.doesNotMatch(
      hints.join("\n"),
      /indexer is lagging behind the finality target|\bdegraded\b/i,
      `${label} finality-aware health must not emit a lagging/degraded hint`,
    );
  }
  assertLogsRedacted(result, "health finality", ["route-matrix-health-secret", "route-matrix-proxy-secret"]);
}

function assertHealthFinalityRawLagMutantRejected(tempRoot: string) {
  const mutant = runWorker(tempRoot, "health-finality-raw-lag-mutant", { moduleMocks: true });
  const mutantPrivate = asRecord(
    asSnapshot(mutant.privateResponse, "health finality raw-lag mutant private").json,
    "health finality raw-lag mutant private JSON",
  );
  assert.equal(mutantPrivate.status, "degraded", "raw head lag substitution must degrade the fixture");
  assert.equal(
    asRecord(
      asRecord(mutantPrivate.indexer, "health finality raw-lag mutant indexer").repair,
      "health finality raw-lag mutant repair",
    ).stale,
    true,
    "raw head lag substitution must incorrectly mark the old repair stale",
  );
  assert.throws(
    () => validateHealthFinality(mutant),
    /finality-aware health must remain healthy when the cursor is ahead of the finality target/,
    "raw head lag substitution must fail the executable finality-aware health boundary",
  );
}

function validateAdminAuth(result: WorkerResult) {
  assert.equal(result.scenario, "admin-auth");
  assertErrorResponse(result.unsupportedType, 415, "Auth payload must be JSON", "admin auth unsupported type", true);
  assertErrorResponse(result.malformed, 400, "Invalid auth payload", "admin auth malformed", true);
  assertErrorResponse(result.oversized, 413, "Auth payload too large", "admin auth oversized", true);
  assertErrorResponse(result.wrongOrigin, 400, "Invalid auth origin", "admin auth origin binding", true);
  assertErrorResponse(result.refreshUnauthenticated, 401, "Admin auth required", "admin auth refresh", true);

  const logout = asSnapshot(result.logoutUnauthenticated, "admin auth logout");
  assertJsonStatus(logout, 200, "admin auth logout");
  assertNoStore(logout, "admin auth logout", true);
  assertNoCors(logout, "admin auth logout");
  assert.deepEqual(logout.json, { ok: true });
  assertNoIssuedSessionCookie(logout, "admin auth logout");

  assertSupportedRouteMethodBoundary(
    result.methods,
    ["DELETE", "GET", "HEAD", "OPTIONS", "POST"],
    "admin auth",
  );
  assertNoProtectedPersistenceChanges(result, "admin auth");
  assertLogsRedacted(result, "admin auth", ["hostile.invalid.value", "route-matrix-admin-secret"]);
}

function validateChatAuth(result: WorkerResult) {
  assert.equal(result.scenario, "chat-auth");
  assertErrorResponse(result.unsupportedType, 415, "Auth payload must be JSON", "chat auth unsupported type", true);
  assertErrorResponse(result.malformed, 400, "Invalid auth payload", "chat auth malformed", true);
  assertErrorResponse(result.oversized, 413, "Auth payload too large", "chat auth oversized", true);
  assertErrorResponse(result.wrongOrigin, 400, "Invalid auth origin", "chat auth origin binding", true);
  assertErrorResponse(result.refreshUnauthenticated, 401, "Chat auth required", "chat auth refresh", true);
  assertSupportedRouteMethodBoundary(
    result.methods,
    ["GET", "HEAD", "OPTIONS", "POST"],
    "chat auth",
  );
  assertNoProtectedPersistenceChanges(result, "chat auth", [
    "https://rpc.playlore.xyz/",
    "https://linea-sepolia.drpc.org/",
    "https://rpc.sepolia.linea.build/",
  ]);
  assertLogsRedacted(result, "chat auth", ["hostile.invalid.value", "route-matrix-chat-secret"]);
}

function validateChatMessages(result: WorkerResult) {
  assert.equal(result.scenario, "chat-messages");
  assertErrorResponse(
    result.unsupportedType,
    415,
    "Message payload must be JSON",
    "chat messages unsupported type",
    true,
  );
  assertErrorResponse(result.malformed, 400, "Invalid message payload", "chat messages malformed", true);
  assertErrorResponse(result.oversized, 413, "Message payload too large", "chat messages oversized", true);
  assertErrorResponse(result.textTooLong, 400, "Message text is too long", "chat messages text limit", true);
  assertErrorResponse(result.senderNameTooLong, 400, "Sender name is too long", "chat messages sender-name limit", true);
  assertErrorResponse(result.unauthenticated, 401, "Chat auth required", "chat messages unauthenticated", true);
  assert.deepEqual(result.afterRejected, result.before, "chat messages rejected writes must not persist protected state");

  const readEmpty = asSnapshot(result.readEmpty, "chat messages read");
  assertJsonStatus(readEmpty, 200, "chat messages read");
  assertNoStore(readEmpty, "chat messages read");
  assertNoCors(readEmpty, "chat messages read");
  assert.deepEqual(readEmpty.json, { messages: [] });
  assertNoIssuedSessionCookie(readEmpty, "chat messages read");

  const mixedCaseSender = asSnapshot(result.mixedCaseSender, "chat messages canonical sender");
  assertJsonStatus(mixedCaseSender, 200, "chat messages canonical sender");
  assertNoStore(mixedCaseSender, "chat messages canonical sender", true);
  assertNoCors(mixedCaseSender, "chat messages canonical sender");
  assertNoIssuedSessionCookie(mixedCaseSender, "chat messages canonical sender");
  const acceptedPayload = asRecord(mixedCaseSender.json, "chat messages canonical sender payload");
  const acceptedMessage = asRecord(acceptedPayload.message, "chat messages canonical sender message");
  assert.equal(acceptedPayload.ok, true);
  assert.equal(acceptedMessage.sender, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  assert.equal(acceptedMessage.text, "canonical sender");

  assertSupportedRouteMethodBoundary(
    result.methods,
    ["GET", "HEAD", "OPTIONS", "POST"],
    "chat messages",
  );
  assert.deepEqual(result.after, {
    adminSessions: 0,
    authProofLocks: 0,
    chatMessages: 1,
    chatProfiles: 0,
  }, "chat messages canonical sender must persist exactly one normalized row");
  assertLogsRedacted(result, "chat messages", ["hostile.invalid.value", "must not persist"]);
}

function validateChatProfile(result: WorkerResult) {
  assert.equal(result.scenario, "chat-profile");
  assertErrorResponse(
    result.unsupportedType,
    415,
    "Profile payload must be JSON",
    "chat profile unsupported type",
    true,
  );
  assertErrorResponse(result.malformed, 400, "Invalid profile payload", "chat profile malformed", true);
  assertErrorResponse(result.oversized, 413, "Profile payload too large", "chat profile oversized", true);
  assertErrorResponse(result.nameTooLong, 400, "Profile name is too long", "chat profile name limit", true);
  assertErrorResponse(result.unauthenticated, 401, "Chat auth required", "chat profile unauthenticated", true);
  assertErrorResponse(
    result.getMissing,
    400,
    "walletAddress or walletAddresses is required",
    "chat profile missing query",
  );

  const getValid = asSnapshot(result.getValid, "chat profile valid read");
  assertJsonStatus(getValid, 200, "chat profile valid read");
  assertNoStore(getValid, "chat profile valid read");
  assertNoCors(getValid, "chat profile valid read");
  assert.deepEqual(getValid.json, { profile: null });
  assertNoIssuedSessionCookie(getValid, "chat profile valid read");

  assertSupportedRouteMethodBoundary(
    result.methods,
    ["GET", "HEAD", "OPTIONS", "PUT"],
    "chat profile",
  );
  assertNoProtectedPersistenceChanges(result, "chat profile");
  assertLogsRedacted(result, "chat profile", ["hostile.invalid.value", "must-not-persist"]);
}

function validateRewards(result: WorkerResult) {
  assert.equal(result.scenario, "rewards");
  assertErrorResponse(result.unsupportedType, 415, "Rewards payload must be JSON", "rewards unsupported type");
  assertErrorResponse(result.malformed, 400, "Invalid rewards payload", "rewards malformed");
  assertErrorResponse(result.oversized, 413, "Rewards payload too large", "rewards oversized");
  assertErrorResponse(result.invalidUser, 400, "Missing or invalid user", "rewards invalid user");
  assertErrorResponse(result.invalidEpochs, 400, "Invalid epochs", "rewards invalid epochs");

  const validEmpty = asSnapshot(result.validEmpty, "rewards valid empty request");
  assertJsonStatus(validEmpty, 200, "rewards valid empty request");
  assertNoStore(validEmpty, "rewards valid empty request");
  assertNoCors(validEmpty, "rewards valid empty request");
  assert.deepEqual(validEmpty.json, { rewards: {} });
  assertNoIssuedSessionCookie(validEmpty, "rewards valid empty request");

  assertSupportedRouteMethodBoundary(result.methods, ["OPTIONS", "POST"], "rewards");
  assertNoProtectedPersistenceChanges(result, "rewards", [
    "https://rpc.playlore.xyz/",
    "https://linea-sepolia.drpc.org/",
    "https://rpc.sepolia.linea.build/",
  ]);
  assertLogsRedacted(result, "rewards", ["route-matrix-proxy-secret"]);
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

export async function runBoundedJsonRouteMatrixTests() {
  const tempRoot = mkdtempSync(join(tmpdir(), "lore-api-route-matrix-"));
  try {
    validateChatAuth(runWorker(tempRoot, "chat-auth"));
    validateChatMessages(runWorker(tempRoot, "chat-messages"));
    validateChatProfile(runWorker(tempRoot, "chat-profile"));
    validateRewards(runWorker(tempRoot, "rewards"));
    const healthSuccess = runWorker(tempRoot, "health-success");
    validateHealthSuccess(healthSuccess, tempRoot);
    assertHealthSuccessMutantsRejected(healthSuccess, tempRoot);
    validateHealthFailure(runWorker(tempRoot, "health-failure"));
    validateHealthFinality(runWorker(tempRoot, "health-finality"));
    assertHealthFinalityRawLagMutantRejected(tempRoot);
  } finally {
    assertSafeTemporaryRoot(tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function runApiRouteMatrixTests() {
  const tempRoot = mkdtempSync(join(tmpdir(), "lore-api-route-matrix-"));
  try {
    validateOg(runWorker(tempRoot, "og"));
    validateJackpots(runWorker(tempRoot, "jackpots"));
    validateDeposits(runWorker(tempRoot, "deposits"));
    validateDepositsPersistence(runWorker(tempRoot, "deposits-persistence"));
    validateDepositsRewardsFallback(runWorker(tempRoot, "deposits-rewards-fallback"));
    proveDepositsRecoveryGlobalBound(tempRoot);
    validateRecoveryStorageAllowlist(runWorker(tempRoot, "recovery-storage-allowlist"));
    assertRecoveryStorageAllowlistMutantRejected(tempRoot);
    const healthSuccess = runWorker(tempRoot, "health-success");
    validateHealthSuccess(healthSuccess, tempRoot);
    assertHealthSuccessMutantsRejected(healthSuccess, tempRoot);
    validateHealthFailure(runWorker(tempRoot, "health-failure"));
    validateHealthFinality(runWorker(tempRoot, "health-finality"));
    assertHealthFinalityRawLagMutantRejected(tempRoot);
    validateAdminAuth(runWorker(tempRoot, "admin-auth"));
    validateChatAuth(runWorker(tempRoot, "chat-auth"));
    validateChatMessages(runWorker(tempRoot, "chat-messages"));
    validateChatProfile(runWorker(tempRoot, "chat-profile"));
    validateRewards(runWorker(tempRoot, "rewards"));
    await validateTwoProcessSharedLimiter(tempRoot);
    console.log(
      "API route matrix tests passed: 9 routes, deposits persistence/recovery storage behavior, " +
      "85 black-box route requests (41 supported mutating/auth boundaries), 5 fault mutants, " +
      "real Next method dispatch, 2-process shared limiter",
    );
  } finally {
    assertSafeTemporaryRoot(tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === directEntry) {
  runApiRouteMatrixTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
