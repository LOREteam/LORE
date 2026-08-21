import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as tokenAmountMathModule from "../app/lib/tokenAmountMath.ts";
import * as balanceFormattingModule from "../app/lib/balanceFormatting.ts";
import * as miningTxPathModule from "../app/lib/miningTxPath.ts";
import * as walletTransfersModule from "../app/hooks/useWalletTransfers.ts";
import * as pageWalletOverviewModule from "../app/hooks/usePageWalletOverview.ts";
import * as autoMinerFormModule from "../app/hooks/useAutoMinerForm.ts";
import * as analyticsAchievementsModule from "../app/hooks/useAnalyticsAchievements.ts";
import * as autoResolveStorageModule from "../app/hooks/autoResolveStorage.ts";
import * as appConstantsModule from "../app/lib/constants.ts";

export async function runWalletModelTests() {
  const miningShared = miningSharedModule.default ?? miningSharedModule;
  const tokenAmountMath = tokenAmountMathModule.default ?? tokenAmountMathModule;
  const balanceFormatting = balanceFormattingModule.default ?? balanceFormattingModule;
  const miningTxPath = miningTxPathModule.default ?? miningTxPathModule;
  const walletTransfers = walletTransfersModule.default ?? walletTransfersModule;
  const pageWalletOverview = pageWalletOverviewModule.default ?? pageWalletOverviewModule;
  const autoMinerForm = autoMinerFormModule.default ?? autoMinerFormModule;
  const analyticsAchievements = analyticsAchievementsModule.default ?? analyticsAchievementsModule;
  const autoResolveStorage = autoResolveStorageModule.default ?? autoResolveStorageModule;
  const appConstants = appConstantsModule.default ?? appConstantsModule;
  const normalizedDuplicateTiles = tokenAmountMath.normalizeTileAmounts(
    [2, 2, 5],
    ["1000000000000000.123456789123456789", "0.876543210876543211", "1"],
    "1000000000000002",
  );
  assert.deepEqual(normalizedDuplicateTiles, {
    tileIds: [2, 5],
    amounts: ["1000000000000001", "1"],
  });
  assert.equal(
    tokenAmountMath.computeWinningAmountWei(
      [1, 2, 3],
      undefined,
      2,
      "3000000000000000.000000000000000003",
    ),
    1_000_000_000_000_000_000_000_000_000_000_000n + 1n,
  );
  assert.equal(
    tokenAmountMath.computeWinningAmountWei([1, 2, 2], ["1", "2", "3"], 2, "999"),
    5_000_000_000_000_000_000n,
  );
  assert.equal(tokenAmountMath.parseLineaAmountWei("not-a-number"), 0n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("0"), null);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("0.0000000000000000001"), null);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWei("1.25"), 1_250_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("bad", "1"), 1_000_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("0", "1"), 1_000_000_000_000_000_000n);
  assert.equal(tokenAmountMath.parsePositiveLineaAmountWeiOrFallback("2.5", "1"), 2_500_000_000_000_000_000n);
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("bad", 4), "0.0000");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1000000000000000000", 2), "1.00");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("2500000000000000000", 1), "2.5");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1234567890000000000000", 2), "1,234.57");
  assert.equal(tokenAmountMath.formatLineaWeiAmountDisplay("1234567890123456789012345678900000000000000000", 0), "1,234,567,890,123,456,789,012,345,679");
  assert.equal(tokenAmountMath.formatLineaWeiDisplayNumber(1_234_567_899_000_000_000n), 1.234568);
  assert.equal(tokenAmountMath.formatLineaWeiDisplayNumber(1_234_567_499_000_000_000n), 1.234567);
  assert.equal(tokenAmountMath.formatLineaWeiDisplayNumber(-1n), 0);
  assert.equal(
    tokenAmountMath.formatLineaWeiDisplayNumber((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000_000_000n),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(tokenAmountMath.formatLineaAmountFixed(1_234_567_899_000_000_000n, 2), "1.23");
  assert.equal(tokenAmountMath.formatLineaAmountFixed(1_235_000_000_000_000_000n, 2), "1.24");
  assert.equal(tokenAmountMath.formatLineaAmountFixed(999_999_999_999_999_999n, 0), "1");
  assert.deepEqual(
    miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", reason: "ok", ts: 123 }, 1_000),
    { mode: "standard-silent", reason: "ok", ts: 123 },
  );
  assert.deepEqual(
    miningTxPath.sanitizeMiningTxPathState({ mode: "wallet-write", reason: 999, ts: 123 }, 1_000),
    { mode: "wallet-write", ts: 123 },
  );
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "bad", ts: 123 }, 1_000), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: Number.NaN }, 1_000), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: 123.5 }, 1_000), null);
  assert.equal(
    miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: Number.MAX_SAFE_INTEGER + 1 }, 1_000),
    null,
  );
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: 1_000 }, 1_000.5), null);
  assert.equal(miningTxPath.sanitizeMiningTxPathState({ mode: "standard-silent", ts: 7_001 }, 1_000), null);
  const pendingMiningState = miningTxPath.sanitizePendingMiningTxState({
    chainId: 59141,
    contract: "0x1111111111111111111111111111111111111111",
    actor: "0x2222222222222222222222222222222222222222",
    hash: `0x${"a".repeat(64)}`,
    ts: 1_000,
  }, 2_000);
  assert.ok(pendingMiningState);
  let legacyRecoveryRpcCalls = 0;
  const legacyRecoveryClient = {
    getTransactionReceipt: async () => {
      legacyRecoveryRpcCalls += 1;
      throw new Error("legacy state must not reach receipt recovery");
    },
    getTransaction: async () => {
      legacyRecoveryRpcCalls += 1;
      throw new Error("legacy state must not reach transaction recovery");
    },
  };
  assert.equal(
    await miningTxPath.recoverPendingMiningTx([legacyRecoveryClient, legacyRecoveryClient], pendingMiningState),
    "manual-reconciliation-required",
    "legacy hash-only mining state must never be treated as proof of the submitted intent",
  );
  assert.equal(legacyRecoveryRpcCalls, 0, "legacy mining state must fail closed before any RPC read");
  const ambiguousPendingMiningState = miningTxPath.sanitizePendingMiningTxState({
    chainId: 59141,
    contract: "0x1111111111111111111111111111111111111111",
    actor: "0x2222222222222222222222222222222222222222",
    nonce: 7,
    ts: 1_000,
  }, 2_000);
  assert.ok(ambiguousPendingMiningState);
  assert.equal(
    miningShared.isAmbiguousPendingTxError(new Error("External wallet eth_sendTransaction timed out after 45000ms")),
    true,
  );
  const silentWalletTimeout = new Error("Privy sendTransaction timed out after 45000ms");
  silentWalletTimeout.name = "WalletSendTimeoutError";
  assert.equal(
    miningShared.isAmbiguousPendingTxError(silentWalletTimeout),
    true,
    "a hashless Privy send timeout must stay pending instead of falling back to a duplicate wallet send",
  );
  assert.equal(
    miningShared.isAmbiguousPendingTxError(new Error("RPC read timed out after 45000ms")),
    false,
  );
  const miningBetExecutionSource = readFileSync("app/hooks/useMiningBetExecution.ts", "utf8");
  assert.match(
    miningBetExecutionSource,
    /catch \(error\) \{\s*if \(isAmbiguousPendingTxError\(error\)\) \{\s*throw error;/,
    "manual silent receipt timeouts must not fall back to a duplicate wallet send",
  );
  const hashlessRecoveryClients = (client) => [client, client];
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 8 : 8,
    }), ambiguousPendingMiningState),
    "manual-reconciliation-required",
    "a consumed nonce without a transaction hash must retain the duplicate-send block for manual reconciliation",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8,
    }), ambiguousPendingMiningState),
    "pending",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => 7,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000),
    "manual-reconciliation-required",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("hashless state must not request a receipt"); },
      getTransaction: async () => { throw new Error("hashless state must not request a transaction"); },
      getTransactionCount: async () => 7,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts - 1),
    "pending",
    "future-dated hashless pending tx state must not clear before caller time catches up",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("malformed hashless nonce recovery must not request a receipt"); },
      getTransaction: async () => { throw new Error("malformed hashless nonce recovery must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? "7" : 7,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000),
    "pending",
    "malformed hashless nonce evidence must keep pending tx recovery fail-closed",
  );
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(hashlessRecoveryClients({
      getTransactionReceipt: async () => { throw new Error("inverted hashless nonce recovery must not request a receipt"); },
      getTransaction: async () => { throw new Error("inverted hashless nonce recovery must not request a transaction"); },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 9 : 8,
    }), ambiguousPendingMiningState, ambiguousPendingMiningState.ts + 15 * 60_000),
    "pending",
    "hashless nonce recovery must fail closed when pending nonce evidence is behind latest",
  );
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, chainId: 0 }), null);
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, actor: "0x1234" }), null);
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, hash: "0x1234" }), null);
  assert.equal(
    miningTxPath.sanitizePendingMiningTxState({ ...ambiguousPendingMiningState, hash: "0x1234" }),
    null,
    "pending tx recovery must reject malformed hashes even when a nonce fallback is present",
  );
  assert.equal(
    miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, nonce: -1 }),
    null,
    "pending tx recovery must reject malformed nonces even when a hash is present",
  );
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: 1_000.5 }, 2_000), null);
  assert.equal(
    miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: Number.MAX_SAFE_INTEGER + 1 }, 2_000),
    null,
  );
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: 1_000 }, 2_000.5), null);
  assert.equal(miningTxPath.sanitizePendingMiningTxState({ ...pendingMiningState, ts: 8_001 }, 2_000), null);
  const miningTxPathSource = readFileSync("app/lib/miningTxPath.ts", "utf8");
  const completePendingMiningState = miningTxPath.sanitizePendingMiningTxState({
    chainId: 59141,
    contract: "0x1111111111111111111111111111111111111111",
    actor: "0x2222222222222222222222222222222222222222",
    hash: `0x${"a".repeat(64)}`,
    nonce: 7,
    calldata: "0x1234",
    expectedEpoch: "42",
    tileIds: [1],
    amountRawPerTile: "5",
    baselineBets: Array(25).fill("0"),
    ts: 1_000,
  }, 2_000);
  assert.ok(completePendingMiningState);
  const receipt = {
    status: "success",
    transactionHash: completePendingMiningState.hash,
    blockHash: `0x${"b".repeat(64)}`,
    blockNumber: 10n,
    transactionIndex: 0,
  };
  const createRecoveryClient = (clientReceipt = receipt, bets = [5n, ...Array(24).fill(0n)]) => ({
    getTransactionReceipt: async () => clientReceipt,
    getTransaction: async () => ({
      hash: completePendingMiningState.hash,
      from: completePendingMiningState.actor,
      to: completePendingMiningState.contract,
      type: "eip1559",
      nonce: completePendingMiningState.nonce,
      input: completePendingMiningState.calldata,
      blockHash: clientReceipt.blockHash,
      blockNumber: clientReceipt.blockNumber,
      transactionIndex: clientReceipt.transactionIndex,
    }),
    getTransactionCount: async () => 8,
    getChainId: async () => 59141,
    getBlockNumber: async () => 12n,
    getBlock: async () => ({ hash: clientReceipt.blockHash }),
    readContract: async () => bets,
  });
  const agreeingRecoveryClient = createRecoveryClient();
  assert.equal(
    await miningTxPath.recoverPendingMiningTx([agreeingRecoveryClient, agreeingRecoveryClient], completePendingMiningState, 2_000, 2n),
    "confirmed",
    "complete intent requires two matching final receipts and its expected bet delta before confirmation",
  );
  const mismatchedReceipt = { ...receipt, blockHash: `0x${"c".repeat(64)}` };
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(
      [createRecoveryClient(), createRecoveryClient(mismatchedReceipt)],
      completePendingMiningState,
      2_000,
      2n,
    ),
    "manual-reconciliation-required",
    "receipt disagreement must keep a pending mining intent fail-closed",
  );
  const revertedReceipt = { ...receipt, status: "reverted" };
  const revertedRecoveryClient = createRecoveryClient(revertedReceipt);
  assert.equal(
    await miningTxPath.recoverPendingMiningTx(
      [revertedRecoveryClient, revertedRecoveryClient],
      completePendingMiningState,
      2_000,
      2n,
    ),
    "clear",
    "a matching finalized reverted receipt clears the pending mining intent",
  );
  assert.match(
    miningTxPathSource,
    /function normalizeMiningTimestamp[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*isSafeCurrentTime\(now\)[\s\S]*value - now > MINING_TX_PATH_MAX_FUTURE_SKEW_MS/,
    "mining tx path timestamps must use a shared safe-integer non-future normalizer",
  );
  assert.match(
    miningTxPathSource,
    /function hasPendingTxNotFoundGraceElapsed[\s\S]*Number\.isSafeInteger\(ts\)[\s\S]*ts > now[\s\S]*now - ts >= PENDING_TX_NOT_FOUND_GRACE_MS/,
    "pending tx not-found recovery must fail closed on malformed or future timestamps",
  );
  assert.match(
    miningTxPathSource,
    /function normalizePendingTxNonce[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*readNonceObservation[\s\S]*normalizedPending < normalizedLatest[\s\S]*observationsAgree\(nonceObservations\[0\], nonceObservations\[1\]\)[\s\S]*normalizedLatestNonce > state\.nonce[\s\S]*return "manual-reconciliation-required"/,
    "hashless pending recovery must normalize two-RPC nonce evidence and never clear a consumed unknown nonce",
  );
  assert.doesNotMatch(
    miningTxPathSource,
    /typeof (?:raw\.)?ts !== "number" \|\| !Number\.isFinite\((?:raw\.)?ts\) \|\| (?:raw\.)?ts <= 0|now - state\.ts >= PENDING_TX_NOT_FOUND_GRACE_MS|latestNonce > state\.nonce|pendingNonce > state\.nonce/,
    "mining tx recovery must not return to broad finite timestamp checks, direct age arithmetic, or raw nonce comparisons",
  );
  assert.match(
    miningTxPathSource,
    /pendingTxStorageKey[\s\S]*getAddress\(contract\)[\s\S]*getAddress\(actor\)/,
    "pending mining tx storage keys must normalize contract and actor addresses with the EVM address parser",
  );
  assert.match(
    miningTxPathSource,
    /function tryPendingTxStorageKey\(chainId: number, contract: string, actor: string\)[\s\S]*return pendingTxStorageKey\(chainId, contract, actor\);[\s\S]*catch \{[\s\S]*return null;[\s\S]*export function clearPendingMiningTxState[\s\S]*const key = tryPendingTxStorageKey\(chainId, contract, actor\);[\s\S]*if \(!key\) return false;/,
    "pending mining tx scoped storage cleanup must fail closed when contract or actor scope is malformed",
  );
  assert.match(
    readFileSync("app/hooks/usePrivyWallet.ts", "utf8"),
    /function normalizeWalletAddress[\s\S]*getAddress\(value\)[\s\S]*normalizeWalletAddress\(embeddedWallet\.address\)/,
    "Privy wallet selection must normalize embedded and external wallet addresses before comparison",
  );
  assert.match(
    readFileSync("app/components/wallet/WalletSettingsOverviewPanel.tsx", "utf8"),
    /getAddress\(address\)\.toLowerCase\(\)/,
    "wallet settings resolver rows must normalize connected and embedded wallet addresses before comparison",
  );
  const priorWindow = globalThis.window;
  const pendingStorage = new Map();
  try {
    globalThis.window = {
      dispatchEvent: () => true,
      localStorage: {
        getItem: (key) => pendingStorage.get(key) ?? null,
        removeItem: (key) => pendingStorage.delete(key),
        setItem: (key, value) => pendingStorage.set(key, value),
      },
    };
    miningTxPath.writeMiningTxPathState("wallet-write", "test");
    assert.ok(miningTxPath.readMiningTxPathState());
    pendingStorage.set("lineaore:mining-tx-path:v1", "{bad json");
    assert.equal(miningTxPath.readMiningTxPathState(), null);
    assert.equal(pendingStorage.has("lineaore:mining-tx-path:v1"), false, "corrupt mining tx path state must be cleared");
    assert.equal(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, pendingMiningState.contract, "0x1234"),
      null,
      "pending tx recovery reads with malformed actors must fail closed without throwing",
    );
    assert.equal(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, "0x1234", pendingMiningState.actor),
      null,
      "pending tx recovery reads with malformed contracts must fail closed without throwing",
    );
    assert.doesNotThrow(
      () => miningTxPath.clearPendingMiningTxState(pendingMiningState.chainId, pendingMiningState.contract, "0x1234"),
      "pending tx recovery cleanup with a malformed actor must not throw",
    );
    miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: pendingMiningState.contract,
      actor: pendingMiningState.actor,
      hash: pendingMiningState.hash,
    });
    const firstPendingKey = [...pendingStorage.keys()].find((key) => key.startsWith("lineaore:pending-mining-tx:v2:"));
    assert.ok(firstPendingKey);
    const recoveredLegacyState = miningTxPath.readPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      pendingMiningState.actor,
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(recoveredLegacyState)),
      { ...pendingMiningState, ts: [...pendingStorage.values()].map((raw) => JSON.parse(raw).ts)[0] },
    );
    pendingStorage.set(firstPendingKey, "{bad json");
    assert.ok(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, pendingMiningState.contract, pendingMiningState.actor),
      "an in-flight actor latch must remain fail-closed when its backing storage is corrupted",
    );
    assert.equal(pendingStorage.has(firstPendingKey), true, "corrupt backing state must not silently unlock an active submission");
    miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: pendingMiningState.contract,
      actor: pendingMiningState.actor,
      hash: pendingMiningState.hash,
    });
    assert.equal(miningTxPath.readPendingMiningTxState(59144, pendingMiningState.contract, pendingMiningState.actor), null);
    assert.equal(
      miningTxPath.readPendingMiningTxState(
        pendingMiningState.chainId,
        pendingMiningState.contract,
        "0x3333333333333333333333333333333333333333",
      ),
      null,
    );
    miningTxPath.writePendingMiningTxState({
      chainId: pendingMiningState.chainId,
      contract: pendingMiningState.contract,
      actor: "0x3333333333333333333333333333333333333333",
      hash: `0x${"b".repeat(64)}`,
    });
    assert.equal(pendingStorage.size, 2, "different actors must keep independent pending recovery records");
    miningTxPath.clearPendingMiningTxState(
      pendingMiningState.chainId,
      pendingMiningState.contract,
      pendingMiningState.actor,
    );
    assert.equal(
      miningTxPath.readPendingMiningTxState(pendingMiningState.chainId, pendingMiningState.contract, pendingMiningState.actor),
      null,
    );
    assert.ok(
      miningTxPath.readPendingMiningTxState(
        pendingMiningState.chainId,
        pendingMiningState.contract,
        "0x3333333333333333333333333333333333333333",
      ),
      "clearing one actor must preserve another actor's pending record",
    );
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 1n), 1n);
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 7n), 7n);
  assert.equal(walletTransfers.getWalletTransferScanFromBlock(10n, 11n), null);
  assert.equal(walletTransfers.getWalletTransferFallbackFromBlock(1n, 100n, 250n), 1n);
  assert.equal(walletTransfers.getWalletTransferFallbackFromBlock(1n, 1000n, 250n), 751n);
  assert.equal(
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 2,
    }),
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 2,
    }),
    "wallet transfer dedupe keys must be stable for the same event log",
  );
  assert.notEqual(
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 2,
    }),
    walletTransfers.getWalletTransferLogKey({
      transactionHash: "0xabc",
      blockNumber: 10n,
      transactionIndex: 1,
      logIndex: 3,
    }),
    "wallet transfer history must not collapse distinct logs from the same transaction",
  );
  assert.equal(walletTransfers.normalizeWalletTransferTxHash("0xabc"), "");
  assert.equal(
    walletTransfers.normalizeWalletTransferTxHash(`  0x${"Ab".repeat(32)}  `),
    `0x${"ab".repeat(32)}`,
    "wallet transfer history must only preserve full transaction hashes in lowercase",
  );
  assert.equal(walletTransfers.normalizeWalletTransferAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  assert.equal(walletTransfers.normalizeWalletTransferAddress("0xabc"), null);
  assert.equal(walletTransfers.normalizeWalletTransferAddress(null), null);
  const persistedTransferSummary = walletTransfers.parsePersistedWalletTransfersSummary({
    version: 1,
    savedAt: 1_700_000_000_000,
    transfers: [{
      direction: "in",
      counterparty: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      amount: "12.50",
      amountNum: 12.5,
      txHash: `0x${"a".repeat(64)}`,
      blockNumber: "123456",
      transactionIndex: 1,
      logIndex: 2,
    }],
    totalIn: 12.5,
    totalOut: 0,
    totalInDisplay: "12.50",
    totalOutDisplay: "0.00",
  });
  assert.deepEqual(
    persistedTransferSummary,
    {
      transfers: [{
        direction: "in",
        counterparty: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        amount: "12.50",
        amountNum: 12.5,
        txHash: `0x${"a".repeat(64)}`,
        blockNumber: 123456n,
        transactionIndex: 1,
        logIndex: 2,
      }],
      totalIn: 12.5,
      totalOut: 0,
      totalInDisplay: "12.50",
      totalOutDisplay: "0.00",
      dataStatus: "stale",
      updatedAt: 1_700_000_000_000,
      statusMessage: "Showing the last verified transfer history. Refresh to check for newer activity.",
    },
    "persisted transfer history must restore bigint block numbers and explicitly report staleness",
  );
  assert.equal(
    walletTransfers.parsePersistedWalletTransfersSummary({ ...walletTransfers.serializeWalletTransfersSummary(persistedTransferSummary), transfers: [{ direction: "in" }] }),
    null,
    "malformed cached transfer history must not be rendered as a verified empty history",
  );
  const walletTransfersSource = readFileSync("app/hooks/useWalletTransfers.ts", "utf8");
  assert.match(
    walletTransfersSource,
    /const seenLogs = new Set<string>\(\)[\s\S]*seenLogs\.add\(getWalletTransferLogKey\(log\)\)[\s\S]*seenLogs\.has\(getWalletTransferLogKey\(log\)\)/,
    "wallet transfer fallback dedupe must compare event logs, not whole transactions",
  );
  assert.match(
    walletTransfersSource,
    /readPersistedWalletTransfers[\s\S]*dataStatus: unavailableSummary\.dataStatus === "stale"[\s\S]*Transfer history is temporarily unavailable[\s\S]*persistWalletTransfers\(cacheKey, summary\)/,
    "transfer history must preserve a verified cached result and report RPC failures instead of replacing it with an empty summary",
  );
  assert.match(
    walletTransfersSource,
    /export function normalizeWalletTransferTxHash\(value: unknown\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*const txHash = normalizeWalletTransferTxHash\(log\.transactionHash\)/,
    "wallet transfer history rows must only publish full transaction hashes",
  );
  assert.match(
    walletTransfersSource,
    /export function normalizeWalletTransferAddress\(value: string \| null \| undefined\)[\s\S]*getAddress\(value\)\.toLowerCase\(\)[\s\S]*const addr = normalizeWalletTransferAddress\(embeddedAddress\)[\s\S]*externalWalletAddress && !externalAddr[\s\S]*pad\(addr as Hex/,
    "wallet transfer history must validate scan and filter addresses before log queries",
  );
  assert.doesNotMatch(
    walletTransfersSource,
    /const txHash = log\.transactionHash \?\? ""|txHash:\s*log\.transactionHash/,
    "wallet transfer history rows must not publish raw chain txHash values",
  );
  assert.doesNotMatch(
    walletTransfersSource,
    /const addr = embeddedAddress\.toLowerCase\(\)|externalWalletAddress\?\.toLowerCase\(\)|pad\(embeddedAddress as Hex/,
    "wallet transfer history must not lower-case or pad raw wallet addresses",
  );
  assert.match(
    walletTransfersSource,
    /totalInDisplay: toDisplayAmountWei\(totalInWei\)[\s\S]*totalOutDisplay: toDisplayAmountWei\(totalOutWei\)/,
    "wallet transfer summary must keep bigint-safe total display strings",
  );
  assert.match(
    walletTransfersSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "wallet transfer numeric compatibility totals must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    walletTransfersSource,
    /Number\(formatUnits\(value, 18\)\)|Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "wallet transfer summary must not coerce formatted wei values through Number(formatUnits()) or formatted decimal strings",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "12.3", eth: "0.0925" }),
    { token: "12.30", tokenUpdatedAt: null, eth: "0.0925", ethUpdatedAt: null },
    "legacy cache remains readable but lacks a trusted last-update timestamp",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({
      token: "9007199254740993.555",
      tokenUpdatedAt: 1_700_000_000_000,
      eth: "0.00005",
      ethUpdatedAt: 1_700_000_001_000,
    }),
    {
      token: "9007199254740993.56",
      tokenUpdatedAt: 1_700_000_000_000,
      eth: "0.0001",
      ethUpdatedAt: 1_700_000_001_000,
    },
    "current cache entries must preserve valid per-asset timestamps without Number precision loss",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "12.3", tokenUpdatedAt: "1700000000000", eth: "0.0925", ethUpdatedAt: 0 }),
    { token: "12.30", tokenUpdatedAt: null, eth: "0.0925", ethUpdatedAt: null },
    "cache timestamps must be positive safe integers rather than coerced values",
  );
  assert.deepEqual(
    pageWalletOverview.normalizeCachedPrivyBalances({ token: "bad", eth: "-1" }),
    { token: null, tokenUpdatedAt: null, eth: null, ethUpdatedAt: null },
    "unknown cached balances must not be presented as a verified zero",
  );
  assert.equal(pageWalletOverview.normalizePageWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  assert.equal(pageWalletOverview.normalizePageWalletAddress("0xabc"), null);
  assert.equal(pageWalletOverview.normalizePageWalletAddress(null), null);
  assert.equal(
    pageWalletOverview.getPrivyBalanceCacheKey("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    `lore:privy-balances:v1:59141:0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
  );
  assert.equal(pageWalletOverview.getPrivyBalanceCacheKey("0xabc"), null);
  assert.equal(
    balanceFormatting.formatDecimalTextFixed("9007199254740993.555", 2),
    "9007199254740993.56",
    "decimal balance formatting must round above Number.MAX_SAFE_INTEGER without Number precision loss",
  );
  assert.equal(balanceFormatting.formatDecimalTextFixed("0.00005", 4), "0.0001");
  assert.equal(balanceFormatting.formatDecimalTextFixed("12", 2), "12.00");
  for (const invalidDecimalText of ["", "-1", "1e3", "1.", ".1", "1.2.3"]) {
    assert.equal(
      balanceFormatting.formatDecimalTextFixed(invalidDecimalText, 2),
      null,
      `decimal balance formatting must reject ${invalidDecimalText || "empty input"}`,
    );
  }
  assert.equal(
    balanceFormatting.formatBalanceFixed({ value: 9_007_199_254_740_993_555n, decimals: 3 }, 2),
    "9007199254740993.56",
    "live bigint balance formatting must round raw units without Number precision loss",
  );
  assert.equal(balanceFormatting.formatBalanceFixed({ value: 5n, decimals: 6 }, 4), "0.0000");
  assert.equal(balanceFormatting.formatBalanceFixed({ value: -1n, decimals: 18 }, 2), null);
  assert.equal(balanceFormatting.formatBalanceFixed({ value: 1n, decimals: 256 }, 2), null);
  const pageWalletOverviewSource = readFileSync("app/hooks/usePageWalletOverview.ts", "utf8");
  assert.match(
    pageWalletOverviewSource,
    /const raw = window\.localStorage\.getItem\(balanceCacheKey\)[\s\S]*window\.localStorage\.removeItem\(balanceCacheKey\)/,
    "wallet overview balance cache reads must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    pageWalletOverviewSource,
    /formatBalanceFixed\(embeddedTokenBalance, 2\)[\s\S]*formatBalanceFixed\(embeddedEthBalance, 4\)/,
    "wallet overview live balances must use shared raw bigint balance formatting",
  );
  assert.match(
    pageWalletOverviewSource,
    /export function normalizePageWalletAddress\(value: string \| null \| undefined\)[\s\S]*getAddress\(value\)\.toLowerCase\(\)[\s\S]*function getPrivyBalanceCacheKey[\s\S]*normalizePageWalletAddress\(address\)[\s\S]*const normalizedActiveAddress = normalizePageWalletAddress\(address\)[\s\S]*normalizedActiveAddress === normalizedEmbeddedWalletAddress/,
    "wallet overview must validate cache and active-wallet addresses before comparing or keying balances",
  );
  assert.doesNotMatch(
    pageWalletOverviewSource,
    /Number\(getFormattedBalance\(embedded(?:Token|Eth)Balance\)\)/,
    "wallet overview live balances must not coerce formatted balances through Number()",
  );
  assert.doesNotMatch(
    pageWalletOverviewSource,
    /address\.toLowerCase\(\)|normalizedEmbeddedAddress\.toLowerCase\(\)/,
    "wallet overview must not compare or cache raw wallet address strings",
  );
  const gameDerivedStateSource = readFileSync("app/hooks/useGameDerivedState.ts", "utf8");
  assert.match(
    gameDerivedStateSource,
    /formatDecimalTextFixed\(tokenBalanceFormatted, 2\)/,
    "active wallet LINEA display must use shared decimal text formatting",
  );
  assert.doesNotMatch(
    gameDerivedStateSource,
    /Number\(tokenBalanceFormatted\)\.toFixed\(2\)/,
    "active wallet LINEA display must not coerce formatted balance text through Number()",
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ betSize: "2.5", targets: 7, cycles: 12 }),
    { betSize: "2.5", targets: 7, cycles: 12 },
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ betSize: "bad", targets: 99, cycles: 1_000_000 }),
    { betSize: "1.0", targets: 25, cycles: 5000 },
  );
  assert.deepEqual(
    autoMinerForm.sanitizeAutoMinerInputs({ targets: 2.9, cycles: 0 }),
    { betSize: "1.0", targets: 2, cycles: 1 },
  );
  {
    const storage = new Map([["lineaore:auto-miner-inputs:v1", JSON.stringify({ betSize: "2.5", targets: 7, cycles: 12 })]]);
    const removed = [];
    const restored = autoMinerForm.restoreAutoMinerInputs({
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => {
        removed.push(key);
        storage.delete(key);
      },
    });
    assert.deepEqual(restored, { betSize: "2.5", targets: 7, cycles: 12 });
    assert.deepEqual(removed, ["lineaore:auto-miner-inputs:v1"], "legacy auto-miner inputs must migrate by removing the legacy value");
  }
  {
    const currentKey = `lineaore:auto-miner-inputs:v2:${appConstants.APP_CHAIN_ID}:${appConstants.CONTRACT_ADDRESS.toLowerCase()}`;
    const storage = new Map([
      ["lineaore:auto-miner-inputs:v1", "{"],
      [currentKey, "{"],
    ]);
    const removed = [];
    assert.equal(
      autoMinerForm.restoreAutoMinerInputs({
        getItem: (key) => storage.get(key) ?? null,
        removeItem: (key) => {
          removed.push(key);
          storage.delete(key);
        },
      }),
      null,
      "corrupt auto-miner storage must not restore unsafe form values",
    );
    assert.equal(storage.size, 0, "corrupt auto-miner current and legacy entries must both be cleared");
    assert.equal(removed.length, 2);
  }
  assert.match(
    readFileSync("app/hooks/useMiningGuards.ts", "utf8"),
    /const sanitized = sanitizeLastBet\(JSON\.parse\(parsed\)\)[\s\S]*localStorage\.removeItem\(raw \? LAST_BET_KEY : LEGACY_LAST_BET_KEY\)[\s\S]*catch \{[\s\S]*localStorage\.removeItem\(LAST_BET_KEY\)/,
    "last-bet restore must clear corrupt or invalid localStorage entries",
  );
  assert.deepEqual(
    ["10", "2", "bad"].sort(analyticsAchievements.compareAchievementEpochs),
    ["bad", "2", "10"],
  );
  assert.doesNotThrow(() => analyticsAchievements.compareAchievementEpochs("bad", "2"));
  assert.deepEqual(
    [
      { blockNumberNum: 0, epoch: "10", txHash: "0x10" },
      { blockNumberNum: 0, epoch: "9007199254740993", txHash: "0x09" },
      { blockNumberNum: 0, epoch: "bad", txHash: "0x0b" },
      { blockNumberNum: 0, epoch: "2", txHash: "0x02" },
      { blockNumberNum: 1, epoch: "9007199254740993", txHash: "0x01" },
    ].sort(analyticsAchievements.compareAchievementDepositOrder).map((deposit) => deposit.txHash),
    ["0x09", "0x0b", "0x01", "0x02", "0x10"],
    "first-bet ordering must treat unsafe and malformed epoch strings as untrusted before the stable hash tie-breaker",
  );
  assert.ok(
    analyticsAchievements.compareAchievementDepositOrder(
      { blockNumberNum: 7, epoch: "99", txHash: "0xb" },
      { blockNumberNum: 7, epoch: "2", txHash: "0xa" },
    ) > 0,
    "first-bet ordering must use the safe epoch order before its tx-hash tie-breaker",
  );
  const analyticsAchievementsSource = readFileSync("app/hooks/useAnalyticsAchievements.ts", "utf8");
  assert.match(
    analyticsAchievementsSource,
    /const parsed = JSON\.parse\(raw\) as PersistedAchievements[\s\S]*localStorage\.removeItem\(storageKey\)[\s\S]*catch \{[\s\S]*const storageKey = getAchievementStorageKey\(walletAddress\)[\s\S]*localStorage\.removeItem\(storageKey\)/,
    "analytics achievements must clear corrupt or invalid localStorage entries",
  );
  assert.deepEqual(
    autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 123 }, 1_000),
    { epoch: "42", ts: 123 },
  );
  assert.deepEqual(
    autoResolveStorage.normalizeResolveGuardEntry({ epoch: "9007199254740991", ts: 123 }, 1_000),
    { epoch: "9007199254740991", ts: 123 },
  );
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: Number.NaN }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 123.5 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: Number.MAX_SAFE_INTEGER + 1 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 1_000 }, 1_000.5), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "42", ts: 7_001 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "bad", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "0042", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "9007199254740992", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "9999999999999999", ts: 123 }, 1_000), null);
  assert.equal(autoResolveStorage.normalizeResolveGuardEntry({ epoch: "1".repeat(21), ts: 123 }, 1_000), null);
  {
    const previousLocalStorage = globalThis.localStorage;
    try {
      const storage = new Map([["lore_resolve_epoch", "42"]]);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
      });
      const beforeMigration = Date.now();
      const migrated = autoResolveStorage.readResolveGuard();
      assert.equal(migrated?.epoch, "42");
      assert.ok((migrated?.ts ?? 0) >= beforeMigration, "legacy auto-resolve guard must gain a fresh timestamp");
      assert.deepEqual(
        autoResolveStorage.normalizeResolveGuardEntry(JSON.parse(storage.get("lore_resolve_epoch"))),
        migrated,
        "legacy auto-resolve guard must migrate to the current JSON envelope",
      );
      autoResolveStorage.writeResolveGuard("0042");
      assert.equal(
        autoResolveStorage.normalizeResolveGuardEntry(JSON.parse(storage.get("lore_resolve_epoch")))?.epoch,
        "42",
        "non-canonical auto-resolve guard writes must not overwrite a valid canonical guard",
      );
      autoResolveStorage.writeResolveGuard("43");
      assert.equal(
        autoResolveStorage.normalizeResolveGuardEntry(JSON.parse(storage.get("lore_resolve_epoch")))?.epoch,
        "43",
        "canonical auto-resolve guard writes must persist the canonical epoch string",
      );
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  }
  {
    const previousLocalStorage = globalThis.localStorage;
    try {
      const storage = new Map([["lore_resolve_epoch", JSON.stringify({ epoch: "42", ts: Number.NaN })]]);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
      });
      assert.equal(autoResolveStorage.readResolveGuard(), null);
      assert.equal(storage.has("lore_resolve_epoch"), false, "invalid timestamp auto-resolve guards must be cleared");
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  }
  {
    const previousLocalStorage = globalThis.localStorage;
    try {
      const storage = new Map([["lore_resolve_epoch", "0042"]]);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
      });
      assert.equal(autoResolveStorage.readResolveGuard(), null);
      assert.equal(storage.has("lore_resolve_epoch"), false, "legacy non-canonical auto-resolve epochs must be cleared");
      storage.set("lore_resolve_epoch", "{");
      assert.equal(autoResolveStorage.readResolveGuard(), null);
      assert.equal(storage.has("lore_resolve_epoch"), false, "corrupt auto-resolve guard JSON must be cleared");
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: previousLocalStorage,
        });
      }
    }
  }
}
