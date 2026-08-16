import assert from "node:assert/strict";
import {
  buildChainAuditBetEventKey,
  buildChainAuditEventId,
  normalizeChainAuditTransactionHash,
  parseChainAuditBoundedInteger,
  parseChainAuditDbInteger,
  parseChainAuditDbTileId,
  parseChainAuditEpoch,
  parseChainAuditTileId,
  planChainAuditBlockChunks,
  toChainAuditSqlBlockNumber,
} from "./chain-indexer-audit-policy.mjs";
import {
  CHAIN_AUDIT_ACCOUNTING_KEYS,
  CHAIN_AUDIT_DUST_EVENT_NAMES,
  CHAIN_AUDIT_METADATA_CATEGORIES,
  appendMissingChainAuditMetadataRows,
  assertChainAuditDbFile,
  formatChainAuditSummary,
  isChainAuditDustSettlementEvent,
  publishChainAuditSummary,
  readChainAuditAccountingSnapshot,
  readChainAuditStoredEventIds,
  selectChainAuditResolvedEpochRows,
} from "./chain-indexer-audit-runtime.mjs";

const HASH = `0x${"ab".repeat(32)}`;

export async function runChainIndexerAuditPolicyTests() {
  assert.equal(parseChainAuditBoundedInteger("window", "0", 0, 500), 0);
  assert.equal(parseChainAuditBoundedInteger("window", "500", 0, 500), 500);
  for (const value of ["", "01", "1.0", "1e2", "501", "9007199254740992", -1]) {
    assert.throws(() => parseChainAuditBoundedInteger("window", value, 0, 500));
  }

  assert.equal(parseChainAuditDbInteger("epoch", "9007199254740991", 1), Number.MAX_SAFE_INTEGER);
  assert.equal(parseChainAuditDbTileId("tile", "1"), 1);
  assert.equal(parseChainAuditDbTileId("tile", 25), 25);
  for (const value of ["0", "26", "1.0", "01", "9007199254740992"]) {
    assert.throws(() => parseChainAuditDbTileId("tile", value));
  }
  assert.equal(parseChainAuditTileId("tile", 1n), 1);
  assert.equal(parseChainAuditTileId("tile", 25n), 25);
  for (const value of [0n, 26n, 1, "1", 9007199254740992n]) {
    assert.throws(() => parseChainAuditTileId("tile", value));
  }
  assert.equal(parseChainAuditEpoch(1n), 1);
  assert.equal(parseChainAuditEpoch(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of [0n, -1n, 1, "1", 9007199254740992n]) {
    assert.equal(parseChainAuditEpoch(value), null);
  }
  assert.equal(toChainAuditSqlBlockNumber("block", 0n), 0);
  assert.equal(toChainAuditSqlBlockNumber("block", BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of [-1n, 1, "1", 9007199254740992n]) {
    assert.throws(() => toChainAuditSqlBlockNumber("block", value));
  }

  assert.equal(normalizeChainAuditTransactionHash({ transactionHash: ` ${HASH.toUpperCase()} ` }), HASH);
  assert.equal(normalizeChainAuditTransactionHash({ transactionHash: "0x1234" }), null);
  assert.equal(buildChainAuditEventId({ transactionHash: HASH, logIndex: 7 }), `${HASH}_7`);
  assert.equal(buildChainAuditEventId({ transactionHash: HASH, logIndex: 7n }), `${HASH}_7`);
  for (const logIndex of [-1, 1.5, "7", -1n, 9007199254740992n, null]) {
    assert.equal(buildChainAuditEventId({ transactionHash: HASH, logIndex }), null);
  }
  assert.equal(buildChainAuditBetEventKey(42, { transactionHash: HASH }), `42_${HASH}`);
  assert.equal(buildChainAuditBetEventKey(0, { transactionHash: HASH }), null);
  assert.equal(buildChainAuditBetEventKey(42, { transactionHash: "0x1234" }), null);

  assert.deepEqual(planChainAuditBlockChunks(100n, 20_100n), [
    { fromBlock: 100n, toBlock: 10_099n },
    { fromBlock: 10_100n, toBlock: 20_099n },
    { fromBlock: 20_100n, toBlock: 20_100n },
  ]);
  assert.deepEqual(planChainAuditBlockChunks(7n, 7n), [{ fromBlock: 7n, toBlock: 7n }]);
  assert.throws(() => planChainAuditBlockChunks(2n, 1n));
  assert.throws(() => planChainAuditBlockChunks(0n, 250_001n));
  assert.throws(() => planChainAuditBlockChunks(0n, 1n, { chunkSize: 0n }));

  const broadNumberMutant = (value) => Number(value);
  assert.equal(Number.isSafeInteger(broadNumberMutant("9007199254740992")), false);
  assert.throws(() => parseChainAuditBoundedInteger("mutant", "01", 0, 500));
  const syntheticEventMutant = (log) => `${log.transactionHash ?? "nohash"}_${log.logIndex ?? 0}`;
  assert.equal(buildChainAuditEventId({ transactionHash: null, logIndex: null }), null);
  assert.equal(syntheticEventMutant({ transactionHash: null, logIndex: null }), "nohash_0");
  const earlyStopChunkMutant = (fromBlock) => [{ fromBlock, toBlock: fromBlock + 9_999n }];
  assert.notDeepEqual(earlyStopChunkMutant(100n, 20_100n), planChainAuditBlockChunks(100n, 20_100n));

  assert.equal(assertChainAuditDbFile("audit.sqlite", {
    statSyncFn: () => ({ isFile: () => true }),
  }), "audit.sqlite");
  assert.throws(
    () => assertChainAuditDbFile("audit.sqlite", { statSyncFn: () => ({ isFile: () => false }) }),
    /existing indexer SQLite database file/,
  );
  assert.throws(
    () => assertChainAuditDbFile("missing.sqlite", { statSyncFn: () => { throw new Error("ENOENT"); } }),
    /existing indexer SQLite database file/,
  );
  assert.throws(() => assertChainAuditDbFile(""), /existing indexer SQLite database file/);

  const preparedQueries = [];
  const epochDb = {
    prepare(sql) {
      return {
        all(...args) {
          preparedQueries.push({ sql, args });
          return [{ epoch: 9 }, { epoch: 8 }];
        },
      };
    },
  };
  assert.deepEqual(selectChainAuditResolvedEpochRows({
    db: epochDb,
    scope: "sepolia:0xabc",
    auditEndEpoch: null,
    windowEpochs: 2,
  }), [{ epoch: 8 }, { epoch: 9 }]);
  assert.deepEqual(preparedQueries[0].args, ["sepolia:0xabc", 2]);
  assert.match(preparedQueries[0].sql, /WHERE scope = \? ORDER BY epoch DESC LIMIT \?/);
  assert.deepEqual(selectChainAuditResolvedEpochRows({
    db: epochDb,
    scope: "sepolia:0xabc",
    auditEndEpoch: 8,
    windowEpochs: 2,
  }), [{ epoch: 8 }, { epoch: 9 }]);
  assert.deepEqual(preparedQueries[1].args, ["sepolia:0xabc", 8, 2]);
  assert.match(preparedQueries[1].sql, /WHERE scope = \? AND epoch <= \? ORDER BY epoch DESC LIMIT \?/);

  const accountingCalls = [];
  const accountingResolvers = [];
  const accountingPromise = readChainAuditAccountingSnapshot({
    client: {
      readContract(call) {
        accountingCalls.push(call);
        return new Promise((resolve) => accountingResolvers.push(() => resolve(BigInt(accountingCalls.indexOf(call) + 1))));
      },
    },
    contractAddress: "0x1111111111111111111111111111111111111111",
    abi: ["abi"],
    blockNumber: 77n,
  });
  assert.equal(accountingCalls.length, CHAIN_AUDIT_ACCOUNTING_KEYS.length);
  assert.deepEqual(accountingCalls.map(({ functionName }) => functionName), CHAIN_AUDIT_ACCOUNTING_KEYS);
  assert.ok(accountingCalls.every(({ blockNumber }) => blockNumber === 77n));
  accountingResolvers.forEach((resolve) => resolve());
  assert.deepEqual(await accountingPromise, {
    rolloverPool: 1n,
    dailyJackpotPool: 2n,
    weeklyJackpotPool: 3n,
    accruedOwnerFees: 4n,
    accruedBurnFees: 5n,
  });

  const eventIdQueries = [];
  const eventIdDb = {
    prepare(sql) {
      return {
        all(...args) {
          eventIdQueries.push({ sql, args });
          return [{ id: "ABC_1" }, { id: "DEF_2" }];
        },
      };
    },
  };
  assert.deepEqual(readChainAuditStoredEventIds({
    db: eventIdDb,
    scope: "sepolia:0xabc",
    category: "batch_claim",
    fromBlock: 10,
    toBlock: 20,
  }), ["abc_1", "def_2"]);
  assert.deepEqual(eventIdQueries[0].args, ["sepolia:0xabc", "batch_claim", 10, 20]);
  assert.match(eventIdQueries[0].sql, /category = \? AND block_number BETWEEN \? AND \?/);
  assert.deepEqual(readChainAuditStoredEventIds({
    db: { prepare: () => { throw new Error("missing table"); } },
    scope: "scope",
    category: "batch_claim",
    fromBlock: 0,
    toBlock: 1,
  }), []);

  assert.deepEqual(CHAIN_AUDIT_METADATA_CATEGORIES.map(({ category, seenKey }) => ({ category, seenKey })), [
    { category: "batch_claim", seenKey: "batchClaims" },
    { category: "resolver_reward", seenKey: "resolverRewards" },
    { category: "dust_settlement", seenKey: "dustSettlements" },
  ]);
  const metadataMismatches = [];
  appendMissingChainAuditMetadataRows({
    idsByCategory: {
      batch_claim: ["seen", "missing-claim"],
      resolver_reward: ["missing-resolver"],
      dust_settlement: ["missing-dust"],
    },
    seen: {
      batchClaims: new Set(["seen"]),
      resolverRewards: new Set(),
      dustSettlements: new Set(),
    },
    addMismatch: (kind, detail) => metadataMismatches.push({ kind, detail }),
  });
  assert.deepEqual(metadataMismatches.map(({ kind }) => kind), [
    "claim",
    "resolver-reward",
    "dust-settlement",
  ]);
  assert.throws(() => appendMissingChainAuditMetadataRows({
    idsByCategory: {},
    seen: {},
    addMismatch: () => {},
  }), /missing chain audit seen set/);

  assert.deepEqual(CHAIN_AUDIT_DUST_EVENT_NAMES, ["RewardDustSettled", "RebateDustSettled"]);
  assert.equal(isChainAuditDustSettlementEvent("RewardDustSettled"), true);
  assert.equal(isChainAuditDustSettlementEvent("RebateDustSettled"), true);
  assert.equal(isChainAuditDustSettlementEvent("RewardDustBatchSettled"), false);
  assert.equal(isChainAuditDustSettlementEvent("RebateDustBatchSettled"), false);

  const summary = {
    status: "pass",
    network: "sepolia",
    epochWindow: { from: 1, to: 2, count: 2 },
    blockWindow: { from: "10", to: "20" },
    mismatches: [],
    accounting: { mismatchCount: 0 },
  };
  assert.equal(
    formatChainAuditSummary(summary, { summaryOnly: true }),
    "status=pass, network=sepolia, epochs=2, blocks=10-20, mismatches=0, accountingMismatches=0",
  );
  assert.equal(formatChainAuditSummary(summary, { summaryOnly: false }), JSON.stringify(summary));
  const publicationCalls = [];
  const publicationLogs = [];
  const publication = publishChainAuditSummary({
    summary,
    outPath: "C:\\proof\\chain-indexer.json",
    summaryOnly: true,
    processId: 42,
    fsApi: {
      mkdirSync: (...args) => publicationCalls.push(["mkdir", ...args]),
      writeFileSync: (...args) => publicationCalls.push(["write", ...args]),
      renameSync: (...args) => publicationCalls.push(["rename", ...args]),
    },
    log: (value) => publicationLogs.push(value),
  });
  assert.equal(publication.exitCode, 0);
  assert.deepEqual(publicationCalls.map(([operation]) => operation), ["mkdir", "write", "rename"]);
  assert.equal(publicationCalls[1][1], "C:\\proof\\chain-indexer.json.42.tmp");
  assert.equal(publicationCalls[1][3].mode, 0o600);
  assert.deepEqual(publicationCalls[2].slice(1), [
    "C:\\proof\\chain-indexer.json.42.tmp",
    "C:\\proof\\chain-indexer.json",
  ]);
  assert.deepEqual(publicationLogs, [formatChainAuditSummary(summary, { summaryOnly: true })]);
  assert.equal(publishChainAuditSummary({
    summary: { ...summary, status: "fail", mismatches: [{ kind: "bet" }] },
    outPath: "C:\\proof\\chain-indexer.json",
    summaryOnly: false,
    fsApi: { mkdirSync() {}, writeFileSync() {}, renameSync() {} },
    log: () => {},
  }).exitCode, 1);

  const acceptsDirectoryMutant = (dbPath) => Boolean(dbPath);
  assert.equal(acceptsDirectoryMutant("audit.sqlite"), true);
  assert.throws(
    () => assertChainAuditDbFile("audit.sqlite", { statSyncFn: () => ({ isFile: () => false }) }),
    /existing indexer SQLite database file/,
  );
  const aggregateDustMutant = (name) => name.endsWith("DustSettled") || name.endsWith("DustBatchSettled");
  assert.equal(aggregateDustMutant("RewardDustBatchSettled"), true);
  assert.equal(isChainAuditDustSettlementEvent("RewardDustBatchSettled"), false);
}
