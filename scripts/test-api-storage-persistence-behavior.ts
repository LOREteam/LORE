import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-api-storage-persistence-"));
const activeDbPath = join(testDir, "lore-v9.sqlite");
const staleDbPath = join(testDir, "lore-v8.sqlite");
const unrelatedPath = join(testDir, "keep.txt");

for (const path of [staleDbPath, `${staleDbPath}-wal`, `${staleDbPath}-shm`]) {
  writeFileSync(path, "stale-test-artifact");
}
writeFileSync(unrelatedPath, "preserve-me");

Object.assign(process.env, {
  LINEA_NETWORK: "sepolia",
  NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
  KEEPER_RPC_URL: "https://rpc.persistence-test.invalid",
  LORE_ALLOW_CONTRACT_SCOPE_PURGE: "1",
  LORE_DB_PATH: activeDbPath,
});

const USER = "0x1111111111111111111111111111111111111111";
const BULK_USER = "0x2222222222222222222222222222222222222222";
const FULL_HASH = `0x${"ab".repeat(32)}`;

type BetIdentity = { id: string; legacyId: string } | null;
type IdentityBuilder = (
  epoch: string,
  txHash: string,
  blockNumber: string,
  logIndex?: unknown,
) => BetIdentity;
type EpochRow = { epoch: string; label: string };
type EpochFilter = (rows: EpochRow[], currentEpoch: number | null) => EpochRow[];
type BridgeReadResult = {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
};

function makeBet(
  epoch: string,
  blockNumber: string,
  txHash = FULL_HASH,
) {
  return {
    epoch,
    user: USER,
    tileIds: [1],
    amounts: ["1"],
    totalAmount: "1",
    totalAmountNum: 1,
    txHash,
    blockNumber,
  };
}

function assertIdentityPolicy(candidate: IdentityBuilder) {
  const canonical = candidate("7", FULL_HASH.toUpperCase(), "101");
  assert.deepEqual(canonical, {
    id: `7_${FULL_HASH}`,
    legacyId: `7_${FULL_HASH}`,
  }, "full transaction hashes must normalize into stable storage identity");

  const malformed = candidate("7", "0xabc", "101");
  assert.deepEqual(malformed, {
    id: "7_nohash_101",
    legacyId: "7_nohash_101",
  }, "malformed transaction hashes must use block-scoped fallback identity");
  assert.doesNotMatch(
    malformed?.id ?? "",
    /0xabc/,
    "malformed transaction hashes must never become transaction identity",
  );
}

function assertEpochFilterPolicy(candidate: EpochFilter) {
  const rows: EpochRow[] = [
    { epoch: "1", label: "one" },
    { epoch: "7", label: "seven" },
    { epoch: "01", label: "leading-zero" },
    { epoch: "+1", label: "signed" },
    { epoch: "1e0", label: "exponent" },
    { epoch: "7.0", label: "fraction" },
    { epoch: "9007199254740992", label: "unsafe" },
  ];
  assert.deepEqual(
    candidate(rows, 7).map((row) => row.label),
    ["one", "seven"],
    "epoch filtering must accept only canonical safe decimal evidence",
  );
}

async function assertBoundedReadPolicy(
  candidate: (limit: number) => Promise<BridgeReadResult>,
) {
  const result = await candidate(2);
  assert.equal(result.ok, true, "bounded bridge reads must succeed from local storage");
  assert.equal(result.status, 200);
  assert.equal(
    Object.keys(result.data ?? {}).length,
    2,
    "the bridge must forward its requested storage row bound",
  );
}

async function assertPatchAllowlistPolicy(
  candidate: (path: string, payload: Record<string, unknown>) => Promise<boolean>,
) {
  assert.equal(
    await candidate("gamedata/currentEpoch", {}),
    false,
    "metadata writes must fail closed at the API bridge",
  );
  assert.equal(
    await candidate(`gamedata/bets/${USER.toUpperCase()}`, {}),
    false,
    "wallet-scoped recovery writes must require canonical lowercase paths",
  );
  assert.equal(
    await candidate(`gamedata/bets/${USER}`, {}),
    true,
    "canonical wallet-scoped recovery writes must remain available",
  );
}

function assertRedactionPolicy(candidate: (message: string) => string) {
  const output = candidate(
    "Authorization: Bearer storage-secret-token https://storage-user:storage-pass@rpc.invalid/private",
  );
  assert.doesNotMatch(output, /storage-secret-token|storage-user|storage-pass|rpc\.invalid/);
  assert.match(output, /<redacted>/, "storage diagnostics must retain an explicit redaction marker");
}

async function main() {
  const originalFetch = globalThis.fetch;
  let fakeRpcCalls = 0;
  const networkCalls = 0;
  globalThis.fetch = (async () => {
    fakeRpcCalls += 1;
    throw new Error("hermetic fake RPC rejected a transport-ranking probe");
  }) as typeof fetch;

  let closeDb: (() => void) | null = null;
  try {
    const storage = await import("../server/storage");
    const dataBridge = await import("../app/api/_lib/dataBridge");
    const sentrySanitize = await import("../app/lib/sentrySanitize");
    const { db } = await import("../server/db");
    closeDb = () => (db as unknown as { close(): void }).close();

    assert.equal(existsSync(activeDbPath), true, "active SQLite database must survive scoped cleanup");
    assert.equal(existsSync(`${activeDbPath}-wal`), true, "active SQLite WAL must survive scoped cleanup");
    assert.equal(existsSync(`${activeDbPath}-shm`), true, "active SQLite SHM must survive scoped cleanup");
    assert.equal(existsSync(staleDbPath), false, "stale versioned SQLite database must be removed");
    assert.equal(existsSync(`${staleDbPath}-wal`), false, "stale versioned WAL must be removed");
    assert.equal(existsSync(`${staleDbPath}-shm`), false, "stale versioned SHM must be removed");
    assert.equal(existsSync(unrelatedPath), true, "unrelated files must remain outside scoped cleanup");

    assertIdentityPolicy(storage.buildIndexerBetIdentity);
    assert.throws(
      () => assertIdentityPolicy((epoch, txHash, blockNumber) => {
        const normalizedHash = txHash.toLowerCase().trim();
        const legacyId = /^0x[0-9a-f]+$/.test(normalizedHash)
          ? `${epoch}_${normalizedHash}`
          : `${epoch}_nohash_${blockNumber}`;
        return { id: legacyId, legacyId };
      }),
      /malformed transaction hashes/,
      "a short-hash identity mutant must be killed",
    );

    storage.upsertBets([
      makeBet("9", "109", `0x${"09".repeat(32)}`),
      makeBet("8", "108", `0x${"08".repeat(32)}`),
      makeBet("7", "107", `0x${"07".repeat(32)}`),
      makeBet("0", "110", `0x${"10".repeat(32)}`),
      makeBet("-1", "111", `0x${"11".repeat(32)}`),
      makeBet("1e3", "112", `0x${"12".repeat(32)}`),
      makeBet("1.5", "113", `0x${"13".repeat(32)}`),
      makeBet("9007199254740992", "114", `0x${"14".repeat(32)}`),
      makeBet("15", "0", `0x${"15".repeat(32)}`),
      makeBet("16", "1e3", `0x${"16".repeat(32)}`),
      makeBet("17", "9007199254740992", `0x${"17".repeat(32)}`),
    ]);

    const currentScope = storage.getCurrentStorageScope();
    const persistedRows = db.prepare(`
      SELECT epoch, block_number AS blockNumber
      FROM scoped_bets
      WHERE scope = ? AND user = ?
      ORDER BY epoch DESC
    `).all(currentScope, USER) as Array<{ epoch: number; blockNumber: number }>;
    assert.deepEqual(
      persistedRows.map((row) => ({ ...row })),
      [
        { epoch: 9, blockNumber: 109 },
        { epoch: 8, blockNumber: 108 },
        { epoch: 7, blockNumber: 107 },
      ],
      "only safe positive epoch and block strings may cross the SQL write boundary",
    );

    assert.deepEqual(storage.getUserParticipatingEpochPage(USER, { limit: 2 }), {
      epochs: [9, 8],
      hasMore: true,
      nextCursor: 8,
    });
    assert.deepEqual(storage.getUserParticipatingEpochPage(USER, { beforeEpoch: 8, limit: 2 }), {
      epochs: [7],
      hasMore: false,
      nextCursor: null,
    });

    const insertRawBet = db.prepare(`
      INSERT INTO scoped_bets(
        scope, id, user, epoch, tile_ids_json, amounts_json,
        total_amount, total_amount_num, tx_hash, block_number
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertRawBet.run(
      "sepolia:0xffffffffffffffffffffffffffffffffffffffff",
      "foreign-scope-row",
      USER,
      999,
      "[1]",
      "[\"1\"]",
      "1",
      1,
      `0x${"ff".repeat(32)}`,
      999,
    );
    insertRawBet.run(
      currentScope,
      "malformed-stored-epoch",
      USER,
      7.5,
      "[1]",
      "[\"1\"]",
      "1",
      1,
      `0x${"75".repeat(32)}`,
      106,
    );
    assert.deepEqual(
      storage.getUserParticipatingEpochs(USER),
      [9, 8, 7],
      "participating-epoch reads must reject malformed DB values and foreign scopes",
    );

    const bulkInsert = db.prepare(`
      INSERT INTO scoped_bets(
        scope, id, user, epoch, tile_ids_json, amounts_json,
        total_amount, total_amount_num, tx_hash, block_number
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let epoch = 1; epoch <= 405; epoch += 1) {
        bulkInsert.run(
          currentScope,
          `bulk-${epoch}`,
          BULK_USER,
          epoch,
          "[1]",
          "[\"1\"]",
          "1",
          1,
          `0x${epoch.toString(16).padStart(64, "0")}`,
          epoch,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const cappedPage = storage.getUserParticipatingEpochPage(BULK_USER, { limit: 9_999 });
    assert.equal(cappedPage.epochs.length, 400, "SQL pagination must clamp oversized limits");
    assert.equal(cappedPage.epochs[0], 405);
    assert.equal(cappedPage.epochs.at(-1), 6);
    assert.equal(cappedPage.hasMore, true);
    assert.equal(cappedPage.nextCursor, 6);

    assert.equal(dataBridge.isSafePositiveInteger(1), true);
    assert.equal(dataBridge.isSafePositiveInteger(Number.MAX_SAFE_INTEGER), true);
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(dataBridge.isSafePositiveInteger(value), false);
    }
    assert.equal(dataBridge.parseCurrentEpoch("7"), 7);
    for (const value of ["01", "+1", "1e3", "1.0", "9007199254740992", 1n]) {
      assert.equal(dataBridge.parseCurrentEpoch(value), null);
    }

    assertEpochFilterPolicy(dataBridge.filterByCurrentEpoch);
    assert.throws(
      () => assertEpochFilterPolicy((rows, currentEpoch) => {
        if (!currentEpoch) return rows;
        return rows.filter((row) => Number(row.epoch) <= currentEpoch);
      }),
      /canonical safe decimal evidence/,
      "a broad Number coercion epoch mutant must be killed",
    );

    const bridgeRead = (limit: number) => dataBridge.fetchStorageJson<Record<string, unknown>>(
      `gamedata/bets/${USER}`,
      limit,
    );
    await assertBoundedReadPolicy(bridgeRead);
    await assert.rejects(
      () => assertBoundedReadPolicy(() => dataBridge.fetchStorageJson<Record<string, unknown>>(
        `gamedata/bets/${USER}`,
      )),
      /forward its requested storage row bound/,
      "an omitted storage-limit mutant must be killed",
    );

    const allowlistErrors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      allowlistErrors.push(args.map(String).join(" "));
    };
    try {
      await assertPatchAllowlistPolicy(dataBridge.patchStorage);
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(allowlistErrors.length, 2, "each rejected bridge write must emit a safe diagnostic");
    await assert.rejects(
      () => assertPatchAllowlistPolicy(async () => true),
      /fail closed/,
      "an allow-all storage patch mutant must be killed",
    );

    const secretMessage =
      "Authorization: Bearer storage-secret-token https://storage-user:storage-pass@rpc.invalid/private";
    const capturedStorageErrors: string[] = [];
    db.exec(`
      CREATE TRIGGER reject_test_bet
      BEFORE INSERT ON scoped_bets
      BEGIN
        SELECT RAISE(ABORT, '${secretMessage}');
      END;
    `);
    console.error = (...args: unknown[]) => {
      capturedStorageErrors.push(args.map(String).join(" "));
    };
    try {
      assert.throws(
        () => storage.upsertBets([makeBet("20", "120", `0x${"20".repeat(32)}`)]),
        /storage-secret-token/,
        "the injected SQLite failure must reach the storage transaction boundary",
      );
    } finally {
      console.error = originalConsoleError;
      db.exec("DROP TRIGGER reject_test_bet");
    }
    const storageErrorOutput = capturedStorageErrors.join("\n");
    assert.doesNotMatch(storageErrorOutput, /storage-secret-token|storage-user|storage-pass|rpc\.invalid/);
    assert.match(storageErrorOutput, /<redacted>/, "storage transaction logs must use shared redaction");

    assertRedactionPolicy((message) => {
      const sanitized = sentrySanitize.sanitizeSentryPayload({ message });
      return sanitized.message;
    });
    assert.throws(
      () => assertRedactionPolicy((message) => message),
      /storage-secret-token/,
      "a raw storage-error logging mutant must be killed",
    );

    assert.ok(fakeRpcCalls > 0, "viem transport ranking must be contained by the fake RPC");
    assert.equal(networkCalls, 0, "storage and bridge behavior probe must make no external calls");
    console.log(JSON.stringify({
      status: "pass",
      activeSqliteArtifactsPreserved: true,
      strictPersistence: true,
      scopedPagination: true,
      boundedBridgeRead: true,
      storageLogsRedacted: true,
      mutantsKilled: 5,
      fakeRpcCallsHandled: true,
      networkCalls,
    }));
  } finally {
    globalThis.fetch = originalFetch;
    closeDb?.();
    rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
