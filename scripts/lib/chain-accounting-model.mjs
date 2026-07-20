const PERCENT_DENOMINATOR = 100n;
const BPS_DENOMINATOR = 10_000n;

const asBigInt = (value) => typeof value === "bigint" ? value : BigInt(value ?? 0);

function addAmount(map, key, amount) {
  map.set(key, (map.get(key) ?? 0n) + asBigInt(amount));
}

export function replayV9Accounting({ initial, events }) {
  const state = {
    rolloverPool: asBigInt(initial.rolloverPool),
    dailyJackpotPool: asBigInt(initial.dailyJackpotPool),
    weeklyJackpotPool: asBigInt(initial.weeklyJackpotPool),
    accruedOwnerFees: asBigInt(initial.accruedOwnerFees),
    accruedBurnFees: asBigInt(initial.accruedBurnFees),
  };
  const freshPools = new Map();
  const dailyAwards = new Map();
  const weeklyAwards = new Map();
  const resolverRewards = new Map();
  const mismatches = [];
  const mismatch = (kind, epoch, expected, actual) => {
    mismatches.push({ kind, epoch, expected: expected.toString(), actual: actual.toString() });
  };

  for (const event of events) {
    const epoch = Number(event.epoch ?? 0);
    if (event.kind === "bet") {
      addAmount(freshPools, epoch, event.amount);
      continue;
    }
    if (event.kind === "daily-jackpot") {
      addAmount(dailyAwards, epoch, event.amount);
      continue;
    }
    if (event.kind === "weekly-jackpot") {
      addAmount(weeklyAwards, epoch, event.amount);
      continue;
    }
    if (event.kind === "resolver-reward") {
      addAmount(resolverRewards, epoch, event.amount);
      continue;
    }
    if (event.kind === "fee-flush") {
      const ownerAmount = asBigInt(event.ownerAmount);
      const burnAmount = asBigInt(event.burnAmount);
      if (ownerAmount !== state.accruedOwnerFees) {
        mismatch("owner-fee-flush", epoch, state.accruedOwnerFees, ownerAmount);
      }
      if (burnAmount !== state.accruedBurnFees) {
        mismatch("burn-fee-flush", epoch, state.accruedBurnFees, burnAmount);
      }
      state.accruedOwnerFees = 0n;
      state.accruedBurnFees = 0n;
      continue;
    }
    if (event.kind !== "resolve") continue;

    const freshPool = freshPools.get(epoch) ?? 0n;
    const expectedTotalPool = freshPool + state.rolloverPool;
    const totalPool = asBigInt(event.totalPool);
    if (totalPool !== expectedTotalPool) mismatch("total-pool", epoch, expectedTotalPool, totalPool);
    state.rolloverPool = 0n;

    let dailyAccrual = 0n;
    let weeklyAccrual = 0n;
    let protocolFee = 0n;
    let burnAmount = 0n;
    let resolverReward = 0n;
    if (freshPool > 0n) {
      dailyAccrual = (freshPool * 2n) / PERCENT_DENOMINATOR;
      weeklyAccrual = (freshPool * 3n) / PERCENT_DENOMINATOR;
      protocolFee = (freshPool * 2n) / PERCENT_DENOMINATOR;
      burnAmount = freshPool / PERCENT_DENOMINATOR;
      resolverReward = (freshPool * 5n) / BPS_DENOMINATOR;
      if (resolverReward > protocolFee) resolverReward = protocolFee;
    }

    const expectedFee = protocolFee + burnAmount;
    const fee = asBigInt(event.fee);
    if (fee !== expectedFee) mismatch("resolve-fee", epoch, expectedFee, fee);
    const actualResolverReward = resolverRewards.get(epoch) ?? 0n;
    if (actualResolverReward !== resolverReward) {
      mismatch("resolver-reward", epoch, resolverReward, actualResolverReward);
    }

    state.dailyJackpotPool += dailyAccrual;
    state.weeklyJackpotPool += weeklyAccrual;
    const protocolAfterResolver = protocolFee - resolverReward;
    const rebateShare = protocolAfterResolver / 2n;
    state.accruedOwnerFees += protocolAfterResolver - rebateShare;
    state.accruedBurnFees += burnAmount;

    const dailyAward = dailyAwards.get(epoch) ?? 0n;
    const weeklyAward = weeklyAwards.get(epoch) ?? 0n;
    if (dailyAward > 0n) {
      if (dailyAward !== state.dailyJackpotPool) {
        mismatch("daily-jackpot", epoch, state.dailyJackpotPool, dailyAward);
      }
      state.dailyJackpotPool = 0n;
    }
    if (weeklyAward > 0n) {
      if (weeklyAward !== state.weeklyJackpotPool) {
        mismatch("weekly-jackpot", epoch, state.weeklyJackpotPool, weeklyAward);
      }
      state.weeklyJackpotPool = 0n;
    }

    const jackpotBonus = dailyAward + weeklyAward;
    if (asBigInt(event.jackpotBonus) !== jackpotBonus) {
      mismatch("jackpot-bonus", epoch, jackpotBonus, asBigInt(event.jackpotBonus));
    }
    const baseReward = expectedTotalPool - dailyAccrual - weeklyAccrual - protocolFee - burnAmount;
    const rewardPool = asBigInt(event.rewardPool);
    if (rewardPool === 0n) {
      if (jackpotBonus !== 0n) mismatch("rollover-jackpot", epoch, 0n, jackpotBonus);
      state.rolloverPool = baseReward;
    } else {
      const expectedRewardPool = baseReward + jackpotBonus;
      if (rewardPool !== expectedRewardPool) mismatch("reward-pool", epoch, expectedRewardPool, rewardPool);
    }

    freshPools.delete(epoch);
    dailyAwards.delete(epoch);
    weeklyAwards.delete(epoch);
    resolverRewards.delete(epoch);
  }

  return { state, mismatches };
}

export function compareAccountingSnapshot(actual, expected) {
  const mismatches = [];
  for (const key of ["rolloverPool", "dailyJackpotPool", "weeklyJackpotPool", "accruedOwnerFees", "accruedBurnFees"]) {
    const actualValue = asBigInt(actual[key]);
    const expectedValue = asBigInt(expected[key]);
    if (actualValue !== expectedValue) {
      mismatches.push({ kind: key, expected: expectedValue.toString(), actual: actualValue.toString() });
    }
  }
  return mismatches;
}
