import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contractPath = "contracts/LineaOreV9.sol";
const delegatePath = "contracts/LineaOre7702Delegate.sol";
const constantsPath = "app/lib/constants.ts";
const indexerPath = "scripts/indexer.ts";
const artifactAbiPath = "contracts_LineaOreV9_sol_LineaOreV9.abi";

const source = readFileSync(contractPath, "utf8");
const delegateSource = readFileSync(delegatePath, "utf8");
const constants = readFileSync(constantsPath, "utf8");
const indexerSource = readFileSync(indexerPath, "utf8");
const artifactAbi = JSON.parse(readFileSync(artifactAbiPath, "utf8"));

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

function declarationsFromAbi(abi, kind) {
  const out = new Set();
  for (const item of abi) {
    if (item?.type !== kind || typeof item.name !== "string") continue;
    const inputs = Array.isArray(item.inputs) ? item.inputs : [];
    out.add(`${kind} ${item.name}(${inputs.map((input) => normalizeType(input.type)).join(",")})`);
  }
  return out;
}

const splitFeesBody = extractFunctionBody("_splitFees");
const recordBetBody = extractFunctionBody("_recordBet");
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

for (const fn of [
  "claimResolverRewards",
  "flushProtocolFees",
  "claimEpochRebate",
  "claimEpochsRebate",
  "settleEpochDust",
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

const contractEvents = extractDeclarations(source, "event");
const clientEvents = extractDeclarations(constants, "event");
const contractErrors = extractDeclarations(source, "error");
const clientErrors = extractDeclarations(constants, "error");
const gameAbiBlock = extractParseAbiBlock("GAME_ABI", constants);
const gameEventsAbiBlock = extractParseAbiBlock("GAME_EVENTS_ABI", constants);
const contractFunctions = extractDeclarations(source, "function");
const clientGameFunctions = extractDeclarations(gameAbiBlock, "function");
const clientGameEvents = extractDeclarations(gameEventsAbiBlock, "event");
const artifactFunctions = declarationsFromAbi(artifactAbi, "function");
const artifactEvents = declarationsFromAbi(artifactAbi, "event");

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
    "resolveEpoch",
    "claimResolverRewards",
    "flushProtocolFees",
    "getEpochEndTime",
    "getJackpotInfo",
    "previewRebate",
    "getRebateInfo",
    "getRebateSummary",
    "getTileData",
    "getUserBetsAll",
  ])),
  actual: artifactFunctions,
  label: "critical artifact functions",
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
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "ProtocolFeesFlushed",
    "RebateClaimed",
    "RebateBatchClaimed",
  ])),
  actual: clientGameEvents,
  label: "critical game events",
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
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "ProtocolFeesFlushed",
    "RebateClaimed",
    "RebateBatchClaimed",
  ])),
  actual: artifactEvents,
  label: "critical artifact events",
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
