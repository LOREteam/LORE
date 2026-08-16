import assert from "node:assert/strict";
import * as publicReadModelPolicyModule from "../app/api/_lib/publicReadModelPolicy.ts";

const policy = publicReadModelPolicyModule.default ?? publicReadModelPolicyModule;
const {
  RECENT_WINS_RECOVERY_POLICY,
  buildPublicReadModelFailure,
  buildPublicRewardClaimStorageIdentity,
  collectPublicLeaderboardWinningTiles,
  comparePublicBigIntDesc,
  computePublicLeaderboardRoiBasisPoints,
  createPublicReadModelJsonResponse,
  formatPublicLeaderboardRoiPercent,
  formatPublicRecentClaimAmount,
  isFreshPublicReadModelSnapshot,
  mergePublicRewardClaims,
  normalizePublicReadModelAddress,
  normalizePublicTransactionHash,
  parsePublicReadModelTileId,
  parsePublicRewardsEpochs,
  sanitizePublicLeaderboardName,
  selectPublicLeaderboardWinningTile,
  sortPublicRewardClaimsDesc,
  toPublicLeaderboardRoiValueNum,
  toPublicWeiDisplayNumber,
} = policy;

const CHECKSUM_ADDRESS = "0x00000000000000000000000000000000000000aA";
const NORMALIZED_ADDRESS = CHECKSUM_ADDRESS.toLowerCase();
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;

function assertEpochPolicy(candidate) {
  assert.deepEqual(candidate(undefined), { ok: true, epochs: [] });
  assert.deepEqual(candidate([3, "2", 3, 1]), { ok: true, epochs: [3, 2, 1] });
  assert.deepEqual(candidate(Array.from({ length: 400 }, (_, index) => index + 1)), {
    ok: true,
    epochs: Array.from({ length: 400 }, (_, index) => index + 1),
  });
  assert.deepEqual(candidate(Array.from({ length: 401 }, (_, index) => index + 1)), {
    ok: false,
    error: "Too many epochs",
  });
  for (const value of [0, -1, 1.5, "01", "1e3", "1000001", Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(candidate([value]), { ok: false, error: "Invalid epochs" });
  }
}

function assertSnapshotFreshnessPolicy(candidate) {
  assert.equal(candidate(1_000, 100, 1_100), true);
  assert.equal(candidate(1_000, 100, 1_101), false);
  assert.equal(candidate(1_101, 100, 1_100), false);
  for (const [savedAt, maxAgeMs, now] of [
    [-1, 100, 1_100],
    [1_000.5, 100, 1_100],
    [1_000, 0, 1_100],
    [1_000, Number.NaN, 1_100],
    [1_000, 100, Number.NaN],
  ]) {
    assert.equal(candidate(savedAt, maxAgeMs, now), false);
  }
}

function assertAddressPolicy(candidate) {
  assert.equal(candidate(CHECKSUM_ADDRESS), NORMALIZED_ADDRESS);
  assert.equal(candidate(` ${CHECKSUM_ADDRESS} `), null);
  for (const value of ["", "0x1234", `${CHECKSUM_ADDRESS}00`, "secret@example.com"]) {
    assert.equal(candidate(value), null);
  }
}

function assertHashPolicy(candidate) {
  assert.equal(candidate(` ${HASH_A.toUpperCase().replace("0X", "0x")} `), HASH_A);
  for (const value of [null, undefined, "", "0x1234", `0x${"g".repeat(64)}`, `${HASH_A}00`]) {
    assert.equal(candidate(value), null);
  }
}

function assertTilePolicy(candidate) {
  for (const value of [1, 25, 1n, 25n]) assert.equal(candidate(value), Number(value));
  for (const value of [null, undefined, 0, 26, 1.5, Number.NaN, 0n, 26n]) {
    assert.equal(candidate(value), null);
  }
}

function assertLeaderboardTileBinding(selectTile, collectTiles) {
  const epochs = [
    { winningTile: 1 },
    { winningTile: 25 },
    { winningTile: 25 },
    { winningTile: 0 },
    { winningTile: 26 },
    { winningTile: 1.5 },
    { winningTile: "2" },
    {},
  ];
  assert.equal(selectTile({ winningTile: 1 }), 1);
  assert.equal(selectTile({ winningTile: 25 }), 25);
  assert.equal(selectTile({ winningTile: 26 }), null);
  assert.equal(selectTile({ winningTile: "2" }), null);
  const result = collectTiles(epochs);
  assert.equal(result.resolvedCount, 3);
  assert.deepEqual([...result.counts.entries()], [[1, 1], [25, 2]]);
  for (const row of epochs) {
    const selected = selectTile(row);
    if (selected !== null) assert.ok(result.counts.has(selected));
  }
}

function assertRoiPolicy(compute, format, toValueNum) {
  assert.equal(compute(5n, 2n), 25_000n);
  assert.equal(compute(0n, 2n), 0n);
  assert.equal(compute(1n, 0n), 0n);
  assert.equal(format(25_000n), "250.0%");
  assert.equal(format(10_005n), "100.1%");
  assert.equal(format(-1n), "0.0%");
  assert.equal(toValueNum(25_000n), 250);
  assert.equal(toValueNum(-1n), 0);
  assert.equal(
    toValueNum(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    Number.MAX_SAFE_INTEGER / 100,
  );
}

function assertClaimPolicy({ identity, sort, merge }) {
  const existing = [
    { blockNumber: "9", epoch: "2", txHash: HASH_A, user: NORMALIZED_ADDRESS, reward: "1" },
    { blockNumber: "10", epoch: "1", txHash: null, user: NORMALIZED_ADDRESS, reward: "2" },
  ];
  const replacement = { ...existing[0], reward: "3" };
  const incoming = [replacement, {
    blockNumber: "10",
    epoch: "2",
    txHash: HASH_B,
    user: NORMALIZED_ADDRESS,
    reward: "4",
  }];
  assert.equal(identity(existing[0]), `${HASH_A}_${NORMALIZED_ADDRESS}_2`);
  assert.equal(identity(existing[1]), `nohash_10_${NORMALIZED_ADDRESS}_1`);
  assert.equal(
    identity({ ...existing[1], blockNumber: "not-a-block" }),
    `nohash_0_${NORMALIZED_ADDRESS}_1`,
  );
  assert.deepEqual(sort([...existing, incoming[1]]).map((row) => row.reward), ["4", "2", "1"]);
  assert.deepEqual(merge(existing, incoming, 2).map((row) => row.reward), ["4", "2"]);
  assert.deepEqual(merge(existing, incoming, 0), []);
}

function assertResponsePolicy(createResponse, buildFailure, sanitizeName) {
  const response = createResponse({ wins: [] }, 503);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(buildFailure({ wins: [] }, new Error("rpc key=https://secret.invalid")), {
    wins: [],
    error: "fetch failed",
  });
  assert.equal(sanitizeName("  Alice\r\nBob  "), "Alice Bob");
  assert.equal(sanitizeName("x".repeat(30)), "x".repeat(20));
  assert.equal(sanitizeName("\u0000\r\n\t"), null);
  assert.equal(sanitizeName({ toString: () => "raw secret" }), null);
}

export function runPublicApiReadModelTests() {
  assert.deepEqual(RECENT_WINS_RECOVERY_POLICY, {
    logScanChunk: 10_000n,
    logScanMinChunk: 2_000n,
    maxBlocks: 100_000n,
    maxRpcCalls: 12,
    maxLogs: 250,
    maxTimeMs: 5_000,
  });
  assert.equal(Object.isFrozen(RECENT_WINS_RECOVERY_POLICY), true);

  assertEpochPolicy(parsePublicRewardsEpochs);
  assertSnapshotFreshnessPolicy(isFreshPublicReadModelSnapshot);
  assertAddressPolicy(normalizePublicReadModelAddress);
  assertHashPolicy(normalizePublicTransactionHash);
  assertTilePolicy(parsePublicReadModelTileId);
  assertLeaderboardTileBinding(
    selectPublicLeaderboardWinningTile,
    collectPublicLeaderboardWinningTiles,
  );
  assert.equal(comparePublicBigIntDesc(2n, 1n), -1);
  assert.equal(comparePublicBigIntDesc(1n, 2n), 1);
  assert.equal(comparePublicBigIntDesc(2n, 2n), 0);
  assert.equal(toPublicWeiDisplayNumber(1_234_567_890_123_456_789n), 1.234568);
  assert.equal(toPublicWeiDisplayNumber(10n ** 40n), Number.MAX_SAFE_INTEGER);
  assert.equal(formatPublicRecentClaimAmount("1.235"), "1.24");
  assert.equal(formatPublicRecentClaimAmount("not-an-amount"), "0.00");
  assertRoiPolicy(
    computePublicLeaderboardRoiBasisPoints,
    formatPublicLeaderboardRoiPercent,
    toPublicLeaderboardRoiValueNum,
  );
  assertClaimPolicy({
    identity: buildPublicRewardClaimStorageIdentity,
    sort: sortPublicRewardClaimsDesc,
    merge: mergePublicRewardClaims,
  });
  assertResponsePolicy(
    createPublicReadModelJsonResponse,
    buildPublicReadModelFailure,
    sanitizePublicLeaderboardName,
  );

  assert.throws(
    () => assertEpochPolicy((raw) => {
      const values = Array.isArray(raw) ? raw.slice(0, 400) : [];
      return { ok: true, epochs: values.map(Number) };
    }),
    /Too many epochs|Invalid epochs|Expected values to be strictly deep-equal/,
    "silent truncation and broad Number coercion epoch mutants must be killed",
  );
  assert.throws(
    () => assertSnapshotFreshnessPolicy((savedAt, maxAgeMs, now) => now - savedAt <= maxAgeMs),
    /false/,
    "future and malformed snapshot timestamp mutant must be killed",
  );
  assert.throws(
    () => assertAddressPolicy((value) => value.toLowerCase()),
    /Expected values to be strictly equal/,
    "unchecked public address mutant must be killed",
  );
  assert.throws(
    () => assertHashPolicy((value) => typeof value === "string" ? value.trim().toLowerCase() : null),
    /Expected values to be strictly equal/,
    "unchecked transaction hash mutant must be killed",
  );
  assert.throws(
    () => assertTilePolicy((value) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }),
    /Expected values to be strictly equal/,
    "missing tile upper-bound mutant must be killed",
  );
  assert.throws(
    () => assertLeaderboardTileBinding(
      (row) => typeof row?.winningTile === "number" && row.winningTile > 0
        ? row.winningTile
        : null,
      (rows) => {
        const counts = new Map();
        let resolvedCount = 0;
        for (const row of rows) {
          const tile = typeof row?.winningTile === "number" && row.winningTile > 0
            ? row.winningTile
            : null;
          if (tile === null) continue;
          counts.set(tile, (counts.get(tile) ?? 0) + 1);
          resolvedCount += 1;
        }
        return { counts, resolvedCount };
      },
    ),
    /Expected values to be strictly equal|Expected values to be strictly deep-equal/,
    "leaderboard route binding mutant without the canonical tile selector must be killed",
  );
  assert.throws(
    () => assertRoiPolicy(
      (won, wagered) => BigInt(Math.round((Number(won) / Number(wagered)) * 10_000)),
      formatPublicLeaderboardRoiPercent,
      toPublicLeaderboardRoiValueNum,
    ),
    /Expected values to be strictly equal|cannot be converted to a BigInt/,
    "floating-point ROI mutant must be killed",
  );
  assert.throws(
    () => assertClaimPolicy({
      identity: (row) => `${row.txHash ?? "nohash"}_${row.user}_${row.epoch}`,
      sort: sortPublicRewardClaimsDesc,
      merge: (existing, incoming, limit) => [...existing, ...incoming].slice(0, limit),
    }),
    /Expected values to be strictly equal/,
    "raw-hash and non-deduplicating claim merge mutants must be killed",
  );
  assert.throws(
    () => assertResponsePolicy(
      (payload, status) => new Response(JSON.stringify(payload), { status }),
      (emptyPayload, error) => ({ ...emptyPayload, error: String(error) }),
      (value) => typeof value === "string" ? value.trim() : null,
    ),
    /cache-control|Expected values to be strictly equal|Expected values to be strictly deep-equal/,
    "cacheable, raw-error, and unsanitized-name response mutant must be killed",
  );
}

if (process.argv[1]?.endsWith("test-business-public-api-read-models.mjs")) {
  runPublicApiReadModelTests();
  console.log("Public API read-model behavior tests passed.");
}
