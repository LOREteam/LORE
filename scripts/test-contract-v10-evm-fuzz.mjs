import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBlock } from "@ethereumjs/block";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createLegacyTx } from "@ethereumjs/tx";
import {
  Account,
  bytesToHex,
  createAddressFromPrivateKey,
  hexToBytes,
} from "@ethereumjs/util";
import { createVM, runTx } from "@ethereumjs/vm";
import solc from "solc";
import {
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  toBytes,
} from "viem";

// This runner intentionally uses a real programmatic EVM: the older V10 source/model
// checks and RPC state-override harness do not execute fresh deployed bytecode offline.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const V10_SOURCE = "contracts/LineaOreV10.sol";
const TOKEN_SOURCE = "scripts/fixtures/V10AdversarialToken.sol";
const BASE_TIME = 1_700_000_000n;
const DUST_SETTLE_DELAY = 365n * 24n * 60n * 60n;
const MAX_UINT256 = (1n << 256n) - 1n;
const USER_EPOCH_VOLUME_MASK = (1n << 254n) - 1n;
const FULL_TILE_MASK = (1n << 25n) - 1n;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";
const TX_GAS_LIMIT = 12_000_000n;
const BLOCK_GAS_LIMIT = 30_000_000n;

const stats = {
  conservationChecks: 0,
  expectedReverts: 0,
  successfulRuntimeTransactions: 0,
  fuzzEpochs: 0,
  gas: [],
};

function readCompilerImport(importName) {
  const allowedRoots = [
    path.resolve(REPO_ROOT, "contracts"),
    path.resolve(REPO_ROOT, "node_modules", "@openzeppelin"),
  ];
  const candidates = [
    path.resolve(REPO_ROOT, importName),
    path.resolve(REPO_ROOT, "node_modules", importName),
    path.resolve(REPO_ROOT, "contracts", importName),
  ];
  for (const candidate of candidates) {
    const allowed = allowedRoots.some((root) => {
      const relative = path.relative(root, candidate);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    if (allowed && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `Import not found inside approved roots: ${importName}` };
}

function compileFixtures() {
  const input = {
    language: "Solidity",
    sources: {
      [V10_SOURCE]: { content: fs.readFileSync(path.resolve(REPO_ROOT, V10_SOURCE), "utf8") },
      [TOKEN_SOURCE]: { content: fs.readFileSync(path.resolve(REPO_ROOT, TOKEN_SOURCE), "utf8") },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      evmVersion: "osaka",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readCompilerImport }));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  assert.deepEqual(errors.map((entry) => entry.formattedMessage), [], "offline fixtures must compile cleanly");

  const game = output.contracts?.[V10_SOURCE]?.LineaOreV10;
  const token = output.contracts?.[TOKEN_SOURCE]?.V10AdversarialToken;
  assert.ok(game?.evm?.bytecode?.object, "missing LineaOreV10 creation bytecode");
  assert.ok(token?.evm?.bytecode?.object, "missing V10AdversarialToken creation bytecode");
  return {
    game: {
      abi: game.abi,
      bytecode: `0x${game.evm.bytecode.object}`,
      runtimeBytes: game.evm.deployedBytecode.object.length / 2,
    },
    token: {
      abi: token.abi,
      bytecode: `0x${token.evm.bytecode.object}`,
      runtimeBytes: token.evm.deployedBytecode.object.length / 2,
    },
  };
}

const compiled = compileFixtures();

function fixtureActor(index, name) {
  const privateKey = hexToBytes(`0x${BigInt(index).toString(16).padStart(64, "0")}`);
  const address = createAddressFromPrivateKey(privateKey);
  return { name, privateKey, address, hex: address.toString() };
}

const actors = {
  owner: fixtureActor(1, "owner"),
  feeRecipient: fixtureActor(2, "feeRecipient"),
  resolver: fixtureActor(3, "resolver"),
  alice: fixtureActor(4, "alice"),
  bob: fixtureActor(5, "bob"),
  carol: fixtureActor(6, "carol"),
  keeper: fixtureActor(7, "keeper"),
};
const actorList = Object.values(actors);

function uint256Bytes(value) {
  return hexToBytes(`0x${(value & MAX_UINT256).toString(16).padStart(64, "0")}`);
}

function selector(signature) {
  return keccak256(toBytes(signature)).slice(0, 10);
}

function executionError(result) {
  return result.execResult.exceptionError?.error ?? result.execResult.exceptionError?.message ?? "unknown EVM error";
}

function requireSuccess(result, label) {
  assert.equal(
    result.execResult.exceptionError,
    undefined,
    `${label} reverted: ${executionError(result)} (${bytesToHex(result.execResult.returnValue)})`,
  );
  assert.equal(result.receipt.status, 1, `${label} receipt must succeed`);
  return result;
}

function requireRevert(result, label, expectedSignature) {
  assert.ok(result.execResult.exceptionError, `${label} unexpectedly succeeded`);
  assert.equal(result.receipt.status, 0, `${label} receipt must report failure`);
  if (expectedSignature) {
    assert.equal(
      bytesToHex(result.execResult.returnValue).slice(0, 10),
      selector(expectedSignature),
      `${label} must revert with ${expectedSignature}`,
    );
  }
  stats.expectedReverts += 1;
  return result;
}

class LocalEvm {
  static async create(seed) {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Osaka });
    const vm = await createVM({ common });
    for (const actor of actorList) {
      await vm.stateManager.putAccount(actor.address, new Account(0n, 1n << 200n));
    }
    return new LocalEvm(vm, common, seed);
  }

  constructor(vm, common, seed) {
    this.vm = vm;
    this.common = common;
    this.timestamp = BASE_TIME;
    this.blockNumber = 1n;
    this.entropy = seed;
  }

  setTime(timestamp) {
    assert.ok(timestamp >= this.timestamp, "local EVM time must be monotonic");
    this.timestamp = timestamp;
  }

  advance(seconds) {
    this.timestamp += seconds;
  }

  block() {
    return createBlock(
      {
        header: {
          number: this.blockNumber,
          timestamp: this.timestamp,
          gasLimit: BLOCK_GAS_LIMIT,
          baseFeePerGas: 0n,
          difficulty: 0n,
          mixHash: uint256Bytes(this.entropy ^ this.blockNumber ^ this.timestamp),
        },
      },
      { common: this.common },
    );
  }

  async transact(actor, { to, data, gasLimit = TX_GAS_LIMIT, label, deployment = false }) {
    const account = await this.vm.stateManager.getAccount(actor.address);
    assert.ok(account, `${actor.name} must exist in the local state manager`);
    const transaction = createLegacyTx(
      {
        nonce: account.nonce,
        gasPrice: 1n,
        gasLimit,
        ...(to ? { to } : {}),
        value: 0n,
        data: hexToBytes(data),
      },
      { common: this.common },
    ).sign(actor.privateKey);
    const result = await runTx(this.vm, { tx: transaction, block: this.block() });
    this.blockNumber += 1n;
    this.entropy = (this.entropy * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) & MAX_UINT256;
    if (!result.execResult.exceptionError && !deployment) {
      stats.successfulRuntimeTransactions += 1;
      stats.gas.push({ label, gas: result.totalGasSpent });
    }
    return result;
  }

  async deploy(actor, artifact, args, label) {
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const result = requireSuccess(
      await this.transact(actor, { data, label, deployment: true }),
      label,
    );
    assert.ok(result.createdAddress, `${label} must return a created address`);
    return { ...artifact, address: result.createdAddress };
  }

  async send(actor, contract, functionName, args = [], options = {}) {
    const data = encodeFunctionData({ abi: contract.abi, functionName, args });
    return this.transact(actor, {
      to: contract.address,
      data,
      gasLimit: options.gasLimit ?? TX_GAS_LIMIT,
      label: options.label ?? functionName,
    });
  }

  async sendOk(actor, contract, functionName, args = [], options = {}) {
    return requireSuccess(
      await this.send(actor, contract, functionName, args, options),
      options.label ?? functionName,
    );
  }

  async read(actor, contract, functionName, args = []) {
    const data = encodeFunctionData({ abi: contract.abi, functionName, args });
    const result = await this.vm.evm.runCall({
      to: contract.address,
      caller: actor.address,
      origin: actor.address,
      data: hexToBytes(data),
      gasLimit: TX_GAS_LIMIT,
      block: this.block(),
      isStatic: true,
    });
    assert.equal(
      result.execResult.exceptionError,
      undefined,
      `${functionName} view reverted: ${executionError(result)}`,
    );
    return decodeFunctionResult({
      abi: contract.abi,
      functionName,
      data: bytesToHex(result.execResult.returnValue),
    });
  }
}

async function createWorld(seed) {
  const evm = await LocalEvm.create(seed);
  const token = await evm.deploy(actors.owner, compiled.token, [], "deploy adversarial token");
  const game = await evm.deploy(
    actors.owner,
    compiled.game,
    [token.address.toString(), actors.owner.hex, actors.feeRecipient.hex],
    "deploy LineaOreV10",
  );
  assert.equal(await evm.read(actors.owner, game, "currentEpoch"), 1n);
  assert.equal(await evm.read(actors.owner, game, "epochDuration"), 60n);
  return { evm, token, game };
}

async function mintAndApprove(world, actor, amount) {
  await world.evm.sendOk(actors.owner, world.token, "mint", [actor.hex, amount], {
    label: `mint ${actor.name}`,
  });
  await world.evm.sendOk(actor, world.token, "approve", [world.game.address.toString(), MAX_UINT256], {
    label: `approve ${actor.name}`,
  });
}

async function tokenBalance(world, address) {
  return world.evm.read(actors.owner, world.token, "balanceOf", [typeof address === "string" ? address : address.toString()]);
}

async function assertConservation(world, label) {
  const { evm, game } = world;
  const currentEpoch = await evm.read(actors.owner, game, "currentEpoch");
  let liabilities = 0n;
  liabilities += await evm.read(actors.owner, game, "rolloverPool");
  liabilities += await evm.read(actors.owner, game, "dailyJackpotPool");
  liabilities += await evm.read(actors.owner, game, "weeklyJackpotPool");
  liabilities += await evm.read(actors.owner, game, "accruedOwnerFees");
  liabilities += await evm.read(actors.owner, game, "accruedBurnFees");
  for (const actor of actorList) {
    liabilities += await evm.read(actors.owner, game, "pendingResolverRewards", [actor.hex]);
  }

  for (let epoch = 1n; epoch <= currentEpoch; epoch += 1n) {
    const [totalPool, rewardPool, , resolved] = await evm.read(actors.owner, game, "epochs", [epoch]);
    if (!resolved) {
      liabilities += totalPool;
      continue;
    }
    const rewardClaimed = await evm.read(actors.owner, game, "epochRewardClaimed", [epoch]);
    const rewardDustSettled = await evm.read(actors.owner, game, "epochDustSettled", [epoch]);
    assert.ok(rewardClaimed <= rewardPool, `${label}: reward claims cannot exceed the reward pool`);
    if (!rewardDustSettled) liabilities += rewardPool - rewardClaimed;

    const rebatePool = await evm.read(actors.owner, game, "epochRebatePool", [epoch]);
    const rebateClaimed = await evm.read(actors.owner, game, "epochRebateClaimed", [epoch]);
    assert.ok(rebateClaimed <= rebatePool, `${label}: rebate claims cannot exceed the rebate pool`);
    liabilities += rebatePool - rebateClaimed;
  }

  const held = await tokenBalance(world, game.address);
  assert.equal(held, liabilities, `${label}: contract tokens must equal all open liabilities`);
  stats.conservationChecks += 1;
}

function expectedReward(rewardPool, userBet, tilePool) {
  return (rewardPool * userBet) / tilePool;
}

function makeRandom(seed) {
  let state = seed;
  return (limit) => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    state &= (1n << 64n) - 1n;
    return state % limit;
  };
}

const FUZZ_SEEDS = [
  0x4c4f52455f563130n,
  0x9e3779b97f4a7c15n,
  0xd1b54a32d192ed03n,
  0x94d049bb133111ebn,
  0x2545f4914f6cdd1dn,
  0xbf58476d1ce4e5b9n,
  0x632be59bd9b4e019n,
  0x8cb92baa43f0c4a7n,
];

async function runAccountingFuzz() {
  const world = await createWorld(0xacc0_0011n);
  const bankroll = 10n ** 29n;
  for (const actor of [actors.alice, actors.bob, actors.carol]) {
    await mintAndApprove(world, actor, bankroll);
  }
  await assertConservation(world, "initial funded actors");

  const resolvedEpochs = [];
  const unclaimedRewardEpochs = [];
  const unclaimedRebateEpochs = [];
  for (let index = 0; index < FUZZ_SEEDS.length; index += 1) {
    const random = makeRandom(FUZZ_SEEDS[index]);
    const epoch = await world.evm.read(actors.owner, world.game, "currentEpoch");
    const unit = 10n ** 14n;
    const alicePerTile = (random(997n) + 1n) * unit;
    const bobPerTile = (random(991n) + 1n) * unit;
    const carolTile = random(25n) + 1n;
    const carolAmount = (random(983n) + 1n) * unit;

    await world.evm.sendOk(
      actors.alice,
      world.game,
      "placeBatchBetsBitmapForEpoch",
      [epoch, FULL_TILE_MASK, alicePerTile],
      { label: `fuzz ${index} alice full bitmap` },
    );
    await world.evm.sendOk(
      actors.bob,
      world.game,
      "placeBatchBetsBitmapForEpoch",
      [epoch, FULL_TILE_MASK, bobPerTile],
      { label: `fuzz ${index} bob full bitmap` },
    );
    if (index === 0) {
      await world.evm.sendOk(
        actors.carol,
        world.game,
        "placeBatchBets",
        [[carolTile, carolTile], [carolAmount, carolAmount + 1n]],
        { label: "duplicate tile entries remain additive" },
      );
      assert.equal(
        await world.evm.read(actors.owner, world.game, "userBets", [epoch, carolTile, actors.carol.hex]),
        carolAmount * 2n + 1n,
      );
    } else {
      await world.evm.sendOk(
        actors.carol,
        world.game,
        "placeBatchBetsBitmapForEpoch",
        [epoch, 1n << (carolTile - 1n), carolAmount],
        { label: `fuzz ${index} carol sparse bitmap` },
      );
    }

    const carolStake = index === 0 ? carolAmount * 2n + 1n : carolAmount;
    const freshPool = alicePerTile * 25n + bobPerTile * 25n + carolStake;
    const [recordedPool] = await world.evm.read(actors.owner, world.game, "epochs", [epoch]);
    assert.equal(recordedPool, freshPool, `fuzz ${index}: recorded fresh pool`);
    assert.equal(
      await world.evm.read(actors.owner, world.game, "userEpochVolumes", [epoch, actors.carol.hex]),
      carolStake,
      `fuzz ${index}: duplicate/sparse volume accounting`,
    );
    await assertConservation(world, `fuzz ${index} after bets`);

    const ownerBefore = await world.evm.read(actors.owner, world.game, "accruedOwnerFees");
    const burnBefore = await world.evm.read(actors.owner, world.game, "accruedBurnFees");
    const resolverBefore = await world.evm.read(
      actors.owner,
      world.game,
      "pendingResolverRewards",
      [actors.resolver.hex],
    );
    const endTime = await world.evm.read(actors.owner, world.game, "getEpochEndTime", [epoch]);
    world.evm.setTime(endTime);
    await world.evm.sendOk(actors.resolver, world.game, "resolveEpoch", [epoch], {
      label: `fuzz ${index} resolve`,
    });
    resolvedEpochs.push(epoch);
    stats.fuzzEpochs += 1;

    const [resolvedFreshPool, rewardPool, winningTile, resolved] = await world.evm.read(
      actors.owner,
      world.game,
      "epochs",
      [epoch],
    );
    assert.equal(resolvedFreshPool, freshPool);
    assert.equal(resolved, true);
    assert.ok(winningTile >= 1n && winningTile <= 25n);
    assert.ok(rewardPool > 0n, "two full-grid bettors must guarantee a winner");

    const protocolFee = (freshPool * 2n) / 100n;
    const resolverReward = (freshPool * 5n) / 10_000n;
    const feeAfterResolver = protocolFee - resolverReward;
    const expectedRebatePool = feeAfterResolver / 2n;
    const expectedOwnerFees = feeAfterResolver - expectedRebatePool;
    const burnFee = freshPool / 100n;
    assert.equal(await world.evm.read(actors.owner, world.game, "epochRebatePool", [epoch]), expectedRebatePool);
    assert.equal(await world.evm.read(actors.owner, world.game, "accruedOwnerFees"), ownerBefore + expectedOwnerFees);
    assert.equal(await world.evm.read(actors.owner, world.game, "accruedBurnFees"), burnBefore + burnFee);
    assert.equal(
      await world.evm.read(actors.owner, world.game, "pendingResolverRewards", [actors.resolver.hex]),
      resolverBefore + resolverReward,
    );
    await assertConservation(world, `fuzz ${index} after resolution`);

    const winningPool = await world.evm.read(actors.owner, world.game, "tilePools", [epoch, winningTile]);
    const aliceWinningBet = await world.evm.read(
      actors.owner,
      world.game,
      "userBets",
      [epoch, winningTile, actors.alice.hex],
    );
    const aliceBefore = await tokenBalance(world, actors.alice.address);
    await world.evm.sendOk(actors.alice, world.game, "claimRewards", [[epoch, epoch]], {
      label: `fuzz ${index} duplicate batch reward claim`,
    });
    assert.equal(
      (await tokenBalance(world, actors.alice.address)) - aliceBefore,
      expectedReward(rewardPool, aliceWinningBet, winningPool),
    );
    requireRevert(
      await world.evm.send(actors.alice, world.game, "claimReward", [epoch]),
      `fuzz ${index} replayed reward claim`,
      "AlreadyClaimed()",
    );

    if (index % 2 === 0) {
      unclaimedRewardEpochs.push(epoch);
    } else {
      await world.evm.sendOk(actors.bob, world.game, "claimReward", [epoch], {
        label: `fuzz ${index} bob reward exit`,
      });
    }

    const carolRebate = await world.evm.read(
      actors.owner,
      world.game,
      "previewRebate",
      [epoch, actors.carol.hex],
    );
    if (carolRebate > 0n && index % 2 === 0) {
      const carolBefore = await tokenBalance(world, actors.carol.address);
      await world.evm.sendOk(actors.carol, world.game, "claimEpochsRebate", [[epoch, epoch]], {
        label: `fuzz ${index} duplicate batch rebate claim`,
      });
      assert.equal((await tokenBalance(world, actors.carol.address)) - carolBefore, carolRebate);
      requireRevert(
        await world.evm.send(actors.carol, world.game, "claimEpochRebate", [epoch]),
        `fuzz ${index} replayed rebate claim`,
        "RebateAlreadyClaimed()",
      );
    } else if (carolRebate > 0n) {
      unclaimedRebateEpochs.push(epoch);
    }
    await assertConservation(world, `fuzz ${index} after exits`);

    if (index % 3 === 2) {
      const ownerFees = await world.evm.read(actors.owner, world.game, "accruedOwnerFees");
      const burnFees = await world.evm.read(actors.owner, world.game, "accruedBurnFees");
      const recipientBefore = await tokenBalance(world, actors.feeRecipient.address);
      const burnBalanceBefore = await tokenBalance(world, BURN_ADDRESS);
      await world.evm.sendOk(actors.keeper, world.game, "flushProtocolFees", [], {
        label: `fuzz ${index} permissionless fee flush`,
      });
      assert.equal((await tokenBalance(world, actors.feeRecipient.address)) - recipientBefore, ownerFees);
      assert.equal((await tokenBalance(world, BURN_ADDRESS)) - burnBalanceBefore, burnFees);
      assert.equal(await world.evm.read(actors.owner, world.game, "accruedOwnerFees"), 0n);
      assert.equal(await world.evm.read(actors.owner, world.game, "accruedBurnFees"), 0n);
      await assertConservation(world, `fuzz ${index} after fee flush`);
    }

    requireRevert(
      await world.evm.send(actors.resolver, world.game, "resolveEpoch", [epoch]),
      `fuzz ${index} replayed resolution`,
      "CanOnlyResolveCurrent()",
    );
  }

  const remainingOwnerFees = await world.evm.read(actors.owner, world.game, "accruedOwnerFees");
  const remainingBurnFees = await world.evm.read(actors.owner, world.game, "accruedBurnFees");
  if (remainingOwnerFees + remainingBurnFees > 0n) {
    await world.evm.sendOk(actors.keeper, world.game, "flushProtocolFees", [], { label: "final fee flush" });
  }
  requireRevert(
    await world.evm.send(actors.keeper, world.game, "flushProtocolFees"),
    "duplicate empty fee flush",
    "NothingToFlush()",
  );

  const pendingResolver = await world.evm.read(
    actors.owner,
    world.game,
    "pendingResolverRewards",
    [actors.resolver.hex],
  );
  const resolverBalanceBefore = await tokenBalance(world, actors.resolver.address);
  await world.evm.sendOk(actors.resolver, world.game, "claimResolverRewards", [], {
    label: "resolver reward exit",
  });
  assert.equal((await tokenBalance(world, actors.resolver.address)) - resolverBalanceBefore, pendingResolver);
  requireRevert(
    await world.evm.send(actors.resolver, world.game, "claimResolverRewards"),
    "duplicate resolver reward exit",
    "NothingToClaim()",
  );
  await assertConservation(world, "after fee and resolver exits");

  assert.ok(unclaimedRewardEpochs.length > 0, "fuzz must leave positive reward dust");
  assert.ok(unclaimedRebateEpochs.length > 0, "fuzz must leave positive rebate dust");
  const firstResolvedAt = await world.evm.read(
    actors.owner,
    world.game,
    "epochResolvedAt",
    [resolvedEpochs[0]],
  );
  world.evm.setTime(firstResolvedAt + DUST_SETTLE_DELAY - 1n);
  requireRevert(
    await world.evm.send(actors.keeper, world.game, "settleEpochDust", [resolvedEpochs[0]]),
    "early reward dust settlement",
    "DustSettlementDelayNotReached()",
  );

  const latestResolvedAt = await world.evm.read(
    actors.owner,
    world.game,
    "epochResolvedAt",
    [resolvedEpochs.at(-1)],
  );
  world.evm.setTime(latestResolvedAt + DUST_SETTLE_DELAY);
  const rewardDustEpoch = unclaimedRewardEpochs[0];
  const [, dustRewardPool] = await world.evm.read(actors.owner, world.game, "epochs", [rewardDustEpoch]);
  const dustClaimed = await world.evm.read(actors.owner, world.game, "epochRewardClaimed", [rewardDustEpoch]);
  const rewardDust = dustRewardPool - dustClaimed;
  assert.ok(rewardDust > 0n);
  const recipientBeforeRewardDust = await tokenBalance(world, actors.feeRecipient.address);
  await world.evm.sendOk(actors.keeper, world.game, "settleEpochDust", [rewardDustEpoch], {
    label: "single reward dust exit",
  });
  assert.equal((await tokenBalance(world, actors.feeRecipient.address)) - recipientBeforeRewardDust, rewardDust);
  const remainingRewardEpochs = resolvedEpochs.filter((epoch) => epoch !== rewardDustEpoch);
  await world.evm.sendOk(
    actors.keeper,
    world.game,
    "settleEpochsDust",
    [[...remainingRewardEpochs, remainingRewardEpochs[0]]],
    { label: "batch reward dust exit with duplicate" },
  );
  requireRevert(
    await world.evm.send(actors.keeper, world.game, "settleEpochsDust", [resolvedEpochs]),
    "replayed reward dust batch",
    "NothingToClaim()",
  );

  const rebateDustEpoch = unclaimedRebateEpochs[0];
  const rebatePool = await world.evm.read(actors.owner, world.game, "epochRebatePool", [rebateDustEpoch]);
  const rebateClaimed = await world.evm.read(actors.owner, world.game, "epochRebateClaimed", [rebateDustEpoch]);
  const rebateDust = rebatePool - rebateClaimed;
  assert.ok(rebateDust > 0n);
  const recipientBeforeRebateDust = await tokenBalance(world, actors.feeRecipient.address);
  await world.evm.sendOk(actors.keeper, world.game, "settleEpochRebateDust", [rebateDustEpoch], {
    label: "single rebate dust exit",
  });
  assert.equal((await tokenBalance(world, actors.feeRecipient.address)) - recipientBeforeRebateDust, rebateDust);
  const remainingRebateEpochs = resolvedEpochs.filter((epoch) => epoch !== rebateDustEpoch);
  await world.evm.sendOk(
    actors.keeper,
    world.game,
    "settleEpochsRebateDust",
    [[...remainingRebateEpochs, remainingRebateEpochs[0]]],
    { label: "batch rebate dust exit with duplicate" },
  );
  requireRevert(
    await world.evm.send(actors.keeper, world.game, "settleEpochsRebateDust", [resolvedEpochs]),
    "replayed rebate dust batch",
    "NothingToClaim()",
  );

  requireRevert(
    await world.evm.send(actors.bob, world.game, "claimReward", [unclaimedRewardEpochs[0]]),
    "late reward claim",
    "RewardClaimWindowExpired()",
  );
  requireRevert(
    await world.evm.send(actors.carol, world.game, "claimEpochRebate", [unclaimedRebateEpochs[0]]),
    "late rebate claim",
    "NoRebateAvailable()",
  );
  await assertConservation(world, "after all dust exits");
}

async function runLateAndReplayBoundaries() {
  const world = await createWorld(0x1a7e_b0a1n);
  await mintAndApprove(world, actors.alice, 10n ** 24n);
  const gameBalanceBefore = await tokenBalance(world, world.game.address);
  const endEpochOne = await world.evm.read(actors.owner, world.game, "getEpochEndTime", [1n]);
  world.evm.setTime(endEpochOne - 1n);
  requireRevert(
    await world.evm.send(
      actors.alice,
      world.game,
      "placeBatchBetsBitmapForEpoch",
      [1n, 1n, 10n ** 18n],
    ),
    "protected bet inside closing grace",
    "EpochClosing()",
  );
  assert.equal(await tokenBalance(world, world.game.address), gameBalanceBefore);

  world.evm.setTime(endEpochOne);
  await world.evm.sendOk(
    actors.alice,
    world.game,
    "placeBatchBetsBitmapForEpoch",
    [1n, 1n, 10n ** 18n],
    { label: "expired empty observed epoch advances exactly once" },
  );
  assert.equal(await world.evm.read(actors.owner, world.game, "currentEpoch"), 2n);
  assert.equal(await world.evm.read(actors.owner, world.game, "userBets", [2n, 1n, actors.alice.hex]), 10n ** 18n);
  requireRevert(
    await world.evm.send(
      actors.alice,
      world.game,
      "placeBatchBetsBitmapForEpoch",
      [1n, 1n, 1n],
    ),
    "stale observed epoch replay",
    "UnexpectedEpoch()",
  );

  const endEpochTwo = await world.evm.read(actors.owner, world.game, "getEpochEndTime", [2n]);
  world.evm.setTime(endEpochTwo);
  requireRevert(
    await world.evm.send(
      actors.alice,
      world.game,
      "placeBatchBetsBitmapForEpoch",
      [2n, 1n, 1n],
    ),
    "expired funded observed epoch refuses implicit resolution",
    "EpochClosing()",
  );
  await world.evm.sendOk(actors.alice, world.game, "placeBet", [1n, 2n * 10n ** 18n], {
    label: "legacy late call resolves funded epoch then bets next epoch",
  });
  assert.equal(await world.evm.read(actors.owner, world.game, "currentEpoch"), 3n);
  requireRevert(
    await world.evm.send(actors.resolver, world.game, "resolveEpoch", [2n]),
    "old epoch resolution replay",
    "CanOnlyResolveCurrent()",
  );
  requireRevert(
    await world.evm.send(actors.resolver, world.game, "resolveEpoch", [3n]),
    "premature current epoch resolution",
    "TimerNotEnded()",
  );
  await assertConservation(world, "late and replay boundaries");
}

async function runLargeValueAndGasProperties() {
  const world = await createWorld(0x1a26e_6a5n);
  await mintAndApprove(world, actors.alice, USER_EPOCH_VOLUME_MASK + 1n);

  const lowGasResult = await world.evm.send(
    actors.alice,
    world.game,
    "placeBatchBetsBitmapForEpoch",
    [1n, FULL_TILE_MASK, 1n],
    { gasLimit: 70_000n, label: "bounded low-gas full bitmap" },
  );
  requireRevert(lowGasResult, "low-gas full bitmap must be atomic");
  assert.equal(await tokenBalance(world, world.game.address), 0n);
  assert.equal(await world.evm.read(actors.owner, world.game, "userEpochVolumes", [1n, actors.alice.hex]), 0n);

  requireRevert(
    await world.evm.send(
      actors.alice,
      world.game,
      "placeBatchBetsSameAmount",
      [[1n, 2n], (1n << 255n) + 1n],
    ),
    "batch total multiplication overflow",
  );
  assert.equal(await tokenBalance(world, world.game.address), 0n);

  await world.evm.sendOk(
    actors.alice,
    world.game,
    "placeBatchBetsBitmapForEpoch",
    [1n, 1n, USER_EPOCH_VOLUME_MASK],
    { label: "maximum packed user volume" },
  );
  assert.equal(
    await world.evm.read(actors.owner, world.game, "userEpochVolumes", [1n, actors.alice.hex]),
    USER_EPOCH_VOLUME_MASK,
  );
  requireRevert(
    await world.evm.send(actors.alice, world.game, "placeBet", [1n, 1n]),
    "packed user volume overflow",
    "UserEpochVolumeOverflow()",
  );
  assert.equal(await tokenBalance(world, world.game.address), USER_EPOCH_VOLUME_MASK);
  await assertConservation(world, "maximum value before resolution");

  const end = await world.evm.read(actors.owner, world.game, "getEpochEndTime", [1n]);
  world.evm.setTime(end);
  await world.evm.sendOk(actors.resolver, world.game, "resolveEpoch", [1n], {
    label: "maximum-value full-precision resolution",
  });
  await assertConservation(world, "maximum value after resolution");
}

async function runAdversarialTokenProperties() {
  const world = await createWorld(0xad7e_25a21a1n);
  const stake = 10n ** 18n;
  await mintAndApprove(world, actors.alice, 100n * stake);

  for (const [mode, label] of [
    [2, "false-return transferFrom"],
    [4, "reverting transferFrom"],
  ]) {
    await world.evm.sendOk(actors.owner, world.token, "configure", [mode, actors.owner.hex, "0x"], {
      label: `configure ${label}`,
    });
    requireRevert(
      await world.evm.send(actors.alice, world.game, "placeBet", [1n, stake]),
      `${label} stake rejection`,
    );
    assert.equal(await tokenBalance(world, world.game.address), 0n);
    assert.equal(await world.evm.read(actors.owner, world.game, "userEpochVolumes", [1n, actors.alice.hex]), 0n);
  }

  const reentrantBetData = encodeFunctionData({
    abi: world.game.abi,
    functionName: "placeBet",
    args: [2n, 1n],
  });
  await world.evm.sendOk(
    actors.owner,
    world.token,
    "configure",
    [6, world.game.address.toString(), reentrantBetData],
    { label: "configure transferFrom reentry" },
  );
  await world.evm.sendOk(actors.alice, world.game, "placeBet", [1n, stake], {
    label: "outer stake survives blocked transferFrom reentry",
  });
  assert.equal(await world.evm.read(actors.owner, world.token, "callbackAttempted"), true);
  assert.equal(await world.evm.read(actors.owner, world.token, "callbackSucceeded"), false);
  assert.equal(await world.evm.read(actors.owner, world.game, "userBets", [1n, 2n, world.token.address.toString()]), 0n);

  await world.evm.sendOk(actors.owner, world.token, "configure", [0, actors.owner.hex, "0x"], {
    label: "restore normal transfer mode",
  });
  await world.evm.sendOk(
    actors.alice,
    world.game,
    "placeBatchBetsBitmapForEpoch",
    [1n, FULL_TILE_MASK, stake],
    { label: "guarantee adversarial fixture winner" },
  );
  const end = await world.evm.read(actors.owner, world.game, "getEpochEndTime", [1n]);
  world.evm.setTime(end);
  await world.evm.sendOk(actors.resolver, world.game, "resolveEpoch", [1n], {
    label: "resolve adversarial token epoch",
  });
  const [, rewardPool, winningTile] = await world.evm.read(actors.owner, world.game, "epochs", [1n]);
  const winningPool = await world.evm.read(actors.owner, world.game, "tilePools", [1n, winningTile]);
  const aliceWinningBet = await world.evm.read(
    actors.owner,
    world.game,
    "userBets",
    [1n, winningTile, actors.alice.hex],
  );
  const reward = expectedReward(rewardPool, aliceWinningBet, winningPool);

  for (const [mode, label] of [
    [1, "false-return transfer"],
    [3, "reverting transfer"],
  ]) {
    const gameBalanceBefore = await tokenBalance(world, world.game.address);
    await world.evm.sendOk(actors.owner, world.token, "configure", [mode, actors.owner.hex, "0x"], {
      label: `configure ${label}`,
    });
    requireRevert(
      await world.evm.send(actors.alice, world.game, "claimReward", [1n]),
      `${label} reward exit rollback`,
    );
    assert.equal(await world.evm.read(actors.owner, world.game, "hasClaimed", [actors.alice.hex, 1n]), false);
    assert.equal(await world.evm.read(actors.owner, world.game, "epochRewardClaimed", [1n]), 0n);
    assert.equal(await tokenBalance(world, world.game.address), gameBalanceBefore);
  }

  const reentrantClaimData = encodeFunctionData({
    abi: world.game.abi,
    functionName: "claimReward",
    args: [1n],
  });
  await world.evm.sendOk(
    actors.owner,
    world.token,
    "configure",
    [5, world.game.address.toString(), reentrantClaimData],
    { label: "configure transfer reentry" },
  );
  const aliceBefore = await tokenBalance(world, actors.alice.address);
  await world.evm.sendOk(actors.alice, world.game, "claimReward", [1n], {
    label: "outer reward exit survives blocked transfer reentry",
  });
  assert.equal(await world.evm.read(actors.owner, world.token, "callbackAttempted"), true);
  assert.equal(await world.evm.read(actors.owner, world.token, "callbackSucceeded"), false);
  assert.equal((await tokenBalance(world, actors.alice.address)) - aliceBefore, reward);
  await world.evm.sendOk(actors.owner, world.token, "configure", [0, actors.owner.hex, "0x"], {
    label: "restore normal mode after reentry",
  });
  await assertConservation(world, "adversarial token paths");
}

await runAccountingFuzz();
await runLateAndReplayBoundaries();
await runLargeValueAndGasProperties();
await runAdversarialTokenProperties();

const runtimeGas = stats.gas.filter((entry) => !entry.label.startsWith("mint ") && !entry.label.startsWith("approve "));
const maxRuntimeGas = runtimeGas.reduce(
  (maximum, entry) => (entry.gas > maximum.gas ? entry : maximum),
  { label: "none", gas: 0n },
);
assert.ok(maxRuntimeGas.gas < 8_000_000n, "all successful runtime actions must remain below the 8M local gas guardrail");

console.log(JSON.stringify({
  status: "passed",
  engine: "@ethereumjs/vm 10.1.2",
  hardfork: Hardfork.Osaka,
  node: process.version,
  compiler: solc.version(),
  compilerProfile: { optimizer: true, runs: 200, viaIR: false, evmVersion: "osaka" },
  bytecode: {
    LineaOreV10RuntimeBytes: compiled.game.runtimeBytes,
    adversarialTokenRuntimeBytes: compiled.token.runtimeBytes,
  },
  properties: {
    fuzzSeeds: FUZZ_SEEDS.map((seed) => `0x${seed.toString(16)}`),
    fuzzEpochs: stats.fuzzEpochs,
    conservationChecks: stats.conservationChecks,
    successfulRuntimeTransactions: stats.successfulRuntimeTransactions,
    expectedReverts: stats.expectedReverts,
    maxRuntimeGas: { label: maxRuntimeGas.label, gas: maxRuntimeGas.gas.toString() },
  },
  covered: [
    "token-balance conservation across every open liability bucket",
    "single/batch reward, rebate, resolver, protocol-fee, reward-dust and rebate-dust exits",
    "duplicate calldata accounting plus claim/resolution/settlement replay rejection",
    "closing, stale-observation, funded-expiry and post-deadline call boundaries",
    "2^254-1 packed volume, overflow rollback, full-precision resolution and bounded gas rollback",
    "false-return, reverting and callback-reentrant ERC-20 transfer/transferFrom behavior",
  ],
  explicitGaps: [
    "fee-on-transfer, rebasing and dishonest-success ERC-20s remain outside the contract's documented token boundary",
    "the offline Mainnet-rule Osaka VM does not emulate Linea node policy, sequencer ordering or live RPC behavior",
    "the suite checks accounting outcomes under varied deterministic entropy; it does not claim randomness quality",
  ],
}, null, 2));
