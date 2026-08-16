import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as rebatePanelModule from "../app/components/RebatePanel.tsx";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";

const { RebatePanel } = rebatePanelModule.default ?? rebatePanelModule;
const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;

function createRebateInfo(overrides = {}) {
  return {
    isSupported: true,
    pendingRebate: "12.5",
    pendingRebateWei: 12_500_000_000_000_000_000n,
    claimableEpochs: 2,
    totalEpochs: 3,
    isLoading: false,
    hasLoaded: true,
    dataFreshness: "fresh",
    claimPlanKind: "single",
    isEstimatingClaimPlan: false,
    minClaimAmount: "100",
    isBelowClaimMinimum: false,
    isLoadingOlder: false,
    hasMoreOlder: false,
    recentEpochs: [
      { epoch: 42, pending: "1.23456", pendingWei: 1n, claimed: false, resolved: true },
    ],
    ...overrides,
  };
}

function renderRebatePanel(overrides = {}) {
  return renderToStaticMarkup(createElement(RebatePanel, {
    address: "0x0000000000000000000000000000000000000001",
    rebateInfo: createRebateInfo(overrides.rebateInfo),
    isClaiming: overrides.isClaiming === true,
    onClaimRebates: async () => {},
  }));
}

function assertDisabledClaimAccessibility(html) {
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="No claimable Safety Pool epochs are available yet\."/);
  assert.match(html, /aria-describedby="rebate-claim-disabled-reason"/);
  assert.match(html, /title="No claimable Safety Pool epochs are available yet\."/);
  assert.match(
    html,
    /id="rebate-claim-disabled-reason"[^>]*>No claimable Safety Pool epochs are available yet\.<\/p>/,
  );
}

function assertInitialLoadingAccessibility(html) {
  assert.match(
    html,
    /role="status" aria-live="polite" aria-busy="true"[^>]*>Loading Safety Pool ledger\.\.\.<\/div>/,
  );
}

function assertStalePresentation(html) {
  assert.match(html, /data-testid="rebate-freshness-hint"/);
  assert.match(html, /Showing cached Safety Pool data while the ledger refreshes\./);
}

function testRebatePanelRuntimeBehavior() {
  const exactDecimalHtml = renderRebatePanel({
    rebateInfo: {
      pendingRebate: "9007199254740993.123456789",
      recentEpochs: [
        { epoch: 42, pending: "1.23456", pendingWei: 1n, claimed: false, resolved: true },
        { epoch: 41, pending: "1e9", pendingWei: 1n, claimed: false, resolved: true },
      ],
      hasMoreOlder: true,
      loadOlder: async () => true,
    },
  });
  assert.match(exactDecimalHtml, /9007199254740993\.1235 LINEA/);
  assert.match(exactDecimalHtml, /1\.2346 LINEA/);
  assert.match(exactDecimalHtml, /0\.0000 LINEA/);
  assert.match(exactDecimalHtml, /<button[^>]*type="button"[^>]*>Load older epochs<\/button>/);

  const disabledHtml = renderRebatePanel({ rebateInfo: { claimableEpochs: 0 } });
  assertDisabledClaimAccessibility(disabledHtml);

  const claimingHtml = renderRebatePanel({ isClaiming: true });
  assert.match(claimingHtml, /aria-label="Safety Pool claim is already pending"/);
  assert.match(claimingHtml, /title="Safety Pool claim is already pending"/);
  assert.match(claimingHtml, /aria-busy="true"/);

  const initialLoadingHtml = renderRebatePanel({
    rebateInfo: { isLoading: true, hasLoaded: false },
  });
  assertInitialLoadingAccessibility(initialLoadingHtml);

  const backgroundRefreshHtml = renderRebatePanel({
    rebateInfo: { isLoading: true, hasLoaded: true, dataFreshness: "background-refresh" },
  });
  assert.match(backgroundRefreshHtml, /role="status" aria-live="polite"[^>]*>Refreshing Safety Pool ledger in background\.\.\.<\/p>/);
  assert.match(backgroundRefreshHtml, /Safety Pool refresh is already in progress; current data remains visible\./);

  const staleHtml = renderRebatePanel({ rebateInfo: { dataFreshness: "stale-cache" } });
  assertStalePresentation(staleHtml);
  const offlineHtml = renderRebatePanel({ rebateInfo: { dataFreshness: "offline" } });
  assert.match(offlineHtml, /Showing last loaded Safety Pool data\. Refresh failed and will retry automatically\./);

  assert.throws(
    () => assertDisabledClaimAccessibility(disabledHtml.replace(' aria-describedby="rebate-claim-disabled-reason"', "")),
    /aria-describedby/,
    "disabled-reason linkage mutant must be rejected",
  );
  assert.throws(
    () => assertInitialLoadingAccessibility(initialLoadingHtml.replace(' aria-busy="true"', "")),
    /aria-busy/,
    "loading announcement mutant must be rejected",
  );
  assert.throws(
    () => assertStalePresentation(staleHtml.replace('data-testid="rebate-freshness-hint"', 'data-testid="mutant"')),
    /rebate-freshness-hint/,
    "stale-hint selector mutant must be rejected",
  );
  assert.doesNotMatch(
    exactDecimalHtml,
    /9007199254740994\.0000 LINEA/,
    "Safety Pool display must not round large decimal text through Number precision",
  );
}

export function runJackpotAndRebateSecurityTests() {
  testRebatePanelRuntimeBehavior();

  const smokeHttpSource = readFileSync("scripts/smoke-http.mjs", "utf8");
  const jackpotsServiceSource = readFileSync("app/api/_lib/jackpotsService.ts", "utf8");
  const jackpotsRouteSource = readFileSync("app/api/jackpots/route.ts", "utf8");
  assert.match(
    jackpotsServiceSource,
    /JACKPOT_LOG_SCAN_CHUNK = 10_000n[\s\S]*JACKPOT_BOOTSTRAP_SCAN_CHUNK = 10_000n/,
    "jackpot RPC scans must stay within the Linea public RPC 10k-block range limit",
  );
  assert.match(
    jackpotsServiceSource,
    /message\.includes\("range"\) && message\.includes\("exceeds limit"\)/,
    "jackpot RPC scans must recognize provider block-range limit errors",
  );
  assert.match(
    jackpotsServiceSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "jackpot service amountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.match(
    jackpotsServiceSource,
    /if \(seedJackpots\.length === 0\)[\s\S]*commitJackpotResponseCache\(\{ jackpots: \[\] \}[\s\S]*maybeStartJackpotRecovery\(\[\]\)[\s\S]*return \{ payload, source: "rebuilt" \}/,
    "empty jackpot storage must return immediately and recover in the background",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /await buildJackpotsPayload\(\{[\s\S]{0,180}seedJackpots: \[\]/,
    "empty jackpot storage must not block the HTTP request on historical RPC recovery",
  );
  const jackpotRuntimeProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-jackpot-api-admission.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    jackpotRuntimeProbe.status,
    0,
    jackpotRuntimeProbe.stderr || jackpotRuntimeProbe.stdout || jackpotRuntimeProbe.error?.message,
  );
  assert.match(
    jackpotRuntimeProbe.stdout,
    /^jackpot API admission tests passed \(runtime 5 groups, 4 mutants killed\)\s*$/,
    "jackpot admission, finality, cache, public-output, and fault behavior probe must complete",
  );
  const walletDeepScanPanelSource = readFileSync("app/components/wallet/WalletSettingsDeepScanPanel.tsx", "utf8");
  assert.match(
    walletDeepScanPanelSource,
    /formatLineaWeiAmountDisplay/,
    "deep reward scan rows must use the shared safe wei amount formatter",
  );
  assert.match(
    walletDeepScanPanelSource,
    /Recovery scan for older rewards[\s\S]*bounded batches[\s\S]*Start Recovery Scan/,
    "deep reward scan copy must frame the tool as bounded recovery instead of a routine full-history action",
  );
  assert.match(
    walletDeepScanPanelSource,
    /deepScanScanning \?[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-hidden="true"[\s\S]*\{deepScanProgress\}/,
    "deep reward scan progress must be announced as a polite busy status with decorative spinner hidden",
  );
  assert.match(
    walletDeepScanPanelSource,
    /deepScanWins !== null \?[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-hidden="true"[\s\S]*All rewards claimed/,
    "deep reward scan completed-empty state must be announced without changing scan-again behavior",
  );
  assert.doesNotMatch(
    walletDeepScanPanelSource,
    /Scans ALL epochs|Start Full Scan/,
    "deep reward scan copy must not overpromise an all-history scan in the normal wallet settings UI",
  );
  assert.equal(
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("-1").toString(),
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei(null).toString(),
    "Safety Pool claim minimum must reject negative env values and keep the dust warning active",
  );
  assert.equal(
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("0").toString(),
    safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei(null).toString(),
    "Safety Pool claim minimum must reject zero env values and keep the dust warning active",
  );
  assert.equal(
    safetyPoolClaimThreshold.formatSafetyPoolClaimMinimum(safetyPoolClaimThreshold.parseMinSafetyPoolClaimWei("12.5")),
    "12.5",
    "Safety Pool claim minimum must keep valid positive configured amounts",
  );
  const rebateSource = readFileSync("app/hooks/useRebate.ts", "utf8");
  assert.match(
    rebateSource,
    /getExplorerTxUrl/,
    "Safety Pool claim notifications must include an explorer link when a tx hash is available",
  );
  assert.match(
    rebateSource,
    /function normalizeNonNegativeSafeInteger[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\*\)\$\/\.test\(text\)[\s\S]*BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function normalizeNumberArray[\s\S]*\.map\(normalizeNonNegativeSafeInteger\)[\s\S]*normalizeRecentEpoch[\s\S]*normalizeNonNegativeSafeInteger\(data\.epoch\)[\s\S]*claimableEpochCount: normalizeNonNegativeSafeInteger\(data\.claimableEpochCount\) \?\? 0[\s\S]*totalEpochs: normalizeNonNegativeSafeInteger\(data\.totalEpochs\) \?\? 0[\s\S]*nextCursor = normalizeNonNegativeSafeInteger\(data\.nextCursor\)/,
    "Safety Pool client must canonical-parse epoch, count, and cursor evidence from API and cache payloads",
  );
  assert.match(
    rebateSource,
    /function parseClaimableEpoch\(value: bigint \| undefined\)[\s\S]*value <= 0n \|\| value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const epochNumber = parseClaimableEpoch\(chunk\[index\]\)[\s\S]*const epochNumber = parseClaimableEpoch\(epoch\)[\s\S]*epoch: parseClaimableEpoch\(epoch\) \?\? "invalid"/,
    "Safety Pool client must safely narrow exact claimable epoch bigint evidence",
  );
  assert.doesNotMatch(
    rebateSource,
    /Number\.isInteger\(item\)|\.map\(\(item\) => Number\(item\)\)|const epoch = Number\(data\.epoch\)|Math\.max\(0, Number\(data\.(?:claimableEpochCount|totalEpochs)\)|const nextCursor = Number\(data\.nextCursor\)|claimable\.add\(Number\(|epoch: Number\(epoch\)/,
    "Safety Pool client must not use broad number coercion for epoch, count, or cursor evidence",
  );
  assert.match(
    rebateSource,
    /X-Rebate-Cache/,
    "Safety Pool client must surface stale/inflight API cache status to the UI",
  );
  assert.match(
    rebateSource,
    /dataFreshness/,
    "Safety Pool info must expose data freshness for degraded-state UI hints",
  );
  assert.match(
    rebateSource,
    /const cachedDelay = getFreshCacheDelayMs\(savedAt, REBATE_CLIENT_CACHE_TTL_MS\) \?\? 0/,
    "Safety Pool cache refresh delay must use the shared strict timestamp helper",
  );
  assert.match(
    rebateSource,
    /cachedPlan && getFreshCacheDelayMs\(cachedPlan\.savedAt, CLAIM_PLAN_CACHE_TTL_MS\) !== null/,
    "Safety Pool claim-plan cache acceptance must use the shared strict timestamp helper",
  );
  assert.doesNotMatch(
    rebateSource,
    /Date\.now\(\) - savedAt < REBATE_CLIENT_CACHE_TTL_MS|REBATE_CLIENT_CACHE_TTL_MS - \(Date\.now\(\) - savedAt\)|Date\.now\(\) - cachedPlan\.savedAt < CLAIM_PLAN_CACHE_TTL_MS/,
    "Safety Pool cache refresh and claim-plan cache must not use broad savedAt age arithmetic",
  );
  assert.match(
    rebateSource,
    /activeRebateAddressRef\.current === rebateAddress[\s\S]*cacheSavedAtRef\.current = null;[\s\S]*resetState\(\)/,
    "Safety Pool must clear prior-wallet state and cache timing when the active wallet changes",
  );
  assert.match(
    rebateSource,
    /const resetState = useCallback[\s\S]*requestIdRef\.current \+= 1/,
    "Safety Pool reset must invalidate in-flight responses from the previous wallet",
  );
  const claimBehaviorProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-rebate-claim-behavior.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    claimBehaviorProbe.status,
    0,
    claimBehaviorProbe.stderr || claimBehaviorProbe.stdout || claimBehaviorProbe.error?.message,
  );
  assert.match(
    claimBehaviorProbe.stdout,
    /^Safety Pool claim behavior tests passed \(5 groups\)\.\s*$/,
    "Safety Pool claim transaction behavior probe must complete",
  );
  assert.match(
    rebateSource,
    /createClaimConfirmationPendingError[\s\S]*error\.name = "TransactionReceiptTimeoutError"/,
    "Safety Pool confirmation timeout must use the shared ambiguous-pending classification",
  );
  assert.match(
    rebateSource,
    /const confirmClaimBatch = useCallback[\s\S]*getTransactionReceipt\(\{ hash \}\)[\s\S]*if \(receipt\.status !== "success"\) \{[\s\S]*throw new Error\(`Transaction reverted: \$\{hash\}`\);/,
    "Safety Pool confirmation must surface reverted receipts before ambiguous-pending fallback",
  );
  assert.match(
    rebateSource,
    /if \(message\.startsWith\("transaction reverted:"\)\) throw err;/,
    "Safety Pool reverted receipts must be rethrown instead of converted to ambiguous pending",
  );
  assert.match(
    rebateSource,
    /let remainingEpochs: number\[\];[\s\S]*loadClaimableEpochsExact[\s\S]*createClaimConfirmationPendingError/,
    "Safety Pool post-send state reads must fail as ambiguous pending rather than trigger a duplicate fallback",
  );
  const rebatesRouteSource = readFileSync("app/api/rebates/route.ts", "utf8");
  const rebateHistoryRouteSource = readFileSync("app/api/rebate-history/route.ts", "utf8");
  assert.match(
    rebatesRouteSource,
    /isSafePositiveInteger/,
    "rebates API must use safe epoch validation for indexed and chain epochs",
  );
  assert.match(
    rebatesRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function bigintToNonNegativeSafeNumber\(value: bigint\)[\s\S]*value > MAX_SAFE_INTEGER_BIGINT[\s\S]*summaryClaimableCount \+= bigintToNonNegativeSafeNumber\(claimableCount\)/,
    "rebates API must bound chain claimable-count evidence before publishing summary counts",
  );
  assert.match(
    rebatesRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseRebateEpochNumber\(value: bigint\)[\s\S]*value <= 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const epochNumber = parseRebateEpochNumber\(chunk\[index\]\)[\s\S]*const epochNumber = parseRebateEpochNumber\(epoch\)[\s\S]*const epoch = parseRebateEpochNumber\(recentEpochBigInts\[index\]\)/,
    "rebates API must safely narrow exact claimable and recent rebate epoch bigint evidence",
  );
  assert.doesNotMatch(
    rebatesRouteSource,
    /(^|[^A-Za-z0-9_])Number\(claimableCount\)|(^|[^A-Za-z0-9_])Number\(recentEpochBigInts\[index\]\)|(^|[^A-Za-z0-9_])Number\(chunk\[index\]\)|const epochNumber = Number\(epoch\)/,
    "rebates API must not broadly coerce chain rebate counts or epoch evidence",
  );
  assert.doesNotMatch(
    rebatesRouteSource,
    /Number\.isInteger\(currentEpoch\)/,
    "rebates API cache key must reject unsafe currentEpoch values",
  );
  const rebateRouteRuntimeProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-rebate-route-runtime.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    rebateRouteRuntimeProbe.status,
    0,
    rebateRouteRuntimeProbe.stderr || rebateRouteRuntimeProbe.stdout || rebateRouteRuntimeProbe.error?.message,
  );
  assert.match(
    rebateRouteRuntimeProbe.stdout,
    /^Rebate route runtime behavior tests passed \(4 groups, 3 mutants killed\)\.\s*$/,
    "rebates API watermark and timing behavior probe must complete",
  );
  assert.match(
    rebatesRouteSource,
    /bucket: "api-rebates-exact"[\s\S]*limit: 6/,
    "expensive exact rebate scans must have a stricter rate limit",
  );
  assert.match(
    rebatesRouteSource,
    /bucket: "api-rebates"[\s\S]*if \(rateLimited\) return applyNoStoreHeaders\(rateLimited\)[\s\S]*bucket: "api-rebates-exact"[\s\S]*if \(exactRateLimited\) return applyNoStoreHeaders\(exactRateLimited\)/,
    "Safety Pool rebate rate-limit responses must remain no-store on both normal and exact-scan paths",
  );
  const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");
  assert.doesNotMatch(depositsRouteSource, /deposits: \[\], error: message/);
  assert.doesNotMatch(rebatesRouteSource, /error: message/);
  assert.match(
    rebateHistoryRouteSource,
    /MAX_PAGE_SIZE = 64[\s\S]*allowFailure: false/,
    "older Safety Pool history must stay bounded and fail the whole page instead of skipping unread epochs",
  );
  assert.match(
    smokeHttpSource,
    /name: "rebate-history"[\s\S]*\/api\/rebate-history\?user=/,
    "HTTP smoke must cover the paginated Safety Pool history route",
  );
  assert.doesNotMatch(jackpotsRouteSource, /error: message/);
}
