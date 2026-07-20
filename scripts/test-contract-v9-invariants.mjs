import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareAccountingSnapshot, replayV9Accounting } from "./lib/chain-accounting-model.mjs";

const contractPath = "contracts/LineaOreV9.sol";
const delegatePath = "contracts/LineaOre7702Delegate.sol";
const constantsPath = "app/lib/constants.ts";
const indexerPath = "scripts/indexer.ts";
const chainIndexerAuditPath = "scripts/audit-chain-indexer-window.mjs";

const source = readFileSync(contractPath, "utf8");
const delegateSource = readFileSync(delegatePath, "utf8");
const constants = readFileSync(constantsPath, "utf8");
const indexerSource = readFileSync(indexerPath, "utf8");
const chainIndexerAuditSource = readFileSync(chainIndexerAuditPath, "utf8");

const accountingReplay = replayV9Accounting({
  initial: {
    rolloverPool: 50n,
    dailyJackpotPool: 20n,
    weeklyJackpotPool: 30n,
    accruedOwnerFees: 0n,
    accruedBurnFees: 0n,
  },
  events: [
    { kind: "bet", epoch: 1, amount: 10_000n },
    { kind: "resolver-reward", epoch: 1, amount: 5n },
    { kind: "daily-jackpot", epoch: 1, amount: 220n },
    { kind: "resolve", epoch: 1, totalPool: 10_050n, fee: 300n, rewardPool: 9_470n, jackpotBonus: 220n },
    { kind: "fee-flush", epoch: 1, ownerAmount: 98n, burnAmount: 100n },
  ],
});
assert.deepEqual(accountingReplay.mismatches, []);
assert.deepEqual(compareAccountingSnapshot(accountingReplay.state, {
  rolloverPool: 0n,
  dailyJackpotPool: 0n,
  weeklyJackpotPool: 330n,
  accruedOwnerFees: 0n,
  accruedBurnFees: 0n,
}), []);

const tamperedFeeReplay = replayV9Accounting({
  initial: { rolloverPool: 0n, dailyJackpotPool: 0n, weeklyJackpotPool: 0n, accruedOwnerFees: 0n, accruedBurnFees: 0n },
  events: [
    { kind: "bet", epoch: 1, amount: 1_000n },
    { kind: "resolve", epoch: 1, totalPool: 1_000n, fee: 31n, rewardPool: 920n, jackpotBonus: 0n },
  ],
});
assert.deepEqual(tamperedFeeReplay.mismatches.map(({ kind }) => kind), ["resolve-fee"]);
assert.deepEqual(
  compareAccountingSnapshot(accountingReplay.state, {
    ...accountingReplay.state,
    dailyJackpotPool: accountingReplay.state.dailyJackpotPool + 1n,
  }).map(({ kind }) => kind),
  ["dailyJackpotPool"],
);

const rolloverReplay = replayV9Accounting({
  initial: { rolloverPool: 0n, dailyJackpotPool: 0n, weeklyJackpotPool: 0n, accruedOwnerFees: 0n, accruedBurnFees: 0n },
  events: [
    { kind: "bet", epoch: 2, amount: 1_000n },
    { kind: "resolve", epoch: 2, totalPool: 1_000n, fee: 30n, rewardPool: 0n, jackpotBonus: 0n },
    { kind: "bet", epoch: 3, amount: 1_000n },
    { kind: "resolve", epoch: 3, totalPool: 1_920n, fee: 30n, rewardPool: 1_840n, jackpotBonus: 0n },
  ],
});
assert.deepEqual(rolloverReplay.mismatches, []);

function getConstantBigInt(name) {
  const match = source.match(new RegExp(`uint256\\s+public\\s+constant\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `missing constant ${name}`);
  return BigInt(match[1].replace(/_/g, "").trim());
}

function extractFunctionBody(name, sourceText = source) {
  const marker = `function ${name}`;
  const start = sourceText.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = sourceText.indexOf("{", start);
  assert.notEqual(open, -1, `missing function body ${name}`);
  let depth = 0;
  for (let index = open; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function extractFunctionSignatureTail(name, sourceText = source) {
  const regex = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*([^{};]*)\\{`);
  const match = sourceText.match(regex);
  assert.ok(match, `missing function signature ${name}`);
  return match[1];
}

function splitArgs(args) {
  const trimmed = args.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((arg) => arg.trim());
}

function normalizeType(type) {
  return type
    .replace(/\bcalldata\b/g, "")
    .replace(/\bmemory\b/g, "")
    .replace(/\bstorage\b/g, "")
    .replace(/\s+/g, "")
    .replace(/^uint($|\[)/, "uint256$1")
    .replace(/^int($|\[)/, "int256$1");
}

function normalizeDeclaration(kind, name, args) {
  const types = splitArgs(args).map((arg) => {
    const withoutIndexed = arg.replace(/\bindexed\b/g, "").trim();
    const parts = withoutIndexed.split(/\s+/).filter(Boolean);
    assert.ok(parts.length >= 1, `bad ${kind} arg in ${name}: ${arg}`);
    return normalizeType(parts[0]);
  });
  return `${kind} ${name}(${types.join(",")})`;
}

function extractDeclarations(text, kind) {
  const regex = new RegExp(`${kind}\\s+(\\w+)\\s*\\(([^)]*)\\)`, "g");
  const out = new Set();
  for (const match of text.matchAll(regex)) {
    out.add(normalizeDeclaration(kind, match[1], match[2]));
  }
  return out;
}

function extractParseAbiBlock(name, text) {
  const marker = `export const ${name} = parseAbi([`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = text.indexOf("]);", start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return text.slice(start, end);
}

function assertSubset({ expected, actual, label }) {
  const missing = [...expected].filter((item) => !actual.has(item));
  assert.deepEqual(missing, [], `${label} missing from client ABI`);
}

function filterDeclarationsByName(declarations, names) {
  return new Set([...declarations].filter((item) => names.has(item.match(/^\w+\s+(\w+)\(/)?.[1])));
}


const splitFeesBody = extractFunctionBody("_splitFees");
const recordBetBody = extractFunctionBody("_recordBet");
const recordEpochVolumeBody = extractFunctionBody("_recordEpochVolume");
assert.match(
  source,
  /function\s+_recordBet\(uint256\s+epoch,\s*address\s+user,\s*uint256\s+tileId,\s*uint256\s+amount\)\s+internal/,
  "_recordBet must receive the caller-cached epoch instead of re-reading currentEpoch per tile",
);
assert.doesNotMatch(
  recordBetBody,
  /currentEpoch/,
  "_recordBet must not re-read currentEpoch for each selected tile",
);
assert.match(
  recordBetBody,
  /uint256\s+previousBet\s*=\s*userBets\[epoch\]\[tileId\]\[user\];/,
  "_recordBet must use the existing user bet as the first-tile sentinel",
);
assert.match(
  recordBetBody,
  /if\s*\(previousBet\s*==\s*0\)\s*\{\s*tileUserCounts\[epoch\]\[tileId\]\s*\+=\s*1;/s,
  "_recordBet must increment a tile's user count exactly once per user and epoch",
);
assert.match(
  recordBetBody,
  /userBets\[epoch\]\[tileId\]\[user\]\s*=\s*previousBet\s*\+\s*amount;/,
  "_recordBet must preserve cumulative user bet accounting",
);
assert.doesNotMatch(recordBetBody, /userEpochVolumes|epochs\[epoch\]\.totalPool/, "per-tile accounting must not rewrite aggregate epoch volume");
assert.match(recordEpochVolumeBody, /userEpochVolumes\[epoch\]\[user\]\s*\+=\s*totalAmount/);
assert.match(recordEpochVolumeBody, /epochs\[epoch\]\.totalPool\s*\+=\s*totalAmount/);
for (const fn of ["placeBet", "placeBatchBets", "placeBatchBetsSameAmount", "placeBatchBetsBitmap"]) {
  const body = extractFunctionBody(fn);
  assert.equal(
    body.match(/_recordEpochVolume\(/g)?.length,
    1,
    `${fn} must update aggregate epoch volume exactly once per transaction`,
  );
}
assert.doesNotMatch(
  source,
  /hasUserBetOnTile/,
  "V9 must not pay for a duplicate first-bet boolean when userBets already provides that sentinel",
);
assert.match(splitFeesBody, /uint256\s+freshPool\s*=\s*ep\.totalPool;/);
assert.match(splitFeesBody, /uint256\s+pool\s*=\s*L\.totalPoolWithRollover;/);
for (const feeName of [
  "DAILY_JACKPOT_PERCENT",
  "WEEKLY_JACKPOT_PERCENT",
  "PROTOCOL_FEE_PERCENT",
  "BURN_FEE_PERCENT",
  "RESOLVER_REWARD_BPS",
]) {
  assert.ok(
    splitFeesBody.includes(`freshPool * ${feeName}`) ||
      splitFeesBody.includes(`freshPool * ${feeName})`),
    `_splitFees must calculate ${feeName} from freshPool`,
  );
  assert.ok(!splitFeesBody.includes(`pool * ${feeName}`), `_splitFees must not calculate ${feeName} from rollover-inclusive pool`);
}

const previewRebateBody = extractFunctionBody("_previewRebate");
assert.match(previewRebateBody, /isResolved/, "_previewRebate must only calculate Safety Pool after resolution");
assert.match(previewRebateBody, /DUST_SETTLE_DELAY/, "_previewRebate must expire after the one-year claim window");
assert.match(previewRebateBody, /epochRebateClaimed\[epoch\]/, "_previewRebate must cap claims by the unclaimed rebate balance");
assert.match(previewRebateBody, /winningTile/, "_previewRebate must inspect the epoch winning tile");
assert.match(
  previewRebateBody,
  /userBets\[epoch\]\[winningTile\]\[user\]/,
  "_previewRebate must exclude users who bet on the winning tile",
);
assert.match(
  previewRebateBody,
  /totalPool\s*-\s*tilePools\[epoch\]\[winningTile\]/,
  "_previewRebate must divide Safety Pool over losing-player volume",
);
assert.match(
  previewRebateBody,
  /rebatePool\s*\*\s*userVolume\)\s*\/\s*losingVolume/,
  "_previewRebate must calculate Safety Pool from losing volume, not total volume",
);

const consumeRebateBody = extractFunctionBody("_consumeRebate");
assert.match(consumeRebateBody, /rebateClaimed\[epoch\]\[user\]\s*=\s*true/, "rebate consumption must prevent duplicate claims");
assert.match(consumeRebateBody, /epochRebateClaimed\[epoch\]\s*\+=\s*amount/, "rebate consumption must track aggregate claims");

const settleEpochDustBody = extractFunctionBody("settleEpochDust");
assert.match(settleEpochDustBody, /DUST_SETTLE_DELAY/, "single reward dust settlement must wait one year");
assert.match(settleEpochDustBody, /_settleRewardDustIfAvailable\(epoch\)/, "single reward dust settlement must reuse shared accounting");
assert.match(settleEpochDustBody, /token\.safeTransfer\(feeRecipient,\s*dust\)/, "reward dust must only go to the timelocked fee recipient");

const settleEpochsDustBody = extractFunctionBody("settleEpochsDust");
assert.match(settleEpochsDustBody, /_settleRewardDustIfAvailable\(rewardEpochs\[i\]\)/, "batch reward settlement must reuse shared accounting");
assert.match(settleEpochsDustBody, /token\.safeTransfer\(feeRecipient,\s*totalDust\)/, "batch reward settlement must use one aggregate transfer");
assert.match(settleEpochsDustBody, /emit RewardDustBatchSettled\(totalDust,\s*epochsSettled\)/, "batch reward settlement must emit its aggregate result");

const settleRewardDustIfAvailableBody = extractFunctionBody("_settleRewardDustIfAvailable");
assert.match(settleRewardDustIfAvailableBody, /DUST_SETTLE_DELAY/, "shared reward dust accounting must enforce the one-year delay");
assert.match(settleRewardDustIfAvailableBody, /epochDustSettled\[epoch\]\s*=\s*true/, "shared reward dust accounting must close liabilities before transfer");
assert.match(settleRewardDustIfAvailableBody, /emit RewardDustSettled\(epoch,\s*dust\)/, "shared reward dust accounting must preserve per-epoch evidence");

const settleEpochRebateDustBody = extractFunctionBody("settleEpochRebateDust");
assert.match(settleEpochRebateDustBody, /DUST_SETTLE_DELAY/, "rebate dust settlement must wait one year");
assert.match(settleEpochRebateDustBody, /token\.safeTransfer\(feeRecipient,\s*dust\)/, "rebate dust must only go to the timelocked fee recipient");

const settleEpochsRebateDustBody = extractFunctionBody("settleEpochsRebateDust");
assert.match(settleEpochsRebateDustBody, /_settleRebateDustIfAvailable\(rebateEpochs\[i\]\)/, "batch rebate settlement must reuse the shared accounting path");
assert.match(settleEpochsRebateDustBody, /token\.safeTransfer\(feeRecipient,\s*totalDust\)/, "batch rebate settlement must use one aggregate transfer");
assert.match(settleEpochsRebateDustBody, /emit RebateDustBatchSettled\(totalDust,\s*epochsSettled\)/, "batch rebate settlement must emit its aggregate result");

const settleRebateDustIfAvailableBody = extractFunctionBody("_settleRebateDustIfAvailable");
assert.match(settleRebateDustIfAvailableBody, /DUST_SETTLE_DELAY/, "shared rebate dust accounting must enforce the one-year delay");
assert.match(settleRebateDustIfAvailableBody, /epochRebateClaimed\[epoch\]\s*=\s*rebatePool/, "shared rebate dust accounting must close liabilities before transfer");
assert.match(settleRebateDustIfAvailableBody, /emit RebateDustSettled\(epoch,\s*dust\)/, "shared rebate dust accounting must preserve per-epoch evidence");

const claimRewardBody = extractFunctionBody("claimReward");
assert.match(claimRewardBody, /if\s*\(reward\s*==\s*0\)\s*revert\s+NothingToClaim\(\)/, "single reward claims must reject zero-rounded payouts");
assert.ok(
  claimRewardBody.indexOf("if (reward == 0)") < claimRewardBody.indexOf("hasClaimed[msg.sender][epoch] = true"),
  "single reward claims must validate a non-zero payout before closing user state",
);

for (const fn of [
  "claimResolverRewards",
  "flushProtocolFees",
  "claimEpochRebate",
  "claimEpochsRebate",
  "settleEpochDust",
  "settleEpochsDust",
  "settleEpochRebateDust",
  "settleEpochsRebateDust",
  "placeBet",
  "placeBatchBets",
  "placeBatchBetsSameAmount",
  "placeBatchBetsBitmap",
  "resolveEpoch",
  "claimReward",
  "claimRewards",
]) {
  const signatureTail = extractFunctionSignatureTail(fn);
  assert.match(signatureTail, /\bexternal\b/, `${fn} must stay external`);
  assert.match(signatureTail, /\bnonReentrant\b/, `${fn} must stay nonReentrant`);
}

for (const fn of [
  "placeBet",
  "placeBatchBets",
  "placeBatchBetsSameAmount",
  "placeBatchBetsBitmap",
]) {
  const body = extractFunctionBody(fn);
  const autoResolveIndex = body.indexOf("_autoResolveIfNeeded();");
  const checkWindowIndex = body.indexOf("_checkBetWindow();");
  assert.ok(autoResolveIndex >= 0, `${fn} must auto-resolve expired epochs before accepting bets`);
  assert.ok(checkWindowIndex >= 0, `${fn} must enforce the late-bet grace window`);
  assert.ok(autoResolveIndex < checkWindowIndex, `${fn} must resolve before checking the active bet window`);
}

const checkBetWindowBody = extractFunctionBody("_checkBetWindow");
assert.match(checkBetWindowBody, /block\.timestamp\s*>=\s*endTime[\s\S]*EpochEnded/, "_checkBetWindow must reject already-ended epochs");
assert.match(
  checkBetWindowBody,
  /block\.timestamp\s*\+\s*LAST_BET_GRACE_SECONDS\s*>=\s*endTime[\s\S]*EpochClosing/,
  "_checkBetWindow must reject bets inside the late-bet grace window",
);

const renounceOwnershipTail = extractFunctionSignatureTail("renounceOwnership");
const renounceOwnershipBody = extractFunctionBody("renounceOwnership");
assert.match(renounceOwnershipTail, /\boverride\b/, "renounceOwnership must override OpenZeppelin ownership behavior");
assert.match(renounceOwnershipTail, /\bonlyOwner\b/, "renounceOwnership must remain owner-gated");
assert.match(renounceOwnershipBody, /OwnershipRenounceDisabled/, "renounceOwnership must remain disabled for production safety");

const claimRewardsBody = extractFunctionBody("claimRewards");
assert.match(claimRewardsBody, /if\s*\(reward\s*>\s*0\)/, "batch reward claims must skip zero-rounded payouts");
assert.ok(
  claimRewardsBody.indexOf("if (reward > 0)") < claimRewardsBody.indexOf("hasClaimed[msg.sender][epoch] = true"),
  "batch reward claims must validate a non-zero payout before closing user state",
);
const rewardPerEpochEventIndex = claimRewardsBody.indexOf("emit RewardClaimed");
const rewardTransferIndex = claimRewardsBody.indexOf("token.safeTransfer(msg.sender, totalReward)");
const rewardBatchEventIndex = claimRewardsBody.indexOf("emit RewardBatchClaimed");
assert.ok(rewardPerEpochEventIndex >= 0, "claimRewards must emit per-epoch RewardClaimed events for indexer detail");
assert.ok(rewardTransferIndex >= 0, "claimRewards must use one aggregate token transfer");
assert.ok(rewardBatchEventIndex >= 0, "claimRewards must emit an aggregate RewardBatchClaimed event");
assert.ok(
  rewardPerEpochEventIndex < rewardTransferIndex && rewardTransferIndex < rewardBatchEventIndex,
  "claimRewards must emit detailed reward events before the aggregate transfer and summary event",
);

const claimEpochsRebateBody = extractFunctionBody("claimEpochsRebate");
const rebatePerEpochEventIndex = claimEpochsRebateBody.indexOf("emit RebateClaimed");
const rebateTransferIndex = claimEpochsRebateBody.indexOf("token.safeTransfer(msg.sender, totalAmount)");
const rebateBatchEventIndex = claimEpochsRebateBody.indexOf("emit RebateBatchClaimed");
assert.ok(rebatePerEpochEventIndex >= 0, "claimEpochsRebate must emit per-epoch RebateClaimed events for indexer detail");
assert.ok(rebateTransferIndex >= 0, "claimEpochsRebate must use one aggregate token transfer");
assert.ok(rebateBatchEventIndex >= 0, "claimEpochsRebate must emit an aggregate RebateBatchClaimed event");
assert.ok(
  rebatePerEpochEventIndex < rebateTransferIndex && rebateTransferIndex < rebateBatchEventIndex,
  "claimEpochsRebate must emit detailed rebate events before the aggregate transfer and summary event",
);

const DAILY_JACKPOT_PERCENT = getConstantBigInt("DAILY_JACKPOT_PERCENT");
const WEEKLY_JACKPOT_PERCENT = getConstantBigInt("WEEKLY_JACKPOT_PERCENT");
const PROTOCOL_FEE_PERCENT = getConstantBigInt("PROTOCOL_FEE_PERCENT");
const BURN_FEE_PERCENT = getConstantBigInt("BURN_FEE_PERCENT");
const RESOLVER_REWARD_BPS = getConstantBigInt("RESOLVER_REWARD_BPS");
const BPS_DENOMINATOR = getConstantBigInt("BPS_DENOMINATOR");

function splitFeesModel(freshPool, rolloverPool) {
  const pool = freshPool + rolloverPool;
  if (freshPool === 0n) {
    return {
      baseReward: pool,
      burnAmount: 0n,
      dailyAccrual: 0n,
      protocolFee: 0n,
      resolverReward: 0n,
      weeklyAccrual: 0n,
    };
  }

  const dailyAccrual = (freshPool * DAILY_JACKPOT_PERCENT) / 100n;
  const weeklyAccrual = (freshPool * WEEKLY_JACKPOT_PERCENT) / 100n;
  const protocolFee = (freshPool * PROTOCOL_FEE_PERCENT) / 100n;
  const burnAmount = (freshPool * BURN_FEE_PERCENT) / 100n;
  let resolverReward = (freshPool * RESOLVER_REWARD_BPS) / BPS_DENOMINATOR;
  if (resolverReward > protocolFee) resolverReward = protocolFee;
  return {
    baseReward: pool - dailyAccrual - weeklyAccrual - protocolFee - burnAmount,
    burnAmount,
    dailyAccrual,
    protocolFee,
    resolverReward,
    weeklyAccrual,
  };
}

const token = 10n ** 18n;
assert.deepEqual(splitFeesModel(0n, 500n * token), {
  baseReward: 500n * token,
  burnAmount: 0n,
  dailyAccrual: 0n,
  protocolFee: 0n,
  resolverReward: 0n,
  weeklyAccrual: 0n,
});

const rolloverCase = splitFeesModel(1_000n * token, 500n * token);
assert.equal(rolloverCase.dailyAccrual, 20n * token);
assert.equal(rolloverCase.weeklyAccrual, 30n * token);
assert.equal(rolloverCase.protocolFee, 20n * token);
assert.equal(rolloverCase.burnAmount, 10n * token);
assert.equal(rolloverCase.resolverReward, token / 2n);
assert.equal(rolloverCase.baseReward, 1_420n * token);

const MAX_UINT256 = (1n << 256n) - 1n;
const feeMultipliers = [
  DAILY_JACKPOT_PERCENT,
  WEEKLY_JACKPOT_PERCENT,
  PROTOCOL_FEE_PERCENT,
  BURN_FEE_PERCENT,
  RESOLVER_REWARD_BPS,
];
const maxFeeMultiplier = feeMultipliers.reduce((max, value) => (value > max ? value : max), 1n);
const MAX_SAFE_PERCENT_POOL = MAX_UINT256 / maxFeeMultiplier;
let fuzzState = 0x6c6f7265n;
function nextFuzzValue() {
  fuzzState ^= fuzzState << 13n;
  fuzzState ^= fuzzState >> 7n;
  fuzzState ^= fuzzState << 17n;
  return fuzzState & ((1n << 128n) - 1n);
}

const feeEdgeCases = [
  [0n, 0n],
  [0n, MAX_UINT256],
  [1n, 0n],
  [100n, 1n],
  [MAX_SAFE_PERCENT_POOL, MAX_UINT256 - MAX_SAFE_PERCENT_POOL],
];
for (let index = 0; index < 10_000; index += 1) {
  const freshPool = nextFuzzValue() % (10n ** 36n);
  const rolloverPool = nextFuzzValue() % (10n ** 36n);
  feeEdgeCases.push([freshPool, rolloverPool]);
}
for (const [freshPool, rolloverPool] of feeEdgeCases) {
  const result = splitFeesModel(freshPool, rolloverPool);
  assert.equal(
    result.baseReward + result.dailyAccrual + result.weeklyAccrual + result.protocolFee + result.burnAmount,
    freshPool + rolloverPool,
    "fee split must conserve the rollover-inclusive pool",
  );
  assert.ok(result.resolverReward <= result.protocolFee, "resolver reward must stay inside protocol fees");
  assert.ok(result.baseReward >= rolloverPool, "fees must never be charged against rollover");
  for (const multiplier of feeMultipliers) {
    assert.ok(freshPool * multiplier <= MAX_UINT256, "configured test domain must not overflow Solidity fee math");
  }
}

const bitmapBody = extractFunctionBody("placeBatchBetsBitmap");
assert.match(bitmapBody, /tileMask\s*&\s*~MAX_TILE_MASK/, "bitmap path must reject bits above tile 25");
assert.match(bitmapBody, /amount\s*\*\s*tileCount/, "bitmap path must charge exactly amount times selected tiles");
const maxTileMask = (1n << 25n) - 1n;
assert.equal(maxTileMask.toString(2).length, 25);
for (let index = 0; index < 10_000; index += 1) {
  const mask = nextFuzzValue() & maxTileMask;
  const expectedCount = mask.toString(2).replaceAll("0", "").length;
  let remaining = mask;
  let actualCount = 0;
  while (remaining !== 0n) {
    actualCount += Number(remaining & 1n);
    remaining >>= 1n;
  }
  assert.equal(actualCount, expectedCount, "bitmap tile count must match popcount");
  assert.ok(actualCount >= 0 && actualCount <= 25, "bitmap must select at most 25 tiles");
}
assert.equal(maxTileMask.toString(2).replaceAll("0", "").length, 25, "all 25 tiles must fit the bitmap path");

for (let index = 0; index < 2_000; index += 1) {
  const participantCount = Number(nextFuzzValue() % 25n) + 1;
  const bets = Array.from({ length: participantCount }, () => (nextFuzzValue() % (10n ** 24n)) + 1n);
  const totalBet = bets.reduce((sum, bet) => sum + bet, 0n);
  const rewardPool = nextFuzzValue() % (10n ** 30n);
  const claims = bets.map((bet) => (rewardPool * bet) / totalBet);
  assert.ok(
    claims.reduce((sum, claim) => sum + claim, 0n) <= rewardPool,
    "rounded winner claims must not exceed the reward pool",
  );
}

assert.match(source, /using\s+SafeERC20\s+for\s+IERC20\s*;/, "token operations must retain SafeERC20 compatibility");
assert.doesNotMatch(source, /token\.(?:transfer|transferFrom)\s*\(/, "raw ERC-20 transfer calls must not bypass SafeERC20");
for (const fn of ["claimReward", "claimEpochRebate"]) {
  const body = extractFunctionBody(fn);
  assert.match(body, /AlreadyClaimed/, `${fn} must reject a repeated claim`);
  assert.ok(
    body.indexOf("= true") < body.indexOf("token.safeTransfer"),
    `${fn} must mark the claim before the external token transfer`,
  );
}
assert.match(extractFunctionBody("resolveEpoch"), /AlreadyResolved/, "resolveEpoch must reject repeated resolution");

function safetyPoolModel({ isResolved, rebatePool, totalPool, winningTilePool, userVolume, userWinningVolume }) {
  if (!isResolved || totalPool === 0n || rebatePool === 0n || userVolume === 0n) return 0n;
  if (userWinningVolume > 0n) return 0n;
  const losingVolume = totalPool - winningTilePool;
  if (losingVolume === 0n) return 0n;
  return (rebatePool * userVolume) / losingVolume;
}

assert.equal(
  safetyPoolModel({
    isResolved: true,
    rebatePool: 100n * token,
    totalPool: 10_000n * token,
    winningTilePool: 2_000n * token,
    userVolume: 100n * token,
    userWinningVolume: 0n,
  }),
  (100n * token * 100n * token) / (8_000n * token),
);
assert.equal(
  safetyPoolModel({
    isResolved: true,
    rebatePool: 100n * token,
    totalPool: 10_000n * token,
    winningTilePool: 2_000n * token,
    userVolume: 100n * token,
    userWinningVolume: 1n,
  }),
  0n,
);
assert.equal(
  safetyPoolModel({
    isResolved: false,
    rebatePool: 100n * token,
    totalPool: 10_000n * token,
    winningTilePool: 2_000n * token,
    userVolume: 100n * token,
    userWinningVolume: 0n,
  }),
  0n,
);

for (let index = 0; index < 5_000; index += 1) {
  const losingParticipantCount = Number(nextFuzzValue() % 25n) + 1;
  const losingVolumes = Array.from(
    { length: losingParticipantCount },
    () => (nextFuzzValue() % (10n ** 24n)) + 1n,
  );
  const losingVolume = losingVolumes.reduce((sum, value) => sum + value, 0n);
  const winningTilePool = nextFuzzValue() % (10n ** 30n);
  const totalPool = winningTilePool + losingVolume;
  const rebatePool = nextFuzzValue() % (10n ** 30n);
  const rebates = losingVolumes.map((userVolume) => safetyPoolModel({
    isResolved: true,
    rebatePool,
    totalPool,
    winningTilePool,
    userVolume,
    userWinningVolume: 0n,
  }));

  assert.ok(
    rebates.reduce((sum, rebate) => sum + rebate, 0n) <= rebatePool,
    "rounded Safety Pool claims must not exceed the epoch rebate pool",
  );
  assert.equal(
    safetyPoolModel({
      isResolved: true,
      rebatePool,
      totalPool,
      winningTilePool,
      userVolume: losingVolumes[0],
      userWinningVolume: 1n,
    }),
    0n,
    "a winning-tile participant must not receive a Safety Pool rebate",
  );
}

assert.equal(
  safetyPoolModel({
    isResolved: true,
    rebatePool: (1n << 128n) - 1n,
    totalPool: (1n << 128n) - 1n,
    winningTilePool: 0n,
    userVolume: (1n << 128n) - 1n,
    userWinningVolume: 0n,
  }),
  (1n << 128n) - 1n,
  "a sole losing participant must receive the complete rebate pool within the safe arithmetic domain",
);

const contractEvents = extractDeclarations(source, "event");
const clientEvents = extractDeclarations(constants, "event");
const contractErrors = extractDeclarations(source, "error");
const clientErrors = extractDeclarations(constants, "error");
const gameAbiBlock = extractParseAbiBlock("GAME_ABI", constants);
const gameEventsAbiBlock = extractParseAbiBlock("GAME_EVENTS_ABI", constants);
const contractFunctions = extractDeclarations(source, "function");
const clientGameFunctions = extractDeclarations(gameAbiBlock, "function");
const clientGameEvents = extractDeclarations(gameEventsAbiBlock, "event");

assertSubset({ expected: contractEvents, actual: clientEvents, label: "events" });
assertSubset({ expected: contractErrors, actual: clientErrors, label: "errors" });
assertSubset({
  expected: filterDeclarationsByName(contractFunctions, new Set([
    "placeBet",
    "placeBatchBets",
    "placeBatchBetsSameAmount",
    "placeBatchBetsBitmap",
    "claimReward",
    "claimRewards",
    "claimEpochRebate",
    "claimEpochsRebate",
    "settleEpochDust",
    "settleEpochsDust",
    "settleEpochRebateDust",
    "settleEpochsRebateDust",
    "resolveEpoch",
    "claimResolverRewards",
    "flushProtocolFees",
    "scheduleEpochDuration",
    "cancelEpochDurationChange",
    "scheduleFeeRecipientChange",
    "cancelFeeRecipientChange",
    "getEpochEndTime",
    "getJackpotInfo",
    "previewRebate",
    "getRebateInfo",
    "getRebateSummary",
    "getTileData",
    "getUserBetsAll",
  ])),
  actual: clientGameFunctions,
  label: "critical game functions",
});
assertSubset({
  expected: filterDeclarationsByName(contractEvents, new Set([
    "BetPlaced",
    "BatchBetsPlaced",
    "BatchBetsSameAmountPlaced",
    "BatchBetsBitmapPlaced",
    "EpochResolved",
    "RewardClaimed",
    "RewardBatchClaimed",
    "DailyJackpotAwarded",
    "WeeklyJackpotAwarded",
    "RewardDustSettled",
    "RewardDustBatchSettled",
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "ProtocolFeesFlushed",
    "RebateClaimed",
    "RebateBatchClaimed",
    "RebateDustSettled",
    "RebateDustBatchSettled",
  ])),
  actual: clientGameEvents,
  label: "critical game events",
});

const indexerEvents = extractDeclarations(indexerSource, "event");
assertSubset({
  expected: filterDeclarationsByName(contractEvents, new Set([
    "BetPlaced",
    "BatchBetsPlaced",
    "BatchBetsSameAmountPlaced",
    "BatchBetsBitmapPlaced",
    "EpochResolved",
    "RewardClaimed",
    "RewardBatchClaimed",
    "DailyJackpotAwarded",
    "WeeklyJackpotAwarded",
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "ProtocolFeesFlushed",
    "RebateClaimed",
    "RebateBatchClaimed",
    "RewardDustSettled",
    "RebateDustSettled",
  ])),
  actual: indexerEvents,
  label: "critical indexer events",
});
assert.match(
  indexerSource,
  /decoded\.eventName !== "RebateClaimed"[\s\S]*epochsClaimed:\s*1/,
  "indexer must store single RebateClaimed events as one-epoch rebate claim activity",
);
assert.match(
  indexerSource,
  /rebateBatchClaimTxs[\s\S]*topic0 === rebateClaimedSig[\s\S]*rebateBatchClaimTxs\.has/,
  "indexer must not duplicate RebateClaimed rows when the same tx also has RebateBatchClaimed",
);
assert.match(
  indexerSource,
  /decoded\.eventName !== "RewardDustSettled"[\s\S]*decoded\.eventName !== "RebateDustSettled"[\s\S]*gamedata\/dustSettlements/,
  "indexer must retain per-epoch reward and rebate dust settlement evidence",
);
assert.match(
  indexerSource,
  /dailyJackpotEpochs\.has\(args\.epoch\.toString\(\)\)[\s\S]*weeklyJackpotEpochs\.has\(args\.epoch\.toString\(\)\)/,
  "resolved epoch rows must preserve jackpot flags when award events precede EpochResolved",
);
assert.match(
  chainIndexerAuditSource,
  /RewardDustSettled[\s\S]*RebateDustSettled[\s\S]*gamedata:dustSettlements[\s\S]*dust-settlement/,
  "chain-to-indexer audit must verify reward and rebate dust settlement evidence",
);
assert.match(
  chainIndexerAuditSource,
  /readAccountingSnapshot[\s\S]*replayV9Accounting[\s\S]*compareAccountingSnapshot/,
  "chain-to-indexer audit must replay rollover, jackpot, and fee-bucket accounting against historical snapshots",
);

assert.match(delegateSource, /address\s+public\s+immutable\s+allowedToken\s*;/);
assert.match(delegateSource, /address\s+public\s+immutable\s+allowedGame\s*;/);
assert.match(delegateSource, /address\s+public\s+immutable\s+allowedSpender\s*;/);
assert.match(delegateSource, /constructor\s*\(\s*address\s+token_,\s*address\s+game_,\s*address\s+spender_\s*\)/);

for (const fn of [
  "approveAndPlaceBatchSameAmount",
  "approveAndPlaceBatchBitmap",
]) {
  const body = extractFunctionBody(fn, delegateSource);
  assert.ok(body.includes("_requireAllowed(token, allowedToken)"), `${fn} must restrict token`);
  assert.ok(body.includes("_requireAllowed(game, allowedGame)"), `${fn} must restrict game`);
  assert.ok(body.includes("_requireAllowed(spender, allowedSpender)"), `${fn} must restrict spender`);
}

for (const fn of [
  "placeBatchSameAmount",
  "placeBatchBitmap",
  "claimRewards",
  "claimEpochsRebate",
  "resolveEpoch",
  "claimResolverRewards",
]) {
  const body = extractFunctionBody(fn, delegateSource);
  assert.ok(body.includes("_requireAllowed(game, allowedGame)"), `${fn} must restrict game`);
}

console.log("Contract V9 invariant checks passed.");
