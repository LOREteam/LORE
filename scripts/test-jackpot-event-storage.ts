import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-jackpot-event-id-"));
process.env.LORE_DB_PATH = join(testDir, "jackpots.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";

async function main() {
  const { getRecentJackpots, upsertJackpots } = await import("../server/storage");
  const { db } = await import("../server/db");
  const jackpotShareModule = await import("../app/lib/jackpotShareVerification");
  const jackpotShareExports = jackpotShareModule as typeof jackpotShareModule & { default?: typeof jackpotShareModule };
  const { selectVerifiedJackpotShare } = jackpotShareExports.default ?? jackpotShareExports;
  const txHash = `0x${"ab".repeat(32)}`;
  const blockHash = `0x${"cd".repeat(32)}`;

  try {
    upsertJackpots([{
      epoch: "17",
      kind: "daily",
      amount: "3.5",
      amountNum: 3.5,
      txHash,
      blockNumber: "100",
      logIndex: "4",
      blockHash,
      finalizedAtBlock: "112",
    }]);
    const [canonical] = getRecentJackpots();
    assert.deepEqual(canonical, {
      epoch: "17",
      kind: "daily",
      amount: "3.5",
      amountNum: 3.5,
      txHash,
      blockNumber: "100",
      eventId: `${txHash}:4`,
      logIndex: "4",
      blockHash,
      finalizedAtBlock: "112",
    });
    assert.equal(
      selectVerifiedJackpotShare([canonical], `${txHash}:4`)?.amount,
      "3.5",
      "a canonical finalized storage row must be shareable by its exact event ID",
    );

    upsertJackpots([{
      epoch: "18",
      kind: "weekly",
      amount: "4",
      amountNum: 4,
      txHash,
      blockNumber: "101",
      logIndex: "5",
      blockHash,
      finalizedAtBlock: "112",
    }]);
    assert.equal(
      selectVerifiedJackpotShare(getRecentJackpots(), txHash),
      null,
      "legacy tx lookup must reject a transaction that has multiple jackpot events",
    );

    upsertJackpots([{
      epoch: "19",
      kind: "daily",
      amount: "5",
      amountNum: 5,
      txHash: `0x${"ef".repeat(32)}`,
      blockNumber: "103",
      logIndex: "6",
      blockHash,
      finalizedAtBlock: "102",
    }]);
    assert.equal(
      getRecentJackpots().some((row) => row.epoch === "19"),
      false,
      "a purported canonical event above its finality target must not be persisted",
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM scoped_jackpots WHERE id = ?").get(`${txHash}:4`) as { count: number }).count,
      1,
      "canonical event ID is the durable scoped jackpot key",
    );
  } finally {
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});