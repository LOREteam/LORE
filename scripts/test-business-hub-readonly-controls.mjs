import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as gameEpochUiStateModule from "../app/hooks/useGameEpochUiState.ts";
import * as miningGuardsModule from "../app/hooks/useMiningGuards.ts";
import * as hubFeeEstimateModule from "../app/lib/hubFeeEstimate.ts";

const gameEpochUiState = gameEpochUiStateModule.default ?? gameEpochUiStateModule;
const miningGuards = miningGuardsModule.default ?? miningGuardsModule;
const hubFeeEstimate = hubFeeEstimateModule.default ?? hubFeeEstimateModule;

export async function runHubReadOnlyControlTests() {
  assert.equal(miningGuards.getMiningReadOnlyBlockReason("Indexer is stale."), "Indexer is stale.");
  assert.equal(miningGuards.getMiningReadOnlyBlockReason("Indexer is stale.", false), "Indexer is stale.");
  assert.equal(miningGuards.getMiningReadOnlyBlockReason("Indexer is stale.", true), null);
  assert.equal(miningGuards.getMiningReadOnlyBlockReason(null), null);

  assert.equal(miningGuards.parseDecimalNumberToUnits(0.1, 18), 100_000_000_000_000_000n);
  assert.equal(miningGuards.parseDecimalNumberToUnits(1.25, 6), 1_250_000n);
  assert.equal(miningGuards.parseDecimalNumberToUnits(Number.NaN, 18), null);
  assert.equal(miningGuards.parseDecimalNumberToUnits(0.123, 2), null);
  assert.equal(
    miningGuards.isBalanceBelowDecimalThreshold(
      { value: 99_999_999_999_999_999n, decimals: 18 },
      0.1,
    ),
    true,
  );
  assert.equal(
    miningGuards.isBalanceBelowDecimalThreshold(
      { value: 100_000_000_000_000_000n, decimals: 18 },
      0.1,
    ),
    false,
  );
  assert.equal(
    miningGuards.isBalanceBelowWholeToken(
      { value: 999_999_999_999_999_999n, decimals: 18 },
    ),
    true,
  );
  assert.equal(
    miningGuards.isBalanceBelowWholeToken(
      { value: 1_000_000_000_000_000_000n, decimals: 18 },
    ),
    false,
  );
  assert.equal(
    miningGuards.isBalanceBelowWholeToken({ value: 10n, decimals: 256 }),
    true,
  );

  assert.deepEqual(
    hubFeeEstimate.normalizeHubFeeEstimateTiles("3,1,3,0,26,01,1e1,9007199254740992", 25),
    [1, 3],
  );
  assert.deepEqual(hubFeeEstimate.normalizeHubFeeEstimateTiles("1,2", 0), []);
  assert.deepEqual(hubFeeEstimate.normalizeHubFeeEstimateTiles("", 25), []);
  assert.deepEqual(
    hubFeeEstimate.buildHubFeeEstimatePlan({
      requiresEpochBoundBets: true,
      gridDisplayEpoch: "42",
      selectedTiles: [1, 25],
      amount: 10n ** 18n,
    }),
    {
      functionName: "placeBatchBetsBitmapForEpoch",
      args: [42n, 16_777_217, 10n ** 18n],
      tileMask: 16_777_217,
    },
  );
  assert.deepEqual(
    hubFeeEstimate.buildHubFeeEstimatePlan({
      requiresEpochBoundBets: false,
      gridDisplayEpoch: null,
      selectedTiles: [7],
      amount: 2n,
    }),
    { functionName: "placeBet", args: [7n, 2n], tileMask: 64 },
  );
  assert.deepEqual(
    hubFeeEstimate.buildHubFeeEstimatePlan({
      requiresEpochBoundBets: false,
      gridDisplayEpoch: null,
      selectedTiles: [1, 2],
      amount: 3n,
    }),
    { functionName: "placeBatchBetsBitmap", args: [3, 3n], tileMask: 3 },
  );
  assert.throws(
    () => hubFeeEstimate.buildHubFeeEstimatePlan({
      requiresEpochBoundBets: true,
      gridDisplayEpoch: "01",
      selectedTiles: [1],
      amount: 1n,
    }),
    /Current epoch unavailable/,
  );
  assert.throws(
    () => hubFeeEstimate.buildHubFeeEstimatePlan({
      requiresEpochBoundBets: true,
      gridDisplayEpoch: "42",
      selectedTiles: [],
      amount: 1n,
    }),
    /No selected tiles/,
  );
  assert.equal(hubFeeEstimate.formatHubFeeEstimate(21_000n, 1_000_000_000n), "0.000021");
  assert.equal(
    hubFeeEstimate.formatHubFeeEstimate(9_007_199_254_740_993n, 1_000_000_000n),
    "9007199.254741",
  );
  assert.throws(() => hubFeeEstimate.formatHubFeeEstimate(21_000n, 0n), /No fee quote/);
  assert.equal(hubFeeEstimate.HUB_FEE_ESTIMATE_DEBOUNCE_MS, 600);
  const feeCalls = [];
  assert.equal(
    await hubFeeEstimate.collectHubFeeEstimate({
      estimateGas: async () => {
        feeCalls.push("gas");
        return 21_000n;
      },
      estimateFeesPerGas: async () => {
        feeCalls.push("fees");
        return { gasPrice: 1_000_000_000n, maxFeePerGas: 2_000_000_000n };
      },
    }),
    "0.000042",
  );
  assert.deepEqual(feeCalls, ["gas", "fees"]);
  assert.equal(
    await hubFeeEstimate.collectHubFeeEstimate({
      estimateGas: async () => 21_000n,
      estimateFeesPerGas: async () => ({ gasPrice: 1_000_000_000n }),
    }),
    "0.000021",
  );
  await assert.rejects(
    hubFeeEstimate.collectHubFeeEstimate({
      estimateGas: async () => 21_000n,
      estimateFeesPerGas: async () => ({ maxFeePerGas: null, gasPrice: null }),
    }),
    /No fee quote/,
  );
  assert.equal(hubFeeEstimate.getHubFeeEstimateLabel("0.000021", false), "~0.000021 ETH");
  assert.equal(hubFeeEstimate.getHubFeeEstimateLabel(null, false), "calculating");
  assert.equal(hubFeeEstimate.getHubFeeEstimateLabel(null, true), "unavailable");
  assert.deepEqual(
    hubFeeEstimate.getHubReadOnlyPresentation("Indexer is stale."),
    { testId: "hub-read-only-banner", text: "Indexer is stale." },
  );
  assert.equal(hubFeeEstimate.getHubReadOnlyPresentation(""), null);
  assert.equal(hubFeeEstimate.getHubReadOnlyPresentation(null), null);

  const hubContentSource = readFileSync("app/components/HubContent.tsx", "utf8");
  assert.match(
    hubContentSource,
    /getHubReadOnlyPresentation\(readOnlyReason\)[\s\S]*data-testid=\{readOnlyPresentation\.testId\}[\s\S]*readOnlyReason=\{readOnlyPresentation\?\.text \?\? null\}/,
    "HubContent must bind the behavior-tested read-only presentation to the banner and betting controls",
  );
  assert.match(
    hubContentSource,
    /normalizeHubFeeEstimateTiles\([\s\S]*buildHubFeeEstimatePlan\(\{[\s\S]*collectHubFeeEstimate\(\{[\s\S]*functionName: estimatePlan\.functionName[\s\S]*estimateFeesPerGas[\s\S]*HUB_FEE_ESTIMATE_DEBOUNCE_MS/,
    "HubContent must bind the behavior-tested tile, V10 call-plan, live fee quote, and debounce policies",
  );

  assert.equal(gameEpochUiState.selectSeededVisualEpoch(null, "17"), "17");
  assert.equal(gameEpochUiState.selectSeededVisualEpoch("16", "17"), "17");
  assert.equal(gameEpochUiState.selectSeededVisualEpoch("17", "17"), "17");
  assert.equal(gameEpochUiState.selectSeededVisualEpoch("16", null), "16");
  assert.match(
    readFileSync("app/hooks/useGameEpochUiState.ts", "utf8"),
    /setVisualEpoch\(\(current\) => selectSeededVisualEpoch\(current, seededVisualEpoch\)\)[\s\S]*\}, \[seededVisualEpoch\]\)/,
    "game epoch UI state must bind the behavior-tested functional sync to seeded-epoch changes",
  );
  assert.match(
    readFileSync("app/components/HubSidePanel.tsx", "utf8"),
    /Fee \{getHubFeeEstimateLabel\(feeEstimate, feeEstimateUnavailable\)\}/,
    "mobile manual bet must bind the behavior-tested fee presentation",
  );

}
