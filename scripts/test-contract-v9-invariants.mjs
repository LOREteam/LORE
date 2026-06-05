import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contractPath = "contracts/LineaOreV9.sol";
const delegatePath = "contracts/LineaOre7702Delegate.sol";
const constantsPath = "app/lib/constants.ts";

const source = readFileSync(contractPath, "utf8");
const delegateSource = readFileSync(delegatePath, "utf8");
const constants = readFileSync(constantsPath, "utf8");

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

function assertSubset({ expected, actual, label }) {
  const missing = [...expected].filter((item) => !actual.has(item));
  assert.deepEqual(missing, [], `${label} missing from client ABI`);
}

const splitFeesBody = extractFunctionBody("_splitFees");
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

assertSubset({ expected: contractEvents, actual: clientEvents, label: "events" });
assertSubset({ expected: contractErrors, actual: clientErrors, label: "errors" });

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
