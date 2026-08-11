import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");

assert.match(
  depositsRouteSource,
  /getIndexerFinalityTargetBlock, parseIndexerFinalityBlocks[\s\S]*const INDEXER_FINALITY_BLOCKS = parseIndexerFinalityBlocks\(process\.env\.INDEXER_FINALITY_BLOCKS\)[\s\S]*const ENABLE_FINALIZED_CHAIN_RECOVERY = ENABLE_CHAIN_RECOVERY && INDEXER_FINALITY_BLOCKS > 0n[\s\S]*const finalityTargetBlock = getIndexerFinalityTargetBlock\(headBlock, INDEXER_FINALITY_BLOCKS\)/,
  "deposits response recovery must use the indexer's configured positive finality target",
);

assert.match(
  depositsRouteSource,
  /async function getLogsByTopicAndUser\([\s\S]*toBlock: bigint[\s\S]*if \(startBlock > toBlock\) return all[\s\S]*for \(let from = startBlock; from <= toBlock; from \+= LOG_CHUNK_BLOCKS\)[\s\S]*toBlock: to/,
  "deposits recovery topic scans must share one explicit bounded target block",
);

assert.doesNotMatch(
  depositsRouteSource,
  /const head = await publicClient\.getBlockNumber\(\)/,
  "deposits recovery topic scans must not independently advance to the raw chain head",
);

assert.match(
  depositsRouteSource,
  /const recoveryWindowStart =[\s\S]*finalityTargetBlock - RECENT_RECOVERY_BLOCK_WINDOW \+ 1n[\s\S]*const recoveryFromBlock =[\s\S]*if \(recoveryFromBlock > finalityTargetBlock\) return \[\][\s\S]*fetchDepositsFromChain\([\s\S]*recoveryFromBlock,[\s\S]*finalityTargetBlock/,
  "deposits recovery must stay inside the finalized recent response window",
);

assert.match(
  depositsRouteSource,
  /const ENABLE_FINALIZED_CHAIN_RECOVERY = ENABLE_CHAIN_RECOVERY && INDEXER_FINALITY_BLOCKS > 0n[\s\S]*async function recoverDepositsFromChain\([\s\S]*if \(!ENABLE_FINALIZED_CHAIN_RECOVERY\) return \[\][\s\S]*const headBlock = await publicClient\.getBlockNumber\(\)/,
  "deposits recovery flag and positive finality must fail closed before any recovery RPC",
);

assert.doesNotMatch(
  depositsRouteSource,
  /patchStorage|gamedata\/bets/,
  "single-RPC public deposits recovery must remain response/cache-only and never write canonical bets",
);

assert.match(
  depositsRouteSource,
  /const currentEpochNum = ENABLE_FINALIZED_CHAIN_RECOVERY[\s\S]*: isValidEpochNumber\(indexedCurrentEpochNum\)[\s\S]*const shouldAttemptRecovery =[\s\S]*ENABLE_FINALIZED_CHAIN_RECOVERY &&[\s\S]*deposits\.length === 0 \|\| indexedEpochLag >= DEPOSIT_RECOVERY_EPOCH_LAG/,
  "disabled deposits recovery must preserve indexed reads without scheduling empty-address or lag recovery",
);

console.log("Deposits recovery safety tests passed.");
