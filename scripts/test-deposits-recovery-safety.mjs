import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");

assert.match(
  depositsRouteSource,
  /isFinalizedDepositsRecoveryEnabled,[\s\S]*planFinalizedDepositsRecoveryRange,[\s\S]*const ENABLE_FINALIZED_CHAIN_RECOVERY = isFinalizedDepositsRecoveryEnabled\([\s\S]*const recoveryRange = planFinalizedDepositsRecoveryRange\(\{[\s\S]*enabled: ENABLE_FINALIZED_CHAIN_RECOVERY,[\s\S]*headBlock,[\s\S]*finalityBlocks: INDEXER_FINALITY_BLOCKS,[\s\S]*contractDeployBlock: CONTRACT_DEPLOY_BLOCK,[\s\S]*latestIndexedBlock,[\s\S]*recentWindowBlocks: RECENT_RECOVERY_BLOCK_WINDOW/,
  "deposits recovery must wire the executable finalized-range planner to bounded production inputs",
);

assert.match(
  depositsRouteSource,
  /DEPOSITS_RECOVERY_SHARED_LOCK_TTL_MS = 1_800_000/,
  "the shared recovery lock must outlive the bounded worst-case RPC sequence",
);

assert.match(
  depositsRouteSource,
  /requiresExternalSharedLock\(\)[\s\S]*hasPublicExternalRateLimitStore\(\)[\s\S]*fallback: "deny"[\s\S]*consumeExternalRateLimit\([\s\S]*"api-deposits-chain-recovery"[\s\S]*"global"[\s\S]*1,[\s\S]*DEPOSITS_RECOVERY_SHARED_BUDGET_WINDOW_MS[\s\S]*acquireExternalExpiringLock\([\s\S]*"api-deposits-chain-recovery"[\s\S]*DEPOSITS_RECOVERY_SHARED_LOCK_TTL_MS/,
  "multi-replica deposits recovery must fail closed without the external store and use one shared budget plus expiring lock before RPC work",
);

assert.match(
  depositsRouteSource,
  /async function getLogsByTopicAndUser\([\s\S]*toBlock: bigint[\s\S]*if \(startBlock > toBlock\) return all[\s\S]*for \(let from = startBlock; from <= toBlock; from \+= LOG_CHUNK_BLOCKS\)[\s\S]*toBlock: to/,
  "deposits recovery topic scans must share one explicit bounded target block",
);

assert.match(
  depositsRouteSource,
  /if \(recoveryRange === null\) return \[\];[\s\S]*fetchDepositsFromChain\([\s\S]*recoveryRange\.fromBlock,[\s\S]*recoveryRange\.toBlock/,
  "deposits recovery must stop on a rejected plan and pass only the plan's explicit finalized bounds",
);

assert.doesNotMatch(
  depositsRouteSource,
  /patchStorage|gamedata\/bets/,
  "single-RPC public deposits recovery must remain response/cache-only and never write canonical bets",
);

console.log("Deposits recovery safety wiring tests passed; executable range policy is covered by the identity probe.");
