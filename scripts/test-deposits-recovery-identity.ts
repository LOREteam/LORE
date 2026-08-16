import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-deposits-recovery-identity-"));
process.env.LORE_DB_PATH = join(testDir, "deposits-recovery-identity.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";

const USER = "0x0000000000000000000000000000000000000001";
const TX_HASH = `0x${"ab".repeat(32)}`;
const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");

type RecoveryPlanner = (input: {
  enabled: boolean;
  headBlock: bigint;
  finalityBlocks: bigint;
  contractDeployBlock: bigint;
  latestIndexedBlock: bigint | null;
  recentWindowBlocks: bigint;
}) => { fromBlock: bigint; toBlock: bigint } | null;

function recoveryInput(overrides: Partial<Parameters<RecoveryPlanner>[0]> = {}) {
  return {
    enabled: true,
    headBlock: 130n,
    finalityBlocks: 10n,
    contractDeployBlock: 1n,
    latestIndexedBlock: 100n,
    recentWindowBlocks: 100_000n,
    ...overrides,
  };
}

function assertRecoveryPlanningPolicy(candidate: RecoveryPlanner) {
  assert.equal(
    candidate(recoveryInput({ enabled: false })),
    null,
    "disabled recovery must not create an RPC range",
  );
  assert.equal(
    candidate(recoveryInput({ finalityBlocks: 0n })),
    null,
    "zero finality must fail closed",
  );
  assert.equal(
    candidate(recoveryInput({ headBlock: 10n, finalityBlocks: 10n })),
    null,
    "a head without a finalized target must not create a range",
  );
  assert.deepEqual(
    candidate(recoveryInput()),
    { fromBlock: 101n, toBlock: 120n },
    "recovery must end at the finalized target and start after the indexed cursor",
  );
  assert.deepEqual(
    candidate(recoveryInput({
      headBlock: 1_010n,
      latestIndexedBlock: null,
      recentWindowBlocks: 100n,
    })),
    { fromBlock: 901n, toBlock: 1_000n },
    "the inclusive recent window must contain exactly the configured number of blocks",
  );
  assert.deepEqual(
    candidate(recoveryInput({
      headBlock: 130n,
      contractDeployBlock: 50n,
      latestIndexedBlock: -1n,
      recentWindowBlocks: 100n,
    })),
    { fromBlock: 50n, toBlock: 120n },
    "negative indexed metadata must fall back to the bounded deploy floor",
  );
  assert.equal(
    candidate(recoveryInput({ latestIndexedBlock: 120n })),
    null,
    "a cursor at the finalized target must not rescan",
  );
  assert.equal(
    candidate(recoveryInput({ latestIndexedBlock: 121n })),
    null,
    "future indexed metadata must not create a reversed recovery range",
  );
  assert.equal(
    candidate(recoveryInput({ contractDeployBlock: -1n })),
    null,
    "an invalid deploy floor must fail closed",
  );
  assert.equal(
    candidate(recoveryInput({ recentWindowBlocks: 0n })),
    null,
    "an invalid recovery window must fail closed",
  );
}

async function main() {
  const { buildRecoveredDepositIdentity } = await import(
    "../app/api/deposits/recoveryIdentity"
  );
  const { dedupeDepositRowsByIdentity } = await import(
    "../app/api/deposits/recoveryIdentity"
  );
  const { parseStoredBlockNumberOrZero } = await import(
    "../app/api/_lib/storedNumberParsing"
  );
  const {
    isFinalizedDepositsRecoveryEnabled,
    planFinalizedDepositsRecoveryRange,
  } = await import("../app/api/deposits/recoveryPolicy");
  const { getCurrentStorageScope, getUserBetsMap, upsertBets } = await import("../server/storage");
  const { db } = await import("../server/db");
  const scope = getCurrentStorageScope();

  const readIds = (epoch: string) => (
    db.prepare(`
      SELECT id
      FROM scoped_bets
      WHERE scope = ? AND user = ? AND epoch = ?
      ORDER BY id
    `).all(scope, USER, Number(epoch)) as Array<{ id: string }>
  ).map((row) => row.id);

  const toRow = (epoch: string, logIndex: string) => ({
    epoch,
    user: USER,
    tileIds: [7],
    amounts: ["1"],
    totalAmount: "1",
    totalAmountNum: 1,
    txHash: TX_HASH,
    blockNumber: "1234",
    logIndex,
  });

  try {
    assert.equal(
      depositsRouteSource.match(/buildRecoveredDepositIdentity\([\s\S]*?log\.logIndex,[\s\S]*?\)/g)?.length,
      4,
      "every recovered bet event family must derive identity from its canonical logIndex",
    );
    assert.equal(
      depositsRouteSource.match(/logIndex: identity\.logIndex/g)?.length,
      4,
      "every recovered deposit row must retain canonical logIndex for durable upsert",
    );
    assert.doesNotMatch(
      depositsRouteSource,
      /patchStorage|gamedata\/bets/,
      "public recovery must not persist even canonically shaped single-RPC rows",
    );

    assert.equal(isFinalizedDepositsRecoveryEnabled(false, 10n), false);
    assert.equal(isFinalizedDepositsRecoveryEnabled(true, 0n), false);
    assert.equal(isFinalizedDepositsRecoveryEnabled(true, -1n), false);
    assert.equal(isFinalizedDepositsRecoveryEnabled(true, 10n), true);
    assertRecoveryPlanningPolicy(planFinalizedDepositsRecoveryRange);

    const rawHeadMutant: RecoveryPlanner = (input) => {
      const planned = planFinalizedDepositsRecoveryRange(input);
      return planned ? { ...planned, toBlock: input.headBlock } : null;
    };
    assert.throws(
      () => assertRecoveryPlanningPolicy(rawHeadMutant),
      /finalized target/,
      "a raw-head recovery mutant must be killed",
    );

    const offByOneWindowMutant: RecoveryPlanner = (input) => {
      const planned = planFinalizedDepositsRecoveryRange(input);
      if (!planned || input.latestIndexedBlock !== null) return planned;
      const fromBlock = planned.toBlock - input.recentWindowBlocks;
      return { ...planned, fromBlock };
    };
    assert.throws(
      () => assertRecoveryPlanningPolicy(offByOneWindowMutant),
      /inclusive recent window/,
      "an off-by-one recent-window mutant must be killed",
    );

    const missingEnableGateMutant: RecoveryPlanner = (input) =>
      planFinalizedDepositsRecoveryRange({ ...input, enabled: true });
    assert.throws(
      () => assertRecoveryPlanningPolicy(missingEnableGateMutant),
      /disabled recovery/,
      "a missing feature/finality gate mutant must be killed",
    );

    assert.equal(
      buildRecoveredDepositIdentity("901", TX_HASH, "1234", undefined),
      null,
      "recovery must reject logs without canonical logIndex identity",
    );
    assert.equal(
      buildRecoveredDepositIdentity("901", TX_HASH, "1234", -1),
      null,
      "recovery must reject an invalid logIndex",
    );
    assert.equal(
      buildRecoveredDepositIdentity("901", "", "1234", 7),
      null,
      "recovery must reject logs without canonical transaction identity",
    );

    const canonicalFirst = buildRecoveredDepositIdentity("901", TX_HASH, "1234", 7n);
    assert.deepEqual(canonicalFirst, {
      id: `901_${TX_HASH}_7`,
      logIndex: "7",
    });
    upsertBets([toRow("901", "7")]);
    upsertBets([{ ...toRow("901", canonicalFirst.logIndex), totalAmountNum: 2 }]);
    assert.deepEqual(
      readIds("901"),
      [canonicalFirst.id],
      "canonical-first then API recovery must remain one durable bet identity",
    );

    const recoveryFirst = buildRecoveredDepositIdentity("902", TX_HASH, "1234", "9");
    assert.ok(recoveryFirst);
    upsertBets([toRow("902", recoveryFirst.logIndex)]);
    upsertBets([{ ...toRow("902", "9"), totalAmountNum: 2 }]);
    assert.deepEqual(
      readIds("902"),
      [recoveryFirst.id],
      "API recovery then canonical indexer replay must remain one durable bet identity",
    );

    const secondLog = buildRecoveredDepositIdentity("902", TX_HASH, "1234", "10");
    assert.ok(secondLog);
    upsertBets([toRow("902", secondLog.logIndex)]);
    assert.deepEqual(
      readIds("902"),
      [recoveryFirst.id, secondLog.id].sort(),
      "distinct logs in one transaction must remain distinct legitimate bets",
    );

    const indexedRows = Object.values(getUserBetsMap(USER)).filter((row) => row.epoch === "902");
    assert.deepEqual(
      indexedRows.map((row) => row.logIndex).sort(),
      ["10", "9"],
      "API storage reads must restore canonical logIndex identity from durable row ids",
    );
    const recoveredReplay = {
      ...toRow("902", recoveryFirst.logIndex),
      totalAmountNum: 3,
    };
    const mergedRows = dedupeDepositRowsByIdentity(
      [...indexedRows, recoveredReplay],
      {
        buildLegacyKey: (epoch, txHash, blockNumber) => {
          const normalizedHash = txHash.toLowerCase().trim();
          return /^0x[0-9a-f]{64}$/.test(normalizedHash)
            ? `${epoch}_${normalizedHash}`
            : `${epoch}_nohash_${blockNumber}`;
        },
        parseBlockNumber: parseStoredBlockNumberOrZero,
      },
    );
    assert.equal(
      mergedRows.length,
      2,
      "API merge must dedupe an indexer/recovery replay without collapsing a distinct log in the same transaction",
    );
    assert.deepEqual(
      mergedRows.map((row) => row.logIndex).sort(),
      ["10", "9"],
      "API merge must preserve both canonical log identities",
    );
    assert.equal(
      mergedRows.find((row) => row.logIndex === "9")?.totalAmountNum,
      3,
      "an equal-block recovery replay must refresh only its matching canonical log row",
    );

    const legacyRows = dedupeDepositRowsByIdentity(
      [
        { ...toRow("903", "1"), logIndex: undefined, totalAmountNum: 1 },
        { ...toRow("903", "2"), logIndex: undefined, totalAmountNum: 2 },
      ],
      {
        buildLegacyKey: (epoch, txHash, blockNumber) => {
          const normalizedHash = txHash.toLowerCase().trim();
          return /^0x[0-9a-f]{64}$/.test(normalizedHash)
            ? `${epoch}_${normalizedHash}`
            : `${epoch}_nohash_${blockNumber}`;
        },
        parseBlockNumber: parseStoredBlockNumberOrZero,
      },
    );
    assert.equal(legacyRows.length, 1, "historical rows without logIndex must retain the legacy fallback key");

    console.log(JSON.stringify({
      status: "pass",
      canonicalFirstIdempotent: true,
      recoveryFirstIdempotent: true,
      distinctLogIdentityPreserved: true,
      missingLogIndexRejected: true,
      apiMergeIdentityPreserved: true,
      legacyFallbackPreserved: true,
      finalizedRecoveryPlanning: true,
      recoveryPlanMutantsKilled: 3,
    }));
  } finally {
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

void main();
