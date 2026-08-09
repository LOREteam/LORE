import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-indexer-bet-identity-"));
process.env.LORE_DB_PATH = join(testDir, "bet-identity.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";

const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_B = `0x${"bb".repeat(32)}`;
const HASH_C = `0x${"cc".repeat(32)}`;
const TX_HASH = `0x${"11".repeat(32)}`;
const USER = "0x0000000000000000000000000000000000000001";
const EPOCH = "901";
const TILE_ID = 7;

const canonicalLogs = [
  { logIndex: "3", amount: "1", amountNum: 1 },
  { logIndex: "9", amount: "2", amountNum: 2 },
];

function toBetRow(log: (typeof canonicalLogs)[number], blockNumber: string) {
  return {
    epoch: EPOCH,
    user: USER,
    tileIds: [TILE_ID],
    amounts: [log.amount],
    totalAmount: log.amount,
    totalAmountNum: log.amountNum,
    txHash: TX_HASH,
    blockNumber,
    logIndex: log.logIndex,
  };
}

async function main() {
  const {
    acquireIndexerLease,
    commitIndexerChunk,
    getCurrentStorageScope,
    releaseIndexerLease,
    rollbackIndexerToBlock,
    runIndexerStorageTransaction,
    upsertBets,
  } = await import("../server/storage");
  const { db } = await import("../server/db");
  const leaseOwnerToken = randomUUID();
  assert.equal(acquireIndexerLease(leaseOwnerToken, 60_000), true);

  const currentScope = getCurrentStorageScope();
  const legacyId = `${EPOCH}_${TX_HASH}`;
  const canonicalIds = canonicalLogs.map((log) => `${legacyId}_${log.logIndex}`).sort();

  const readRows = () => (db.prepare(`
      SELECT id, total_amount AS totalAmount, block_number AS blockNumber
      FROM scoped_bets
      WHERE scope = ? AND lower(tx_hash) = ?
      ORDER BY id
    `).all(currentScope, TX_HASH) as Array<{
      id: string;
      totalAmount: string;
      blockNumber: number;
    }>).map((row) => ({ ...row }));

  try {
    rollbackIndexerToBlock(90n, null, leaseOwnerToken);
    commitIndexerChunk({
      leaseOwnerToken,
      expectedPreviousBlock: 90n,
      expectedPreviousBlockHash: null,
      blockNumber: 100n,
      blockHash: HASH_A,
    }, () => undefined);

    commitIndexerChunk({
      leaseOwnerToken,
      expectedPreviousBlock: 100n,
      expectedPreviousBlockHash: HASH_A,
      blockNumber: 110n,
      blockHash: HASH_B,
    }, () => {
      upsertBets([{
        epoch: EPOCH,
        user: USER,
        tileIds: [TILE_ID],
        amounts: [canonicalLogs[0].amount],
        totalAmount: canonicalLogs[0].amount,
        totalAmountNum: canonicalLogs[0].amountNum,
        txHash: TX_HASH,
        blockNumber: "110",
      }]);
    });
    assert.deepEqual(
      readRows().map((row) => row.id),
      [legacyId],
      "pre-fix stored bet IDs must remain readable before canonical replay",
    );

    const canonicalRows = canonicalLogs.map((log) => toBetRow(log, "110"));
    runIndexerStorageTransaction(leaseOwnerToken, () => upsertBets(canonicalRows));
    assert.deepEqual(
      readRows().map((row) => row.id),
      canonicalIds,
      "two canonical logs in one transaction and tile must persist independently",
    );

    const replayRows = [...canonicalRows].reverse().map((row) => ({
      ...row,
      txHash: row.txHash.toUpperCase(),
    }));
    runIndexerStorageTransaction(leaseOwnerToken, () => upsertBets(replayRows));
    assert.deepEqual(
      readRows(),
      canonicalIds.map((id, index) => ({
        id,
        totalAmount: canonicalLogs[index].amount,
        blockNumber: 110,
      })),
      "canonical replay must be idempotent regardless of order or hash casing",
    );

    rollbackIndexerToBlock(100n, HASH_A, leaseOwnerToken);
    assert.deepEqual(readRows(), [], "fork rollback must delete every orphaned log-indexed bet");

    const replacementRows = canonicalLogs.map((log, index) => ({
      ...toBetRow(log, "110"),
      amounts: [String(index + 3)],
      totalAmount: String(index + 3),
      totalAmountNum: index + 3,
    }));
    commitIndexerChunk({
      leaseOwnerToken,
      expectedPreviousBlock: 100n,
      expectedPreviousBlockHash: HASH_A,
      blockNumber: 110n,
      blockHash: HASH_C,
    }, () => upsertBets(replacementRows));
    assert.deepEqual(
      readRows(),
      canonicalIds.map((id, index) => ({
        id,
        totalAmount: String(index + 3),
        blockNumber: 110,
      })),
      "canonical replacement replay must restore both logs without reviving the legacy collision",
    );

    console.log(JSON.stringify({
      status: "pass",
      sameTransactionSameTileDistinctLogs: true,
      legacyIdLazyUpgrade: true,
      idempotentReplay: true,
      forkRollbackAndReplacement: true,
    }));
  } finally {
    releaseIndexerLease(leaseOwnerToken);
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

void main();
