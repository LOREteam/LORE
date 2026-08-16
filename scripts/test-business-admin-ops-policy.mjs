import assert from "node:assert/strict";
import * as adminOpsPolicyModule from "../app/api/admin/ops/runtimePolicy.ts";

const adminOpsPolicy = adminOpsPolicyModule.default ?? adminOpsPolicyModule;

export function runAdminOpsPolicyTests() {
  const {
    extractOpsLogTimestamp,
    parseAdminSafeDecimalInteger,
    parseLiveIndexerProgress,
    parseOpsLogTimestampMs,
    parseStoredEpochNumber,
  } = adminOpsPolicy;

  assert.equal(parseAdminSafeDecimalInteger("1"), 1);
  assert.equal(parseAdminSafeDecimalInteger("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseAdminSafeDecimalInteger("0", { allowZero: true }), 0);
  assert.equal(parseAdminSafeDecimalInteger("0"), null);
  for (const value of [
    null,
    undefined,
    "",
    "00",
    "01",
    "-1",
    "+1",
    "1.0",
    "1e3",
    " 1",
    "1 ",
    "9007199254740992",
    "10000000000000000",
  ]) {
    assert.equal(parseAdminSafeDecimalInteger(value), null, `unsafe admin integer must be rejected: ${String(value)}`);
  }
  assert.equal(Number("01"), 1, "leading-zero fixture must survive a broad Number-coercion mutant");
  assert.equal(Number("1e3"), 1_000, "scientific-notation fixture must survive a broad Number-coercion mutant");
  assert.equal(parseStoredEpochNumber("42"), 42);
  assert.equal(parseStoredEpochNumber("01"), 0);
  assert.equal(parseStoredEpochNumber("9007199254740992"), 0);

  assert.equal(
    extractOpsLogTimestamp("2026-08-14T11:22:33.456Z [ERROR] failed"),
    "2026-08-14T11:22:33.456Z",
  );
  assert.equal(extractOpsLogTimestamp("2026-08-14T11:22:33Z [INFO] ready"), "2026-08-14T11:22:33Z");
  assert.equal(extractOpsLogTimestamp("prefix 2026-08-14T11:22:33.456Z"), null);
  const canonicalTimestampMs = Date.parse("2026-08-14T11:22:33.456Z");
  assert.equal(parseOpsLogTimestampMs("2026-08-14T11:22:33.456Z"), canonicalTimestampMs);
  assert.equal(parseOpsLogTimestampMs("2026-08-14T11:22:33Z"), Date.parse("2026-08-14T11:22:33.000Z"));
  for (const value of [
    null,
    "",
    "2026-02-30T11:22:33.456Z",
    "2026-08-14T11:22:33.45Z",
    "2026-08-14T11:22:33.4567Z",
    "2026-08-14T11:22:33.456+00:00",
    " 2026-08-14T11:22:33.456Z",
  ]) {
    assert.equal(
      parseOpsLogTimestampMs(value),
      Number.NEGATIVE_INFINITY,
      `noncanonical admin log timestamp must sort last: ${String(value)}`,
    );
  }
  assert.equal(
    Date.parse("2026-08-14T11:22:33.456+00:00"),
    canonicalTimestampMs,
    "offset timestamp fixture must survive a broad Date.parse mutant",
  );

  const progress = parseLiveIndexerProgress([
    "[indexer] Scanning blocks 100 -> 199 (100 blocks)",
    "[indexer] Chunk 2/4: 125 -> 149",
    "[indexer] Chunk 2/4 fetched 0 logs",
    "[indexer] Chunk 2/4 parsed: 3 bets, 4 epochs, 5 jackpots, 6 claims",
    "[indexer] Chunk 2/4 written to local SQLite",
  ]);
  assert.deepEqual(progress, {
    scanFromBlock: "100",
    scanToBlock: "199",
    scanBlockCount: 100,
    chunkIndex: 2,
    chunkTotal: 4,
    chunkFromBlock: "125",
    chunkToBlock: "149",
    fetchedLogs: 0,
    parsedBets: 3,
    parsedEpochs: 4,
    parsedJackpots: 5,
    parsedClaims: 6,
    wroteChunk: true,
    progressPct: 50,
  });
  assert.equal(parseLiveIndexerProgress(["unrelated log line"]), null);

  const unsafeCounters = parseLiveIndexerProgress([
    "[indexer] Scanning blocks 1 -> 2 (9007199254740992 blocks)",
    "[indexer] Chunk 9007199254740992/4: 1 -> 2",
    "[indexer] Chunk 1/4 fetched 9007199254740992 logs",
    "[indexer] Chunk 1/4 parsed: 9007199254740992 bets, 01 epochs, 0 jackpots, 6 claims",
  ]);
  assert.deepEqual(unsafeCounters, {
    scanFromBlock: "1",
    scanToBlock: "2",
    scanBlockCount: null,
    chunkIndex: null,
    chunkTotal: 4,
    chunkFromBlock: "1",
    chunkToBlock: "2",
    fetchedLogs: null,
    parsedBets: null,
    parsedEpochs: null,
    parsedJackpots: 0,
    parsedClaims: 6,
    wroteChunk: false,
    progressPct: null,
  });
  assert.equal(Number("9007199254740992"), 9_007_199_254_740_992, "unsafe counter fixture must reach a Number mutant");

  const resetProgress = parseLiveIndexerProgress([
    "[indexer] Scanning blocks 1 -> 10 (10 blocks)",
    "[indexer] Chunk 1/2: 1 -> 5",
    "[indexer] Chunk 1/2 parsed: 1 bets, 1 epochs, 1 jackpots, 1 claims",
    "[indexer] Chunk 1/2 written to local SQLite",
    "[indexer] Scanning blocks 11 -> 20 (10 blocks)",
  ]);
  assert.deepEqual(resetProgress, {
    scanFromBlock: "11",
    scanToBlock: "20",
    scanBlockCount: 10,
    chunkIndex: null,
    chunkTotal: null,
    chunkFromBlock: null,
    chunkToBlock: null,
    fetchedLogs: null,
    parsedBets: null,
    parsedEpochs: null,
    parsedJackpots: null,
    parsedClaims: null,
    wroteChunk: false,
    progressPct: null,
  });
}
