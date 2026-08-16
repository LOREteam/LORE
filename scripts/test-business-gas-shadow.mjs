import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as constantsModule from "../app/lib/constants.ts";
import * as lineaGasShadowModule from "../app/lib/lineaEstimateGasShadow.ts";
import * as miningGasPolicyModule from "../app/lib/miningGasPolicy.ts";
import * as miningRuntimeHelpersModule from "../app/hooks/useMiningRuntimeHelpers.ts";

const constants = constantsModule.default ?? constantsModule;
const lineaGasShadow = lineaGasShadowModule.default ?? lineaGasShadowModule;
const miningGasPolicy = miningGasPolicyModule.default ?? miningGasPolicyModule;
const miningRuntimeHelpers = miningRuntimeHelpersModule.default ?? miningRuntimeHelpersModule;
const { CONTRACT_ADDRESS } = constants;

const account = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const testAbi = [{
  type: "function",
  name: "placeBet",
  stateMutability: "nonpayable",
  inputs: [
    { name: "tile", type: "uint256" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [],
}];

function shadowOptions(publicClient, overrides = {}) {
  return {
    publicClient,
    account,
    to: target,
    abi: testAbi,
    functionName: "placeBet",
    args: [1n, 2n],
    baselineGas: 100_000n,
    tag: "behavior-test",
    ...overrides,
  };
}

async function runMiningRuntimeHelperBehaviorTests() {
  const { useMiningRuntimeHelpers } = miningRuntimeHelpers;
  assert.equal(typeof useMiningRuntimeHelpers, "function");

  let balance = 19n;
  let estimateFailure = null;
  const events = [];
  const publicClient = {
    estimateContractGas: async ({ functionName, args }) => {
      events.push({ kind: "baseline", functionName, args });
      if (estimateFailure) throw estimateFailure;
      return 100n;
    },
    getBalance: async ({ address }) => {
      events.push({ kind: "balance", address });
      return balance;
    },
  };
  const recorded = [];
  const options = {
    getActorAddress: () => account,
    publicClientRef: { current: publicClient },
    tokenGetterWarningShownRef: { current: false },
    gasBumpBase: 10n,
    minGasPlaceBet: 100n,
    minGasPlaceBatch: 200n,
    gasCostBufferBps: 10_000n,
    bpsDenominator: 10_000n,
    recordEstimateGasShadow: (options) => {
      events.push({ kind: "shadow", baselineGas: options.baselineGas, tag: options.tag });
      recorded.push(options);
      return Promise.resolve(999_999n);
    },
  };
  let helpers;
  function RuntimeHelperProbe() {
    helpers = useMiningRuntimeHelpers(options);
    return null;
  }
  assert.equal(renderToStaticMarkup(React.createElement(RuntimeHelperProbe)), "");
  assert.ok(helpers, "React SSR must execute the real mining runtime hook");

  await assert.rejects(
    helpers.assertNativeGasBalance(10n, { gasPrice: 2n }),
    /Not enough ETH for gas/,
    "the hook must apply the exact native-balance policy before a wallet send",
  );
  balance = 20n;
  await assert.doesNotReject(helpers.assertNativeGasBalance(10n, { gasPrice: 2n }));

  events.length = 0;
  const bufferedGas = await helpers.estimateGas("placeBet", [1n, 2n], 1n);
  assert.equal(bufferedGas, 181n, "the shadow result must not replace the buffered baseline gas limit");
  assert.deepEqual(events, [
    { kind: "baseline", functionName: "placeBet", args: [1n, 2n] },
    { kind: "shadow", baselineGas: 100n, tag: "wallet-mining" },
  ]);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].account, account);
  assert.equal(recorded[0].to, CONTRACT_ADDRESS);
  assert.equal(recorded[0].functionName, "placeBet");
  assert.deepEqual(recorded[0].args, [1n, 2n]);

  estimateFailure = new Error("network request failed");
  events.length = 0;
  const fallbackGas = await helpers.estimateGas("placeBet", [1n, 2n], 1n);
  assert.equal(fallbackGas, 100n);
  assert.deepEqual(events, [
    { kind: "baseline", functionName: "placeBet", args: [1n, 2n] },
  ], "a failed baseline estimate must not emit a shadow request");
}

export async function runGasShadowBehaviorTests() {
  await runMiningRuntimeHelperBehaviorTests();
  let disabledRequests = 0;
  const disabledLogs = [];
  const disabledRecorder = lineaGasShadow.createLineaEstimateGasShadowRecorder({
    enabled: () => false,
    logInfo: (...args) => disabledLogs.push(args),
  });
  const disabledResult = disabledRecorder(shadowOptions({
    request: async () => {
      disabledRequests += 1;
      return 1n;
    },
  }));
  assert.equal(disabledResult, undefined);
  assert.equal(disabledRequests, 0);
  assert.deepEqual(disabledLogs, []);

  const requests = [];
  const logs = [];
  const recorder = lineaGasShadow.createLineaEstimateGasShadowRecorder({
    enabled: () => true,
    logInfo: (tag, message, data) => logs.push({ tag, message, data }),
  });
  const publicClient = {
    request: async (request) => {
      requests.push(request);
      return "0x249f0";
    },
  };
  await recorder(shadowOptions(publicClient));
  await recorder(shadowOptions(publicClient, { args: [25n, 99n] }));
  assert.equal(requests.length, 1, "one recorder must probe each tag/function pair at most once");
  assert.equal(requests[0].method, "linea_estimateGas");
  assert.equal(requests[0].params[0].from, account);
  assert.equal(requests[0].params[0].to, target);
  assert.match(requests[0].params[0].data, /^0x[0-9a-f]+$/i);
  assert.deepEqual(logs, [{
    tag: "GasShadow",
    message: "linea_estimateGas shadow",
    data: {
      tag: "behavior-test",
      functionName: "placeBet",
      baselineGas: 100_000n,
      lineaGas: 150_000n,
      ratioBps: 15_000,
    },
  }]);

  await recorder(shadowOptions(publicClient, {
    tag: "zero-baseline",
    baselineGas: 0n,
  }));
  assert.equal(requests.length, 2);
  assert.equal(logs.at(-1).data.ratioBps, null);

  const unavailableCases = [
    [new Error("request timed out token=timeout-secret"), "timeout"],
    [Object.assign(new Error("provider secret"), { code: -32601 }), "method-unsupported"],
    [new Error("429 too many requests token=rate-secret"), "rate-limited"],
    [new Error("execution reverted token=revert-secret"), "revert"],
    [new Error("socket ECONNRESET token=network-secret"), "network"],
    [new Error("opaque provider failure token=unknown-secret"), "unknown"],
  ];
  for (const [error, expectedReason] of unavailableCases) {
    const failureLogs = [];
    const failureRecorder = lineaGasShadow.createLineaEstimateGasShadowRecorder({
      enabled: () => true,
      logInfo: (tag, message, data) => failureLogs.push({ tag, message, data }),
    });
    await failureRecorder(shadowOptions({ request: async () => { throw error; } }));
    assert.deepEqual(failureLogs, [{
      tag: "GasShadow",
      message: "linea_estimateGas shadow unavailable",
      data: {
        tag: "behavior-test",
        functionName: "placeBet",
        reason: expectedReason,
      },
    }]);
    const publicFailureEvidence = `${failureLogs[0].message} ${Object.values(failureLogs[0].data).join(" ")}`;
    assert.doesNotMatch(publicFailureEvidence, /secret|provider failure|econnreset|execution reverted/i);
  }

  const weiPerEth = 10n ** 18n;
  assert.equal(miningGasPolicy.formatNativeWeiSixDecimals(-1n), "0.000000");
  assert.equal(miningGasPolicy.formatNativeWeiSixDecimals(0n), "0.000000");
  assert.equal(miningGasPolicy.formatNativeWeiSixDecimals(weiPerEth), "1.000000");
  assert.equal(
    miningGasPolicy.formatNativeWeiSixDecimals(1_234_567_400_000_000_000n),
    "1.234567",
  );
  assert.equal(
    miningGasPolicy.formatNativeWeiSixDecimals(1_234_567_500_000_000_000n),
    "1.234568",
  );
  assert.equal(
    miningGasPolicy.formatNativeWeiSixDecimals(999_999_500_000_000_000n),
    "1.000000",
  );

  const hugeRequiredCost = 9_007_199_254_740_993n * weiPerEth + 550_000_000_000_000_000n;
  const hugeBalance = hugeRequiredCost - 100_000_000_000_000_000n;
  assert.equal(
    Number(hugeBalance),
    Number(hugeRequiredCost),
    "precision fixture must alias when incorrectly coerced through Number",
  );
  assert.throws(
    () => miningGasPolicy.assertSufficientNativeGasBalance(hugeBalance, hugeRequiredCost),
    {
      message: "Not enough ETH for gas: need ~9007199254740993.550000 ETH, have 9007199254740993.450000 ETH.",
    },
  );
  assert.doesNotThrow(() => miningGasPolicy.assertSufficientNativeGasBalance(hugeRequiredCost, hugeRequiredCost));
  assert.doesNotThrow(() => miningGasPolicy.assertSufficientNativeGasBalance(hugeRequiredCost + 1n, hugeRequiredCost));

  assert.equal(miningGasPolicy.getBufferedMiningGasLimit(100n, 100n, 1n), 181n);
  assert.equal(miningGasPolicy.getBufferedMiningGasLimit(100n, 200n, 1n), 200n);
  const hugeBaseline = 9_007_199_254_740_993n;
  assert.equal(
    miningGasPolicy.getBufferedMiningGasLimit(hugeBaseline, 0n, 7n),
    16_212_958_658_533_794n,
  );
}
