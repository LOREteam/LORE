import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-indexer-fork-recovery-"));
process.env.LORE_DB_PATH = join(testDir, "fork-recovery.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";

const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_B = `0x${"bb".repeat(32)}`;
const HASH_C = `0x${"cc".repeat(32)}`;
const BET_TX_A = `0x${"01".repeat(32)}`;
const BET_TX_B = `0x${"02".repeat(32)}`;
const USER = "0x0000000000000000000000000000000000000001";

async function main() {
  const {
    acquireIndexerLease,
    commitIndexerChunk,
    getIndexerBlockCheckpoints,
    patchJsonPath,
    putJsonPath,
    readJsonPath,
    releaseIndexerLease,
    rollbackIndexerToBlock,
    setMetaJson,
    upsertBets,
    upsertEpochMap,
    upsertJackpots,
    upsertProtocolFeeFlushes,
    upsertRewardClaims,
  } = await import("../server/storage");
  const {
    findLatestCanonicalCheckpoint,
    verifyCanonicalLogBlockHashes,
  } = await import("./indexerForkRecovery");
  const { db } = await import("../server/db");
  const leaseOwnerToken = randomUUID();
  assert.equal(acquireIndexerLease(leaseOwnerToken, 60_000), true);

  try {
    rollbackIndexerToBlock(90n, null, leaseOwnerToken);
    commitIndexerChunk({
      leaseOwnerToken,
      expectedPreviousBlock: 90n,
      expectedPreviousBlockHash: null,
      blockNumber: 100n,
      blockHash: HASH_A,
    }, () => {
      upsertEpochMap({
        "901": {
          winningTile: 1,
          totalPool: "1",
          rewardPool: "0.9",
          isDailyJackpot: false,
          isWeeklyJackpot: false,
          resolvedBlock: "100",
        },
      });
      upsertBets([{
        epoch: "901",
        user: USER,
        tileIds: [1],
        totalAmount: "1",
        totalAmountNum: 1,
        txHash: BET_TX_A,
        blockNumber: "100",
      }]);
      upsertJackpots([{
        epoch: "901",
        kind: "daily",
        amount: "0.1",
        amountNum: 0.1,
        txHash: BET_TX_A,
        blockNumber: "100",
      }]);
      upsertRewardClaims([{
        id: "claim-base",
        epoch: "901",
        user: USER,
        reward: "0.9",
        rewardNum: 0.9,
        txHash: BET_TX_A,
        blockNumber: "100",
      }]);
      upsertProtocolFeeFlushes([{
        id: "fee-base",
        ownerAmount: "0.05",
        burnAmount: "0.05",
        txHash: BET_TX_A,
        blockNumber: "100",
      }]);
      patchJsonPath("gamedata/batchClaims", {
        "batch-base": { id: "batch-base", blockNumber: "100" },
      });
      patchJsonPath("gamedata/resolverRewards", {
        "resolver-base": { id: "resolver-base", blockNumber: "100" },
      });
      patchJsonPath("gamedata/dustSettlements", {
        "dust-base": { id: "dust-base", blockNumber: "100" },
      });
    });

    commitIndexerChunk({
      leaseOwnerToken,
      expectedPreviousBlock: 100n,
      expectedPreviousBlockHash: HASH_A,
      blockNumber: 110n,
      blockHash: HASH_B,
    }, () => {
      upsertEpochMap({
        "902": {
          winningTile: 2,
          totalPool: "2",
          rewardPool: "1.8",
          isDailyJackpot: false,
          isWeeklyJackpot: false,
          resolvedBlock: "110",
        },
      });
      upsertBets([{
        epoch: "902",
        user: USER,
        tileIds: [2],
        totalAmount: "2",
        totalAmountNum: 2,
        txHash: BET_TX_B,
        blockNumber: "110",
      }]);
      upsertJackpots([{
        epoch: "902",
        kind: "weekly",
        amount: "0.2",
        amountNum: 0.2,
        txHash: BET_TX_B,
        blockNumber: "110",
      }]);
      upsertRewardClaims([{
        id: "claim-orphan",
        epoch: "902",
        user: USER,
        reward: "1.8",
        rewardNum: 1.8,
        txHash: BET_TX_B,
        blockNumber: "110",
      }]);
      upsertProtocolFeeFlushes([{
        id: "fee-orphan",
        ownerAmount: "0.1",
        burnAmount: "0.1",
        txHash: BET_TX_B,
        blockNumber: "110",
      }]);
      patchJsonPath("gamedata/batchClaims", {
        "batch-orphan": { id: "batch-orphan", blockNumber: "110" },
      });
      patchJsonPath("gamedata/resolverRewards", {
        "resolver-orphan": { id: "resolver-orphan", blockNumber: "110" },
      });
      patchJsonPath("gamedata/dustSettlements", {
        "dust-orphan": { id: "dust-orphan", blockNumber: "110" },
      });
    });

    assert.equal(readJsonPath<string>("gamedata/_meta/lastIndexedBlock"), "110");
    assert.deepEqual(getIndexerBlockCheckpoints(), [
      { blockNumber: "110", blockHash: HASH_B },
      { blockNumber: "100", blockHash: HASH_A },
    ]);

    assert.equal(releaseIndexerLease(leaseOwnerToken), true);
    assert.throws(
      () => commitIndexerChunk({
        leaseOwnerToken,
        expectedPreviousBlock: 110n,
        expectedPreviousBlockHash: HASH_B,
        blockNumber: 120n,
        blockHash: HASH_C,
      }, () => {
        patchJsonPath("gamedata/batchClaims", {
          "lost-lease-write": { id: "lost-lease-write", blockNumber: "120" },
        });
      }),
      /indexer lease is unavailable or lost/,
      "a process that lost its lease must not commit a prepared indexer chunk",
    );
    assert.equal(
      readJsonPath<Record<string, unknown>>("gamedata/batchClaims")?.["lost-lease-write"],
      undefined,
    );
    assert.equal(readJsonPath<string>("gamedata/_meta/lastIndexedBlock"), "110");
    assert.equal(acquireIndexerLease(leaseOwnerToken, 60_000), true);

    assert.throws(
      () => commitIndexerChunk({
        leaseOwnerToken,
        expectedPreviousBlock: 110n,
        expectedPreviousBlockHash: HASH_B,
        blockNumber: 120n,
        blockHash: HASH_C,
      }, () => {
        patchJsonPath("gamedata/batchClaims", {
          "rolled-back-write": { id: "rolled-back-write", blockNumber: "120" },
        });
        throw new Error("forced chunk failure");
      }),
      /forced chunk failure/,
      "a failed chunk must roll back event writes, checkpoint, and cursor together",
    );
    assert.equal(
      readJsonPath<Record<string, unknown>>("gamedata/batchClaims")?.["rolled-back-write"],
      undefined,
    );
    assert.equal(readJsonPath<string>("gamedata/_meta/lastIndexedBlock"), "110");
    assert.equal(getIndexerBlockCheckpoints()[0]?.blockNumber, "110");

    assert.throws(
      () => commitIndexerChunk({
        leaseOwnerToken,
        expectedPreviousBlock: 100n,
        expectedPreviousBlockHash: HASH_A,
        blockNumber: 115n,
        blockHash: HASH_C,
      }, () => {
        patchJsonPath("gamedata/batchClaims", {
          "stale-writer": { id: "stale-writer", blockNumber: "115" },
        });
      }),
      /cursor changed/,
      "a concurrent stale writer must not append to a newer indexed cursor",
    );
    assert.equal(
      readJsonPath<Record<string, unknown>>("gamedata/batchClaims")?.["stale-writer"],
      undefined,
    );

    const currentScope = (db.prepare(`
      SELECT scope
      FROM scoped_indexer_block_checkpoints
      WHERE block_number = 100
    `).get() as { scope: string }).scope;
    const foreignScope = "sepolia:0x00000000000000000000000000000000000000ff";
    db.prepare(`
      INSERT INTO scoped_bets(
        scope, id, user, epoch, tile_ids_json, amounts_json,
        total_amount, total_amount_num, tx_hash, block_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      foreignScope,
      "foreign-orphan-height",
      USER,
      999,
      "[1]",
      "[]",
      "1",
      1,
      "0xforeign",
      999,
    );
    setMetaJson("gamedata:batchClaims", {
      "legacy-canonical": { id: "legacy-canonical", blockNumber: "99" },
      "legacy-orphan": { id: "legacy-orphan", blockNumber: "105" },
      "legacy-unbound": { id: "legacy-unbound" },
    });
    upsertEpochMap({
      "903": {
        winningTile: 3,
        totalPool: "3",
        rewardPool: "2.7",
        isDailyJackpot: false,
        isWeeklyJackpot: false,
      },
    });
    putJsonPath("gamedata/_meta/repairCursorBlock", "999");
    rollbackIndexerToBlock(100n, HASH_A, leaseOwnerToken);

    const scopedRollbackPredicates = [
      ["scoped_epochs", "resolved_block"],
      ["scoped_bets", "block_number"],
      ["scoped_jackpots", "block_number"],
      ["scoped_reward_claims", "block_number"],
      ["scoped_protocol_fee_flushes", "block_number"],
      ["scoped_indexer_events", "block_number"],
    ] as const;
    for (const [table, column] of scopedRollbackPredicates) {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE scope = ? AND ${column} > 100
      `).get(currentScope) as { count: number };
      assert.equal(row.count, 0, `${table} must delete orphaned current-scope rows`);
    }
    assert.equal(
      (db.prepare(`
        SELECT COUNT(*) AS count
        FROM scoped_epochs
        WHERE scope = ? AND epoch = 903
      `).get(currentScope) as { count: number }).count,
      0,
      "rollback must delete epoch rows that have no block binding",
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM scoped_bets WHERE scope = ?").get(foreignScope) as { count: number }).count,
      1,
      "rollback must not delete another contract scope",
    );
    assert.equal(readJsonPath<string>("gamedata/_meta/lastIndexedBlock"), "100");
    assert.equal(readJsonPath<string>("gamedata/_meta/repairCursorBlock"), "101");
    assert.deepEqual(getIndexerBlockCheckpoints(), [
      { blockNumber: "100", blockHash: HASH_A },
    ]);
    const legacyAfterRollback = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
    assert.ok(legacyAfterRollback?.["legacy-canonical"]);
    assert.equal(legacyAfterRollback?.["legacy-orphan"], undefined);
    assert.equal(legacyAfterRollback?.["legacy-unbound"], undefined);
    assert.equal(legacyAfterRollback?.["batch-orphan"], undefined);

    commitIndexerChunk({
      leaseOwnerToken,
      expectedPreviousBlock: 100n,
      expectedPreviousBlockHash: HASH_A,
      blockNumber: 110n,
      blockHash: HASH_C,
    }, () => {
      patchJsonPath("gamedata/batchClaims", {
        "batch-canonical-replacement": {
          id: "batch-canonical-replacement",
          blockNumber: "110",
          canonical: true,
        },
      });
    });
    assert.equal(
      (readJsonPath<Record<string, unknown>>("gamedata/batchClaims")?.["batch-canonical-replacement"] as Record<string, unknown>)?.canonical,
      true,
    );
    assert.equal(
      readJsonPath<Record<string, unknown>>("gamedata/batchClaims")?.["batch-orphan"],
      undefined,
      "canonical replay must not resurrect an orphan event",
    );

    let checkpointReads = 0;
    const common = await findLatestCanonicalCheckpoint(
      getIndexerBlockCheckpoints(),
      async (blockNumber) => {
        checkpointReads += 1;
        return blockNumber === 110n ? HASH_B : HASH_A;
      },
    );
    assert.deepEqual(common, { blockNumber: "100", blockHash: HASH_A });
    assert.equal(checkpointReads, 2, "recovery must walk backward to the latest common checkpoint");
    assert.equal(
      await findLatestCanonicalCheckpoint(
        [{ blockNumber: "110", blockHash: HASH_C }],
        async () => HASH_B,
      ),
      null,
      "recovery must report no common checkpoint when every stored hash is orphaned",
    );
    await assert.rejects(
      () => findLatestCanonicalCheckpoint(
        [{ blockNumber: "110", blockHash: HASH_C }],
        async () => { throw new Error("RPC unavailable"); },
      ),
      /RPC unavailable/,
      "RPC failures must abort recovery instead of triggering destructive rollback",
    );

    let canonicalLogReads = 0;
    await verifyCanonicalLogBlockHashes([
      { blockNumber: 101n, blockHash: HASH_A },
      { blockNumber: 101n, blockHash: HASH_A },
      { blockNumber: 102n, blockHash: HASH_B },
    ], async (blockNumber) => {
      canonicalLogReads += 1;
      return blockNumber === 101n ? HASH_A : HASH_B;
    });
    assert.equal(canonicalLogReads, 2, "logs in the same block should require one canonical hash read");
    await assert.rejects(
      () => verifyCanonicalLogBlockHashes(
        [{ blockNumber: 101n, blockHash: HASH_A }],
        async () => HASH_B,
      ),
      /non-canonical log block/,
    );

    console.log(JSON.stringify({
      status: "pass",
      blockHashCheckpoints: true,
      commonAncestorRollback: true,
      canonicalReplacementReplay: true,
      scopedOrphanDeletion: true,
      atomicChunkCommit: true,
      lostLeaseCommitRejected: true,
      staleWriterRejected: true,
      canonicalLogValidation: true,
    }));
  } finally {
    releaseIndexerLease(leaseOwnerToken);
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

void main();
