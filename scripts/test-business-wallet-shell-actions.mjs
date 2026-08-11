import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as autoResolveModule from "../app/hooks/useAutoResolve.ts";

const autoResolve = autoResolveModule.default ?? autoResolveModule;

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [path] : [];
  });
}

export async function runWalletShellAndMiningActionTests() {
  const publicConfigSource = readFileSync("config/publicConfig.ts", "utf8");
  const providersSource = readFileSync("app/providers.tsx", "utf8");
  assert.match(
    providersSource,
    /coinbaseWallet[\s\S]*preference[\s\S]*options:\s*['"]eoaOnly['"]/,
    "Privy Coinbase connector must avoid unsupported smart-wallet mode on Linea networks",
  );
  const walletSettingsModalSource = readFileSync("app/components/WalletSettingsModal.tsx", "utf8");
  assert.match(
    walletSettingsModalSource,
    /aria-label="Export support logs"[\s\S]*className="text-xs"[\s\S]*hidden sm:inline">Export Logs/,
    "mobile Wallet Settings must keep support-log export available as an accessible icon button",
  );
  assert.match(
    walletSettingsModalSource,
    /useDialogFocusTrap<HTMLDivElement>\(isOpen, onClose\)/,
    "Wallet Settings must use the shared focus trap with hidden-control and escaped-focus recovery",
  );
  assert.match(
    walletSettingsModalSource,
    /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="wallet-settings-title"[\s\S]*aria-describedby="wallet-settings-description"[\s\S]*tabIndex=\{-1\}/,
    "Wallet Settings dialog root must remain programmatically focusable for focus-trap fallback",
  );
  const backupGateSource = readFileSync("app/components/BackupGate.tsx", "utf8");
  assert.match(
    backupGateSource,
    /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="backup-gate-title"[\s\S]*aria-describedby="backup-gate-description"[\s\S]*tabIndex=\{-1\}/,
    "backup gate dialog root must remain labeled, described, modal, and programmatically focusable",
  );
  assert.match(
    backupGateSource,
    /aria-describedby="backup-gate-description"[\s\S]*id="backup-gate-description"/,
    "backup gate dialog must expose its recovery-risk description to assistive technology",
  );
  assert.match(
    backupGateSource,
    /normalizeBackupAddress[\s\S]*getAddress/,
    "backup gate confirmation must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    backupGateSource,
    /const raw = window\.localStorage\.getItem\(STORAGE_KEY\)[\s\S]*normalizeBackupAddress\(raw\)[\s\S]*window\.localStorage\.removeItem\(STORAGE_KEY\)/,
    "backup gate confirmation must clear invalid stored wallet addresses before re-checking backup state",
  );
  assert.match(
    backupGateSource,
    /onClick=\{handleExport\}[\s\S]*uiTokens\.focusRing[\s\S]*Export private key[\s\S]*onClick=\{handleContinue\}[\s\S]*uiTokens\.focusRing[\s\S]*I&apos;ve saved it, continue/,
    "backup gate primary actions must keep visible keyboard focus rings",
  );
  assert.match(
    readFileSync("app/components/MobileTabNav.tsx", "utf8"),
    /MOBILE_TABS\.map[\s\S]*<button[\s\S]{0,160}type="button"[\s\S]*aria-current=\{active \? "page" : undefined\}/,
    "mobile tab navigation buttons must remain non-submit controls with current-page semantics",
  );
  const maintenanceOverlaySource = readFileSync("app/components/MaintenanceOverlay.tsx", "utf8");
  assert.match(
    maintenanceOverlaySource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-labelledby="maintenance-title"[\s\S]*aria-describedby="maintenance-description"[\s\S]*id="maintenance-title"[\s\S]*id="maintenance-description"/,
    "maintenance overlay must announce busy status with stable title and description wiring",
  );
  assert.match(
    maintenanceOverlaySource,
    /aria-hidden="true"[\s\S]*orb-drift-1[\s\S]*aria-hidden="true"[\s\S]*opacity-\[0\.03\][\s\S]*aria-hidden="true"[\s\S]*animate-gradient-x/,
    "maintenance overlay decorative animation layers must stay hidden from assistive technology",
  );
  const pageTabPanelsSource = readFileSync("app/components/PageTabPanels.tsx", "utf8");
  assert.match(
    pageTabPanelsSource,
    /const TabPanelFallback[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*Loading panel/,
    "lazy tab panel fallback must announce loading state without changing tab behavior",
  );
  assert.doesNotMatch(
    backupGateSource,
    /Opening\u2026/,
    "backup gate pending text must stay ASCII-safe for terminal and log rendering",
  );
  const miningManualActionsSource = readFileSync("app/hooks/useMiningManualActions.ts", "utf8");
  assert.match(
    miningManualActionsSource,
    /setIsPending\(true\)/,
    "manual bet must expose its pending state while the Privy transaction is sent",
  );
  assert.match(
    miningManualActionsSource,
    /const manualMineInFlightRef = useRef\(false\)[\s\S]*const handleManualMine[\s\S]*if \(autoMineActive\(\) \|\| manualMineInFlightRef\.current\) return false;[\s\S]*manualMineInFlightRef\.current = true;[\s\S]*finally \{\s*manualMineInFlightRef\.current = false;[\s\S]*const handleDirectMine[\s\S]*if \(autoMineActive\(\) \|\| manualMineInFlightRef\.current\) return false;[\s\S]*manualMineInFlightRef\.current = true;[\s\S]*finally \{\s*manualMineInFlightRef\.current = false;/,
    "manual and repeat bets must share an in-flight guard so rapid clicks cannot create duplicate sends",
  );
  assert.match(
    miningManualActionsSource,
    /submitMineAttempt\("ManualMine"[\s\S]*state === "pending"[\s\S]*Bet transaction is still pending\. Check wallet activity before retrying\.[\s\S]*submitMineAttempt\("DirectMine"[\s\S]*state === "pending"[\s\S]*Repeat bet transaction is still pending\. Check wallet activity before retrying\./,
    "manual and repeat ambiguous pending bets must surface a user-facing warning instead of only clearing the pending spinner",
  );
  assert.match(
    miningManualActionsSource,
    /catch \(error\) \{\s*if \(!isUserRejection\(error\)\) \{\s*clearMiningTxPathState\(\);[\s\S]*notify\?\.\(reason, "danger"\);\s*\} else \{\s*notify\?\.\("Bet transaction rejected in wallet\.", "info"\);/,
    "manual wallet rejection must keep pending tx recovery state and use explicit info copy",
  );
  assert.match(
    miningManualActionsSource,
    /catch \(error\) \{\s*if \(!isUserRejection\(error\)\) \{\s*clearMiningTxPathState\(\);[\s\S]*notify\?\.\(reason, "danger"\);\s*\} else \{\s*notify\?\.\("Repeat bet transaction rejected in wallet\.", "info"\);/,
    "repeat bet wallet rejection must keep pending tx recovery state and use explicit info copy",
  );
  assert.doesNotMatch(
    miningManualActionsSource,
    /Preparing (?:repeat )?bet(?: transaction)?/,
    "manual and repeat bets must not show a redundant preparation toast",
  );
  const autoResolveSource = readFileSync("app/hooks/useAutoResolve.ts", "utf8");
  assert.match(
    autoResolveSource,
    /function getBootstrapRetryDelayMs/,
    "auto-resolve must centralize bootstrap retryAfter clamping",
  );
  assert.equal(autoResolve.getBootstrapRetryDelayMs(undefined), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(-1), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("5"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("90"), 90_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(10_000), 300_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("1e2"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("90.5"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("00090"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(Number.MAX_SAFE_INTEGER + 1), 30_000);
  assert.equal(await autoResolve.readEpochHasPool(undefined, "42"), false);
  {
    let readContractCalls = 0;
    const zeroPoolClient = {
      readContract: async (request) => {
        readContractCalls += 1;
        assert.equal(request.functionName, "epochs");
        assert.deepEqual(request.args, [42n]);
        return [0n, 0n, 0n, false, false, false];
      },
    };
    assert.equal(await autoResolve.readEpochHasPool(zeroPoolClient, "42"), false);
    assert.equal(readContractCalls, 1, "auto-resolve precheck must read the epoch exactly once");
  }
  {
    const fundedPoolClient = {
      readContract: async () => [1n, 0n, 0n, false, false, false],
    };
    assert.equal(await autoResolve.readEpochHasPool(fundedPoolClient, "43"), true);
  }
  {
    const failingClient = {
      readContract: async () => {
        throw new Error("rpc unavailable");
      },
    };
    assert.equal(await autoResolve.readEpochHasPool(failingClient, "44"), false);
  }
  assert.match(
    autoResolveSource,
    /function parseRetryAfterSeconds[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\{0,5\}\)\$\/[\s\S]*Number\.parseInt\(trimmed, 10\)[\s\S]*const retryAfterSeconds = parseRetryAfterSeconds\(retryAfter\)/,
    "auto-resolve retryAfter must use canonical bounded seconds parsing before backoff clamping",
  );
  assert.match(
    autoResolveSource,
    /readJsonResponse<BootstrapResolvePayload>/,
    "auto-resolve bootstrap response parsing must use the bounded JSON response helper",
  );
  assert.match(
    autoResolveSource,
    /export async function readEpochHasPool\(publicClient: PublicClient \| undefined, epochKey: string\)[\s\S]*if \(!publicClient\) return false[\s\S]*publicClient\.readContract\(\{[\s\S]*functionName:\s*"epochs"[\s\S]*return epochData\[0\] > 0n[\s\S]*catch \{[\s\S]*return false[\s\S]*fetch\("\/api\/bootstrap-resolve"/,
    "browser auto-resolve must fail closed unless a read-only epoch precheck proves a funded pool before the server keeper API trigger",
  );
  assert.match(
    autoResolveSource,
    /payload\?\.ok && payload\.action === "pending"[\s\S]*server keeper resolve tx pending[\s\S]*markRetryScheduled\(epochKey\)[\s\S]*getBootstrapRetryDelayMs\(payload\.retryAfter\)[\s\S]*continue;/,
    "browser auto-resolve must treat keeper receipt timeouts as pending states with guarded retry/backoff",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /\b(?:useWriteContract|writeContractAsync|sendTransactionSilent|sendTransactionFromExternal|walletClient|eth_sendTransaction|sendTransaction\s*\(|writeContract\s*\(|simulateContract|encodeFunctionData)\b|\bbody\s*:/,
    "browser auto-resolve must not import or call wallet/write/send primitives or attach a mutation payload",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /res\.json\(\)|response\.json\(\)/,
    "auto-resolve bootstrap response parsing must not use unbounded response.json",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /Number\(payload\??\.retryAfter \?\? 0\)\s*\*\s*1000|Number\(retryAfter\)/,
    "auto-resolve must not trust raw retryAfter values from bootstrap responses",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /sendTransactionSilent|encodeFunctionData|functionName:\s*"resolveEpoch"|ENABLE_AUTO_RESOLVE_SWEEP/,
    "browser auto-resolve must not keep dormant client wallet resolve transaction paths",
  );
  const allowedClientResolveReferences = new Set([
    join("app", "components", "WhitePaper.tsx"),
    join("app", "hooks", "useAutoResolve.ts"),
    join("app", "lib", "constants.ts"),
  ]);
  const unexpectedClientResolveReferences = listSourceFiles("app")
    .filter((filePath) => !filePath.startsWith(join("app", "api")))
    .filter((filePath) => !allowedClientResolveReferences.has(filePath))
    .filter((filePath) => readFileSync(filePath, "utf8").includes("resolveEpoch"));
  assert.deepEqual(
    unexpectedClientResolveReferences,
    [],
    "client source must not retain dormant resolveEpoch wallet/sweep references outside ABI, docs, or the fetch-only bootstrap hook",
  );
  assert.doesNotMatch(
    publicConfigSource,
    /NEXT_PUBLIC_ENABLE_CLIENT_AUTO_RESOLVE|NEXT_PUBLIC_ENABLE_AUTO_RESOLVE_SWEEP|getConfiguredAutoResolveSweepEnabled|DEFAULT_AUTO_RESOLVE_SWEEP_ENABLED/,
    "public config must not expose a browser auto-resolve sweep flag",
  );
  assert.match(
    publicConfigSource,
    /function getConfiguredClientAutoResolveEnabled\(explicitFlag\?: string \| null\)[\s\S]*void explicitFlag;[\s\S]*return DEFAULT_CLIENT_AUTO_RESOLVE_ENABLED;/,
    "client bootstrap resolve config must ignore public opt-in flags and remain isolated from browser runtime",
  );
}
