import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_ROWS = 100_000;
const BATCH_SIZE = 1_000;
const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000002";

type SqlStatement = {
  all: (...parameters: unknown[]) => unknown;
  get: (...parameters: unknown[]) => unknown;
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

function parseRowCount(argv: string[]) {
  const raw = argv.find((value) => value.startsWith("--rows="))?.slice("--rows=".length);
  if (raw === undefined) return DEFAULT_ROWS;
  if (!/^\d+$/.test(raw)) throw new Error("--rows must be a positive safe integer");
  const rows = Number(raw);
  if (!Number.isSafeInteger(rows) || rows <= 0 || rows > 1_000_000) {
    throw new Error("--rows must be between 1 and 1000000");
  }
  return rows;
}

function parseGlobalStatsAmountWei(value: unknown) {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(String(value ?? "").trim());
  if (match === null) return 0n;
  const [, whole, fraction = ""] = match;
  return BigInt(`${whole}${fraction.slice(0, 18).padEnd(18, "0")}`);
}

function makeHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function percentile(samples: number[], quantile: number) {
  const sorted = [...samples].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function summarize(samples: number[]) {
  return {
    count: samples.length,
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
  };
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

async function main() {
  const rows = parseRowCount(process.argv.slice(2));
  const tempRoot = mkdtempSync(join(tmpdir(), "lore-global-stats-benchmark-"));
  const dbPath = join(tempRoot, "benchmark.sqlite");
  Object.assign(process.env, {
    LORE_DB_PATH: dbPath,
    LORE_ALLOW_CONTRACT_SCOPE_PURGE: "0",
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  });

  let db: SqlDatabase | null = null;
  try {
    const storage = await import("../server/storage");
    const { db: rawDb } = await import("../server/db");
    db = rawDb as unknown as SqlDatabase;
    const {
      getCurrentStorageScope,
      getGlobalStatsAggregate,
      setMetaBigInt,
      upsertBets,
      upsertEpochMap,
      upsertProtocolFeeFlushes,
    } = storage;
    const scope = getCurrentStorageScope();

    const seedStartedAt = performance.now();
    for (let offset = 0; offset < rows; offset += BATCH_SIZE) {
      const count = Math.min(BATCH_SIZE, rows - offset);
      upsertBets(Array.from({ length: count }, (_, index) => {
        const rowIndex = offset + index + 1;
        return {
          epoch: String((rowIndex % 100) + 1),
          user: `0x${rowIndex.toString(16).padStart(40, "0")}`,
          tileIds: [((rowIndex % 25) + 1)],
          amounts: ["1.000000000000000001"],
          totalAmount: "1.000000000000000001",
          totalAmountNum: 1,
          txHash: makeHash(rowIndex),
          blockNumber: String(rowIndex),
          logIndex: "0",
        };
      }));
    }
    for (let epoch = 1; epoch <= 100; epoch += 1) {
      upsertEpochMap({
        [String(epoch)]: {
          winningTile: ((epoch - 1) % 25) + 1,
          totalPool: "1",
          rewardPool: "0.9",
          fee: "0.1",
          jackpotBonus: "0",
          isDailyJackpot: false,
          isWeeklyJackpot: false,
          resolvedBlock: String(rows + epoch),
        },
      });
      upsertProtocolFeeFlushes([
        {
          id: `fee-${epoch}`,
          ownerAmount: "0",
          burnAmount: "0.100000000000000001",
          txHash: makeHash(rows + epoch),
          blockNumber: String(rows + epoch),
        },
      ]);
    }
    setMetaBigInt("lastIndexedBlock", BigInt(rows + 100));
    const seedMs = performance.now() - seedStartedAt;

    const materialized = getGlobalStatsAggregate();
    assert.deepEqual(materialized, readRawAggregate(db, scope), "materialized stats must equal raw oracle");

    const materializedSamples: number[] = [];
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const startedAt = performance.now();
      assert.deepEqual(getGlobalStatsAggregate(), materialized);
      materializedSamples.push(performance.now() - startedAt);
    }
    const rawSamples: number[] = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const startedAt = performance.now();
      assert.deepEqual(readRawAggregate(db, scope), materialized);
      rawSamples.push(performance.now() - startedAt);
    }

    const queryPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT total_volume_wei, total_burn_wei, epoch_count, last_indexed_block
      FROM scoped_global_stats_aggregate
      WHERE scope = ?
    `).all(scope) as Array<Record<string, unknown>>;
    const planText = JSON.stringify(queryPlan);
    assert.match(planText, /scoped_global_stats_aggregate/i);
    assert.doesNotMatch(planText, /scoped_(?:bets|protocol_fee_flushes|epochs)/i);
    const dirtyQueryPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT 1
      FROM scoped_global_stats_dirty
      WHERE scope = ?
    `).all(scope) as Array<Record<string, unknown>>;
    assert.match(JSON.stringify(dirtyQueryPlan), /scoped_global_stats_dirty/i);

    const materializedP95Ms = percentile(materializedSamples, 0.95);
    const rawP50Ms = percentile(rawSamples, 0.5);
    const rawP50ToMaterializedP95Ratio = rawP50Ms / Math.max(materializedP95Ms, 0.001);
    assert.ok(
      materializedP95Ms <= 5,
      `materialized read p95 ${materializedP95Ms.toFixed(3)}ms exceeds the 5ms local scale-regression guardrail`,
    );
    assert.ok(
      rawP50ToMaterializedP95Ratio >= 20,
      `raw p50/materialized p95 ratio ${rawP50ToMaterializedP95Ratio.toFixed(1)}x is below the 20x local scale-regression guardrail`,
    );

    console.log(JSON.stringify({
      status: "pass",
      rows,
      seedMs: Number(seedMs.toFixed(3)),
      materialized: summarize(materializedSamples),
      rawOracle: summarize(rawSamples),
      checks: {
        structuralLookup: true,
        materializedP95MaxMs: 5,
        rawP50ToMaterializedP95MinRatio: 20,
        observedRawP50ToMaterializedP95Ratio: Number(rawP50ToMaterializedP95Ratio.toFixed(1)),
      },
      aggregate: materialized,
      temporaryDatabase: dbPath,
    }));
  } finally {
    try {
      db?.close();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
