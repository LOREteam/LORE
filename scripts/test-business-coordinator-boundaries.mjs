import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const filesystemPath = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(filesystemPath, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [filesystemPath.replaceAll("\\", "/")] : [];
  });
}

export async function runBusinessCoordinatorBoundaryTests() {
  const restoreProofValidationSource = readFileSync("scripts/verify-db-restore.mjs", "utf8");
  assert.ok(
    restoreProofValidationSource.includes('import { hasKnownLaunchSqliteRows, readCanonicalSqliteCount } from "./sqlite-scope-audit-lib.mjs";') &&
      restoreProofValidationSource.includes("counts[table] = readCanonicalSqliteCount(db, table);") &&
      [
        "scoped_global_stats_aggregate",
        "scoped_global_stats_dirty",
        "scoped_leaderboard_read_model",
        "scoped_leaderboard_dirty",
      ].every((table) => restoreProofValidationSource.includes(`"${table}"`)) &&
      [...restoreProofValidationSource.matchAll(/!hasKnownLaunchSqliteRows\(/g)].length === 2 &&
      !/Number\(row\?\.count \?\? 0\)|function knownLaunchRowTotal/.test(restoreProofValidationSource),
    "restore proof must bind canonical SQLite counts and known-row admission to the shared executable policy",
  );

  const gasShadowBootstrapResolveRouteSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
  const gasShadowLiveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
  assert.match(
    gasShadowBootstrapResolveRouteSource,
    /const gasEstimate = await publicClient\.estimateContractGas\(\{[\s\S]*functionName: "resolveEpoch"[\s\S]*await recordLineaEstimateGasShadow\(\{[\s\S]*tag: "bootstrap-resolve"[\s\S]*const estimatedFeeOverrides = getKeeperFeeOverrides\([\s\S]*const gas = \([\s\S]*gasEstimate \* RESOLVE_GAS_BUFFER_PERCENT[\s\S]*assertKeeperFeeBudget\([\s\S]*"keeper"/,
    "bootstrap keeper resolve shadow must run after baseline estimation and before fixed fee-budget validation without replacing gasEstimate",
  );
  assert.match(
    gasShadowLiveRoundCanarySource,
    /const gasEstimate = await publicClient\.estimateContractGas\(\{[\s\S]*functionName: "resolveEpoch"[\s\S]*await recordLineaEstimateGasShadow\(\{[\s\S]*tag: "live-canary-resolve"[\s\S]*let gas = gasEstimate > RESOLVE_GAS_FLOOR \? gasEstimate : RESOLVE_GAS_FLOOR/,
    "live canary resolver shadow must not replace the resolver gas floor or execution gas limit",
  );
  assert.match(
    gasShadowLiveRoundCanarySource,
    /const estimate = await estimateGasWithMethodRetry\(\(\) => publicClient\.estimateContractGas\(\{[\s\S]*gas = estimate\.value;[\s\S]*await recordLineaEstimateGasShadow\(\{[\s\S]*baselineGas: gas,[\s\S]*tag: `live-canary-bet-\$\{mode\}`,[\s\S]*const gasEstimatedAt = Date\.now\(\)/,
    "live canary bet shadow must run after baseline bet estimation and before fee clamping without replacing gas",
  );

  const prodHealthMalformedDiagnosticsSecret = spawnSync(
    process.execPath,
    ["scripts/check-production-health.mjs", "--summary-only"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROD_HEALTH_BASE_URL: "https://playlore.xyz",
        SMOKE_BASE_URL: "",
        NEXT_PUBLIC_SITE_URL: "",
        HEALTH_DIAGNOSTICS_SECRET: "short",
        PROD_HEALTH_MAX_LAG_BLOCKS: "",
        PROD_HEALTH_MAX_INDEXER_STALE_MS: "",
        NEXT_PUBLIC_LINEA_CHAIN_ID: "",
        LINEA_CHAIN_ID: "",
      },
      encoding: "utf8",
    },
  );
  assert.equal(
    prodHealthMalformedDiagnosticsSecret.status,
    1,
    prodHealthMalformedDiagnosticsSecret.stderr || prodHealthMalformedDiagnosticsSecret.stdout,
  );
  const prodHealthMalformedDiagnosticsSecretSummary = JSON.parse(prodHealthMalformedDiagnosticsSecret.stdout);
  assert.equal(prodHealthMalformedDiagnosticsSecretSummary.status, "fail");
  assert.match(
    prodHealthMalformedDiagnosticsSecretSummary.firstIssue,
    /HEALTH_DIAGNOSTICS_SECRET must be 32\.\.256 non-control characters/,
    "production health checker must report malformed diagnostics secret before endpoint polling",
  );
  assert.doesNotMatch(
    prodHealthMalformedDiagnosticsSecret.stdout,
    /short|https?:\/\/|playlore\.xyz/i,
    "production health checker must not print malformed diagnostics secret text or endpoint details in summary failures",
  );
  const prodHealthSelfTest = spawnSync(process.execPath, ["scripts/check-production-health.mjs", "--self-test", "--summary-only"], {
    cwd: process.cwd(),
    env: { ...process.env, PROD_HEALTH_BASE_URL: "", SMOKE_BASE_URL: "", NEXT_PUBLIC_SITE_URL: "", HEALTH_DIAGNOSTICS_SECRET: "" },
    encoding: "utf8",
  });
  assert.equal(prodHealthSelfTest.status, 0, prodHealthSelfTest.stderr || prodHealthSelfTest.stdout);
  assert.deepEqual(
    JSON.parse(prodHealthSelfTest.stdout),
    { status: "pass", payloadIntegerParser: true },
    "production health checker self-test must prove malformed payload counters fail closed without endpoint polling",
  );

  const behaviorallyCoveredBodyRoutes = new Set([
    "app/api/admin/auth/route.ts",
    "app/api/admin/ops/route.ts",
    "app/api/admin/processes/route.ts",
    "app/api/chat/auth/route.ts",
    "app/api/chat/messages/route.ts",
    "app/api/chat/profile/route.ts",
    "app/api/rewards/route.ts",
  ]);
  const jsonBodyFetchIssues = [];
  for (const sourcePath of listSourceFiles("app", /\.(?:ts|tsx)$/)) {
    const source = readFileSync(sourcePath, "utf8");
    for (const fetchMatch of source.matchAll(/\b(?:fetch|fetchWithTimeout)\s*\(/g)) {
      const snippet = source.slice(fetchMatch.index, fetchMatch.index + 1200);
      const methodMatch = snippet.match(/\bmethod:\s*["'](?:POST|PUT|PATCH)["']/);
      const bodyMatch = snippet.match(/\bbody:\s*JSON\.stringify\s*\(/);
      if (!methodMatch || !bodyMatch || methodMatch.index > bodyMatch.index) continue;
      const methodToBody = snippet.slice(methodMatch.index, bodyMatch.index);
      if (/\}\s*\)\s*;/.test(methodToBody)) continue;
      const beforeBody = snippet.slice(0, bodyMatch.index);
      if (!/headers:\s*\{[\s\S]{0,400}["']Content-Type["']\s*:\s*["']application\/json["']/.test(beforeBody)) {
        jsonBodyFetchIssues.push(sourcePath);
      }
    }
  }
  assert.deepEqual([...new Set(jsonBodyFetchIssues)], [], "app JSON body fetches must send an explicit application/json Content-Type");
  for (const routePath of listSourceFiles("app/api", /^route\.(?:ts|tsx)$/)
    .filter((routePath) => !behaviorallyCoveredBodyRoutes.has(routePath))) {
    const routeSource = readFileSync(routePath, "utf8");
    assert.doesNotMatch(routeSource, /\brequest\.(?:json|text|arrayBuffer|formData)\s*\(/, `${routePath} must not read request bodies directly; use a bounded parser or explicit no-body rejection`);
    assert.doesNotMatch(routeSource, /\breturn\s+(?:rateLimited|[A-Za-z_$][\w$]*RateLimited)\s*;/, `${routePath} rate-limit responses must pass through the route no-store helper`);
    if (!/(?:NextResponse|Response)\.json\(/.test(routeSource)) continue;
    assert.match(routeSource, /applyNoStoreHeaders|Cache-Control[\s\S]*no-store|no-store[\s\S]*Cache-Control/, `${routePath} JSON responses must set no-store cache headers`);
    if (/\b(?:read|issue|clear)(?:Admin|Chat)Session\b/.test(routeSource)) {
      assert.match(routeSource, /varyCookie:\s*true/, `${routePath} session responses must vary on Cookie`);
    }
  }

  const chainIndexerAuditSource = readFileSync("scripts/audit-chain-indexer-window.mjs", "utf8");
  assert.deepEqual(
    {
      endEpochParser: [...chainIndexerAuditSource.matchAll(/parseChainAuditBoundedInteger\("--end-epoch"/g)].length,
      blockPlanner: [...chainIndexerAuditSource.matchAll(/planChainAuditBlockChunks\(fromBlock, toBlock\)/g)].length,
      eventIdentity: [...chainIndexerAuditSource.matchAll(/buildChainAuditEventId\(log\)/g)].length,
      betIdentity: [...chainIndexerAuditSource.matchAll(/buildChainAuditBetEventKey\(epoch, log\)/g)].length,
      dbFileBoundary: [...chainIndexerAuditSource.matchAll(/assertChainAuditDbFile\(dbPath\)/g)].length,
      epochWindow: [...chainIndexerAuditSource.matchAll(/selectChainAuditResolvedEpochRows\(\{/g)].length,
      accountingSnapshot: [...chainIndexerAuditSource.matchAll(/readChainAuditAccountingSnapshot\(\{/g)].length,
      metadataIds: [...chainIndexerAuditSource.matchAll(/readChainAuditStoredEventIds\(\{/g)].length,
      dustPolicy: [...chainIndexerAuditSource.matchAll(/isChainAuditDustSettlementEvent\(decoded\.eventName\)/g)].length,
      staleMetadata: [...chainIndexerAuditSource.matchAll(/appendMissingChainAuditMetadataRows\(\{/g)].length,
      atomicPublication: [...chainIndexerAuditSource.matchAll(/publishChainAuditSummary\(\{/g)].length,
      localReimplementations: [...chainIndexerAuditSource.matchAll(/function (?:parseBoundedInteger|parseDbInteger|parseDbTileId|parseChainTileId|parseChainEpoch|toSqlBlockNumber|eventId|betEventKey)\(/g)].length,
    },
    { endEpochParser: 1, blockPlanner: 1, eventIdentity: 1, betIdentity: 1, dbFileBoundary: 1, epochWindow: 1, accountingSnapshot: 1, metadataIds: 1, dustPolicy: 1, staleMetadata: 1, atomicPublication: 1, localReimplementations: 0 },
    "chain/indexer audit must bind every tested parser, identity, DB, accounting, metadata, dust, and publication boundary exactly once",
  );

  const browserAutomationSource = readFileSync("docs/browser_automation.md", "utf8");
  assert.match(browserAutomationSource, /Never use `npm run dev` for browser-only work[\s\S]*npm run dev:ui -- -p <port>/, "browser runbook must prevent composite dev runner from starting operator workers");
  assert.match(browserAutomationSource, /local production browser baselines[\s\S]*fail closed without trusted proxy identity[\s\S]*ALLOW_WEAK_RATE_LIMIT_IDENTITY=1[\s\S]*only for localhost baseline\/smoke measurement[\s\S]*Do not commit this as a production default/, "browser runbook must document the local-only weak-identity baseline precondition without weakening production defaults");
}
