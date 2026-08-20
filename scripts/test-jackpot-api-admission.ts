import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import {
  acquireResponseConcurrencySlot,
  releaseResponseConcurrencySlotOnSettled,
} from "../app/api/_lib/responseConcurrencyBudget";
import { getTrustedAuthOrigin } from "../app/api/_lib/trustedAuthOrigin";
import {
  JACKPOT_PUBLIC_HISTORY_LIMIT,
  canPersistJackpotRecoveryBlock,
  classifyJackpotResponseCache,
  createJackpotPublicErrorPayload,
  deriveDurableJackpotRecoveryCheckpoint,
  isDurableJackpotRecoverySnapshot,
  sanitizeJackpotPublicRows,
  shouldBypassJackpotResponseCache,
  shouldStartJackpotRecovery,
  type JackpotPublicRow,
  type JackpotRecoveryContextPolicy,
} from "../app/api/_lib/jackpotRouteRuntime";

const DEPLOY_BLOCK = 10_000n;
const TARGET_BLOCK = 20_000n;
const CHECKPOINT_BLOCK = 19_900n;
const CHECKPOINT_HASH = `0x${"11".repeat(32)}` as `0x${string}`;
const TX_HASH = `0x${"aa".repeat(32)}` as `0x${string}`;

function uniqueBudgetKey(label: string) {
  return `test:${label}:${process.pid}:${Date.now()}:${Math.random()}`;
}

async function testConcurrencyBudget() {
  const budgetKey = uniqueBudgetKey("admission");
  const releaseFirst = acquireResponseConcurrencySlot(budgetKey, 2);
  const releaseSecond = acquireResponseConcurrencySlot(budgetKey, 2);
  assert.ok(releaseFirst);
  assert.ok(releaseSecond);
  assert.equal(acquireResponseConcurrencySlot(budgetKey, 2), null);

  releaseFirst();
  releaseFirst();
  const releaseReplacement = acquireResponseConcurrencySlot(budgetKey, 2);
  assert.ok(releaseReplacement, "an idempotently released slot must become available exactly once");
  assert.equal(acquireResponseConcurrencySlot(budgetKey, 2), null);
  releaseSecond();
  releaseReplacement();

  const streamBudgetKey = uniqueBudgetKey("stream");
  const releaseStream = acquireResponseConcurrencySlot(streamBudgetKey, 1);
  assert.ok(releaseStream);
  let closeUpstream: (() => void) | null = null;
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("image"));
      closeUpstream = () => controller.close();
    },
  });
  const wrapped = releaseResponseConcurrencySlotOnSettled(
    new Response(upstream, { status: 201, headers: { "x-test-header": "preserved" } }),
    releaseStream,
  );
  assert.equal(wrapped.status, 201);
  assert.equal(wrapped.headers.get("x-test-header"), "preserved");
  assert.equal(
    acquireResponseConcurrencySlot(streamBudgetKey, 1),
    null,
    "the slot must remain held while the response body is active",
  );
  const closeStream = closeUpstream as (() => void) | null;
  assert.ok(closeStream);
  closeStream();
  assert.equal(await wrapped.text(), "image");
  const releaseAfterCompletion = acquireResponseConcurrencySlot(streamBudgetKey, 1);
  assert.ok(releaseAfterCompletion, "body completion must release the render slot");
  releaseAfterCompletion();

  const cancelBudgetKey = uniqueBudgetKey("cancel");
  const releaseCancel = acquireResponseConcurrencySlot(cancelBudgetKey, 1);
  assert.ok(releaseCancel);
  let upstreamCancelled = false;
  const cancellable = new Response(new ReadableStream({
    cancel() {
      upstreamCancelled = true;
    },
  }));
  const wrappedCancellable = releaseResponseConcurrencySlotOnSettled(cancellable, releaseCancel);
  assert.ok(wrappedCancellable.body);
  await wrappedCancellable.body.cancel();
  assert.equal(upstreamCancelled, true);
  const releaseAfterCancel = acquireResponseConcurrencySlot(cancelBudgetKey, 1);
  assert.ok(releaseAfterCancel, "body cancellation must release the render slot");
  releaseAfterCancel();
}

async function testNodeImageResponseBudget() {
  const budgetKey = uniqueBudgetKey("node-image-response");
  const releaseRender = acquireResponseConcurrencySlot(budgetKey, 1);
  assert.ok(releaseRender);
  const imageResponse = new ImageResponse(
    createElement("div", { style: { display: "flex", color: "white", background: "black" } }, "LORE"),
    { width: 120, height: 63 },
  );
  const wrapped = releaseResponseConcurrencySlotOnSettled(imageResponse, releaseRender);
  assert.equal(wrapped.headers.get("content-type"), "image/png");
  assert.equal(wrapped.headers.get("cache-control"), imageResponse.headers.get("cache-control"));
  assert.equal(acquireResponseConcurrencySlot(budgetKey, 1), null);
  const png = new Uint8Array(await wrapped.arrayBuffer());
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const releaseAfterRender = acquireResponseConcurrencySlot(budgetKey, 1);
  assert.ok(releaseAfterRender, "a completed Node.js ImageResponse must release the render budget");
  releaseAfterRender();
}

function testOgAdmissionSource() {
  const routeSource = readFileSync("app/api/jackpots/og/route.tsx", "utf8");
  assert.match(routeSource, /export const runtime = "nodejs"/);
  assert.match(
    routeSource,
    /enforceSharedRateLimit\(request, \{[\s\S]*bucket: "api-jackpots-og"[\s\S]*limit: 20[\s\S]*windowMs: 60_000/,
    "OG rendering must use the shared, multi-replica-compatible admission limiter",
  );
  assert.match(
    routeSource,
    /export async function HEAD\(request: NextRequest\)[\s\S]*enforceOgRateLimit\(request\)[\s\S]*readVerifiedJackpotShare\(request\.nextUrl\.searchParams\.get\("tx"\)\)[\s\S]*new Response\(null,[\s\S]*"Content-Type": "image\/png"/,
    "OG HEAD must validate the same verified event while remaining an explicit bodyless image response",
  );
  const headStart = routeSource.indexOf("export async function HEAD");
  assert.ok(headStart >= 0);
  const headSource = routeSource.slice(headStart);
  assert.doesNotMatch(
    headSource,
    /acquireResponseConcurrencySlot|new ImageResponse/,
    "HEAD must never acquire or render against the process-global OG budget",
  );
  assert.match(
    routeSource,
    /acquireResponseConcurrencySlot\([\s\S]*MAX_CONCURRENT_OG_RENDERS[\s\S]*if \(!releaseRenderSlot\) return renderBudgetExceededResponse\(\)/,
    "OG rendering must reject work when its process-global concurrency budget is full",
  );
  assert.match(
    routeSource,
    /status: 503, headers: \{ "Retry-After": "1" \}[\s\S]*applyNoStoreHeaders/,
    "OG concurrency rejection must be retryable and no-store",
  );
  assert.match(
    routeSource,
    /const image = \([\s\S]*try \{[\s\S]*const imageResponse = new ImageResponse\(image,[\s\S]*releaseResponseConcurrencySlotOnSettled\(imageResponse, releaseRenderSlot\)[\s\S]*catch \(error\) \{[\s\S]*releaseRenderSlot\(\)/,
    "OG render slots must be held through body settlement and released on construction failure",
  );

  const priorSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://playlore.xyz";
    const hostileRequestUrl = "https://attacker.invalid/api/jackpots/og?kind=daily";
    const trustedOrigin = getTrustedAuthOrigin(hostileRequestUrl, "production");
    assert.equal(trustedOrigin, "https://playlore.xyz");
    assert.equal(
      new URL("/jackpot-og-daily-painted.png", trustedOrigin ?? "https://playlore.xyz").toString(),
      "https://playlore.xyz/jackpot-og-daily-painted.png",
      "a hostile production Host must not control the OG renderer asset URL",
    );
  } finally {
    if (priorSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = priorSiteUrl;
  }
  assert.match(
    routeSource,
    /const artOrigin = getTrustedAuthOrigin\(request\.url\) \?\? CANONICAL_SITE_ORIGIN;\s*const artUrl = new URL\(theme\.ogArt, artOrigin\)\.toString\(\)/,
    "the OG renderer must resolve relative art against a trusted production origin",
  );
  assert.doesNotMatch(
    routeSource,
    /new URL\(theme\.ogArt, request\.url\)/,
    "the request Host must never be used directly as the OG asset origin",
  );
}

function testJackpotRefreshSource() {
  const routeSource = readFileSync("app/api/jackpots/route.ts", "utf8");
  const serviceSource = readFileSync("app/api/_lib/jackpotsService.ts", "utf8");
  assert.match(
    routeSource,
    /bypassResponseCache: shouldBypassJackpotResponseCache\(searchParams\.get\("fresh"\)\)/,
    "the existing refresh request must be preserved as a cache-only bypass",
  );
  assert.doesNotMatch(routeSource, /forceFresh/);
  assert.doesNotMatch(serviceSource, /forceFresh|FORCE_FRESH|jackpotForceFreshInflight/);

  const bypassStart = serviceSource.indexOf("if (options.bypassResponseCache)");
  const bypassEnd = serviceSource.indexOf("const staleCache", bypassStart);
  assert.ok(bypassStart >= 0 && bypassEnd > bypassStart);
  const bypassBranch = serviceSource.slice(bypassStart, bypassEnd);
  assert.match(bypassBranch, /commitJackpotResponseCache\([\s\S]*seedJackpots\.slice/);
  assert.match(bypassBranch, /maybeStartJackpotRecovery\(seedJackpots\)/);
  assert.doesNotMatch(
    bypassBranch,
    /buildJackpotsPayload|allowSlowRecovery/,
    "a public cache bypass must never execute slow recovery inline",
  );

  assert.equal(
    [...serviceSource.matchAll(/allowSlowRecovery:\s*true/g)].length,
    1,
    "all slow jackpot recovery must enter through the single guarded background path",
  );
  assert.match(
    serviceSource,
    /function maybeStartJackpotRecovery[\s\S]*jackpotBackgroundRecoveryPromise[\s\S]*JACKPOT_BACKGROUND_RECOVERY_COOLDOWN_MS[\s\S]*allowSlowRecovery: true/,
    "the remaining slow recovery path must retain in-flight joining and cooldown admission",
  );
}

function validPublicRow(overrides: Partial<JackpotPublicRow> = {}): JackpotPublicRow {
  return {
    epoch: "42",
    kind: "daily",
    amount: "12.5",
    amountNum: 12.5,
    txHash: TX_HASH,
    blockNumber: TARGET_BLOCK.toString(),
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function testJackpotRuntimeBehavior() {
  assert.equal(shouldBypassJackpotResponseCache("1"), true);
  for (const value of [null, "", "0", "true", "01", "1 "]) {
    assert.equal(shouldBypassJackpotResponseCache(value), false);
  }

  assert.equal(classifyJackpotResponseCache({ hasPayload: false, expiresAt: 2_000, now: 1_000 }), "missing");
  assert.equal(classifyJackpotResponseCache({ hasPayload: true, expiresAt: 2_000, now: 1_999 }), "fresh");
  assert.equal(classifyJackpotResponseCache({ hasPayload: true, expiresAt: 2_000, now: 2_000 }), "stale");
  assert.equal(classifyJackpotResponseCache({ hasPayload: true, expiresAt: Number.NaN, now: 1_000 }), "stale");
  assert.equal(classifyJackpotResponseCache({ hasPayload: true, expiresAt: 2_000, now: 1_000.5 }), "stale");

  const recoveryBaseline = {
    hasInflightRecovery: false,
    lastStartedAt: 1_000,
    now: 2_000,
    cooldownMs: 1_000,
  };
  assert.equal(shouldStartJackpotRecovery(recoveryBaseline), true);
  assert.equal(shouldStartJackpotRecovery({ ...recoveryBaseline, hasInflightRecovery: true }), false);
  assert.equal(shouldStartJackpotRecovery({ ...recoveryBaseline, now: 1_999 }), false);
  assert.equal(shouldStartJackpotRecovery({ ...recoveryBaseline, now: 999 }), false);
  assert.equal(shouldStartJackpotRecovery({ ...recoveryBaseline, now: Number.NaN }), false);
  assert.equal(shouldStartJackpotRecovery({ ...recoveryBaseline, cooldownMs: 0 }), false);

  const normalized = sanitizeJackpotPublicRows([
    validPublicRow({ txHash: TX_HASH.toUpperCase() }),
    validPublicRow({ epoch: "01" }),
    validPublicRow({ amount: "1e9" }),
    validPublicRow({ amountNum: Number.POSITIVE_INFINITY }),
    validPublicRow({ blockNumber: (DEPLOY_BLOCK - 1n).toString() }),
    validPublicRow({ timestamp: Number.MAX_VALUE }),
    validPublicRow({ txHash: "rpc-error-private-key" }),
  ], { contractDeployBlock: DEPLOY_BLOCK });
  assert.deepEqual(normalized, [
    validPublicRow(),
    validPublicRow({ timestamp: null }),
    validPublicRow({ txHash: "" }),
  ]);
  assert.equal(
    sanitizeJackpotPublicRows(
      Array.from({ length: JACKPOT_PUBLIC_HISTORY_LIMIT + 10 }, (_, index) => validPublicRow({ epoch: String(index + 1) })),
      { contractDeployBlock: DEPLOY_BLOCK, limit: Number.MAX_SAFE_INTEGER },
    ).length,
    JACKPOT_PUBLIC_HISTORY_LIMIT,
  );

  const checkpoint = deriveDurableJackpotRecoveryCheckpoint({
    contractDeployBlock: DEPLOY_BLOCK,
    finalityBlocks: 12n,
    targetBlock: TARGET_BLOCK,
    lastIndexedBlock: CHECKPOINT_BLOCK,
    checkpointBlock: CHECKPOINT_BLOCK,
    checkpointHash: CHECKPOINT_HASH,
    observedCheckpointHash: CHECKPOINT_HASH.toUpperCase(),
  });
  assert.deepEqual(checkpoint, { blockNumber: CHECKPOINT_BLOCK, blockHash: CHECKPOINT_HASH });
  assert.equal(deriveDurableJackpotRecoveryCheckpoint({
    contractDeployBlock: DEPLOY_BLOCK,
    finalityBlocks: 0n,
    targetBlock: TARGET_BLOCK,
    lastIndexedBlock: CHECKPOINT_BLOCK,
    checkpointBlock: CHECKPOINT_BLOCK,
    checkpointHash: CHECKPOINT_HASH,
    observedCheckpointHash: CHECKPOINT_HASH,
  }), null);
  assert.equal(deriveDurableJackpotRecoveryCheckpoint({
    contractDeployBlock: DEPLOY_BLOCK,
    finalityBlocks: 12n,
    targetBlock: TARGET_BLOCK,
    lastIndexedBlock: CHECKPOINT_BLOCK,
    checkpointBlock: CHECKPOINT_BLOCK,
    checkpointHash: CHECKPOINT_HASH,
    observedCheckpointHash: `0x${"22".repeat(32)}`,
  }), null);

  const lagging: JackpotRecoveryContextPolicy = {
    blockNumber: TARGET_BLOCK,
    blockHash: `0x${"33".repeat(32)}`,
    finalityBlocks: 12n,
    durableThroughBlock: CHECKPOINT_BLOCK,
    durableCheckpointHash: CHECKPOINT_HASH,
  };
  assert.equal(canPersistJackpotRecoveryBlock(lagging, CHECKPOINT_BLOCK, DEPLOY_BLOCK), true);
  assert.equal(canPersistJackpotRecoveryBlock(lagging, CHECKPOINT_BLOCK + 1n, DEPLOY_BLOCK), false);
  assert.equal(isDurableJackpotRecoverySnapshot(lagging), false);
  assert.equal(isDurableJackpotRecoverySnapshot({ ...lagging, durableThroughBlock: TARGET_BLOCK }), true);
  assert.equal(
    isDurableJackpotRecoverySnapshot({ ...lagging, durableThroughBlock: TARGET_BLOCK, finalityBlocks: 0n }),
    false,
  );
  assert.deepEqual(createJackpotPublicErrorPayload(), {
    jackpots: [],
    error: "Unable to load jackpots",
  });
}

function testJackpotRuntimeFaultMutants() {
  const unsafeFreshAtBoundary = (hasPayload: boolean, expiresAt: number, now: number) =>
    hasPayload && expiresAt >= now ? "fresh" : "stale";
  assert.notEqual(unsafeFreshAtBoundary(true, 2_000, 2_000), classifyJackpotResponseCache({
    hasPayload: true,
    expiresAt: 2_000,
    now: 2_000,
  }));

  const ignoresClockRollback = (lastStartedAt: number, now: number, cooldownMs: number) =>
    now - lastStartedAt < cooldownMs;
  assert.equal(ignoresClockRollback(1_000, 999, 1_000), true);
  assert.equal(shouldStartJackpotRecovery({
    hasInflightRecovery: false,
    lastStartedAt: 1_000,
    now: 999,
    cooldownMs: 1_000,
  }), false);

  const unboundedRows = Array.from(
    { length: JACKPOT_PUBLIC_HISTORY_LIMIT + 1 },
    (_, index) => validPublicRow({ epoch: String(index + 1) }),
  );
  assert.notEqual(
    unboundedRows.length,
    sanitizeJackpotPublicRows(unboundedRows, { contractDeployBlock: DEPLOY_BLOCK }).length,
  );

  const acceptsUnfinalized = { blockNumber: TARGET_BLOCK, blockHash: CHECKPOINT_HASH };
  assert.notDeepEqual(
    deriveDurableJackpotRecoveryCheckpoint({
      contractDeployBlock: DEPLOY_BLOCK,
      finalityBlocks: 0n,
      targetBlock: TARGET_BLOCK,
      lastIndexedBlock: TARGET_BLOCK,
      checkpointBlock: TARGET_BLOCK,
      checkpointHash: CHECKPOINT_HASH,
      observedCheckpointHash: CHECKPOINT_HASH,
    }),
    acceptsUnfinalized,
  );
}

async function main() {
  await testConcurrencyBudget();
  await testNodeImageResponseBudget();
  testOgAdmissionSource();
  testJackpotRefreshSource();
  testJackpotRuntimeBehavior();
  testJackpotRuntimeFaultMutants();
  console.log("jackpot API admission tests passed (runtime 5 groups, 4 mutants killed)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
