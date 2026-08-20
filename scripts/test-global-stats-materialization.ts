import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "lore-global-stats-materialization-"));
const TEST_DB_PATH = join(TEST_DIR, "global-stats.sqlite");
const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000001";
const EXPECTED_SCOPE = `sepolia:${CONTRACT_ADDRESS}`;

Object.assign(process.env, {
  LORE_DB_PATH: TEST_DB_PATH,
  LORE_ALLOW_CONTRACT_SCOPE_PURGE: "0",
  LINEA_NETWORK: "sepolia",
  NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
  NEXT_PUBLIC_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
});

type SqlStatement = {
  all: (...parameters: unknown[]) => unknown;
  get: (...parameters: unknown[]) => unknown;
  run: (...parameters: unknown[]) => unknown;
};

type SqlDatabase = {
  prepare: (sql: string) => SqlStatement;
  close: () => void;
};

type GlobalStats = {
  totalVolumeWei: string;
  totalBurnWei: string;
  resolvedEpochs: number;
  lastIndexedBlock: string;
};

function parseGlobalStatsAmountWei(value: unknown) {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(String(value ?? "").trim());
  if (match === null) return 0n;
  const [, whole, fraction = ""] = match;
  return BigInt(`${whole}${fraction.slice(0, 18).padEnd(18, "0")}`);
}

function makeHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function readRawAggregate(db: SqlDatabase, scope: string): GlobalStats {
  const bets = db.prepare(`
    SELECT total_amount
    FROM scoped_bets
    WHERE scope = ?
  `).all(scope) as Array<Record<string, unknown>>;
  const fees = db.prepare(`
    SELECT burn_amount
    FROM scoped_protocol_fee_flushes
    WHERE scope = ?
  `).all(scope) as Array<Record<string, unknown>>;
  const epochs = db.prepare(`
    SELECT COUNT(*) AS count
    FROM scoped_epochs
    WHERE scope = ?
  `).get(scope) as { count?: unknown } | undefined;
  const cursor = db.prepare("SELECT value FROM meta WHERE key = ?")
    .get(`${scope}:lastIndexedBlock`) as { value?: unknown } | undefined;

  return {
    totalVolumeWei: bets.reduce(
      (total, row) => total + parseGlobalStatsAmountWei(row.total_amount),
      0n,
    ).toString(),
    totalBurnWei: fees.reduce(
      (total, row) => total + parseGlobalStatsAmountWei(row.burn_amount),
      0n,
    ).toString(),
    resolvedEpochs: Number(epochs?.count ?? 0),
    lastIndexedBlock: cursor?.value === undefined ? "0" : BigInt(String(cursor.value)).toString(),
  };
}

function restartStorageAndReadAggregate() {
  const child = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      "-e",
      'import("./server/storage").then((module) => { const storage = module.default ?? module; process.stdout.write(JSON.stringify({ aggregate: storage.getGlobalStatsAggregate(), revision: storage.getPublicReadModelRevision() })); })',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LORE_DB_PATH: TEST_DB_PATH,
        LORE_ALLOW_CONTRACT_SCOPE_PURGE: "0",
        LINEA_NETWORK: "sepolia",
        NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
        NEXT_PUBLIC_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
      },
      encoding: "utf8",
    },
  );
  assert.equal(
    child.status,
    0,
    `storage restart for dirty aggregate recovery failed: ${child.error?.message ?? child.stderr}`,
  );
  const output = child.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  assert.ok(output, "storage restart must emit the rebuilt aggregate");
  return JSON.parse(output) as { aggregate: GlobalStats; revision: string };
}

async function main() {
  let databaseToClose: SqlDatabase | null = null;
  try {
    const { db: rawDb } = await import("../server/db");
    const db = rawDb as unknown as SqlDatabase;
    databaseToClose = db;
    // Seed normalized raw rows before storage loads: this exercises one-time backfill
    // for an old database with a prior aggregate model version.
    db.prepare(`
      INSERT INTO scoped_bets(
        scope, id, user, epoch, tile_ids_json, amounts_json,
        total_amount, total_amount_num, tx_hash, block_number
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      EXPECTED_SCOPE,
      "backfill-bet",
      "0x1111111111111111111111111111111111111111",
      1,
      "[1]",
      "[\"2.5\"]",
      "2.5",
      2.5,
      makeHash(1),
      1,
    );
    db.prepare(`
      INSERT INTO scoped_bets(
        scope, id, user, epoch, tile_ids_json, amounts_json,
        total_amount, total_amount_num, tx_hash, block_number
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      EXPECTED_SCOPE,
      "backfill-extra-dot",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      1,
      "[1]",
      "[\"1.2.3\"]",
      "1.2.3",
      0,
      makeHash(13),
      1,
    );
    db.prepare(`
      INSERT INTO scoped_protocol_fee_flushes(scope, id, owner_amount, burn_amount, tx_hash, block_number)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(EXPECTED_SCOPE, "backfill-fee", "0", "0.25", makeHash(2), 1);
    db.prepare(`
      INSERT INTO scoped_epochs(
        scope, epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus,
        is_daily_jackpot, is_weekly_jackpot, resolved_block
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(EXPECTED_SCOPE, 1, 1, "2.5", "2.25", "0.25", "0", 0, 0, 1);
    db.prepare("INSERT INTO meta(key, value) VALUES(?, ?)")
      .run(`${EXPECTED_SCOPE}:lastIndexedBlock`, "7");
    db.prepare(`
      INSERT INTO scoped_global_stats_aggregate(
        scope, model_version, total_volume_wei, total_burn_wei, epoch_count, last_indexed_block
      ) VALUES(?, ?, ?, ?, ?, ?)
    `).run(EXPECTED_SCOPE, 2, "1", "1", 99, "0");

    const storage = await import("../server/storage");
    const {
      acquireIndexerLease,
      commitIndexerChunk,
      getCurrentStorageScope,
      getGlobalStatsAggregate,
      getPublicReadModelRevision,
      releaseIndexerLease,
      rollbackIndexerToBlock,
      setMetaBigInt,
      setMetaNumber,
      upsertBets,
      upsertEpochMap,
      upsertProtocolFeeFlushes,
    } = storage;
    const scope = getCurrentStorageScope();
    assert.equal(scope, EXPECTED_SCOPE, "test must use the explicitly configured temporary scope");
    assert.equal(parseGlobalStatsAmountWei("1.2.3"), 0n, "extra decimal components must not be truncated");

    const assertParity = (label: string) => {
      assert.deepEqual(
        getGlobalStatsAggregate(),
        readRawAggregate(db, scope),
        `materialized global stats must equal the raw BigInt oracle after ${label}`,
      );
    };
    const assertDirtyRead = (label: string) => {
      assert.notEqual(
        db.prepare("SELECT 1 AS dirty FROM scoped_global_stats_dirty WHERE scope = ?")
          .get(scope),
        undefined,
        `source ${label} must set the scoped dirty marker`,
      );
      assert.throws(
        () => getGlobalStatsAggregate(),
        /source data is dirty/,
        `public read must fail closed after source ${label}`,
      );
      assert.throws(
        () => getPublicReadModelRevision(),
        /source data is dirty/,
        `public cache revision must fail closed after source ${label}`,
      );
    };
    const restartAndAssertRebuild = (
      label: string,
      expected: GlobalStats,
      revisionBeforeDirtyWrite: string,
    ) => {
      assert.deepEqual(readRawAggregate(db, scope), expected, `source total after ${label} must match its explicit expectation`);
      const restarted = restartStorageAndReadAggregate();
      assert.deepEqual(restarted.aggregate, expected, `startup must rebuild after source ${label}`);
      assert.ok(
        BigInt(restarted.revision) > BigInt(revisionBeforeDirtyWrite),
        `dirty recovery must advance the public read revision after source ${label}`,
      );
      assert.equal(
        db.prepare("SELECT 1 AS dirty FROM scoped_global_stats_dirty WHERE scope = ?")
          .get(scope),
        undefined,
        `startup rebuild must clear the scoped dirty marker after source ${label}`,
      );
      assert.deepEqual(getGlobalStatsAggregate(), expected, `parent read must observe rebuilt source ${label}`);
      assertParity(`startup rebuild after source ${label}`);
    };

    assertParity("startup backfill");
    assert.equal(
      db.prepare("SELECT 1 AS dirty FROM scoped_global_stats_dirty WHERE scope = ?")
        .get(scope),
      undefined,
      "startup migration rebuild must clear its source dirty marker",
    );
    assert.deepEqual(getGlobalStatsAggregate(), {
      totalVolumeWei: "2500000000000000000",
      totalBurnWei: "250000000000000000",
      resolvedEpochs: 1,
      lastIndexedBlock: "7",
    });

    upsertEpochMap({
      "2": {
        winningTile: 2,
        totalPool: "1",
        rewardPool: "0.9",
        fee: "0.1",
        jackpotBonus: "0",
        isDailyJackpot: false,
        isWeeklyJackpot: false,
        resolvedBlock: "10",
      },
    });
    const replayHash = makeHash(3);
    upsertBets([
      {
        epoch: "2",
        user: "0x2222222222222222222222222222222222222222",
        tileIds: [2],
        amounts: ["340282366920938463463.374607431768211455"],
        totalAmount: "340282366920938463463.374607431768211455",
        totalAmountNum: 1,
        txHash: replayHash,
        blockNumber: "11",
        logIndex: "0",
      },
      {
        epoch: "2",
        user: "0x3333333333333333333333333333333333333333",
        tileIds: [2],
        amounts: ["invalid"],
        totalAmount: "invalid",
        totalAmountNum: 0,
        txHash: makeHash(4),
        blockNumber: "12",
        logIndex: "0",
      },
    ]);
    upsertProtocolFeeFlushes([
      { id: "fee-replay", ownerAmount: "0", burnAmount: "0.1234567890123456789", txHash: makeHash(5), blockNumber: "12" },
    ]);
    assertParity("initial accepted mutations");
    assert.deepEqual(getGlobalStatsAggregate(), {
      totalVolumeWei: (
        2_500_000_000_000_000_000n +
        340_282_366_920_938_463_463_374_607_431_768_211_455n
      ).toString(),
      totalBurnWei: (250_000_000_000_000_000n + 123_456_789_012_345_678n).toString(),
      resolvedEpochs: 2,
      lastIndexedBlock: "7",
    }, "accepted deltas must preserve exact BigInt totals");

    const aggregateAfterEpochInsert = getGlobalStatsAggregate();
    upsertEpochMap({
      "2": {
        winningTile: 2,
        totalPool: "1",
        rewardPool: "0.9",
        fee: "0.1",
        jackpotBonus: "0",
        isDailyJackpot: false,
        isWeeklyJackpot: false,
        resolvedBlock: "10",
      },
    });
    upsertEpochMap({
      "2": {
        winningTile: 25,
        totalPool: "999",
        rewardPool: "999",
        fee: "0",
        jackpotBonus: "0",
        isDailyJackpot: false,
        isWeeklyJackpot: false,
        resolvedBlock: "9",
      },
    });
    assert.deepEqual(getGlobalStatsAggregate(), aggregateAfterEpochInsert, "idempotent and stale epoch replays must not drift the aggregate");
    upsertBets([{
      epoch: "0",
      user: "0x2222222222222222222222222222222222222222",
      tileIds: [2],
      amounts: ["999"],
      totalAmount: "999",
      totalAmountNum: 999,
      txHash: makeHash(99),
      blockNumber: "0",
    }]);
    upsertProtocolFeeFlushes([
      { id: "invalid-fee", ownerAmount: "0", burnAmount: "999", txHash: makeHash(98), blockNumber: "0" },
    ]);
    assert.deepEqual(getGlobalStatsAggregate(), aggregateAfterEpochInsert, "invalid writes must not drift the aggregate");

    const revisionBeforeReplay = getPublicReadModelRevision();
    upsertBets([{
      epoch: "2",
      user: "0x2222222222222222222222222222222222222222",
      tileIds: [2],
      amounts: ["7.0000000000000000009"],
      totalAmount: "7.0000000000000000009",
      totalAmountNum: 7,
      txHash: replayHash,
      blockNumber: "13",
      logIndex: "0",
    }]);
    upsertProtocolFeeFlushes([
      { id: "fee-replay", ownerAmount: "0", burnAmount: "0.3", txHash: makeHash(6), blockNumber: "13" },
    ]);
    assert.ok(BigInt(getPublicReadModelRevision()) > BigInt(revisionBeforeReplay));
    assertParity("newer replay replacement");
    assert.deepEqual(getGlobalStatsAggregate(), {
      totalVolumeWei: "9500000000000000000",
      totalBurnWei: "550000000000000000",
      resolvedEpochs: 2,
      lastIndexedBlock: "7",
    }, "accepted replacement deltas must replace rather than double count exact totals");

    const aggregateAfterIdempotentReplay = getGlobalStatsAggregate();
    upsertBets([{
      epoch: "2",
      user: "0x2222222222222222222222222222222222222222",
      tileIds: [2],
      amounts: ["7.0000000000000000009"],
      totalAmount: "7.0000000000000000009",
      totalAmountNum: 7,
      txHash: replayHash,
      blockNumber: "13",
      logIndex: "0",
    }]);
    upsertProtocolFeeFlushes([
      { id: "fee-replay", ownerAmount: "0", burnAmount: "0.3", txHash: makeHash(6), blockNumber: "13" },
    ]);
    assert.deepEqual(getGlobalStatsAggregate(), aggregateAfterIdempotentReplay, "idempotent accepted replays must not double count");

    const aggregateAfterNewerReplay = getGlobalStatsAggregate();
    upsertBets([{
      epoch: "2",
      user: "0x2222222222222222222222222222222222222222",
      tileIds: [2],
      amounts: ["999"],
      totalAmount: "999",
      totalAmountNum: 999,
      txHash: replayHash,
      blockNumber: "12",
      logIndex: "0",
    }]);
    upsertProtocolFeeFlushes([
      { id: "fee-replay", ownerAmount: "0", burnAmount: "999", txHash: makeHash(7), blockNumber: "12" },
    ]);
    assert.deepEqual(getGlobalStatsAggregate(), aggregateAfterNewerReplay, "stale replays must not drift the aggregate");
    assertParity("stale replay rejection");

    // Direct foreign data is deliberately not a product write path; it proves the
    // scoped materialized row cannot absorb another contract's raw history.
    const foreignScope = "sepolia:0xffffffffffffffffffffffffffffffffffffffff";
    db.prepare(`
      INSERT INTO scoped_bets(
        scope, id, user, epoch, tile_ids_json, amounts_json,
        total_amount, total_amount_num, tx_hash, block_number
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(foreignScope, "foreign-bet", "0x4444444444444444444444444444444444444444", 99, "[1]", "[\"999\"]", "999", 999, makeHash(8), 99);
    db.prepare(`
      INSERT INTO scoped_protocol_fee_flushes(scope, id, owner_amount, burn_amount, tx_hash, block_number)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(foreignScope, "foreign-fee", "0", "999", makeHash(9), 99);
    db.prepare(`
      INSERT INTO scoped_epochs(
        scope, epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus,
        is_daily_jackpot, is_weekly_jackpot, resolved_block
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(foreignScope, 99, 1, "999", "999", "0", "0", 0, 0, 99);
    assertParity("foreign scope injection");

    setMetaNumber("lastIndexedBlock", 99);
    assertParity("numeric last indexed block setter");
    setMetaBigInt("lastIndexedBlock", 100n);
    assertParity("direct last indexed block setter");
    const aggregateBeforeInvalidCursor = getGlobalStatsAggregate();
    assert.throws(
      () => setMetaNumber("lastIndexedBlock", -1),
      /non-negative safe integer/,
      "numeric last indexed block setter must reject negative values",
    );
    assert.throws(
      () => setMetaBigInt("lastIndexedBlock", -1n),
      /must be non-negative/,
      "BigInt last indexed block setter must reject negative values",
    );
    assert.deepEqual(getGlobalStatsAggregate(), aggregateBeforeInvalidCursor, "invalid cursor writes must not drift the aggregate");
    const leaseOwnerToken = randomUUID();
    assert.equal(acquireIndexerLease(leaseOwnerToken, 60_000), true);
    try {
      commitIndexerChunk({
        leaseOwnerToken,
        expectedPreviousBlock: 100n,
        expectedPreviousBlockHash: null,
        blockNumber: 110n,
        blockHash: makeHash(10),
      }, () => {
        upsertEpochMap({
          "3": {
            winningTile: 3,
            totalPool: "3",
            rewardPool: "2.7",
            fee: "0.3",
            jackpotBonus: "0",
            isDailyJackpot: false,
            isWeeklyJackpot: false,
            resolvedBlock: "110",
          },
        });
        upsertBets([{
          epoch: "3",
          user: "0x5555555555555555555555555555555555555555",
          tileIds: [3],
          amounts: ["3"],
          totalAmount: "3",
          totalAmountNum: 3,
          txHash: makeHash(11),
          blockNumber: "110",
          logIndex: "0",
        }]);
        upsertProtocolFeeFlushes([
          { id: "fee-rollback", ownerAmount: "0", burnAmount: "0.3", txHash: makeHash(12), blockNumber: "110" },
        ]);
      });
      assertParity("chunk commit");
      rollbackIndexerToBlock(100n, null, leaseOwnerToken);
      assertParity("rollback rebuild");
    } finally {
      releaseIndexerLease(leaseOwnerToken);
    }

    const revisionBeforeDirectInsert = getPublicReadModelRevision();
    db.prepare(`
      INSERT INTO scoped_bets(
        scope, id, user, epoch, tile_ids_json, amounts_json,
        total_amount, total_amount_num, tx_hash, block_number
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scope,
      "direct-dirty-bet",
      "0x6666666666666666666666666666666666666666",
      2,
      "[2]",
      "[\"4.25\"]",
      "4.25",
      4.25,
      makeHash(14),
      101,
    );
    assertDirtyRead("INSERT to scoped_bets");
    restartAndAssertRebuild("INSERT to scoped_bets", {
      totalVolumeWei: "13750000000000000000",
      totalBurnWei: "550000000000000000",
      resolvedEpochs: 2,
      lastIndexedBlock: "100",
    }, revisionBeforeDirectInsert);

    const revisionBeforeDirectUpdate = getPublicReadModelRevision();
    db.prepare(`
      UPDATE scoped_protocol_fee_flushes
      SET burn_amount = ?
      WHERE scope = ? AND id = ?
    `).run("0.4", scope, "fee-replay");
    assertDirtyRead("UPDATE to scoped_protocol_fee_flushes");
    restartAndAssertRebuild("UPDATE to scoped_protocol_fee_flushes", {
      totalVolumeWei: "13750000000000000000",
      totalBurnWei: "650000000000000000",
      resolvedEpochs: 2,
      lastIndexedBlock: "100",
    }, revisionBeforeDirectUpdate);

    const revisionBeforeDirectDelete = getPublicReadModelRevision();
    db.prepare(`DELETE FROM scoped_epochs WHERE scope = ? AND epoch = ?`)
      .run(scope, 2);
    assertDirtyRead("DELETE from scoped_epochs");
    restartAndAssertRebuild("DELETE from scoped_epochs", {
      totalVolumeWei: "13750000000000000000",
      totalBurnWei: "650000000000000000",
      resolvedEpochs: 1,
      lastIndexedBlock: "100",
    }, revisionBeforeDirectDelete);

    const scopedLastIndexedBlockKey = `${scope}:lastIndexedBlock`;
    const revisionBeforeDirectCursorUpdate = getPublicReadModelRevision();
    db.prepare("UPDATE meta SET value = ? WHERE key = ?")
      .run("101", scopedLastIndexedBlockKey);
    assertDirtyRead("UPDATE to scoped lastIndexedBlock metadata");
    restartAndAssertRebuild("UPDATE to scoped lastIndexedBlock metadata", {
      totalVolumeWei: "13750000000000000000",
      totalBurnWei: "650000000000000000",
      resolvedEpochs: 1,
      lastIndexedBlock: "101",
    }, revisionBeforeDirectCursorUpdate);

    const revisionBeforeDirectCursorDelete = getPublicReadModelRevision();
    db.prepare("DELETE FROM meta WHERE key = ?").run(scopedLastIndexedBlockKey);
    assertDirtyRead("DELETE from scoped lastIndexedBlock metadata");
    restartAndAssertRebuild("DELETE from scoped lastIndexedBlock metadata", {
      totalVolumeWei: "13750000000000000000",
      totalBurnWei: "650000000000000000",
      resolvedEpochs: 1,
      lastIndexedBlock: "0",
    }, revisionBeforeDirectCursorDelete);

    const revisionBeforeDirectCursorInsert = getPublicReadModelRevision();
    db.prepare("INSERT INTO meta(key, value) VALUES(?, ?)")
      .run(scopedLastIndexedBlockKey, "102");
    assertDirtyRead("INSERT to scoped lastIndexedBlock metadata");
    restartAndAssertRebuild("INSERT to scoped lastIndexedBlock metadata", {
      totalVolumeWei: "13750000000000000000",
      totalBurnWei: "650000000000000000",
      resolvedEpochs: 1,
      lastIndexedBlock: "102",
    }, revisionBeforeDirectCursorInsert);

    for (let offset = 0; offset < 10_000; offset += 500) {
      upsertBets(Array.from({ length: 500 }, (_, index) => {
        const rowIndex = offset + index;
        return {
          epoch: "2",
          user: `0x${(rowIndex + 1).toString(16).padStart(40, "0")}`,
          tileIds: [2],
          amounts: ["1.000000000000000001"],
          totalAmount: "1.000000000000000001",
          totalAmountNum: 1,
          txHash: makeHash(1_000 + rowIndex),
          blockNumber: String(1_000 + rowIndex),
          logIndex: "0",
        };
      }));
    }
    assertParity("10k scale regression");
    const aggregatePlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT total_volume_wei, total_burn_wei, epoch_count, last_indexed_block
      FROM scoped_global_stats_aggregate
      WHERE scope = ?
    `).all(scope) as Array<Record<string, unknown>>;
    const planText = JSON.stringify(aggregatePlan);
    assert.match(planText, /scoped_global_stats_aggregate/i);
    assert.doesNotMatch(planText, /scoped_(?:bets|protocol_fee_flushes|epochs)/i);
    const dirtyPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT 1
      FROM scoped_global_stats_dirty
      WHERE scope = ?
    `).all(scope) as Array<Record<string, unknown>>;
    assert.match(JSON.stringify(dirtyPlan), /scoped_global_stats_dirty/i);

    db.prepare(`
      UPDATE scoped_global_stats_aggregate
      SET last_indexed_block = ?
      WHERE scope = ?
    `).run("-1", scope);
    assert.throws(
      () => getGlobalStatsAggregate(),
      /last indexed block is not a canonical non-negative integer/,
      "a negative aggregate cursor must fail closed",
    );
    db.prepare(`
      UPDATE scoped_global_stats_aggregate
      SET total_volume_wei = ?
      WHERE scope = ?
    `).run("not-a-number", scope);
    assert.throws(
      () => getGlobalStatsAggregate(),
      /canonical non-negative integer/,
      "a malformed aggregate row must fail closed rather than scan raw tables",
    );

    console.log(JSON.stringify({
      status: "pass",
      temporaryDatabase: TEST_DB_PATH,
      backfill: true,
      mutationParity: true,
      staleReplay: true,
      rollbackRebuild: true,
      scopeIsolation: true,
      dirtySourceRecovery: true,
      dirtyMetaRecovery: true,
      strictDecimalSyntax: true,
      scaleRows: 10_000,
      failClosed: true,
    }));
  } finally {
    try {
      databaseToClose?.close();
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
