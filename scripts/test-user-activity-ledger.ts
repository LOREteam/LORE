import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const testDir = mkdtempSync(join(tmpdir(), "lore-user-activity-"));
process.env.LORE_DB_PATH = join(testDir, "activity.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";
process.env.LINEA_NETWORK = "sepolia";
process.env.KEEPER_RPC_URL = "https://activity-test.invalid";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER_USER = "0x2222222222222222222222222222222222222222";
const TX_A = `0x${"aa".repeat(32)}`;
const TX_B = `0x${"bb".repeat(32)}`;
const TX_C = `0x${"cc".repeat(32)}`;

async function main() {
  const storage = await import("../server/storage");
  const { GET } = await import("../app/api/activity/route");
  const { db } = await import("../server/db");
  const owner = randomUUID();
  try {
    storage.upsertBets([
      {
        epoch: "10", user: USER.toUpperCase(), tileIds: [1], amounts: ["2"], totalAmount: "2", totalAmountNum: 2,
        txHash: TX_A.toUpperCase(), blockNumber: "100", logIndex: "4",
      },
      {
        epoch: "9", user: USER, tileIds: [2], amounts: ["1"], totalAmount: "1", totalAmountNum: 1,
        txHash: TX_B, blockNumber: "90",
      },
    ]);
    storage.upsertRewardClaims([{
      id: `${TX_B}:5`, epoch: "10", user: USER, reward: "3", rewardNum: 3, txHash: TX_B, blockNumber: "101",
    }]);
    storage.upsertUserActivity([{
      eventId: `${TX_C}:6`, user: USER, activityType: "rebate_batch_claim", amount: "4", amountNum: 4, txHash: TX_C, blockNumber: "102",
    }, {
      eventId: "not-a-canonical-event", user: OTHER_USER, activityType: "bet", epoch: "1", amount: "99", amountNum: 99, txHash: TX_C, blockNumber: "103",
    }]);

    const first = storage.getUserActivityPage(USER, { limit: 2 });
    assert.equal(first.coverage, "partial", "new ledger must never imply a historical backfill");
    assert.equal(first.rows.length, 2);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);
    assert.deepEqual(first.rows.map((row) => row.eventId), [`${TX_C}:6`, `${TX_B}:5`]);
    assert.equal(first.rows.some((row) => row.eventId.includes("_nohash_")), false, "legacy bet rows must not become canonical activity events");
    const second = storage.getUserActivityPage(USER, { cursor: first.nextCursor, limit: 2 });
    assert.deepEqual(second.rows.map((row) => row.eventId), [`10_${TX_A}_4`]);
    assert.equal(storage.decodeUserActivityCursor("not-a-cursor"), null, "opaque cursors must fail closed");

    const bad = await GET(new NextRequest("http://localhost/api/activity?user=not-an-address"));
    assert.equal(bad.status, 400);
    const invalidCursor = await GET(new NextRequest(`http://localhost/api/activity?user=${USER}&cursor=invalid`));
    assert.equal(invalidCursor.status, 400);
    const response = await GET(new NextRequest(`http://localhost/api/activity?user=${USER}&limit=2`));
    assert.equal(response.status, 200);
    const payload = await response.json() as { coverage: string; rows: Array<{ eventId: string }>; hasMore: boolean };
    assert.equal(payload.coverage, "partial");
    assert.equal(payload.rows.length, 2);
    assert.equal(payload.hasMore, true);
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");

    assert.equal(storage.acquireIndexerLease(owner, 60_000), true);
    storage.rollbackIndexerToBlock(102n, null, owner);
    storage.commitIndexerChunk({
      leaseOwnerToken: owner,
      expectedPreviousBlock: 102n,
      expectedPreviousBlockHash: null,
      blockNumber: 120n,
      blockHash: TX_A,
    }, () => {
      storage.upsertUserActivity([{
        eventId: `${TX_A}:7`, user: USER, activityType: "reward_batch_claim", amount: "5", amountNum: 5, txHash: TX_A, blockNumber: "120",
      }]);
    });
    storage.rollbackIndexerToBlock(102n, null, owner);
    assert.equal(
      storage.getUserActivityPage(USER, { limit: 64 }).rows.some((row) => row.eventId === `${TX_A}:7`),
      false,
      "reorg rollback must remove orphaned ledger events with the rest of the indexed chunk",
    );
    assert.equal(storage.releaseIndexerLease(owner), true);
    console.log("User activity ledger tests passed");
  } finally {
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
