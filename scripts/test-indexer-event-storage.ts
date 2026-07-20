import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-indexer-events-"));
process.env.LORE_DB_PATH = join(testDir, "events.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";

async function main() {
  const {
    getUserParticipatingEpochPage,
    patchJsonPath,
    readJsonPath,
    setMetaJson,
    upsertBets,
  } = await import("../server/storage");
  const { db } = await import("../server/db");

  try {
    setMetaJson("gamedata:batchClaims", {
    legacy: { id: "legacy", blockNumber: "1" },
  });
  patchJsonPath("gamedata/batchClaims", {
    batch: { id: "batch", kind: "reward", blockNumber: "2" },
  });
  patchJsonPath("gamedata/resolverRewards", {
    resolver: { id: "resolver", kind: "accrued", blockNumber: "3" },
  });
  patchJsonPath("gamedata/dustSettlements", {
    dust: { id: "dust", kind: "rebate", epoch: "1", amount: "0", blockNumber: "4" },
  });

  const batchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  const resolverRewards = readJsonPath<Record<string, unknown>>("gamedata/resolverRewards");
  const dustSettlements = readJsonPath<Record<string, unknown>>("gamedata/dustSettlements");
  assert.ok(batchClaims?.legacy, "legacy JSON metadata must remain readable");
  assert.ok(batchClaims?.batch, "batch claim must use normalized event storage");
  assert.ok(resolverRewards?.resolver, "resolver reward must use normalized event storage");
  assert.ok(dustSettlements?.dust, "dust settlement must use normalized event storage");

  const rows = db.prepare(`
    SELECT category, COUNT(*) AS count
    FROM scoped_indexer_events
    GROUP BY category
    ORDER BY category
  `).all() as Array<{ category: string; count: number }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { category: "batch_claim", count: 1 },
    { category: "dust_settlement", count: 1 },
    { category: "resolver_reward", count: 1 },
  ]);
  assert.equal(
    db.prepare("SELECT value FROM meta WHERE key LIKE ?").get("%gamedata:dustSettlements")?.value,
    undefined,
    "new dust settlements must not rewrite a growing JSON metadata blob",
  );
  const user = "0x0000000000000000000000000000000000000001";
  upsertBets([
    { epoch: "9", user, tileIds: [1], totalAmount: "1", totalAmountNum: 1, txHash: "0x01", blockNumber: "1" },
    { epoch: "8", user, tileIds: [2], totalAmount: "1", totalAmountNum: 1, txHash: "0x02", blockNumber: "2" },
    { epoch: "8", user, tileIds: [3], totalAmount: "1", totalAmountNum: 1, txHash: "0x03", blockNumber: "3" },
    { epoch: "7", user, tileIds: [4], totalAmount: "1", totalAmountNum: 1, txHash: "0x04", blockNumber: "4" },
  ]);
  const firstPage = getUserParticipatingEpochPage(user, { limit: 2 });
  assert.deepEqual(firstPage, { epochs: [9, 8], hasMore: true, nextCursor: 8 });
  const secondPage = getUserParticipatingEpochPage(user, { beforeEpoch: firstPage.nextCursor, limit: 2 });
  assert.deepEqual(secondPage, { epochs: [7], hasMore: false, nextCursor: null });

  const sensitiveMarker = "storage-payload-must-not-reach-logs";
  db.prepare("UPDATE scoped_indexer_events SET payload_json = ? WHERE category = ?")
    .run(`${sensitiveMarker}{`, "batch_claim");
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "malformed indexed payload should emit one bounded warning");
  assert.ok(!warnings.join(" ").includes(sensitiveMarker), "storage warnings must not echo malformed payloads");

    console.log(JSON.stringify({ status: "pass", categories: rows.length, legacyRead: true, candidatePagination: true }));
  } finally {
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

void main();
