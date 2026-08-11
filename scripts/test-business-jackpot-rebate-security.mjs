import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";

const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;

export function runJackpotAndRebateSecurityTests() {
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
    /function parseStoredBlockNumber/,
    "jackpot service must parse stored block numbers safely",
  );
  assert.match(
    jackpotsServiceSource,
    /function normalizeJackpotTxHash\(txHash: string \| null \| undefined\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*txHash: normalizeJackpotTxHash\(log\.transactionHash\)[\s\S]*txHash: normalizeJackpotTxHash\(row\.txHash\)/,
    "jackpot service must only publish full 32-byte transaction hashes",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /txHash:\s*(?:log\.transactionHash|onchain\?\.txHash|String\(row\.txHash)/,
    "jackpot service must not publish raw chain or stored txHash values",
  );
  assert.match(
    jackpotsServiceSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "jackpot service amountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.match(
    jackpotsServiceSource,
    /function parseChainUintEpochNumber\(value: unknown\)[\s\S]*typeof value !== "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const lastDailyEpoch = parseChainUintEpochNumber\(info\[4\]\)[\s\S]*const lastWeeklyEpoch = parseChainUintEpochNumber\(info\[5\]\)[\s\S]*lastDailyEpoch !== null[\s\S]*fetchJackpotEventByEpoch\("daily", lastDailyEpoch, context, budget\)[\s\S]*lastWeeklyEpoch !== null[\s\S]*fetchJackpotEventByEpoch\("weekly", lastWeeklyEpoch, context, budget\)/,
    "jackpot service must safely narrow chain uint256 jackpot epochs before recovery lookups",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /(^|[^A-Za-z0-9_])Number\(info\[[45]\]\)/,
    "jackpot service must not broadly coerce chain uint256 jackpot epochs",
  );
  assert.match(
    jackpotsServiceSource,
    /function toSafeBlockTimestampMs\(value: bigint\)[\s\S]*Math\.floor\(Number\.MAX_SAFE_INTEGER \/ 1000\)[\s\S]*return Number\(value\) \* 1000[\s\S]*const value = toSafeBlockTimestampMs\(block\.timestamp\)/,
    "jackpot service must safely narrow chain block timestamps before millisecond conversion",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /amountNum:\s*(?:Number\.)?parseFloat\(formatUnits\(|amountNum:\s*parseFloat\(formatUnits\(/,
    "jackpot service must not derive amountNum through parseFloat(formatUnits())",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "jackpot service amountNum compatibility fields must not parse formatted decimal strings",
  );
  assert.match(
    jackpotsServiceSource,
    /isSafePositiveInteger/,
    "jackpot service must use safe epoch validation",
  );
  assert.doesNotMatch(
    jackpotsServiceSource,
    /BigInt\([^)]*(?:row\.blockNumber|blockNumber|a\.blockNumber|b\.blockNumber)[^)]*\)/,
    "jackpot service must not BigInt-parse unchecked stored block numbers",
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
  assert.match(
    jackpotsServiceSource,
    /jackpotBlockTimestampCache\.size > MAX_JACKPOT_EVENT_CACHE_ENTRIES/,
    "jackpot block timestamp cache must stay bounded",
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
  assert.match(
    rebateSource,
    /isAmbiguousPendingTxError\(err\) \|\| isUserRejection\(err\)/,
    "Safety Pool batch fallback must not prompt again after a user rejection or ambiguous submission",
  );
  assert.match(
    rebateSource,
    /await submitClaimBatch\(batch\);\s*claimedEpochCount \+= batch\.length;[\s\S]*await submitSingleClaim\(batch\[0\]\);\s*claimedEpochCount \+= 1;[\s\S]*await claimBatches\(/,
    "Safety Pool split claims must preserve partial success counts before a later wallet rejection or ambiguous submission",
  );
  assert.match(
    rebateSource,
    /const formatRebateError = useCallback[\s\S]*claim status is unknown[\s\S]*claim reverted on-chain[\s\S]*wallet provider[\s\S]*Refresh the Safety Pool tab/,
    "Safety Pool claim failures must classify provider errors without surfacing raw RPC messages",
  );
  assert.doesNotMatch(
    rebateSource,
    /return msg;/,
    "Safety Pool claim failures must not return raw provider or RPC messages to users",
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
  assert.match(
    rebateSource,
    /if \(claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;[\s\S]*finally \{[\s\S]*claimInFlightRef\.current = false;/,
    "Safety Pool claim must synchronously reject duplicate starts before React updates the loading state",
  );
  assert.match(
    rebateSource,
    /const submitClaimBatch[\s\S]*simulateContract\(\{[\s\S]*functionName: "claimEpochsRebate"[\s\S]*estimateClaimGas[\s\S]*silentSend/,
    "Safety Pool batch claims must simulate before gas fallback or wallet submission",
  );
  assert.match(
    rebateSource,
    /const submitSingleClaim[\s\S]*simulateContract\(\{[\s\S]*functionName: "claimEpochRebate"[\s\S]*estimateSingleClaimGas[\s\S]*silentSend/,
    "Safety Pool single-epoch fallback must simulate before gas fallback or wallet submission",
  );
  assert.match(
    rebateSource,
    /latestRebateAddressRef\.current = rebateAddress\?\.toLowerCase\(\) \?\? null[\s\S]*const claimActor = rebateAddress\.toLowerCase\(\)[\s\S]*assertClaimActorActive[\s\S]*err === claimActorChangedError/,
    "Safety Pool claims must stop split sends and stale refreshes when the active wallet changes",
  );
  assert.match(
    rebateSource,
    /isAmbiguousPendingTxError\(err\)[\s\S]*claim submission status is ambiguous; fallback suppressed[\s\S]*formatRebateTxMessage\([\s\S]*Safety Pool claim may already be pending\. Check wallet activity and refresh Safety Pool before retrying\.[\s\S]*lastClaimTxHash[\s\S]*isUserRejection\(err\)[\s\S]*Claimed Safety Pool payouts for \$\{claimedEpochCount\} epochs in \$\{claimTxCount\} transaction[\s\S]*Safety Pool claim rejected in wallet\./,
    "Safety Pool claims must surface ambiguous pending with tx links, partial-success rejection, and plain wallet rejection explicitly",
  );
  assert.match(
    rebateSource,
    /Claimed Safety Pool payouts for \$\{claimedEpochCount\} epochs in \$\{claimTxCount\} transaction[\s\S]*some epochs still failed: \$\{message\}/,
    "Safety Pool split claims must preserve partial success counts when later epochs fail",
  );
  const rebatePanelSource = readFileSync("app/components/RebatePanel.tsx", "utf8");
  assert.match(
    rebatePanelSource,
    /formatDecimalTextFixed\(String\(value \?\? ""\)\.trim\(\), 4\) \?\? "0\.0000"/,
    "Safety Pool amount display must use canonical decimal-text formatting",
  );
  assert.doesNotMatch(
    rebatePanelSource,
    /Number\.parseFloat\(String\(value \?\? ""\)\)[\s\S]*\.toFixed\(4\)/,
    "Safety Pool amount display must not round through broad parseFloat().toFixed()",
  );
  assert.match(
    rebatePanelSource,
    /data-testid="rebate-freshness-hint"/,
    "Safety Pool panel must show a stable visible freshness hint when serving stale data",
  );
  assert.match(
    rebatePanelSource,
    /claimDisabledReason[\s\S]*aria-describedby=\{claimDisabledReason \? "rebate-claim-disabled-reason" : undefined\}[\s\S]*id="rebate-claim-disabled-reason"/,
    "Safety Pool claim button must expose the reason when claiming is disabled",
  );
  assert.match(
    rebatePanelSource,
    /claimActionLabel[\s\S]*aria-label=\{claimActionLabel\}[\s\S]*title=\{claimActionLabel\}/,
    "Safety Pool claim button must keep an explicit accessible action label",
  );
  assert.match(
    rebatePanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*Loading Safety Pool ledger/,
    "Safety Pool initial loading state must be announced as a polite busy status",
  );
  assert.match(
    rebatePanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*Refreshing Safety Pool ledger in background/,
    "Safety Pool background refresh must remain announced without changing visible copy",
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
  assert.match(
    rebatesRouteSource,
    /rebateCacheWatermarks/,
    "rebates API must track indexed-data watermarks to avoid repeated slow background rebuilds",
  );
  assert.match(
    rebatesRouteSource,
    /shouldSkip:[\s\S]*REBATE_UNCHANGED_WATERMARK_REFRESH_MS/,
    "rebates API stale refresh must skip unchanged indexed-data watermarks for a bounded interval",
  );
  assert.match(
    rebatesRouteSource,
    /function normalizeRebateTimingMs\(value: number\)[\s\S]*Number\.isFinite\(value\)[\s\S]*REBATE_TIMING_MAX_MS[\s\S]*function formatRebateTimingMs\(value: number\)[\s\S]*normalizeRebateTimingMs\(value\)\.toFixed\(1\)[\s\S]*function formatRebateTimingLogValue\(value: number\)[\s\S]*formatRebateTimingMs\(value\)/,
    "rebates API timing output must bound slow-build metrics before formatting Server-Timing or logs",
  );
  assert.match(
    rebatesRouteSource,
    /indexed;dur=\$\{formatRebateTimingMs\(timings\.indexedMs\)\}[\s\S]*summary;dur=\$\{formatRebateTimingMs\(timings\.summaryMs\)\}[\s\S]*exact;dur=\$\{formatRebateTimingMs\(timings\.exactMs\)\}[\s\S]*recent;dur=\$\{formatRebateTimingMs\(timings\.recentMs\)\}[\s\S]*total;dur=\$\{formatRebateTimingMs\(timings\.totalMs\)\}[\s\S]*indexedMs: formatRebateTimingLogValue\(timings\.indexedMs\)[\s\S]*totalMs: formatRebateTimingLogValue\(timings\.totalMs\)/,
    "rebates API must route every published timing field through the bounded formatter",
  );
  assert.doesNotMatch(
    rebatesRouteSource,
    /timings\.(?:indexedMs|summaryMs|exactMs|recentMs|totalMs)\.toFixed\(1\)|Number\(timings\.(?:indexedMs|summaryMs|exactMs|recentMs|totalMs)\.toFixed\(1\)\)/,
    "rebates API must not format raw timing fields directly",
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
    rebatePanelSource,
    /Load older epochs/,
    "Safety Pool must expose explicit on-demand older history instead of background historical polling",
  );
  assert.match(
    smokeHttpSource,
    /name: "rebate-history"[\s\S]*\/api\/rebate-history\?user=/,
    "HTTP smoke must cover the paginated Safety Pool history route",
  );
  assert.doesNotMatch(jackpotsRouteSource, /error: message/);
}
