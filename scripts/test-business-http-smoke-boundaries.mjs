import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runHttpSmokeBoundaryTests() {
  const smokeHttpSource = readFileSync("scripts/smoke-http.mjs", "utf8");
  assert.match(
    smokeHttpSource,
    /LORE - Linea Mining Game/,
    "HTTP smoke must verify the LORE page title to catch wrong local sites on the same port",
  );
  assert.match(
    smokeHttpSource,
    /privacy-page[\s\S]*Wallet-first sign-in[\s\S]*Third-party services[\s\S]*We do not ask for your email/,
    "HTTP smoke must verify the privacy page and reject stale email-login disclosure",
  );
  assert.match(
    smokeHttpSource,
    /robots[\s\S]*\/robots\.txt[\s\S]*Sitemap:[\s\S]*sitemap[\s\S]*\/sitemap\.xml[\s\S]*\/jackpot-win[\s\S]*\/privacy[\s\S]*\/terms/,
    "HTTP smoke must verify robots.txt and sitemap.xml stay consistent",
  );
  assert.match(
    smokeHttpSource,
    /MAX_SMOKE_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*async function readBoundedResponseText[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "HTTP smoke must strictly parse Content-Length and bound response bodies before assertions",
  );
  assert.match(
    smokeHttpSource,
    /function parseOptionalPositiveIntegerText\(name, value\)[\s\S]*canonical positive decimal integer[\s\S]*EXPECTED_PUBLIC_CHAIN_ID = parseOptionalPositiveIntegerText\("NEXT_PUBLIC_LINEA_CHAIN_ID"[\s\S]*EXPECTED_SERVER_CHAIN_ID = parseOptionalPositiveIntegerText\("LINEA_CHAIN_ID"[\s\S]*LINEA_CHAIN_ID and NEXT_PUBLIC_LINEA_CHAIN_ID must match[\s\S]*health-runtime public config chain id must match configured Linea chain id/,
    "HTTP smoke must canonical-parse configured chain ids and compare health-runtime publicConfig.chainId",
  );
  assert.match(
    smokeHttpSource,
    /function assertNonNegativeSafeIntegerOrNull\(value, label\)[\s\S]*non-negative safe integer or null[\s\S]*assertNonNegativeSafeIntegerOrNull\(json\.contract\.currentEpoch, "health-sync contract\.currentEpoch"\)[\s\S]*assertNonNegativeSafeIntegerOrNull\(json\.storage\.lagBlocks, "health-sync storage\.lagBlocks"\)[\s\S]*assertNonNegativeSafeIntegerOrNull\(\s*json\.storage\.lagToFinalityTargetBlocks,\s*"health-sync storage\.lagToFinalityTargetBlocks"/,
    "HTTP smoke health-sync counters must be non-negative safe integers or null",
  );
  assert.match(
    smokeHttpSource,
    /function assertNonNegativeSafeInteger\(value, label\)[\s\S]*function assertPositiveSafeInteger\(value, label\)[\s\S]*function assertTileId\(value, label\)[\s\S]*assertNonNegativeSafeInteger\(json\.fetchedAt, "live-state fetchedAt"\)[\s\S]*assertNonNegativeSafeInteger\(value, `live-state tileUserCounts\[\$\{index\}\]`\)[\s\S]*assertNonNegativeSafeInteger\(json\.ts, "health-runtime timestamp"\)[\s\S]*assertPositiveSafeInteger\(row\.rank, `\$\{boardName\} entry rank`\)[\s\S]*assertTileId\(row\.tileId, "luckyTile tileId"\)[\s\S]*assertNonNegativeSafeInteger\(row\.wins, "luckyTile wins"\)[\s\S]*assertTileId\(row\.tileId, `recent win \$\{row\.epoch\} tileId`\)/,
    "HTTP smoke must require safe integer timestamp, rank, count, and tile evidence",
  );
  assert.match(
    smokeHttpSource,
    /const uniqueTileCount = new Set\(row\.tileIds\)\.size[\s\S]*row\.tileIds\.forEach\(\(tileId\) => \{[\s\S]*assertTileId\(tileId, `deposit row \$\{row\.epoch\} tileId`\)[\s\S]*assertTileId\(reward\.winningTile, `reward \$\{epoch\} winningTile`\)/,
    "HTTP smoke must require deposit and reward tile evidence to be valid tile ids",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /Number\.isInteger\(json\.publicConfig\.chainId\)/,
    "HTTP smoke must not accept unsafe or non-positive health-runtime chain ids",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /Number\.isFinite\(json\.ts\)|assertFiniteNumber\(json\.fetchedAt|Number\.isInteger\(row\.(?:rank|tileId|wins)\)|Number\.isInteger\(value\) \|\| value < 0|Number\.isInteger\(reward\.winningTile\)/,
    "HTTP smoke must not broadly accept unsafe integer evidence",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /health-sync storage\.(?:lagBlocks|lagToFinalityTargetBlocks)[\s\S]{0,220}Number\.isFinite/,
    "HTTP smoke must not accept fractional health-sync lag evidence",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "HTTP smoke must not broadly coerce response Content-Length",
  );
  assert.match(
    smokeHttpSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeSmokeError\(error\)[\s\S]*redactProofText\(/,
    "HTTP smoke terminal errors must use the shared proof redactor",
  );
  assert.match(
    smokeHttpSource,
    /MAX_SMOKE_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeSmokeError\(error\)\)/,
    "HTTP smoke terminal errors must be compact and bounded",
  );
  assert.doesNotMatch(
    smokeHttpSource,
    /response\.text\(\)/,
    "HTTP smoke must not read unbounded response text",
  );

  const httpLoadSource = readFileSync("scripts/load-http.mjs", "utf8");
  assert.match(
    httpLoadSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeLoadError\(error\)[\s\S]*redactProofText\(/,
    "HTTP load terminal errors must use the shared proof redactor",
  );
  assert.match(
    httpLoadSource,
    /MAX_LOAD_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeLoadError\(error\)\)/,
    "HTTP load terminal errors must be compact and bounded",
  );
  assert.doesNotMatch(
    `${smokeHttpSource}\n${httpLoadSource}`,
    /console\.error\(error\)/,
    "HTTP smoke/load scripts must not print raw Error objects",
  );

  const smokeBrowserCoreSource = readFileSync("scripts/smoke-browser-lib/core.mjs", "utf8");
  assert.match(
    smokeBrowserCoreSource,
    /MAX_WARMUP_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function readBoundedWarmupText[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*function parseContentLengthHeader\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "browser smoke warmup must strictly parse and bound response bodies",
  );
  assert.doesNotMatch(
    smokeBrowserCoreSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "browser smoke warmup must not broadly coerce response Content-Length",
  );
  assert.doesNotMatch(
    smokeBrowserCoreSource,
    /response\.text\(\)/,
    "browser smoke warmup must not read unbounded response text",
  );
}
