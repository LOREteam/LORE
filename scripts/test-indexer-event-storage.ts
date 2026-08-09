import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-indexer-events-"));
process.env.LORE_DB_PATH = join(testDir, "events.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";

async function main() {
  const {
    getEpochTileUserCounts,
    getEpochMap,
    getGlobalStatsAggregate,
    getAllRewardClaims,
    getJackpotsMap,
    getRecentJackpots,
    getRecentRewardClaims,
    getUserBetsMap,
    getUserParticipatingEpochPage,
    patchJsonPath,
    readJsonPath,
    setMetaJson,
    upsertBets,
    upsertEpochMap,
    upsertJackpots,
    upsertProtocolFeeFlushes,
    upsertRewardClaims,
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
  patchJsonPath("gamedata/batchClaims", {
    batch: { id: "batch", kind: "reward", blockNumber: "5", replacement: true },
  });
  patchJsonPath("gamedata/batchClaims", {
    shared: { id: "shared", category: "batch", blockNumber: "6" },
  });
  patchJsonPath("gamedata/resolverRewards", {
    shared: { id: "shared", category: "resolver", blockNumber: "7" },
  });
  patchJsonPath("gamedata/dustSettlements", {
    shared: { id: "shared", category: "dust", blockNumber: "8" },
  });
  const duplicateRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber
    FROM scoped_indexer_events
    WHERE category = ? AND id = ?
  `).get("batch_claim", "batch") as { count: number; blockNumber: number };
  assert.equal(duplicateRows.count, 1, "re-indexing the same event id must not grow rows inside the same category");
  assert.equal(duplicateRows.blockNumber, 5, "re-indexing the same event id must update block metadata");
  patchJsonPath("gamedata/resolverRewards", {
    resolver: { id: "resolver", kind: "accrued", blockNumber: "11", replacement: true },
  });
  patchJsonPath("gamedata/dustSettlements", {
    dust: { id: "dust", kind: "rebate", epoch: "1", amount: "0", blockNumber: "12", replacement: true },
  });
  const resolverDuplicateRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber
    FROM scoped_indexer_events
    WHERE category = ? AND id = ?
  `).get("resolver_reward", "resolver") as { count: number; blockNumber: number };
  const dustDuplicateRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber
    FROM scoped_indexer_events
    WHERE category = ? AND id = ?
  `).get("dust_settlement", "dust") as { count: number; blockNumber: number };
  assert.equal(resolverDuplicateRows.count, 1, "re-indexing the same resolver reward id must not grow rows inside the same category");
  assert.equal(resolverDuplicateRows.blockNumber, 11, "re-indexing the same resolver reward id must update block metadata");
  assert.equal(dustDuplicateRows.count, 1, "re-indexing the same dust settlement id must not grow rows inside the same category");
  assert.equal(dustDuplicateRows.blockNumber, 12, "re-indexing the same dust settlement id must update block metadata");
  const updatedBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  const updatedBatch = (updatedBatchClaims?.batch ?? {}) as Record<string, unknown>;
  assert.equal(updatedBatch.replacement, true, "event reads must prefer the latest normalized payload");
  patchJsonPath("gamedata/batchClaims", {
    batch: { id: "batch", kind: "reward", blockNumber: "4", staleReplay: true },
  });
  const staleBatchReplayRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber
    FROM scoped_indexer_events
    WHERE category = ? AND id = ?
  `).get("batch_claim", "batch") as { count: number; blockNumber: number };
  const staleReplayBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  const staleReplayBatch = (staleReplayBatchClaims?.batch ?? {}) as Record<string, unknown>;
  assert.equal(staleBatchReplayRows.count, 1, "stale replay of the same event id must not grow rows");
  assert.equal(staleBatchReplayRows.blockNumber, 5, "stale replay of the same event id must not downgrade block metadata");
  assert.equal(staleReplayBatch.replacement, true, "stale replay of the same event id must not replace the latest payload");
  assert.equal(staleReplayBatch.staleReplay, undefined, "stale replay payload must not reach frontend event reads");
  const updatedResolverRewards = readJsonPath<Record<string, unknown>>("gamedata/resolverRewards");
  const updatedResolver = (updatedResolverRewards?.resolver ?? {}) as Record<string, unknown>;
  assert.equal(updatedResolver.replacement, true, "resolver reward reads must prefer the latest normalized payload");
  const updatedDustSettlements = readJsonPath<Record<string, unknown>>("gamedata/dustSettlements");
  const updatedDust = (updatedDustSettlements?.dust ?? {}) as Record<string, unknown>;
  assert.equal(updatedDust.replacement, true, "dust settlement reads must prefer the latest normalized payload");
  patchJsonPath("gamedata/batchClaims", {
    "0xabc_1": { id: "0xabc_1", kind: "reward", blockNumber: "9", logIndex: 1 },
    "0xabc_2": { id: "0xabc_2", kind: "reward", blockNumber: "9", logIndex: 2 },
  });
  patchJsonPath("gamedata/batchClaims", {
    "0xabc_1": { id: "0xabc_1", kind: "reward", blockNumber: "10", logIndex: 1, replayed: true },
  });
  const sameTxDifferentLogRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber
    FROM scoped_indexer_events
    WHERE category = ? AND id LIKE ?
  `).get("batch_claim", "0xabc_%") as { count: number; blockNumber: number };
  assert.equal(sameTxDifferentLogRows.count, 2, "same transaction hash with different log indexes must remain distinct");
  assert.equal(sameTxDifferentLogRows.blockNumber, 10, "replay of the same tx/log index must update only that normalized event");
  const replayedBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  assert.equal((replayedBatchClaims?.["0xabc_1"] as Record<string, unknown> | undefined)?.replayed, true);
  assert.equal((replayedBatchClaims?.["0xabc_2"] as Record<string, unknown> | undefined)?.logIndex, 2);
  patchJsonPath("gamedata/batchClaims", {
    "reward-kind": {
      id: "reward-kind",
      kind: "reward",
      eventName: "RewardBatchClaimed",
      totalAmount: "5",
      epochsClaimed: 2,
      blockNumber: "11",
    },
    "rebate-kind": {
      id: "rebate-kind",
      kind: "rebate",
      eventName: "RebateBatchClaimed",
      totalAmount: "3",
      epochsClaimed: 1,
      blockNumber: "12",
    },
    "single-rebate-kind": {
      id: "single-rebate-kind",
      kind: "rebate",
      eventName: "RebateClaimed",
      totalAmount: "4",
      epochsClaimed: 1,
      blockNumber: "12",
    },
  });
  patchJsonPath("gamedata/dustSettlements", {
    "reward-dust-kind": {
      id: "reward-dust-kind",
      kind: "reward",
      eventName: "RewardDustSettled",
      epoch: "31",
      amount: "0",
      blockNumber: "13",
    },
    "rebate-dust-kind": {
      id: "rebate-dust-kind",
      kind: "rebate",
      eventName: "RebateDustSettled",
      epoch: "41",
      amount: "6",
      blockNumber: "14",
    },
  });
  const parityBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  const rewardBatchKind = parityBatchClaims?.["reward-kind"] as Record<string, unknown> | undefined;
  const rebateBatchKind = parityBatchClaims?.["rebate-kind"] as Record<string, unknown> | undefined;
  const singleRebateClaimKind = parityBatchClaims?.["single-rebate-kind"] as Record<string, unknown> | undefined;
  assert.equal(rewardBatchKind?.kind, "reward", "reward batch claim payload kind must survive normalized storage");
  assert.equal(rewardBatchKind?.eventName, "RewardBatchClaimed", "reward batch claim event name must survive normalized storage");
  assert.equal(rebateBatchKind?.kind, "rebate", "rebate batch claim payload kind must survive normalized storage");
  assert.equal(rebateBatchKind?.eventName, "RebateBatchClaimed", "rebate batch claim event name must survive normalized storage");
  assert.equal(singleRebateClaimKind?.kind, "rebate", "single rebate claim payload kind must survive normalized storage");
  assert.equal(singleRebateClaimKind?.eventName, "RebateClaimed", "single rebate claim event name must survive normalized storage");
  assert.equal(singleRebateClaimKind?.epochsClaimed, 1, "single rebate claims must remain distinguishable from batch claims");
  const parityDustSettlements = readJsonPath<Record<string, unknown>>("gamedata/dustSettlements");
  const rewardDustKind = parityDustSettlements?.["reward-dust-kind"] as Record<string, unknown> | undefined;
  const rebateDustKind = parityDustSettlements?.["rebate-dust-kind"] as Record<string, unknown> | undefined;
  assert.equal(rewardDustKind?.kind, "reward", "reward dust payload kind must survive normalized storage");
  assert.equal(rewardDustKind?.eventName, "RewardDustSettled", "reward dust event name must survive normalized storage");
  assert.equal(rebateDustKind?.kind, "rebate", "rebate dust payload kind must survive normalized storage");
  assert.equal(rebateDustKind?.eventName, "RebateDustSettled", "rebate dust event name must survive normalized storage");
  const parityRows = db.prepare(`
    SELECT category, COUNT(*) AS count
    FROM scoped_indexer_events
    WHERE id IN (?, ?, ?, ?, ?)
    GROUP BY category
    ORDER BY category
  `).all("reward-kind", "rebate-kind", "single-rebate-kind", "reward-dust-kind", "rebate-dust-kind") as Array<{ category: string; count: number }>;
  assert.deepEqual(
    parityRows.map((row) => ({ ...row })),
    [
      { category: "batch_claim", count: 3 },
      { category: "dust_settlement", count: 2 },
    ],
    "reward/rebate payload variants must share normalized categories without collapsing distinct event ids",
  );
  assert.equal((updatedBatchClaims?.shared as Record<string, unknown> | undefined)?.category, "batch");
  assert.equal(
    (readJsonPath<Record<string, unknown>>("gamedata/resolverRewards")?.shared as Record<string, unknown> | undefined)?.category,
    "resolver",
  );
  assert.equal(
    (readJsonPath<Record<string, unknown>>("gamedata/dustSettlements")?.shared as Record<string, unknown> | undefined)?.category,
    "dust",
  );
  const sharedIdRows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM scoped_indexer_events
    WHERE id = ?
  `).get("shared") as { count: number };
  assert.equal(sharedIdRows.count, 3, "identical event ids must remain isolated by category");
  const currentScope = (db.prepare(`
    SELECT scope
    FROM scoped_indexer_events
    WHERE category = ? AND id = ?
    LIMIT 1
  `).get("batch_claim", "batch") as { scope: string }).scope;
  const currentScopeAddress = currentScope.split(":").slice(1).join(":");
  const insertForeignEvent = db.prepare(`
    INSERT INTO scoped_indexer_events(scope, category, id, payload_json, block_number)
    VALUES (?, ?, ?, ?, ?)
  `);
  const foreignScope = "sepolia:0x00000000000000000000000000000000000000ff";
  const foreignChainScope = `linea-mainnet:${currentScopeAddress}`;
  insertForeignEvent.run(
    foreignScope,
    "batch_claim",
    "batch",
    JSON.stringify({ id: "batch", kind: "reward", blockNumber: "999", foreignScope: true }),
    999,
  );
  insertForeignEvent.run(
    foreignScope,
    "resolver_reward",
    "resolver",
    JSON.stringify({ id: "resolver", kind: "accrued", blockNumber: "999", foreignScope: true }),
    999,
  );
  insertForeignEvent.run(
    foreignScope,
    "dust_settlement",
    "dust",
    JSON.stringify({ id: "dust", kind: "rebate", epoch: "1", amount: "0", blockNumber: "999", foreignScope: true }),
    999,
  );
  insertForeignEvent.run(
    foreignChainScope,
    "batch_claim",
    "batch",
    JSON.stringify({ id: "batch", kind: "reward", blockNumber: "1000", foreignChainScope: true }),
    1_000,
  );
  insertForeignEvent.run(
    foreignChainScope,
    "resolver_reward",
    "resolver",
    JSON.stringify({ id: "resolver", kind: "accrued", blockNumber: "1000", foreignChainScope: true }),
    1_000,
  );
  insertForeignEvent.run(
    foreignChainScope,
    "dust_settlement",
    "dust",
    JSON.stringify({ id: "dust", kind: "rebate", epoch: "1", amount: "0", blockNumber: "1000", foreignChainScope: true }),
    1_000,
  );
  const currentScopeBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  const currentScopeBatch = (currentScopeBatchClaims?.batch ?? {}) as Record<string, unknown>;
  assert.equal(currentScopeBatch.foreignScope, undefined, "normalized event reads must ignore foreign contract scopes");
  assert.equal(currentScopeBatch.foreignChainScope, undefined, "normalized event reads must ignore foreign chain scopes");
  assert.equal(currentScopeBatch.blockNumber, "5", "foreign scoped events must not override current scope payloads");
  const currentScopeResolver = (readJsonPath<Record<string, unknown>>("gamedata/resolverRewards")?.resolver ?? {}) as Record<string, unknown>;
  const currentScopeDust = (readJsonPath<Record<string, unknown>>("gamedata/dustSettlements")?.dust ?? {}) as Record<string, unknown>;
  assert.equal(currentScopeResolver.foreignScope, undefined, "resolver reward reads must ignore foreign contract scopes");
  assert.equal(currentScopeResolver.foreignChainScope, undefined, "resolver reward reads must ignore foreign chain scopes");
  assert.equal(currentScopeResolver.blockNumber, "11", "foreign resolver rewards must not override current scope payloads");
  assert.equal(currentScopeDust.foreignScope, undefined, "dust settlement reads must ignore foreign contract scopes");
  assert.equal(currentScopeDust.foreignChainScope, undefined, "dust settlement reads must ignore foreign chain scopes");
  assert.equal(currentScopeDust.blockNumber, "12", "foreign dust settlements must not override current scope payloads");
  patchJsonPath("gamedata/dustSettlements", {
    "partial-rpc-log": {
      id: "partial-rpc-log",
      kind: "reward",
      eventName: "RewardDustSettled",
      epoch: "51",
      amount: "1",
      blockNumber: "latest",
    },
  });
  const partialLogRows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM scoped_indexer_events
    WHERE category = ? AND id = ?
  `).get("dust_settlement", "partial-rpc-log") as { count: number };
  assert.equal(partialLogRows.count, 0, "partial RPC logs with non-canonical block numbers must not enter normalized storage");
  assert.equal(
    readJsonPath<Record<string, unknown>>("gamedata/dustSettlements")?.["partial-rpc-log"],
    undefined,
    "partial RPC logs with non-canonical block numbers must not reach frontend event reads",
  );
  const oversizedEventId = "x".repeat(161);
  const boundaryEventId = "b".repeat(160);
  const circularEventPayload: Record<string, unknown> = {
    id: "circular-payload",
    kind: "reward",
    blockNumber: "17",
  };
  circularEventPayload.self = circularEventPayload;
  assert.doesNotThrow(
    () => patchJsonPath("gamedata/batchClaims", {
      [oversizedEventId]: { id: oversizedEventId, kind: "reward", blockNumber: "15" },
      "oversized-payload": {
        id: "oversized-payload",
        kind: "reward",
        blockNumber: "16",
        blob: "x".repeat(17 * 1024),
      },
      "circular-payload": circularEventPayload,
      [boundaryEventId]: {
        id: boundaryEventId,
        kind: "reward",
        blockNumber: "18",
        boundary: true,
      },
    }),
    "unserializable normalized event payloads must be skipped without crashing storage writes",
  );
  const rejectedBoundedEventRows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM scoped_indexer_events
    WHERE category = ? AND (length(id) > 160 OR id IN (?, ?))
  `).get("batch_claim", "oversized-payload", "circular-payload") as { count: number };
  assert.equal(
    rejectedBoundedEventRows.count,
    0,
    "oversized ids and oversized or unserializable event payloads must not enter normalized storage",
  );
  const boundaryEventRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber
    FROM scoped_indexer_events
    WHERE category = ? AND id = ?
  `).get("batch_claim", boundaryEventId) as { count: number; blockNumber: number };
  assert.equal(boundaryEventRows.count, 1, "bounded normalized event ids must still be accepted at the documented limit");
  assert.equal(boundaryEventRows.blockNumber, 18, "bounded normalized event ids must preserve block metadata");
  const boundedBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
  assert.equal(boundedBatchClaims?.[oversizedEventId], undefined, "oversized event ids must not reach frontend reads");
  assert.equal(boundedBatchClaims?.["oversized-payload"], undefined, "oversized event payloads must not reach frontend reads");
  assert.equal(boundedBatchClaims?.["circular-payload"], undefined, "unserializable event payloads must not reach frontend reads");
  assert.equal(
    (boundedBatchClaims?.[boundaryEventId] as Record<string, unknown> | undefined)?.boundary,
    true,
    "valid event ids at the storage boundary must remain readable",
  );
  const limitedBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims", 2);
  assert.ok(limitedBatchClaims?.legacy, "limited normalized event reads must keep legacy metadata readable");
  assert.equal(limitedBatchClaims?.batch, undefined, "limited normalized event reads must not load older normalized rows");
  assert.equal(
    (limitedBatchClaims?.["single-rebate-kind"] as Record<string, unknown> | undefined)?.kind,
    "rebate",
    "limited normalized event reads must include recent normalized rows in chronological merge order",
  );
  assert.equal(
    (limitedBatchClaims?.[boundaryEventId] as Record<string, unknown> | undefined)?.boundary,
    true,
    "limited normalized event reads must include the newest normalized row",
  );
  patchJsonPath("gamedata/batchClaims", {
    "same-block-c": {
      id: "same-block-c",
      kind: "reward",
      blockNumber: "19",
      orderMarker: "second",
    },
    "same-block-a": {
      id: "same-block-a",
      kind: "reward",
      blockNumber: "19",
      orderMarker: "first",
    },
  });
  const sameBlockBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims", 2);
  const sameBlockEventIds = Object.keys(sameBlockBatchClaims ?? {}).filter((key) => key.startsWith("same-block-"));
  assert.deepEqual(
    sameBlockEventIds,
    ["same-block-a", "same-block-c"],
    "same-block normalized event reads must use deterministic id ordering after the block number tie-break",
  );
  const user = "0x0000000000000000000000000000000000000001";
  const secondUser = "0x0000000000000000000000000000000000000002";
  const betTxHash01 = `0x${"01".repeat(32)}`;
  const betTxHash02 = `0x${"02".repeat(32)}`;
  const betTxHash03 = `0x${"03".repeat(32)}`;
  const betTxHash04 = `0x${"04".repeat(32)}`;
  const betTxHash05 = `0x${"05".repeat(32)}`;
  const betTxHash06 = `0x${"06".repeat(32)}`;
  upsertBets([
    { epoch: "9", user, tileIds: [1], totalAmount: "1", totalAmountNum: 1, txHash: betTxHash01, blockNumber: "1" },
    { epoch: "8", user, tileIds: [2], totalAmount: "1", totalAmountNum: 1, txHash: betTxHash02, blockNumber: "2" },
    { epoch: "8", user, tileIds: [3], totalAmount: "1", totalAmountNum: 1, txHash: betTxHash03, blockNumber: "3" },
    { epoch: "7", user, tileIds: [4], totalAmount: "1", totalAmountNum: 1, txHash: betTxHash04, blockNumber: "4" },
    { epoch: "8", user, tileIds: [2], totalAmount: "1", totalAmountNum: 1, txHash: betTxHash05, blockNumber: "5" },
    { epoch: "8", user: secondUser, tileIds: [2, 3], totalAmount: "2", totalAmountNum: 2, txHash: betTxHash06, blockNumber: "6" },
  ]);
  upsertBets([
    { epoch: "8", user, tileIds: [2], totalAmount: "1", totalAmountNum: 1, txHash: betTxHash02.toUpperCase(), blockNumber: "12" },
  ]);
  const replayedBetRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber
    FROM scoped_bets
    WHERE id = ?
  `).get(`8_${betTxHash02}`) as { count: number; blockNumber: number };
  assert.equal(replayedBetRows.count, 1, "re-indexing the same bet event id must not grow scoped bet rows");
  assert.equal(replayedBetRows.blockNumber, 12, "re-indexing the same bet event id must update block metadata");
  upsertBets([
    { epoch: "8", user, tileIds: [24], totalAmount: "9", totalAmountNum: 9, txHash: betTxHash02, blockNumber: "11" },
  ]);
  const staleReplayedBetRows = db.prepare(`
    SELECT COUNT(*) AS count, block_number AS blockNumber, total_amount AS totalAmount, tx_hash AS txHash
    FROM scoped_bets
    WHERE id = ?
  `).get(`8_${betTxHash02}`) as { count: number; blockNumber: number; totalAmount: string; txHash: string };
  assert.equal(staleReplayedBetRows.count, 1, "stale replay of the same bet event id must not grow scoped bet rows");
  assert.equal(staleReplayedBetRows.blockNumber, 12, "stale replay of the same bet event id must not downgrade block metadata");
  assert.equal(staleReplayedBetRows.totalAmount, "1", "stale replay of the same bet event id must not downgrade amount metadata");
  assert.equal(staleReplayedBetRows.txHash, betTxHash02.toUpperCase(), "stale replay of the same bet event id must keep latest tx metadata");
  db.prepare(`
    INSERT INTO scoped_bets(
      scope, id, user, epoch, tile_ids_json, amounts_json,
      total_amount, total_amount_num, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sepolia:0x00000000000000000000000000000000000000ff",
    "foreign-contract-bet",
    user,
    999,
    "[2]",
    "[\"1000\"]",
    "1000",
    1000,
    "0xforeign",
    999,
  );
  db.prepare(`
    INSERT INTO scoped_bets(
      scope, id, user, epoch, tile_ids_json, amounts_json,
      total_amount, total_amount_num, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    foreignChainScope,
    "foreign-chain-bet",
    user,
    999,
    "[2]",
    "[\"2000\"]",
    "2000",
    2000,
    "0xforeignchain",
    1_000,
  );
  const userBetsMap = getUserBetsMap(user);
  assert.equal(
    Object.keys(userBetsMap).length,
    5,
    "deposit reads must ignore foreign contract and chain bet scopes",
  );
  assert.equal(
    userBetsMap[`8_${betTxHash02}`]?.blockNumber,
    "12",
    "deposit reads must prefer latest replay metadata for current-scope bets",
  );
  assert.equal(
    userBetsMap["foreign-contract-bet"],
    undefined,
    "deposit reads must not expose previous-contract scoped bets",
  );
  assert.equal(
    userBetsMap["foreign-chain-bet"],
    undefined,
    "deposit reads must not expose foreign-chain scoped bets",
  );
  const tileUserCounts = getEpochTileUserCounts(8);
  assert.equal(tileUserCounts[1], 2, "repeat bets by one wallet must count once per tile");
  assert.equal(tileUserCounts[2], 2, "each distinct wallet must count once per tile");
  const firstPage = getUserParticipatingEpochPage(user, { limit: 2 });
  assert.deepEqual(firstPage, { epochs: [9, 8], hasMore: true, nextCursor: 8 });
  const secondPage = getUserParticipatingEpochPage(user, { beforeEpoch: firstPage.nextCursor, limit: 2 });
  assert.deepEqual(secondPage, { epochs: [7], hasMore: false, nextCursor: null });
  db.prepare(`
    INSERT INTO scoped_bets(
      scope, id, user, epoch, tile_ids_json, amounts_json,
      total_amount, total_amount_num, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sepolia:0x0000000000000000000000000000000000000001",
    "malformed-epoch-bet",
    user,
    6.5,
    "[3]",
    "[\"0\"]",
    "0",
    0,
    "0xmalformed",
    1_001,
  );
  assert.deepEqual(
    getUserParticipatingEpochPage(user, { beforeEpoch: 7, limit: 4 }),
    { epochs: [], hasMore: false, nextCursor: null },
    "participating epoch pagination must ignore non-integer DB epoch rows",
  );
  assert.deepEqual(
    getUserParticipatingEpochPage(user, { limit: Number.NaN }),
    { epochs: [9, 8, 7], hasMore: false, nextCursor: null },
    "participating epoch pagination must recover to the default limit for invalid callers",
  );
  assert.equal(
    getGlobalStatsAggregate().totalVolumeWei,
    "7000000000000000000",
    "global stats must ignore rows from previous contract or chain scopes",
  );
  upsertEpochMap({
    "42": {
      winningTile: 3,
      totalPool: "1",
      rewardPool: "0.9",
      fee: "0.1",
      jackpotBonus: "0",
      isDailyJackpot: false,
      isWeeklyJackpot: false,
      resolvedBlock: "17",
    },
  });
  upsertEpochMap({
    "42": {
      winningTile: 4,
      totalPool: "2",
      rewardPool: "1.8",
      fee: "0.2",
      jackpotBonus: "0.1",
      isDailyJackpot: true,
      isWeeklyJackpot: false,
      resolvedBlock: "18",
    },
  });
  const replayedEpochRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(resolved_block) AS resolvedBlock, MAX(winning_tile) AS winningTile, MAX(total_pool) AS totalPool
    FROM scoped_epochs
    WHERE epoch = ?
  `).get(42) as { count: number; resolvedBlock: number; winningTile: number; totalPool: string };
  assert.equal(replayedEpochRows.count, 1, "re-indexing the same resolved epoch must not grow scoped epoch rows");
  assert.equal(replayedEpochRows.resolvedBlock, 18, "resolved epoch replay must update block metadata");
  assert.equal(replayedEpochRows.winningTile, 4, "resolved epoch replay must update the winning tile");
  assert.equal(replayedEpochRows.totalPool, "2", "resolved epoch replay must update pool metadata");
  upsertEpochMap({
    "42": {
      winningTile: 1,
      totalPool: "0.5",
      rewardPool: "0.45",
      fee: "0.05",
      jackpotBonus: "0",
      isDailyJackpot: false,
      isWeeklyJackpot: false,
      resolvedBlock: "17",
    },
  });
  upsertEpochMap({
    "42": {
      winningTile: 2,
      totalPool: "0.25",
      rewardPool: "0.2",
      fee: "0.05",
      jackpotBonus: "0",
      isDailyJackpot: false,
      isWeeklyJackpot: true,
    },
  });
  const staleReplayedEpochRows = db.prepare(`
    SELECT COUNT(*) AS count, resolved_block AS resolvedBlock, winning_tile AS winningTile,
      total_pool AS totalPool, is_daily_jackpot AS isDailyJackpot, is_weekly_jackpot AS isWeeklyJackpot
    FROM scoped_epochs
    WHERE epoch = ?
  `).get(42) as {
    count: number;
    resolvedBlock: number;
    winningTile: number;
    totalPool: string;
    isDailyJackpot: number;
    isWeeklyJackpot: number;
  };
  assert.equal(staleReplayedEpochRows.count, 1, "stale replay of the same resolved epoch must not grow scoped epoch rows");
  assert.equal(staleReplayedEpochRows.resolvedBlock, 18, "stale replay of the same resolved epoch must not downgrade resolved block metadata");
  assert.equal(staleReplayedEpochRows.winningTile, 4, "stale replay of the same resolved epoch must not downgrade winning tile metadata");
  assert.equal(staleReplayedEpochRows.totalPool, "2", "stale replay of the same resolved epoch must not downgrade pool metadata");
  assert.equal(staleReplayedEpochRows.isDailyJackpot, 1, "stale replay of the same resolved epoch must not downgrade jackpot metadata");
  assert.equal(staleReplayedEpochRows.isWeeklyJackpot, 0, "unresolved replay after resolution must not overwrite weekly jackpot metadata");
  db.prepare(`
    INSERT INTO scoped_epochs(
      scope, epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus,
      is_daily_jackpot, is_weekly_jackpot, resolved_block
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sepolia:0x00000000000000000000000000000000000000ff",
    42,
    25,
    "999",
    "999",
    "999",
    "999",
    0,
    1,
    999,
  );
  db.prepare(`
    INSERT INTO scoped_epochs(
      scope, epoch, winning_tile, total_pool, reward_pool, fee, jackpot_bonus,
      is_daily_jackpot, is_weekly_jackpot, resolved_block
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    foreignChainScope,
    42,
    24,
    "888",
    "888",
    "888",
    "888",
    0,
    1,
    1_000,
  );
  const epochMap = getEpochMap();
  assert.deepEqual(Object.keys(epochMap), ["42"], "epoch reads must ignore foreign contract and chain scopes");
  assert.equal(epochMap["42"]?.winningTile, 4, "current-scope epoch map must prefer latest replay metadata");
  assert.equal(epochMap["42"]?.totalPool, "2", "foreign scoped epochs must not override current epoch pool data");
  assert.equal(
    getGlobalStatsAggregate().resolvedEpochs,
    1,
    "global stats resolved-epoch count must ignore previous contract or chain scopes",
  );
  const jackpotTxHash = `0x${"0a".repeat(32)}`;
  const jackpotReplayTxHash = `0x${"0b".repeat(32)}`;
  upsertJackpots([
    { epoch: "21", kind: "daily", amount: "1", amountNum: 1, txHash: jackpotTxHash, blockNumber: "15" },
  ]);
  upsertJackpots([
    { epoch: "21", kind: "daily", amount: "2", amountNum: 2, txHash: jackpotReplayTxHash, blockNumber: "16" },
  ]);
  const replayedJackpotRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber, MAX(tx_hash) AS txHash, MAX(amount) AS amount
    FROM scoped_jackpots
    WHERE id = ?
  `).get("daily_21") as { count: number; blockNumber: number; txHash: string; amount: string };
  assert.equal(replayedJackpotRows.count, 1, "re-indexing the same jackpot id must not grow rows");
  assert.equal(replayedJackpotRows.blockNumber, 16, "jackpot replay must update block metadata");
  assert.equal(replayedJackpotRows.txHash, jackpotReplayTxHash, "jackpot replay must update tx hash metadata");
  assert.equal(replayedJackpotRows.amount, "2", "jackpot replay must update the normalized amount");
  const jackpotStaleReplayTxHash = `0x${"0c".repeat(32)}`;
  upsertJackpots([
    { epoch: "21", kind: "daily", amount: "0.5", amountNum: 0.5, txHash: jackpotStaleReplayTxHash, blockNumber: "15" },
  ]);
  const staleReplayedJackpotRows = db.prepare(`
    SELECT COUNT(*) AS count, block_number AS blockNumber, tx_hash AS txHash, amount
    FROM scoped_jackpots
    WHERE id = ?
  `).get("daily_21") as { count: number; blockNumber: number; txHash: string; amount: string };
  assert.equal(staleReplayedJackpotRows.count, 1, "stale replay of the same jackpot id must not grow rows");
  assert.equal(staleReplayedJackpotRows.blockNumber, 16, "stale replay of the same jackpot id must not downgrade block metadata");
  assert.equal(staleReplayedJackpotRows.txHash, jackpotReplayTxHash, "stale replay of the same jackpot id must keep latest tx metadata");
  assert.equal(staleReplayedJackpotRows.amount, "2", "stale replay of the same jackpot id must not downgrade amount metadata");
  db.prepare(`
    INSERT INTO scoped_jackpots(scope, id, epoch, kind, amount, amount_num, tx_hash, block_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sepolia:0x00000000000000000000000000000000000000ff",
    "daily_21",
    21,
    "daily",
    "999",
    999,
    "0xforeignjackpot",
    999,
  );
  db.prepare(`
    INSERT INTO scoped_jackpots(scope, id, epoch, kind, amount, amount_num, tx_hash, block_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    foreignChainScope,
    "daily_21",
    21,
    "daily",
    "999",
    999,
    "0xforeignchainjackpot",
    1_000,
  );
  const jackpotMap = getJackpotsMap();
  const recentJackpots = getRecentJackpots(5);
  assert.equal(Object.keys(jackpotMap).length, 1, "jackpot map reads must ignore foreign contract and chain scopes");
  assert.equal(recentJackpots.length, 1, "recent jackpot reads must ignore foreign contract and chain scopes");
  assert.equal(jackpotMap.daily_21?.amount, "2", "current-scope jackpot map must prefer latest replay metadata");
  assert.equal(recentJackpots[0]?.txHash, jackpotReplayTxHash, "recent jackpot reads must prefer latest replay metadata");
  const claimTxHash = `0x${"11".repeat(32)}`;
  const claimReplayTxHash = `0x${"12".repeat(32)}`;
  upsertRewardClaims([
    { id: "claim-current", epoch: "8", user, reward: "1", rewardNum: 1, txHash: claimTxHash, blockNumber: "15" },
  ]);
  upsertRewardClaims([
    { id: "claim-current", epoch: "8", user: user.toUpperCase(), reward: "2", rewardNum: 2, txHash: claimReplayTxHash, blockNumber: "16" },
  ]);
  const replayedRewardClaimRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber, MAX(tx_hash) AS txHash, MAX(reward) AS reward
    FROM scoped_reward_claims
    WHERE id = ?
  `).get("claim-current") as { count: number; blockNumber: number; txHash: string; reward: string };
  assert.equal(replayedRewardClaimRows.count, 1, "re-indexing the same reward claim id must not grow rows");
  assert.equal(replayedRewardClaimRows.blockNumber, 16, "reward claim replay must update block metadata");
  assert.equal(replayedRewardClaimRows.txHash, claimReplayTxHash, "reward claim replay must update tx hash metadata");
  assert.equal(replayedRewardClaimRows.reward, "2", "reward claim replay must update the normalized reward amount");
  const claimStaleReplayTxHash = `0x${"13".repeat(32)}`;
  upsertRewardClaims([
    { id: "claim-current", epoch: "8", user, reward: "0.5", rewardNum: 0.5, txHash: claimStaleReplayTxHash, blockNumber: "15" },
  ]);
  const staleReplayedRewardClaimRows = db.prepare(`
    SELECT COUNT(*) AS count, block_number AS blockNumber, tx_hash AS txHash, reward
    FROM scoped_reward_claims
    WHERE id = ?
  `).get("claim-current") as { count: number; blockNumber: number; txHash: string; reward: string };
  assert.equal(staleReplayedRewardClaimRows.count, 1, "stale replay of the same reward claim id must not grow rows");
  assert.equal(staleReplayedRewardClaimRows.blockNumber, 16, "stale replay of the same reward claim id must not downgrade block metadata");
  assert.equal(staleReplayedRewardClaimRows.txHash, claimReplayTxHash, "stale replay of the same reward claim id must keep latest tx metadata");
  assert.equal(staleReplayedRewardClaimRows.reward, "2", "stale replay of the same reward claim id must not downgrade reward metadata");
  db.prepare(`
    INSERT INTO scoped_reward_claims(
      scope, id, epoch, user, reward, reward_num, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sepolia:0x00000000000000000000000000000000000000ff",
    "claim-foreign-contract",
    999,
    user,
    "999",
    999,
    "0xforeignclaim",
    999,
  );
  db.prepare(`
    INSERT INTO scoped_reward_claims(
      scope, id, epoch, user, reward, reward_num, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    foreignChainScope,
    "claim-foreign-chain",
    999,
    user,
    "999",
    999,
    "0xforeignchainclaim",
    1_000,
  );
  const recentRewardClaims = getRecentRewardClaims(5);
  const allRewardClaims = getAllRewardClaims();
  assert.equal(recentRewardClaims.length, 1, "recent reward claim reads must ignore foreign contract and chain scopes");
  assert.equal(allRewardClaims.length, 1, "all reward claim reads must ignore foreign contract and chain scopes");
  assert.equal(allRewardClaims[0]?.id, "claim-current", "current-scope reward claim must remain readable");
  assert.equal(allRewardClaims[0]?.blockNumber, "16", "reward claim reads must prefer the latest replay metadata");
  assert.equal(allRewardClaims[0]?.user, user, "reward claim reads must normalize wallet addresses consistently");
  upsertProtocolFeeFlushes([
    { id: "fee-current", ownerAmount: "0.5", burnAmount: "0.25", txHash: "0xfee", blockNumber: "13" },
  ]);
  upsertProtocolFeeFlushes([
    { id: "fee-current", ownerAmount: "0.6", burnAmount: "0.3", txHash: "0xfee-replay", blockNumber: "14" },
  ]);
  const replayedProtocolFeeRows = db.prepare(`
    SELECT COUNT(*) AS count, MAX(block_number) AS blockNumber, MAX(tx_hash) AS txHash
    FROM scoped_protocol_fee_flushes
    WHERE id = ?
  `).get("fee-current") as { count: number; blockNumber: number; txHash: string };
  assert.equal(replayedProtocolFeeRows.count, 1, "re-indexing the same protocol fee flush id must not grow rows");
  assert.equal(replayedProtocolFeeRows.blockNumber, 14, "protocol fee flush replay must update block metadata");
  assert.equal(replayedProtocolFeeRows.txHash, "0xfee-replay", "protocol fee flush replay must update tx hash metadata");
  upsertProtocolFeeFlushes([
    { id: "fee-current", ownerAmount: "0.1", burnAmount: "0.05", txHash: "0xfee-stale", blockNumber: "13" },
  ]);
  const staleReplayedProtocolFeeRows = db.prepare(`
    SELECT COUNT(*) AS count, block_number AS blockNumber, tx_hash AS txHash, owner_amount AS ownerAmount, burn_amount AS burnAmount
    FROM scoped_protocol_fee_flushes
    WHERE id = ?
  `).get("fee-current") as { count: number; blockNumber: number; txHash: string; ownerAmount: string; burnAmount: string };
  assert.equal(staleReplayedProtocolFeeRows.count, 1, "stale replay of the same protocol fee flush id must not grow rows");
  assert.equal(staleReplayedProtocolFeeRows.blockNumber, 14, "stale replay of the same protocol fee flush id must not downgrade block metadata");
  assert.equal(staleReplayedProtocolFeeRows.txHash, "0xfee-replay", "stale replay of the same protocol fee flush id must keep latest tx metadata");
  assert.equal(staleReplayedProtocolFeeRows.ownerAmount, "0.6", "stale replay of the same protocol fee flush id must not downgrade owner amount");
  assert.equal(staleReplayedProtocolFeeRows.burnAmount, "0.3", "stale replay of the same protocol fee flush id must not downgrade burn amount");
  db.prepare(`
    INSERT INTO scoped_protocol_fee_flushes(
      scope, id, owner_amount, burn_amount, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "sepolia:0x00000000000000000000000000000000000000ff",
    "fee-foreign",
    "999",
    "999",
    "0xforeignfee",
    999,
  );
  db.prepare(`
    INSERT INTO scoped_protocol_fee_flushes(
      scope, id, owner_amount, burn_amount, tx_hash, block_number
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    foreignChainScope,
    "fee-foreign-chain",
    "999",
    "999",
    "0xforeignchainfee",
    1_000,
  );
  assert.equal(
    getGlobalStatsAggregate().totalBurnWei,
    "300000000000000000",
    "global stats burn accounting must use the latest current-scope protocol fee flush and ignore previous contract or chain scopes",
  );

  const sensitiveMarker = "storage-payload-must-not-reach-logs";
  for (const category of ["batch_claim", "resolver_reward", "dust_settlement"]) {
    db.prepare(`
      INSERT INTO scoped_indexer_events(scope, category, id, payload_json, block_number)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      currentScope,
      category,
      `malformed-${category}`,
      `${sensitiveMarker}-${category}{`,
      1_000,
    );
  }
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    const corruptedBatchClaims = readJsonPath<Record<string, unknown>>("gamedata/batchClaims");
    assert.ok(corruptedBatchClaims?.legacy, "malformed normalized payloads must not hide legacy metadata");
    assert.ok(corruptedBatchClaims?.batch, "malformed batch claim payloads must not hide valid normalized events");
    assert.equal(corruptedBatchClaims?.["malformed-batch_claim"], undefined, "malformed batch claim payloads must be skipped");
    const corruptedResolverRewards = readJsonPath<Record<string, unknown>>("gamedata/resolverRewards");
    assert.ok(corruptedResolverRewards?.resolver, "malformed resolver reward payloads must not hide valid normalized events");
    assert.equal(corruptedResolverRewards?.["malformed-resolver_reward"], undefined, "malformed resolver reward payloads must be skipped");
    const corruptedDustSettlements = readJsonPath<Record<string, unknown>>("gamedata/dustSettlements");
    assert.ok(corruptedDustSettlements?.dust, "malformed dust settlement payloads must not hide valid normalized events");
    assert.equal(corruptedDustSettlements?.["malformed-dust_settlement"], undefined, "malformed dust settlement payloads must be skipped");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 3, "each malformed indexed payload category should emit one bounded warning");
  assert.ok(!warnings.join(" ").includes(sensitiveMarker), "storage warnings must not echo malformed payloads");
  assert.ok(
    warnings.every((entry) => entry.length <= 180),
    "storage malformed-payload warnings must stay compact",
  );

    const financialEventCategories = rows.map((row) => row.category);
    console.log(JSON.stringify({
      status: "pass",
      categories: rows.length,
      financialEventCategories,
      legacyRead: true,
      candidatePagination: true,
      tileUserCounts: true,
      chainScopeIsolation: true,
      contractScopeIsolation: true,
      depositScopeIsolation: true,
      categoryIdIsolation: true,
      epochScopeIsolation: true,
      jackpotScopeIsolation: true,
      resolverRewardScopeIsolation: true,
      dustSettlementScopeIsolation: true,
      normalizedEventScopeIsolation: true,
      rewardClaimScopeIsolation: true,
      protocolFeeScopeIsolation: true,
      idempotentEventUpsert: true,
      staleEventReplayIgnored: true,
      staleEpochReplayIgnored: true,
      staleFinancialReplayIgnored: true,
      idempotentBetUpsert: true,
      idempotentDepositUpsert: true,
      idempotentEpochUpsert: true,
      idempotentJackpotUpsert: true,
      idempotentResolverRewardUpsert: true,
      idempotentDustSettlementUpsert: true,
      idempotentRewardClaimUpsert: true,
      idempotentProtocolFeeUpsert: true,
      normalizedEventIdRequiresTxLog: true,
      batchClaimKindParity: true,
      singleRebateClaimParity: true,
      dustSettlementKindParity: true,
      partialRpcLogFallback: true,
      malformedPayloadFallback: true,
      boundedEventStorage: true,
      limitedEventReads: true,
      sameBlockEventOrdering: true,
    }));
  } finally {
    (db as unknown as { close(): void }).close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

void main();
