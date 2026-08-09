import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const summaryOnly = process.argv.includes("--summary-only");
const repoRoot = process.cwd();
const MAX_SECURITY_FOLLOWUP_SOURCE_BYTES = 1024 * 1024;

function readSource(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing source file: ${relativePath}`);
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Source path must be a file: ${relativePath}`);
  }
  if (stats.size > MAX_SECURITY_FOLLOWUP_SOURCE_BYTES) {
    throw new Error(`Source file is too large to validate safely: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function listFiles(root, extensions = /\.(?:ts|tsx|js|mjs)$/) {
  const absoluteRoot = path.resolve(repoRoot, root);
  const files = [];
  const ignored = new Set([".next", ".tmp", "artifacts", "cache", "coverage", "dist", "logs", "node_modules", "out", "playwright-report", "test-results", "typechain-types"]);
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && extensions.test(entry.name)) {
        files.push(path.relative(repoRoot, absolute).replace(/\\/g, "/"));
      }
    }
  }
  walk(absoluteRoot);
  return files;
}

function check(id, description, fn) {
  try {
    const passed = fn();
    return { id, description, status: passed ? "pass" : "fail" };
  } catch {
    return { id, description, status: "fail" };
  }
}

const bootstrapShared = readSource("app/api/bootstrap-resolve/shared.ts");
const bootstrapRoute = readSource("app/api/bootstrap-resolve/route.ts");
const keeperBot = readSource("bot.ts");
const tabLock = readSource("app/hooks/useMiningTabLock.ts");
const depositsRoute = readSource("app/api/deposits/route.ts");
const autoResolve = readSource("app/hooks/useAutoResolve.ts");
const clearPendingNonce = readSource("scripts/clear-live-test-pending-nonce.ts");
const liveCanary = readSource("scripts/live-round-canary.ts");
const previewDryRun = readSource("scripts/create-v10-canary-dry-run-preview.mjs");
const ciWorkflow = readSource(".github/workflows/ci.yml");
const ciSecurity = readSource("scripts/check-ci-security.mjs");

const allowedResolveEpochReferences = new Set([
  "app/lib/constants.ts",
  "app/api/bootstrap-resolve/route.ts",
  "app/api/bootstrap-resolve/shared.ts",
  "app/components/WhitePaper.tsx",
]);

const appResolveEpochFiles = listFiles("app")
  .filter((file) => readSource(file).includes("resolveEpoch"))
  .filter((file) => !allowedResolveEpochReferences.has(file));

const checks = [
  check("host-auth", "bootstrap resolver host auth and shared lock fail-closed", () =>
    /function isLocalDevBootstrapRequest\(_request: Request\)[\s\S]*return false/.test(bootstrapShared) &&
    /requiresExternalSharedLock\(\)[\s\S]*acquireExternalExpiringLock[\s\S]*fallback: "deny"/.test(bootstrapShared) &&
    !/BOOTSTRAP_RESOLVE_ALLOW_LOCAL_DEV_WITHOUT_SECRET/.test(bootstrapShared)),
  check("web-locks", "Auto-Miner native Web Locks fail closed without localStorage-only ownership", () =>
    /typeof navigator === "undefined" \|\| !navigator\.locks\) return false/.test(tabLock) &&
    /navigator\.locks[\s\S]*request\(TAB_LOCK_KEY, \{ ifAvailable: true, mode: "exclusive" \}/.test(tabLock) &&
    /export async function acquireTabLock\(\): Promise<boolean> \{[\s\S]*return acquireNativeTabLock\(\);[\s\S]*\}/.test(tabLock)),
  check("keeper-nonce", "bootstrap keeper refuses unbound pending nonce and preserves receipt timeout as pending", () =>
    /if \(pendingNonce > latestNonce\) \{[\s\S]*bootstrap_pending_nonce_unbound[\s\S]*return json/.test(bootstrapRoute) &&
    /waitForTransactionReceipt[\s\S]*catch\(\(\) => null\)[\s\S]*action: "pending"[\s\S]*reason: "resolve_receipt_timeout"/.test(bootstrapRoute)),
  check("keeper-bot-receipts", "legacy keeper bot binds pending nonce and defers reverted receipts", () =>
    /type PendingResolve = \{[\s\S]*hash: `0x\$\{string\}`;[\s\S]*nonce: number;[\s\S]*retryAt\?: number;[\s\S]*\}/.test(keeperBot) &&
    /hasPendingTransaction && replacePendingResolve\?\.nonce === latestNonce/.test(keeperBot) &&
    /keeper_pending_nonce_unbound latest=\$\{latestNonce\.toString\(\)\} pending=\$\{pendingNonce\.toString\(\)\}/.test(keeperBot) &&
    /const receipt = await publicClient\.waitForTransactionReceipt\(\{ hash \}\);[\s\S]*if \(receipt\.status !== "success"\)[\s\S]*retryAt: Date\.now\(\) \+ PENDING_RESOLVE_REVERT_RETRY_MS/.test(keeperBot) &&
    /typeof storedNonce === "number"[\s\S]*Ignoring legacy or invalid pendingResolve without a bound nonce/.test(keeperBot) &&
    /receipt\.status === "success"[\s\S]*pending\.retryAt && Date\.now\(\) < pending\.retryAt[\s\S]*Resolve tx reverted for epoch/.test(keeperBot) &&
    /replacing only its bound nonce[\s\S]*replacePendingResolve = pending;/.test(keeperBot)),
  check("deposit-limiter", "deposits recovery has one global in-flight limiter and cooldown", () =>
    /let depositsRecoveryInflight: Promise<DepositRow\[]> \| null = null/.test(depositsRoute) &&
    /depositsRecoveryInflight \|\|[\s\S]*DEPOSITS_BACKGROUND_RECOVERY_COOLDOWN_MS[\s\S]*return null/.test(depositsRoute) &&
    !/return\s+depositsRecoveryInflight/.test(depositsRoute)),
  check("dry-run-defaults", "live recovery/canary/preview default to dry-run and defer signing material", () =>
    /const EXECUTE = process\.argv\.includes\("--execute"\)/.test(clearPendingNonce) &&
    /const address = getDryRunAddress\(\)[\s\S]*if \(state\.gap === 0\) return;[\s\S]*if \(!EXECUTE\) return;[\s\S]*const account = getAccount\(\)/.test(clearPendingNonce) &&
    /const DRY_RUN = !LIVE_EXECUTION_CONFIRMED[\s\S]*if \(DRY_RUN\) return;[\s\S]*LORE_LIVE_TEST_RESOLVER_PRIVATE_KEY/.test(liveCanary) &&
    /LIVE_TEST_DRY_RUN: "1"[\s\S]*LIVE_TEST_EXECUTE: "0"[\s\S]*SOAK_EXECUTE_LIVE: "0"[\s\S]*TEST_WALLET_EXECUTE: "0"/.test(previewDryRun)),
  check("ci-security", "CI uses read permissions, SHA pins, no pull_request_target, and no persisted checkout credentials", () =>
    /permissions:\s*\n\s+contents: read/.test(ciWorkflow) &&
    !/\bpull_request_target\b/.test(ciWorkflow) &&
    /actions\/checkout@[0-9a-f]{40}[\s\S]*persist-credentials: false/.test(ciWorkflow) &&
    /actions\/setup-node@[0-9a-f]{40}/.test(ciWorkflow) &&
    /actions\/upload-artifact@[0-9a-f]{40}/.test(ciWorkflow) &&
    /permissionsReadOnly[\s\S]*usesPinned[\s\S]*checkoutPersistCredentialsFalse/.test(ciSecurity)),
  check("auto-resolve", "browser auto-resolve remains fetch-only and has no wallet resolve sweep", () =>
    /export async function readEpochHasPool\(publicClient: PublicClient \| undefined, epochKey: string\)[\s\S]*if \(!publicClient\) return false[\s\S]*publicClient\.readContract\(\{[\s\S]*functionName:\s*"epochs"[\s\S]*return epochData\[0\] > 0n[\s\S]*catch \{[\s\S]*return false[\s\S]*fetch\("\/api\/bootstrap-resolve"/.test(autoResolve) &&
    !/sendTransactionSilent|createWalletClient|writeContract|encodeFunctionData|functionName:\s*"resolveEpoch"|ENABLE_AUTO_RESOLVE_SWEEP/.test(autoResolve) &&
    appResolveEpochFiles.length === 0),
];

const failed = checks.filter((entry) => entry.status !== "pass");

function passed(id) {
  return checks.find((entry) => entry.id === id)?.status === "pass";
}

if (summaryOnly) {
  console.log(JSON.stringify({
    status: failed.length === 0 ? "pass" : "fail",
    checks: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    failedIds: failed.map((entry) => entry.id),
    hostAuth: passed("host-auth"),
    webLocks: passed("web-locks"),
    keeperNonce: passed("keeper-nonce"),
    keeperBotReceipts: passed("keeper-bot-receipts"),
    depositLimiter: passed("deposit-limiter"),
    dryRunDefaults: passed("dry-run-defaults"),
    ciSecurity: passed("ci-security"),
    autoResolve: passed("auto-resolve"),
    appResolveEpochFiles: appResolveEpochFiles.length,
  }));
} else {
  console.log(JSON.stringify({
    status: failed.length === 0 ? "pass" : "fail",
    checks,
    appResolveEpochFiles,
  }, null, 2));
}

if (failed.length > 0) process.exitCode = 1;
