import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "lore-leaderboard-materialization-"));
const TEST_DB_PATH = join(TEST_DIR, "leaderboard.sqlite");
const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000001";
const EXPECTED_SCOPE = `sepolia:${CONTRACT_ADDRESS}`;

Object.assign(process.env, {
  LORE_DB_PATH: TEST_DB_PATH,
  LORE_ALLOW_CONTRACT_SCOPE_PURGE: "0",
  LINEA_NETWORK: "sepolia",
  NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
  NEXT_PUBLIC_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
});

type SqlStatement = { all: (...parameters: unknown[]) => unknown; get: (...parameters: unknown[]) => unknown; run: (...parameters: unknown[]) => unknown };
type SqlDatabase = { prepare: (sql: string) => SqlStatement; close: () => void };

function hash(value: number) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function address(value: number) {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function restartAndRead() {
  const child = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      "-e",
      'import("./server/storage").then((module) => { const storage = module.default ?? module; process.stdout.write(JSON.stringify({ model: storage.getLeaderboardReadModel(), revision: storage.getPublicReadModelRevision() })); })',
    ],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" },
  );
  assert.equal(child.status, 0, `dirty leaderboard restart failed: ${child.stderr || child.error?.message}`);
  const line = child.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  assert.ok(line, "restart must return rebuilt leaderboard model");
  return JSON.parse(line) as { model: Record<string, unknown>; revision: string };
}

async function main() {
  let database: SqlDatabase | null = null;
  try {
    const { db: rawDb } = await import("../server/db");
    const db = rawDb as unknown as SqlDatabase;
    database = db;
    const storage = await import("../server/storage");
    const { getCurrentStorageScope, getLeaderboardReadModel, getPublicReadModelRevision, rollbackIndexerToBlock, acquireIndexerLease, releaseIndexerLease, upsertBets, upsertEpochMap, upsertRewardClaims } = storage;
    assert.equal(getCurrentStorageScope(), EXPECTED_SCOPE, "test must use only its explicit temporary DB scope");

    upsertEpochMap({
      "1": { winningTile: 1, totalPool: "100", rewardPool: "100", isDailyJackpot: false, isWeeklyJackpot: false, resolvedBlock: "1" },
    });
    upsertBets([
      { epoch: "1", user: address(0x11), tileIds: [1, 2], amounts: ["2", "2"], totalAmount: "4", totalAmountNum: 4, txHash: hash(1), blockNumber: "2", logIndex: "0" },
      { epoch: "1", user: address(0x22), tileIds: [1], amounts: ["1"], totalAmount: "1", totalAmountNum: 1, txHash: hash(2), blockNumber: "2", logIndex: "0" },
    ]);
    upsertRewardClaims([
      { id: "claim-alice", epoch: "1", user: address(0x11), reward: "60", rewardNum: 60, txHash: hash(3), blockNumber: "3" },
      { id: "claim-bob", epoch: "1", user: address(0x22), reward: "40", rewardNum: 40, txHash: hash(4), blockNumber: "3" },
    ]);

    const initial = getLeaderboardReadModel();
    assert.deepEqual(initial.biggestSingleWin.map((row) => row.address), [address(0x11), address(0x22)]);
    assert.deepEqual(initial.luckiest.map((row) => row.address), [address(0x22), address(0x11)]);
    assert.deepEqual(initial.oneTileWonder.map((row) => row.address), [address(0x11), address(0x22)]);
    assert.deepEqual(initial.mostWins.map((row) => row.address), [address(0x11), address(0x22)], "ties must remain address-ascending");
    assert.deepEqual(initial.whales.map((row) => row.address), [address(0x11), address(0x22)]);
    assert.deepEqual(initial.underdog.map((row) => row.address), [address(0x22), address(0x11)]);
    assert.deepEqual(initial.luckyTile, [{ tileId: 1, wins: 1, pct: 100 }]);
    assert.equal(initial.oneTileWonder[0]?.value, "60.00");
    assert.equal(initial.underdog[0]?.extra, "pool on tile 1 was 2.50 LINEA");
    const leaderboardRoute = await import("../app/api/leaderboards/route");
    const routeResponse = await leaderboardRoute.GET(new Request("http://localhost/api/leaderboards"));
    assert.equal(routeResponse.status, 200, "public route must read the materialized model");
    const routePayload = await routeResponse.json() as { biggestSingleWin: Array<{ address: string; value: string }> };
    assert.deepEqual(routePayload.biggestSingleWin, [
      { rank: 1, address: address(0x11), value: "60.00", valueNum: 60 },
      { rank: 2, address: address(0x22), value: "40.00", valueNum: 40 },
    ]);

    const revisionBeforeDirty = getPublicReadModelRevision();
    db.prepare("UPDATE scoped_reward_claims SET reward = ?, reward_num = ? WHERE scope = ? AND id = ?")
      .run("100", 100, EXPECTED_SCOPE, "claim-alice");
    assert.throws(() => getLeaderboardReadModel(), /source data is dirty/, "dirty direct source writes must fail closed");
    assert.throws(() => getPublicReadModelRevision(), /source data is dirty/, "dirty source writes must invalidate public cache revision");
    const restarted = restartAndRead();
    assert.ok(BigInt(restarted.revision) > BigInt(revisionBeforeDirty), "dirty recovery must advance revision");
    assert.equal((restarted.model.biggestSingleWin as Array<{ value: string }>)[0]?.value, "100.00");
    assert.equal(db.prepare("SELECT 1 AS dirty FROM scoped_leaderboard_dirty WHERE scope = ?").get(EXPECTED_SCOPE), undefined);

    db.prepare("UPDATE scoped_leaderboard_read_model SET payload_json = ? WHERE scope = ?")
      .run("not-json", EXPECTED_SCOPE);
    assert.throws(() => getPublicReadModelRevision(), /payload is invalid/, "cache revision must fail closed for a malformed materialization row");
    db.prepare("DELETE FROM scoped_leaderboard_read_model WHERE scope = ?").run(EXPECTED_SCOPE);
    restartAndRead();

    const leaseOwnerToken = "leaderboard-materialization-lease-token";
    assert.equal(acquireIndexerLease(leaseOwnerToken, 60_000), true);
    try {
      upsertEpochMap({
        "2": { winningTile: 2, totalPool: "2", rewardPool: "2", isDailyJackpot: false, isWeeklyJackpot: false, resolvedBlock: "20" },
      });
      upsertBets([{ epoch: "2", user: address(0x33), tileIds: [2], amounts: ["2"], totalAmount: "2", totalAmountNum: 2, txHash: hash(5), blockNumber: "20", logIndex: "0" }]);
      upsertRewardClaims([{ id: "claim-rollback", epoch: "2", user: address(0x33), reward: "2", rewardNum: 2, txHash: hash(6), blockNumber: "20" }]);
      assert.ok(getLeaderboardReadModel().mostWins.some((row) => row.address === address(0x33)));
      rollbackIndexerToBlock(10n, null, leaseOwnerToken);
      assert.ok(!getLeaderboardReadModel().mostWins.some((row) => row.address === address(0x33)), "rollback must rebuild leaderboard from retained raw rows");
    } finally {
      releaseIndexerLease(leaseOwnerToken);
    }

    upsertEpochMap({
      "3": { winningTile: 3, totalPool: "100000", rewardPool: "90000", isDailyJackpot: false, isWeeklyJackpot: false, resolvedBlock: "30" },
    });
    const tenThousand = Array.from({ length: 10_000 }, (_, index) => ({
      epoch: "3", user: address(10_000 + (index % 1_000)), tileIds: [3], amounts: ["1"], totalAmount: "1", totalAmountNum: 1,
      txHash: hash(100 + index), blockNumber: "30", logIndex: String(index),
    }));
    upsertBets(tenThousand);
    assert.equal(getLeaderboardReadModel().whales.length, 50, "10k source rows must produce the bounded top-K read model");

    const oneHundredThousand = Array.from({ length: 100_000 }, (_, index) => ({
      epoch: "3", user: address(20_000 + (index % 2_000)), tileIds: [3], amounts: ["1"], totalAmount: "1", totalAmountNum: 1,
      txHash: hash(20_000 + index), blockNumber: "31", logIndex: String(index),
    }));
    upsertBets(oneHundredThousand);
    const materializedSamples = Array.from({ length: 100 }, () => {
      const started = performance.now();
      getLeaderboardReadModel();
      return performance.now() - started;
    }).sort((left, right) => left - right);
    const rawSamples = Array.from({ length: 5 }, () => {
      const started = performance.now();
      db.prepare("SELECT user, epoch, tile_ids_json, amounts_json, total_amount FROM scoped_bets WHERE scope = ?").all(EXPECTED_SCOPE);
      return performance.now() - started;
    }).sort((left, right) => left - right);
    const materializedP95Ms = materializedSamples[Math.floor(materializedSamples.length * 0.95)] ?? 0;
    const rawMedianMs = rawSamples[Math.floor(rawSamples.length / 2)] ?? 0;
    assert.ok(materializedP95Ms < rawMedianMs, "materialized cold read must not scan the 100k raw-bet table");
    console.log(JSON.stringify({ status: "pass", rows: 110_003, materializedP95Ms, rawMedianMs }));
  } finally {
    database?.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
