import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as networkRetryModule from "../app/lib/mining/networkRetry.ts";
import * as autoMineDiagnosticsModule from "../app/lib/mining/autoMineDiagnostics.ts";
import * as autoMineDebugOverrideModule from "../app/lib/mining/autoMineDebugOverride.ts";
import * as autoMineRunnerStopReasonModule from "../app/lib/mining/autoMineRunnerStopReason.ts";
import * as autoMineRestoreDeduperModule from "../app/lib/mining/autoMineRestoreDeduper.ts";
import * as chunkReloadRecoveryModule from "../app/lib/chunkReloadRecovery.ts";
import * as autoMineErrorModule from "../app/hooks/useMiningAutoMineError.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";

export async function runRuntimeRecoveryTests() {
  const networkRetry = networkRetryModule.default ?? networkRetryModule;
  const autoMineDiagnostics = autoMineDiagnosticsModule.default ?? autoMineDiagnosticsModule;
  const autoMineDebugOverride = autoMineDebugOverrideModule.default ?? autoMineDebugOverrideModule;
  const autoMineRunnerStopReason = autoMineRunnerStopReasonModule.default ?? autoMineRunnerStopReasonModule;
  const autoMineRestoreDeduper = autoMineRestoreDeduperModule.default ?? autoMineRestoreDeduperModule;
  const chunkReloadRecovery = chunkReloadRecoveryModule.default ?? chunkReloadRecoveryModule;
  const autoMineError = autoMineErrorModule.default ?? autoMineErrorModule;
  const miningShared = miningSharedModule.default ?? miningSharedModule;
  assert.equal(networkRetry.getNetworkRetryDelayMs(0, 500, 10_000), 500);
  assert.equal(networkRetry.getNetworkRetryDelayMs(3, 500, 10_000), 4_000);
  assert.equal(networkRetry.getNetworkRetryDelayMs(4, 500, 10_000, 2), 2_000);
  assert.equal(networkRetry.formatRetryWaitSeconds(499), "0");
  assert.equal(networkRetry.formatRetryWaitSeconds(500), "1");
  assert.equal(networkRetry.formatRetryWaitSeconds(1_500), "2");
  assert.equal(networkRetry.formatRetryWaitSeconds(Number.NaN), "0");
  assert.equal(networkRetry.formatRetryWaitSeconds(Number.POSITIVE_INFINITY), "0");
  assert.equal(networkRetry.formatRetryWaitSeconds(Number.MAX_SAFE_INTEGER + 1), "0");
  for (const args of [
    [Number.NaN, 500, 10_000],
    [-1, 500, 10_000],
    [1.5, 500, 10_000],
    [0, Number.NaN, 10_000],
    [0, 0, 10_000],
    [0, 500.5, 10_000],
    [0, 500, Number.POSITIVE_INFINITY],
    [0, 500, 400],
    [0, 500, 10_000, 1.5],
  ]) {
    assert.equal(
      networkRetry.getNetworkRetryDelayMs(...args),
      0,
      `invalid network retry delay args ${JSON.stringify(args)} must fail closed to zero wait`,
    );
  }
  for (const maxAttempts of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
    let reads = 0;
    await assert.rejects(
      () => networkRetry.readWithNetworkRetry({
        actionLabel: "validating retry bounds",
        initialMs: 1,
        isActive: () => true,
        maxAttempts,
        maxMs: 2,
        onProgress: () => {
          throw new Error("invalid retry limit must not schedule progress");
        },
        read: async () => {
          reads += 1;
          return "unexpected";
        },
        shouldRetry: () => true,
      }),
      { name: "NetworkRetryExhaustedError" },
      `invalid retry attempt limit ${String(maxAttempts)} must fail closed without a read`,
    );
    assert.equal(reads, 0);
  }

  const diagnosticsStorage = (() => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
      hasItem: (key) => map.has(key),
    };
  })();
  assert.deepEqual(autoMineDiagnostics.createDefaultAutoMineDiagnosticsSnapshot(), {
    phase: "idle",
    progress: null,
    runningParams: null,
    isAutoMining: false,
    autoResumeRequested: false,
    sessionExpired: false,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastErrorRawMessage: null,
    lastStopReason: null,
    lastEpoch: null,
    retryCount: 0,
    updatedAt: 0,
  });
  diagnosticsStorage.setItem(autoMineDiagnostics.AUTO_MINE_DIAGNOSTICS_STORAGE_KEY, "{bad json");
  assert.equal(autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage), null);
  assert.equal(
    diagnosticsStorage.hasItem(autoMineDiagnostics.AUTO_MINE_DIAGNOSTICS_STORAGE_KEY),
    false,
    "corrupt Auto-Miner diagnostics must be cleared from localStorage",
  );
  autoMineDiagnostics.writeAutoMineDiagnostics({
    phase: "retry-wait",
    progress: "Saved session is paused and will retry automatically.",
    autoResumeRequested: true,
    lastErrorKind: "network",
    lastStopReason: "retry-wait",
  }, { storage: diagnosticsStorage, now: 1234 });
  assert.deepEqual(autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage), {
    phase: "retry-wait",
    progress: "Saved session is paused and will retry automatically.",
    runningParams: null,
    isAutoMining: false,
    autoResumeRequested: true,
    sessionExpired: false,
    lastErrorKind: "network",
    lastErrorMessage: null,
    lastErrorRawMessage: null,
    lastStopReason: "retry-wait",
    lastEpoch: null,
    retryCount: 0,
    updatedAt: 1234,
  });
  autoMineDiagnostics.writeAutoMineDiagnostics({
    lastErrorRawMessage: `rpc_url=https://rpc.example/secret account=0x1111111111111111111111111111111111111111 ${"f".repeat(64)} ${"x".repeat(640)}`,
  }, { storage: diagnosticsStorage, now: 1235 });
  const sanitizedAutoMineDiagnostics = autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage);
  assert.ok(sanitizedAutoMineDiagnostics?.lastErrorRawMessage?.includes("<redacted>"));
  assert.ok((sanitizedAutoMineDiagnostics?.lastErrorRawMessage?.length ?? 0) <= 500);
  assert.doesNotMatch(
    sanitizedAutoMineDiagnostics?.lastErrorRawMessage ?? "",
    /rpc\.example|1111111111111111111111111111111111111111|f{64}/,
    "Auto-Miner diagnostics raw messages must redact provider URLs, wallet addresses, and hex secrets before storage",
  );
  assert.equal(
    autoMineDiagnostics.sanitizeAutoMineDiagnosticsSnapshot({
      lastErrorRawMessage: "x".repeat(640),
    }).lastErrorRawMessage?.endsWith("...<truncated>"),
    true,
    "Auto-Miner diagnostics raw messages must be clamped when reading legacy localStorage entries",
  );
  const supportDiagnostics = autoMineDiagnostics.getAutoMineSupportDiagnostics({
    ...autoMineDiagnostics.createDefaultAutoMineDiagnosticsSnapshot(),
    lastErrorKind: "network",
    lastErrorMessage: "RPC unavailable",
    lastErrorRawMessage: "sensitive raw provider detail",
    lastStopReason: "retry-wait",
    lastEpoch: "2414",
    retryCount: 3,
    updatedAt: 123,
  });
  assert.equal(supportDiagnostics.lastStopReason, "retry-wait");
  assert.equal(supportDiagnostics.lastErrorKind, "network");
  assert.equal(supportDiagnostics.lastEpoch, "2414");
  assert.equal(supportDiagnostics.retryCount, 3);
  assert.equal("lastErrorRawMessage" in supportDiagnostics, false);
  assert.equal(
    autoMineDiagnostics.sanitizeAutoMineDiagnosticsSnapshot({
      phase: "bogus",
      lastErrorKind: "broken",
      lastStopReason: "wrong",
      updatedAt: "bad",
    }).phase,
    "idle",
  );
  assert.equal(
    autoMineDiagnostics.sanitizeAutoMineDiagnosticsSnapshot({ lastErrorKind: "wrong-network" }).lastErrorKind,
    "wrong-network",
    "Auto-Miner diagnostics must preserve wrong-network errors for support export",
  );
  for (const retryCount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
    assert.equal(
      autoMineDiagnostics.sanitizeAutoMineDiagnosticsSnapshot({ retryCount }).retryCount,
      0,
      `invalid Auto-Miner diagnostics retryCount ${String(retryCount)} must be discarded`,
    );
  }
  for (const updatedAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
    assert.equal(
      autoMineDiagnostics.sanitizeAutoMineDiagnosticsSnapshot({ updatedAt }).updatedAt,
      0,
      `invalid Auto-Miner diagnostics updatedAt ${String(updatedAt)} must be discarded`,
    );
  }
  autoMineDiagnostics.clearAutoMineDiagnostics(diagnosticsStorage);
  assert.equal(autoMineDiagnostics.readAutoMineDiagnostics(diagnosticsStorage), null);

  autoMineDebugOverride.writeAutoMineDebugOverride({
    phase: "retry-wait",
    progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
    runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
  }, { storage: diagnosticsStorage, now: 2222 });
  assert.deepEqual(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), {
    phase: "retry-wait",
    progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
    runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
    updatedAt: 2222,
  });
  autoMineDebugOverride.writeAutoMineDebugOverride({
    phase: "running",
    progress: "Synthetic debug override with invalid clock.",
    runningParams: null,
  }, { storage: diagnosticsStorage, now: Number.POSITIVE_INFINITY });
  assert.deepEqual(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), {
    phase: "running",
    progress: "Synthetic debug override with invalid clock.",
    runningParams: null,
    updatedAt: 0,
  });
  assert.equal(
    autoMineDebugOverride.sanitizeAutoMineDebugOverride({
      phase: "wrong",
      runningParams: { betStr: "1", blocks: 2, rounds: 3 },
    }),
    null,
  );
  for (const updatedAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
    assert.equal(
      autoMineDebugOverride.sanitizeAutoMineDebugOverride({
        phase: "running",
        runningParams: null,
        updatedAt,
      })?.updatedAt,
      0,
      `invalid Auto-Miner debug override updatedAt ${String(updatedAt)} must be discarded`,
    );
  }
  diagnosticsStorage.setItem(autoMineDebugOverride.AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY, "{bad json");
  assert.equal(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), null);
  assert.equal(
    diagnosticsStorage.hasItem(autoMineDebugOverride.AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY),
    false,
    "corrupt Auto-Miner debug override must be cleared from localStorage",
  );
  diagnosticsStorage.setItem(
    autoMineDebugOverride.AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ phase: "wrong", runningParams: { betStr: "1", blocks: 2, rounds: 3 } }),
  );
  assert.equal(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), null);
  assert.equal(
    diagnosticsStorage.hasItem(autoMineDebugOverride.AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY),
    false,
    "invalid Auto-Miner debug override must be cleared from localStorage",
  );
  const autoMineDebugOverrideHookSource = readFileSync("app/hooks/useAutoMineDebugOverride.ts", "utf8");
  assert.match(
    autoMineDebugOverrideHookSource,
    /import \{ useEffect, useMemo, useSyncExternalStore \} from "react";[\s\S]*clearAutoMineDebugOverride[\s\S]*useEffect\(\(\) => \{[\s\S]*if \(rawOverride && !override\) clearAutoMineDebugOverride\(\)/,
    "Auto-Miner debug override hook must clear corrupt or invalid localStorage entries after render",
  );
  autoMineDebugOverride.clearAutoMineDebugOverride(diagnosticsStorage);
  assert.equal(autoMineDebugOverride.readAutoMineDebugOverride(diagnosticsStorage), null);

  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: false,
      pendingNonceBlocked: false,
      sessionExpired: false,
      shouldAutoResume: true,
    }),
    "retry-wait",
  );
  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: false,
      pendingNonceBlocked: false,
      sessionExpired: true,
      shouldAutoResume: true,
    }),
    "session-expired",
  );
  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: true,
      pendingNonceBlocked: true,
      sessionExpired: false,
      shouldAutoResume: true,
    }),
    "insufficient-balance",
  );
  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: false,
      pendingNonceBlocked: true,
      sessionExpired: false,
      shouldAutoResume: false,
    }),
    "pending-nonce-blocked",
  );
  assert.equal(
    autoMineRunnerStopReason.getAutoMineRunnerCatchStopReason({
      insufficientFunds: false,
      pendingNonceBlocked: false,
      sessionExpired: false,
      shouldAutoResume: false,
    }),
    "error",
  );

  const restoreFingerprint = autoMineRestoreDeduper.getAutoMineRestoreFingerprint({
    active: true,
    betStr: "1.0",
    blocks: 3,
    rounds: 500,
    nextRoundIndex: 81,
    lastPlacedEpoch: "2413",
  });
  assert.equal(restoreFingerprint, "1.0|3|500|81|2413");
  assert.equal(
    autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
      previousAt: 10_000,
      previousFingerprint: restoreFingerprint,
      nextFingerprint: restoreFingerprint,
      now: 12_500,
      cooldownMs: 4_000,
    }),
    true,
  );
  assert.equal(
    autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
      previousAt: 10_000,
      previousFingerprint: restoreFingerprint,
      nextFingerprint: "1.0|3|500|82|2414",
      now: 12_500,
      cooldownMs: 4_000,
    }),
    false,
  );
  for (const previousAt of [Number.NaN, -1, 10_000.5, Number.MAX_SAFE_INTEGER + 1, 13_000]) {
    assert.equal(
      autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
        previousAt,
        previousFingerprint: restoreFingerprint,
        nextFingerprint: restoreFingerprint,
        now: 12_500,
        cooldownMs: 4_000,
      }),
      false,
      `invalid Auto-Miner restore previousAt ${String(previousAt)} must not suppress recovery`,
    );
  }
  for (const now of [Number.NaN, -1, 12_500.5, Number.POSITIVE_INFINITY]) {
    assert.equal(
      autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
        previousAt: 10_000,
        previousFingerprint: restoreFingerprint,
        nextFingerprint: restoreFingerprint,
        now,
        cooldownMs: 4_000,
      }),
      false,
      `invalid Auto-Miner restore now ${String(now)} must not suppress recovery`,
    );
  }
  for (const cooldownMs of [Number.NaN, 0, -1, 4_000.5, Number.POSITIVE_INFINITY]) {
    assert.equal(
      autoMineRestoreDeduper.shouldSuppressDuplicateAutoMineRestore({
        previousAt: 10_000,
        previousFingerprint: restoreFingerprint,
        nextFingerprint: restoreFingerprint,
        now: 12_500,
        cooldownMs,
      }),
      false,
      `invalid Auto-Miner restore cooldown ${String(cooldownMs)} must not suppress recovery`,
    );
  }
  const chunkStorage = (() => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  })();
  assert.equal(
    chunkReloadRecovery.isChunkLoadLikeErrorMessage(
      "Loading chunk _app-pages-browser_app_components_WhitePaper_tsx failed. (timeout: /_next/static/chunks/foo.js)",
    ),
    true,
  );
  assert.equal(
    chunkReloadRecovery.isChunkLoadLikeErrorMessage(
      "Failed to fetch dynamically imported module: https://example.com/_next/static/chunks/app/page.js",
    ),
    true,
  );
  assert.equal(
    chunkReloadRecovery.isChunkLoadLikeErrorMessage(
      "Importing a module script failed. https://example.com/_next/static/chunks/app/layout.js",
    ),
    true,
  );
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 1_000), true);
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 2_000), false);
  chunkReloadRecovery.clearExpiredChunkReloadAttempt(
    chunkStorage,
    1_000 + chunkReloadRecovery.CHUNK_RELOAD_WINDOW_MS + 1,
  );
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(chunkStorage, 20_000), true);
  const malformedChunkStorage = (() => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      removeItem: (key) => {
        map.delete(key);
      },
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  })();
  malformedChunkStorage.setItem(chunkReloadRecovery.CHUNK_RELOAD_KEY, "1e3");
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(malformedChunkStorage, 3_000), true);
  assert.equal(malformedChunkStorage.getItem(chunkReloadRecovery.CHUNK_RELOAD_KEY), "3000");
  malformedChunkStorage.setItem(chunkReloadRecovery.CHUNK_RELOAD_KEY, "03000");
  chunkReloadRecovery.clearExpiredChunkReloadAttempt(malformedChunkStorage, 4_000);
  assert.equal(malformedChunkStorage.getItem(chunkReloadRecovery.CHUNK_RELOAD_KEY), null);
  malformedChunkStorage.setItem(chunkReloadRecovery.CHUNK_RELOAD_KEY, "9999");
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(malformedChunkStorage, 4_000), true);
  assert.equal(malformedChunkStorage.getItem(chunkReloadRecovery.CHUNK_RELOAD_KEY), "4000");
  assert.equal(chunkReloadRecovery.shouldAttemptChunkReloadOnce(malformedChunkStorage, Number.NaN), false);
  assert.equal(malformedChunkStorage.getItem(chunkReloadRecovery.CHUNK_RELOAD_KEY), "4000");
  chunkReloadRecovery.clearExpiredChunkReloadAttempt(malformedChunkStorage, Number.POSITIVE_INFINITY);
  assert.equal(malformedChunkStorage.getItem(chunkReloadRecovery.CHUNK_RELOAD_KEY), null);
  let replacedUrl = null;
  chunkReloadRecovery.reloadWithCacheBust({
    href: "http://localhost:3000/?_r=legacy&tab=hub",
    reload: () => {
      throw new Error("should use replace");
    },
    replace: (url) => {
      replacedUrl = url;
    },
  }, 21_000);
  assert.equal(replacedUrl, "http://localhost:3000/?tab=hub&__lore_reload=21000");
  chunkReloadRecovery.reloadWithCacheBust({
    href: "http://localhost:3000/?tab=hub",
    reload: () => {
      throw new Error("should use replace after invalid now fallback");
    },
    replace: (url) => {
      replacedUrl = url;
    },
  }, Number.NaN);
  assert.match(replacedUrl, /^http:\/\/localhost:3000\/\?tab=hub&__lore_reload=\d+$/);
  const historyCalls = [];
  assert.equal(
    chunkReloadRecovery.stripChunkReloadCacheParam(
      { href: "http://localhost:3000/?tab=hub&_r=legacy&__lore_reload=21000#board" },
      {
        state: { ok: true },
        replaceState: (...args) => historyCalls.push(args),
      },
    ),
    true,
  );
  assert.deepEqual(historyCalls, [[{ ok: true }, "", "/?tab=hub#board"]]);

  await assert.rejects(
    () =>
      miningShared.findConfirmedEpochForTiles(
        {
          readContract: async () => {
            throw new Error("rpc timeout");
          },
        },
        "0x0000000000000000000000000000000000000001",
        [11n, 12n],
        [1, 2],
      ),
    /rpc timeout/,
  );

  assert.deepEqual(
    autoMineError.getAutoMineUserMessage(new Error("must have valid access token")),
    {
      diagnosticsErrorKind: "session-expired",
      rawMessage: "must have valid access token",
      sessionExpired: true,
      networkDown: false,
      walletUnavailable: false,
      pendingNonceBlocked: false,
      userMessage: "Session expired. Log out, log in again, then reload this page - the bot will auto-resume.",
    },
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("public client unavailable")).diagnosticsErrorKind,
    "wallet-unavailable",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("public client unavailable")).userMessage,
    "Auto-miner paused: Privy wallet not ready. Retrying automatically...",
  );
  assert.deepEqual(
    autoMineError.getAutoMineUserMessage(new Error("pending transaction blocked by nonce")),
    {
      diagnosticsErrorKind: "pending-nonce-blocked",
      rawMessage: "pending transaction blocked by nonce",
      sessionExpired: false,
      networkDown: false,
      walletUnavailable: false,
      pendingNonceBlocked: true,
      userMessage:
        "Auto-miner paused: wallet has a stuck pending transaction. Open Settings and clear or replace it, then start the bot again.",
    },
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("pending transaction blocked by nonce")).diagnosticsErrorKind,
    "pending-nonce-blocked",
  );
  assert.deepEqual(
    autoMineError.getAutoMineUserMessage(new Error("Connector chain mismatch: wallet is on the wrong network")),
    {
      diagnosticsErrorKind: "wrong-network",
      rawMessage: "connector chain mismatch: wallet is on the wrong network",
      sessionExpired: false,
      networkDown: false,
      walletUnavailable: false,
      pendingNonceBlocked: false,
      userMessage: "Auto-miner stopped: wallet is on the wrong network. Switch to Linea Sepolia and start again.",
    },
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("insufficient funds for gas * price + value")).userMessage,
    "Auto-miner stopped: not enough ETH for gas in the Privy wallet.",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("execution reverted: EpochClosing()")).userMessage,
    "Round skipped (epoch ended). Press START BOT to continue.",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("execution reverted: ERC20InsufficientAllowance")).userMessage,
    "Auto-miner stopped: transaction reverted on-chain. No bet was placed.",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("contract token mismatch")).userMessage,
    "Auto-miner stopped: configured token does not match the game contract.",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("network request failed: provider secret details")).userMessage,
    "Auto-miner paused: RPC offline for too long. Retrying automatically...",
  );
}
