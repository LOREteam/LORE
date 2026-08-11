import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";
import * as analyticsDepositsStatusModule from "../app/lib/analyticsDepositsStatus.ts";
import * as liveStateSnapshotModule from "../app/hooks/useGameLiveStateSnapshot.ts";
import * as gameConstantsModule from "../app/lib/constants.ts";
import * as sqliteScopeAuditModule from "./sqlite-scope-audit-lib.mjs";
import * as chatAuthModule from "../app/lib/chatAuth.ts";
import * as chatSessionModule from "../app/api/_lib/chatSession.ts";

const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;
const analyticsDepositsStatus = analyticsDepositsStatusModule.default ?? analyticsDepositsStatusModule;
const liveStateSnapshot = liveStateSnapshotModule.default ?? liveStateSnapshotModule;
const gameConstants = gameConstantsModule.default ?? gameConstantsModule;
const chatAuth = chatAuthModule.default ?? chatAuthModule;
const chatSession = chatSessionModule.default ?? chatSessionModule;
const packageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;

function withTemporaryEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function runReleaseOperationsTests() {
  const liveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
  const keeperBotSource = readFileSync("bot.ts", "utf8");
  const botSupervisorSource = readFileSync("scripts/run-bot-forever.mjs", "utf8");
  const soakSupervisorSource = readFileSync("scripts/run-testnet-soak-supervisor.mjs", "utf8");
    const clearPendingNonceSource = readFileSync("scripts/clear-live-test-pending-nonce.ts", "utf8");
    const prelaunchStatusSource = readFileSync("scripts/report-prelaunch-status.mjs", "utf8");
    const chatSessionSource = readFileSync("app/api/_lib/chatSession.ts", "utf8");
  const cleanupNextCandidatesSource = readFileSync("scripts/cleanup-next-candidates.mjs", "utf8");
  const collectIndexerEvidenceSource = readFileSync("scripts/collect-indexer-evidence.mjs", "utf8");
  const createIndexerDraftSource = readFileSync("scripts/create-indexer-proof-draft.mjs", "utf8");
    const checkIndexerDryRunSource = readFileSync("scripts/check-indexer-dry-run.mjs", "utf8");
    const chainIndexerAuditSource = readFileSync("scripts/audit-chain-indexer-window.mjs", "utf8");
    const sqliteScopeAuditSource = readFileSync("scripts/sqlite-scope-audit-lib.mjs", "utf8");
  const sqliteScopeAudit = sqliteScopeAuditModule.default ?? sqliteScopeAuditModule;
  assert.equal(sqliteScopeAudit.normalizeSqliteCount(3), 3);
  assert.equal(sqliteScopeAudit.normalizeSqliteCount(3n), 3);
  assert.equal(sqliteScopeAudit.normalizeSqliteCount("3"), 3);
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(-1));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(1.5));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount("1e3"));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount("01"));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
  for (const [label, source] of [
    ["collect-indexer-evidence", collectIndexerEvidenceSource],
    ["create-indexer-proof-draft", createIndexerDraftSource],
  ]) {
    assert.match(
      source,
      /const requestedEpochs = parseInteger\(epochs\)[\s\S]*requestedEpochs !== null && requestedEpochs > 0[\s\S]*uniqueCheckedEpochs\.length >= requestedEpochs/,
      `${label} must reuse canonical parsed --epochs for chain-snapshot coverage checks`,
    );
    assert.doesNotMatch(
      source,
      /Number\(epochs\)/,
      `${label} must not broadly coerce --epochs after validation`,
    );
  }
  assert.match(
    collectIndexerEvidenceSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*requestedEpochs,/,
    "indexer evidence collector must publish the same canonical parsed epoch count it validates",
  );
  assert.match(
    liveRoundCanarySource,
    /APP_NETWORK !== "sepolia" \|\| APP_CHAIN\.id !== 59141/,
    "live canary must fail closed outside Linea Sepolia before transaction-capable setup",
  );
  assert.match(
    liveRoundCanarySource,
    /function assertOptionalEnvFile\(path: string, description: string\)[\s\S]*existsSync\(path\) && !statSync\(path\)\.isFile\(\)[\s\S]*function loadSigningEnvFileIfPresent\(\)[\s\S]*assertOptionalEnvFile\(LIVE_WALLET_ENV_PATH[\s\S]*loadDotenv\(\{ path: LIVE_WALLET_ENV_PATH, override: false, quiet: true \}\)[\s\S]*function loadWallets\(\)[\s\S]*loadSigningEnvFileIfPresent\(\)/,
    "live canary must reject a non-file secret wallet env path before deferred dotenv loading",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /console\.error\("\[live-canary\] failed", error\)/,
    "live canary fatal handler must not print raw errors",
  );
  assert.match(
    liveRoundCanarySource,
    /MAX_HEALTH_SAMPLE_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function readBoundedHealthJson[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "live canary health sampling must strictly parse and bound health response bodies before JSON parsing",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "live canary health sampling must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /response\.json\(\)|runtimeResponse\.json\(\)|dataSyncResponse\.json\(\)/,
    "live canary health sampling must not use unbounded response.json",
  );
  assert.match(
    keeperBotSource,
    /function describeKeeperError[\s\S]*sanitizeSentryPayload[\s\S]*console\.error\("\[keeper\] Fatal startup error:", describeKeeperError\(err\)\)/,
    "keeper logs must sanitize provider and alert transport errors before output",
  );
  assert.match(
    keeperBotSource,
    /MAX_ALERT_RESPONSE_BYTES\s*=\s*64\s*\*\s*1024[\s\S]*ALERT_CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*async function readBoundedAlertResponseText\(response: Response\)[\s\S]*parseAlertContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*reader\.cancel[\s\S]*function parseAlertContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "keeper Telegram alert failures must bound response body reads before logging transport errors",
  );
  assert.doesNotMatch(
    keeperBotSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "keeper Telegram alert failures must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    keeperBotSource,
    /res\.text\(\)/,
    "keeper Telegram alert failures must not use unbounded response.text",
  );
  assert.match(
    botSupervisorSource,
    /function describeSupervisorError[\s\S]*SECRET_PATTERNS[\s\S]*failed to send alert: \$\{describeSupervisorError\(err\)\}/,
    "bot supervisor alert errors must be redacted before terminal output",
  );
  assert.match(
    botSupervisorSource,
    /process error: \$\{describeSupervisorError\(error\)\}/,
    "bot supervisor process errors must be redacted before terminal output",
  );
  assert.match(
    soakSupervisorSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeSupervisorError\(error\)[\s\S]*redactProofText\(/,
    "testnet soak supervisor terminal errors must use the shared proof redactor",
  );
  assert.match(
    soakSupervisorSource,
    /status failed: \$\{describeSupervisorError\(error\)\}[\s\S]*stop failed: \$\{describeSupervisorError\(error\)\}[\s\S]*const message = describeSupervisorError\(error\)/,
    "testnet soak supervisor status, stop, and fatal errors must be compact and redacted",
  );
  assert.match(
    clearPendingNonceSource,
    /sanitizeSupportLogPayload\(\{ message \}\)/,
    "pending nonce recovery must sanitize fatal error text",
  );
  assert.match(
    clearPendingNonceSource,
    /PUBLIC_ADDRESS_ENV_NAME_RE[\s\S]*function loadPublicAddressEnvFileIfPresent\(\)[\s\S]*processEnv: isolatedEnv[\s\S]*!PUBLIC_ADDRESS_ENV_NAME_RE\.test\(name\)[\s\S]*function loadSigningEnvFileIfPresent\(\)[\s\S]*loadDotenv\(\{ path: LIVE_WALLET_ENV_PATH, override: false, quiet: true \}\)/,
    "pending nonce recovery must isolate and allowlist public addresses before any optional signing env load",
  );
  assert.match(
    clearPendingNonceSource,
    /Missing LORE_LIVE_TEST_\$\{ROLE\}_ADDRESS in \$\{PUBLIC_ADDRESS_ENV_PATH\}/,
    "pending nonce recovery dry-run must point missing-address operators at the public address env file",
  );
  assert.match(
    clearPendingNonceSource,
    /EXECUTION_CONFIRMATION = "--confirm-lowest-pending-nonce-replacement"[\s\S]*EXECUTE && !EXECUTION_CONFIRMED/,
    "pending nonce recovery must require a separate explicit confirmation before loading a signing account",
  );
  assert.match(
    clearPendingNonceSource,
    /const publicAddressEnv = loadPublicAddressEnvFileIfPresent\(\)[\s\S]*const signingMaterialLoaded = hasSigningMaterialInEnvironment\(\)[\s\S]*const address = getDryRunAddress\(publicAddressEnv\)[\s\S]*readNonceState\(publicClient, address\)[\s\S]*if \(state\.gap === 0\) return;[\s\S]*const account = getAccount\(\)/,
    "pending nonce recovery must verify the public nonce gap before loading signing material",
  );
  assert.match(
    clearPendingNonceSource,
    /account\.address !== address[\s\S]*Configured recovery signer does not match the public role address/,
    "pending nonce recovery must refuse mismatched signer and public role address",
  );
  assert.match(
    clearPendingNonceSource,
    /!EXECUTE && signingMaterialLoaded[\s\S]*wouldSendReplacement:\s*EXECUTE && state\.gap > 0[\s\S]*operationalBoundary: \{[\s\S]*dryRunDefault: !EXECUTE[\s\S]*signingMaterialLoaded,[\s\S]*walletClientCreated: false[\s\S]*contractWriteSubmitted: false[\s\S]*transactionSent: false[\s\S]*value: 0n,[\s\S]*nonce: state\.latest,[\s\S]*gas: 21_000n/,
    "pending nonce recovery must remain a bounded zero-value replacement of the lowest pending nonce",
  );
  assert.doesNotMatch(
    clearPendingNonceSource,
    /console\.log\(JSON\.stringify\(\{[\s\S]{0,180}\b(?:address|hash|rpc|url)\b/i,
    "pending nonce recovery status output must remain role-level and avoid addresses, tx hashes, and RPC endpoints",
  );
  assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000, 100_000), 120_000);
  assert.equal(chatSession.normalizeChatSessionExpiresAt("120000", 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000.5, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(99_999, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(100_000 + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 60_001, 100_000), null);
  for (const malformedChatCookie of [
    `${"a".repeat(1025)}.sig`,
    "encoded.sig.extra",
    "encoded.signature!",
  ]) {
    assert.equal(
      withTemporaryEnv({ NODE_ENV: "production", CHAT_AUTH_SECRET: undefined, NEXTAUTH_SECRET: undefined }, () =>
        chatSession.readChatSession({ cookies: { get: () => ({ value: malformedChatCookie }) } }),
      ),
      null,
      "malformed chat session cookies must fail before production secret/HMAC lookup",
    );
  }
  for (const [name, source] of [["chat", chatSessionSource]]) {
    assert.match(source, /randomBytes\(32\)\.toString\("hex"\)/, `${name} development sessions must use an ephemeral secret`);
    assert.doesNotMatch(source, /createHash\(|dev-(admin|chat)-session:/, `${name} development sessions must not derive a predictable secret`);
    assert.match(
      source,
      /function normalize(?:Admin|Chat)SessionExpiresAt\(value: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*SESSION_MAX_FUTURE_SKEW_MS[\s\S]*const expiresAt = normalize(?:Admin|Chat)SessionExpiresAt\(parsed\.expiresAt\)/,
      `${name} server session cookies must strictly normalize expiry before accepting a signed payload`,
    );
    assert.match(
      source,
      /const SESSION_COOKIE_MAX_LENGTH = 1024[\s\S]*const SESSION_COOKIE_PART_RE = \/\^\[A-Za-z0-9_-\]\+\$\/[\s\S]*function parseSessionCookie[\s\S]*raw\.length > SESSION_COOKIE_MAX_LENGTH[\s\S]*raw\.indexOf\("\.", dotIndex \+ 1\) !== -1[\s\S]*SESSION_COOKIE_PART_RE\.test\(encoded\)[\s\S]*SESSION_COOKIE_PART_RE\.test\(signature\)/,
      `${name} server session cookies must reject oversized, malformed, or suffixed signed tokens before HMAC verification`,
    );
    assert.match(
      source,
      /const cookie = parseSessionCookie\(raw\)[\s\S]*if \(!cookie\) return null[\s\S]*const \[encoded, signature\] = cookie[\s\S]*const expected = sign\(encoded\)/,
      `${name} server session cookie parsing must run before signed-token verification`,
    );
    assert.doesNotMatch(
      source,
      /typeof parsed\.expiresAt !== "number"[\s\S]*expiresAt: parsed\.expiresAt|raw\.split\("\.", 2\)/,
      `${name} server session cookies must not broadly accept raw numeric expiry values or suffixed signed tokens`,
    );
  }
  assert.match(
    collectIndexerEvidenceSource,
    /function normalizeRpcSource\(value\)[\s\S]*!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash[\s\S]*rpcSource must be a redacted label or origin-only URL/,
    "indexer evidence collector must reject credentialed or path-sensitive RPC source URLs",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /MAX_INDEXER_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readOptionalLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "indexer evidence collector must reject directory and oversized log artifacts before reading them",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function readOptionalJson\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*JSON artifact is too large to validate safely[\s\S]*--\$\{name\} must be valid JSON[\s\S]*--\$\{name\} must be a JSON object artifact/,
    "indexer evidence collector must reject directory and oversized JSON artifacts before parsing them",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct indexer evidence files/,
    "indexer evidence collector must reject one artifact reused across indexer evidence inputs",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*CANONICAL_POSITIVE_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isCanonicalNonNegativeInteger[\s\S]*function parseInteger[\s\S]*const parsed = BigInt\(text\)[\s\S]*function isCanonicalPositiveInteger/,
    "indexer evidence collector must define canonical integer parsers",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function requireMatchingChainId[\s\S]*canonical positive decimal integer[\s\S]*must match \$\{expected\}/,
    "indexer evidence collector must strictly parse chain snapshot chain IDs before writing drafts",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function isCanonicalNonNegativeInteger\(value\)[\s\S]*parseInteger\(value\) !== null[\s\S]*function parseInteger\(value\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*finalityLagIsNumeric = isCanonicalNonNegativeInteger\(healthValues\.finalityLagBlocks\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "indexer evidence collector must BigInt-bound finality lag evidence before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /MAX_INDEXER_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*function readRequiredJson\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*JSON artifact is too large to validate safely[\s\S]*--\$\{name\} must be valid JSON[\s\S]*--\$\{name\} must be a JSON object artifact/,
    "indexer proof draft generation must reject directory and oversized artifacts before reading or parsing them",
  );
  assert.match(
    createIndexerDraftSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct indexer evidence files/,
    "indexer proof draft generation must reject one artifact reused across indexer evidence inputs",
  );
  assert.match(
    createIndexerDraftSource,
    /function normalizeRpcSource\(value\)[\s\S]*!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash[\s\S]*rpcSource must be a redacted label or origin-only URL[\s\S]*const rpcSource = normalizeRpcSource\(chainSnapshot\?\.rpcSource\) \|\| "TODO"/,
    "indexer proof draft generation must reject credentialed or path-sensitive RPC source URLs before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*CANONICAL_POSITIVE_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger[\s\S]*const parsed = BigInt\(text\)[\s\S]*function isPositiveInteger[\s\S]*function isNonNegativeInteger/,
    "indexer proof draft generation must define canonical integer parsers",
  );
  assert.match(
    createIndexerDraftSource,
    /function requireMatchingChainId[\s\S]*canonical positive decimal integer[\s\S]*must match \$\{expected\}/,
    "indexer proof draft generation must strictly parse chain snapshot chain IDs before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /function parseInteger\(value\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*finalityLagIsNumeric = isNonNegativeInteger\(healthValues\.finalityLagBlocks\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "indexer proof draft generation must BigInt-bound finality lag evidence before writing drafts",
  );
  for (const [label, source] of [
    ["collect-indexer-evidence", collectIndexerEvidenceSource],
    ["create-indexer-proof-draft", createIndexerDraftSource],
  ]) {
    assert.match(
      source,
      /const MAX_KEY_VALUE_MARKERS = 64[\s\S]*function parseKeyValues\(line = ""\)[\s\S]*pattern\.exec\(line\)[\s\S]*inspected > MAX_KEY_VALUE_MARKERS[\s\S]*too many key\/value markers to validate safely/,
      `${label} must cap key/value parsing before accepting indexer health evidence`,
    );
    assert.doesNotMatch(
      source,
      /line\.matchAll\(/,
      `${label} must not parse indexer health evidence through matchAll`,
    );
  }
  assert.doesNotMatch(
    `${collectIndexerEvidenceSource}\n${createIndexerDraftSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "indexer evidence collector and draft generator must not bypass regularFileStat for resolved artifact paths",
  );
  assert.doesNotMatch(
    `${collectIndexerEvidenceSource}\n${createIndexerDraftSource}`,
    /Number\(value\)\s*===\s*Number\(expected\)|Number\(expectedSnapshotChainId\)|Number\(rpcSnapshotChainId\)|Number\.isFinite\(Number\(healthValues\.finalityLagBlocks\)\)/,
    "indexer evidence draft tooling must not use broad numeric fallback for chain IDs or finalityLagBlocks",
  );
  const proofDraftRegressionSourceForIndexer = readFileSync("scripts/check-proof-drafts.mjs", "utf8");
  assert.ok(
    [
      "hostHealthMalformedFinalityLog",
      "hostHealthUnsafeFinalityLog",
      "9999999999999999",
      "host-collector-malformed-finality-lag",
      "host-collector-unsafe-finality-lag",
      "host-draft-malformed-finality-lag",
      "host-draft-unsafe-finality-lag",
      "canonical non-negative decimal finalityLagBlocks=<number>",
    ].every((marker) => proofDraftRegressionSourceForIndexer.includes(marker)),
    "proof draft regressions must cover malformed and unsafe host finalityLagBlocks in collector and draft paths",
  );
  assert.ok(
    [
      "indexerHealthUnsafeFinalityLog",
      "9999999999999999",
      "indexer-unsafe-finality-artifact",
      "indexer-collector-malformed-finality-lag",
      "indexer-collector-unsafe-finality-lag",
      "indexer-collector-malformed-chain-id",
      "indexer-draft-malformed-finality-lag",
      "indexer-draft-unsafe-finality-lag",
      "indexer-draft-malformed-chain-id",
      "canonical non-negative decimal finalityLagBlocks=<number>",
      "canonical positive decimal integer",
    ].every((marker) => proofDraftRegressionSourceForIndexer.includes(marker)),
    "proof draft regressions must cover malformed and unsafe indexer chain IDs and finalityLagBlocks in collector, draft, and strict artifact paths",
  );
  assert.match(
    checkIndexerDryRunSource,
    /!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash/,
    "indexer evidence checker must reject credential-bearing or path-sensitive RPC source URLs",
  );
  assert.match(
    checkIndexerDryRunSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseCanonicalNonNegativeInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function parseCanonicalPositiveInteger\(value\)/,
    "indexer proof checker must BigInt-bound canonical integer evidence before strict validation",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function sharedIndexerSectionArtifactIssues\(manifest\)[\s\S]*normalizedArtifactPathSet[\s\S]*indexer evidence sections must use distinct local artifact files across/,
    "indexer proof validation must reject one artifact reused across dry-run, finality, and chain-snapshot sections",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fmtMtime\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*stats \? stats\.mtime\.toISOString\(\) : "missing"[\s\S]*function fileExists\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null/,
    "indexer proof must derive mtime and file presence from a shared regular-file stat boundary",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function localArtifactIsFile\(artifactPath\)[\s\S]*regularFileStat\(resolve\(process\.cwd\(\), artifactPath\)\) !== null/,
    "indexer proof must derive local artifact existence from the shared regular-file stat boundary",
  );
  const analyzeCanarySource = readFileSync("scripts/analyze-live-canary-proof.mjs", "utf8");
  const createCanaryDraftSource = readFileSync("scripts/create-canary-proof-draft.mjs", "utf8");
  const collectSignoffSource = readFileSync("scripts/collect-signoff-evidence.mjs", "utf8");
  const createSignoffDraftSource = readFileSync("scripts/create-signoff-proof-draft.mjs", "utf8");
  assert.match(
    analyzeCanarySource,
    /JSONL_READ_CHUNK_BYTES[\s\S]*function readJsonl[\s\S]*readSync/,
    "live canary proof analysis must read long JSONL artifacts in bounded chunks",
  );
  assert.ok(
    analyzeCanarySource.includes('JSON.parse(line.replace(/^\\uFEFF/, ""))'),
    "live canary proof analysis must tolerate UTF-8 BOM on the first JSONL record",
  );
  assert.equal(
    packageScripts["proof:canary:summary"],
    "node scripts/analyze-live-canary-proof.mjs --summary-only",
    "launch canary proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=testnet --summary-only",
    "testnet canary proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:strict:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=testnet --strict --summary-only",
    "testnet canary proof must expose a compact strict summary command for launch checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:v10:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=v10-matrix --strict --summary-only --require-epoch-bound --require-v10-gas-matrix",
    "V10 testnet canary matrix proof must expose a compact fail-closed summary command",
  );
  assert.match(
    analyzeCanarySource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "canary proof analyzer must support compact output without changing validation",
  );
  assert.match(
    analyzeCanarySource,
    /function hasNonFutureIsoTimestamp[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*targetNetwork\.checkedAt must not be in the future[\s\S]*recovery\.\$\{check\}\.checkedAt must not be in the future[\s\S]*autoMinerSession\.checkedAt must not be in the future[\s\S]*transactionHealth\.checkedAt must not be in the future/,
    "canary proof analyzer must reject future-dated target, recovery, auto-miner session, and transaction health timestamps",
  );
  assert.match(
    analyzeCanarySource,
    /const canaryLaunchGates = \["G10", "G11"\][\s\S]*const canaryLaunchGateGroups = "canary=2"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(strictFailures\.length\)[\s\S]*launchGateSummary\(1\)/,
    "canary proof summary must identify both G10 epoch and G11 recovery gates without printing live log details",
  );
  assert.match(
    analyzeCanarySource,
    /summaryOnly \? manifestSummaryStatus\(\) : \(manifestPath \? resolve\(process\.cwd\(\), manifestPath\) : "not required"\)/,
    "canary proof summary output must avoid printing the absolute manifest path",
  );
  assert.match(
    analyzeCanarySource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function isExistingFile\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null[\s\S]*function manifestSummaryStatus\(\)[\s\S]*isExistingFile\(resolve\(process\.cwd\(\), manifestPath\)\) \? "present" : "missing"/,
    "canary proof summary must classify only regular manifest files as present",
  );
  assert.match(
    analyzeCanarySource,
    /MAX_CANARY_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(absolutePath\)[\s\S]*!manifestStat[\s\S]*canary proof manifest must be a file[\s\S]*manifestStat\.size > MAX_CANARY_PROOF_MANIFEST_BYTES[\s\S]*canary proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(absolutePath, "utf8"\)\)/,
    "canary proof analyzer must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    analyzeCanarySource,
    /else if \(!isExistingFile\(resolve\(process\.cwd\(\), logPath\)\)\)[\s\S]*live canary log must be a file/,
    "canary proof analyzer must reject directory live-log inputs before opening them",
  );
  assert.match(
    analyzeCanarySource,
    /function printMissingLogSummary[\s\S]*Log: missing[\s\S]*Summary: 1 proof issue\(s\):/,
    "canary proof summary output must report missing logs without dumping local paths",
  );
  assert.match(
    analyzeCanarySource,
    /function failInvalidJsonl[\s\S]*if \(summaryOnly\)[\s\S]*printMissingLogSummary\(`live canary log contains invalid JSONL at line \$\{lineNumber\}: \$\{summaryDetail\}`\)[\s\S]*Invalid JSONL at \$\{basename\(path\)\}:\$\{lineNumber\}/,
    "canary proof summary output must avoid absolute paths and raw JSONL snippets for parse failures",
  );
  assert.match(
    analyzeCanarySource,
    /if \(failedResolve\.length > 0 && !summaryOnly\)[\s\S]*if \(duplicateSuccessfulTxHashes\.length > 0 && !summaryOnly\)[\s\S]*if \(duplicateKeys\.length > 0 && !summaryOnly\)/,
    "canary proof summary output must avoid tx hash and duplicate-key sample sections",
  );
  assert.match(
    analyzeCanarySource,
    /import \{ closeSync, existsSync, openSync, readFileSync, readSync, statSync \}[\s\S]*function regularFileStat\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function findMissingLocalArtifactRefs[\s\S]*regularFileStat\(resolvedArtifact\)[\s\S]*function artifactBackedEvidenceText[\s\S]*regularFileStat\(resolved\)/,
    "canary proof analyzer must reject directory artifact references before reading manifest-backed evidence",
  );
  assert.match(
    analyzeCanarySource,
    /MAX_CANARY_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*artifactBackedEvidenceText\(value\)[\s\S]*readBoundedArtifactText\(resolved\)/,
    "canary proof analyzer must read bounded local artifact snippets for manifest-backed evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /readFileSync\(resolved,\s*"utf8"\)\.slice/,
    "canary proof analyzer must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    analyzeCanarySource,
    /function sharedCanarySectionArtifactIssues[\s\S]*targetNetwork[\s\S]*recovery[\s\S]*autoMinerSession[\s\S]*transactionHealth/,
    "canary proof analyzer must reject one artifact reused across independent canary evidence sections",
  );
  assert.ok(
    analyzeCanarySource.includes("canary evidence sections must use distinct local artifact files across"),
    "canary proof analyzer must explain reused canary evidence section artifacts",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /readFileSync\(path,\s*"utf8"\)[\s\S]*\.split\(\s*\/\\r\?\\n\//,
    "live canary proof analysis must not load the full JSONL artifact before parsing",
  );
  assert.match(
    createCanaryDraftSource,
    /JSONL_READ_CHUNK_BYTES[\s\S]*function readJsonlArtifact[\s\S]*readSync/,
    "live canary proof draft generation must read long JSONL artifacts in bounded chunks",
  );
  assert.ok(
    createCanaryDraftSource.includes('JSON.parse(line.replace(/^\\uFEFF/, ""))'),
    "live canary proof draft generation must tolerate UTF-8 BOM on the first JSONL record",
  );
  assert.match(
    createCanaryDraftSource,
    /const displayPath = path\.basename\(filePath\)[\s\S]*Invalid JSONL at \$\{displayPath\}:\$\{lineNumber\}: parse error/,
    "live canary proof draft generation must avoid absolute paths and raw JSONL snippets for parse failures",
  );
  assert.match(
    createCanaryDraftSource,
    /import \{ closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync \}[\s\S]*MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function requireExistingArtifact\(name\)[\s\S]*const stats = regularFileStat\(resolved\)[\s\S]*if \(!stats\)[\s\S]*stats\.size > MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES[\s\S]*too large to reference safely/,
    "live canary proof draft generation must reject directory artifact inputs before reading them",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "live canary proof draft generation must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    createCanaryDraftSource,
    /function requireDistinctArtifactInputs[\s\S]*distinct canary evidence files[\s\S]*target-artifact[\s\S]*recovery-artifact[\s\S]*session-artifact[\s\S]*tx-artifact/,
    "live canary proof draft generation must reject reused target, recovery, session, and transaction artifacts",
  );
  assert.match(
    createCanaryDraftSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveInteger\(value\)[\s\S]*CANONICAL_POSITIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const parsedChainId = parsePositiveInteger\(chainId\)[\s\S]*chainId: parsedChainId/,
    "live canary proof draft generation must publish the same safe parsed chain id it validates",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /readFileSync\(path\.resolve\(process\.cwd\(\), filePath\),\s*"utf8"\)[\s\S]*\.split\(\s*\/\\r\?\\n\/|chainId:\s*Number\(chainId\)/,
    "live canary proof draft generation must not load the full JSONL artifact before parsing or broadly coerce chain id evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /GENERIC_RPC_LABEL_RE[\s\S]*LIVE_CANARY_RPC_LABEL must be a concrete redacted RPC label/,
    "live canary must fail before transactions when the redacted RPC label is missing or generic",
  );
  assert.match(
    liveRoundCanarySource,
    /http request[\s\S]*rpc[\s\S]*connection[\s\S]*socket/,
    "live canary must classify common provider transport failures as network errors",
  );
  assert.match(
    chainIndexerAuditSource,
    /decoded\.eventName === "ResolverRewardAccrued" && inEpochWindow[\s\S]*decoded\.eventName === "ResolverRewardClaimed"/,
    "chain/indexer audit must keep epoch-scoped resolver accruals inside the selected epoch window",
  );
  assert.match(
    analyzeCanarySource,
    /BET_MODES\.has\(event\.mode\)/,
    "canary analyzer must not count preflight, resolve, wait, or summary events as bet transactions",
  );
  assert.match(
    readFileSync("scripts/canary-proof-profile.mjs", "utf8"),
    /launch:[\s\S]*requiredRoles:\s*\["MANUAL",\s*"AUTOMINER_A",\s*"AUTOMINER_B"\][\s\S]*testnet:[\s\S]*requiredRoles:\s*\["MANUAL",\s*"AUTOMINER_A",\s*"AUTOMINER_B"\][\s\S]*"v10-matrix":(?![\s\S]*requiredRoles)/,
    "launch/testnet canary proof must require MANUAL/AUTOMINER_A/AUTOMINER_B role coverage while keeping V10 matrix exempt",
  );
  assert.match(
    analyzeCanarySource,
    /requiredCanaryRoles[\s\S]*successfulRoles[\s\S]*missingRequiredCanaryRoles[\s\S]*successful required canary roles missing/,
    "strict canary proof must fail when required live-test roles are missing from successful bets",
  );
  assert.match(
    analyzeCanarySource,
    /unexpectedSuccessfulCanaryRoles[\s\S]*successfulRoles\.filter\(\(role\) => !requiredCanaryRoles\.includes\(role\)\)[\s\S]*unexpected successful canary roles/,
    "strict canary proof must reject successful roles outside the profile-required role set",
  );
  assert.match(
    analyzeCanarySource,
    /autoMinerSession\.requiredRoles[\s\S]*autoMinerSession\.successfulRoles[\s\S]*missingManifestRequiredRoles[\s\S]*missingManifestSuccessfulRoles[\s\S]*unexpectedManifestRequiredRoles[\s\S]*unexpectedManifestSuccessfulRoles/,
    "canary proof manifest must record exactly the required and successful role coverage",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryUnexpectedRoleLog[\s\S]*role: "AUTOMINER_C"[\s\S]*canary-unexpected-successful-role[\s\S]*unexpected successful canary roles: AUTOMINER_C/,
    "proof draft regression suite must reject canary logs with extra successful roles",
  );
  assert.match(
    analyzeCanarySource,
    /malformedSuccessfulRoleEvidence = okBets\.filter\(\(event\) => !normalizeRole\(event\.role\)\)[\s\S]*malformed successful role evidence/,
    "canary proof analyzer must fail closed on malformed successful role evidence",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedRoleLog[\s\S]*role: "AUTOMINER A"[\s\S]*canary-live-log-malformed-role[\s\S]*malformed successful role evidence 1/,
    "proof draft regression suite must reject malformed canary successful role evidence",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canary-future-timestamp[\s\S]*targetNetwork\.checkedAt must not be in the future/,
    "proof draft regression suite must reject strict canary proof with future-dated manifest timestamps",
  );
  assert.match(
    analyzeCanarySource,
    /CANONICAL_POSITIVE_INTEGER_RE[\s\S]*targetNetwork\.chainId must be a canonical positive decimal integer[\s\S]*configured chain id must be a canonical positive decimal integer[\s\S]*function positiveIntegerString/,
    "canary proof analyzer must canonicalize target chain IDs before strict proof acceptance",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(targetNetwork\.chainId\)|Number\(expectedChainId\)|Number\(event\.chainId\)/,
    "canary proof analyzer must not use broad numeric fallback for target or live-log chain IDs",
  );
  assert.match(
    analyzeCanarySource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*malformedNonceEvidence[\s\S]*malformed nonce evidence \$\{malformedNonceEvidence\.length\}[\s\S]*function hasCanonicalNonceEvidence/,
    "canary proof analyzer must fail closed on malformed successful bet nonce evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(event\.noncePending\)\s*>\s*Number\(event\.nonceLatest\)/,
    "canary proof analyzer must not use broad numeric fallback for nonce gap evidence",
  );
  assert.match(
    createCanaryDraftSource,
    /CANONICAL_POSITIVE_INTEGER_RE[\s\S]*function positiveIntegerString[\s\S]*--chain-id must be a canonical positive decimal integer/,
    "canary proof draft generation must canonicalize target chain IDs before writing draft evidence",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /Number\(event\.chainId\)|Number\(expectedChainId\)/,
    "canary proof draft generation must not use broad numeric fallback for live-log chain IDs",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canary-malformed-target-chain-id[\s\S]*targetNetwork\.chainId must be a canonical positive decimal integer[\s\S]*canary-live-log-malformed-chain-id[\s\S]*target metadata mismatches[\s\S]*canary-draft-malformed-chain-id[\s\S]*--chain-id must be a canonical positive decimal integer[\s\S]*canary-draft-malformed-live-chain-id[\s\S]*--live-log target metadata must match/,
    "proof draft regression suite must reject malformed canary chain IDs in strict manifest, live-log, and draft paths",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedNonceLog[\s\S]*noncePending: "2e1"[\s\S]*canary-live-log-malformed-nonce[\s\S]*malformed nonce evidence 1/,
    "proof draft regression suite must reject malformed canary nonce evidence in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /malformedBetTileEvidence[\s\S]*malformed bet tile evidence \$\{malformedBetTileEvidence\.length\}[\s\S]*function parseBetTiles/,
    "canary proof analyzer must fail closed on malformed successful bet tile evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource.match(/function findDuplicateBetKeys\(bets\)[\s\S]*?function findDuplicateTxHashes/)?.[0] ?? "",
    /tiles\.map\(Number\)|Array\.isArray\(event\.tiles\) \? event\.tiles : \[\]/,
    "duplicate bet proof must use canonical parsed tiles instead of raw tile fallback",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTileLog[\s\S]*tiles: \["1\.0"\][\s\S]*canary-live-log-malformed-tile[\s\S]*malformed bet tile evidence 1/,
    "proof draft regression suite must reject malformed canary tile evidence in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /malformedBetEpochEvidence[\s\S]*malformed bet epoch evidence \$\{malformedBetEpochEvidence\.length\}[\s\S]*function findDuplicateBetKeys[\s\S]*positiveIntegerString\(event\.epoch\)/,
    "canary proof analyzer must fail closed on malformed successful bet epoch evidence before duplicate proof",
  );
  assert.match(
    analyzeCanarySource,
    /malformedTxMetricEvidence[\s\S]*malformed successful tx metric evidence \$\{malformedTxMetricEvidence\.length\}[\s\S]*function nonNegativeValue[\s\S]*function hasMalformedSuccessfulTxMetricEvidence/,
    "canary proof analyzer must fail closed on malformed successful tx metric evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(event\.durationMs\)|Number\(event\.gasUsed\)|Number\(event\[field\]\)/,
    "canary proof analyzer must not use broad numeric fallback for successful tx stats or health trends",
  );
  assert.match(
    analyzeCanarySource,
    /manifestAutoMinerRounds = positiveIntegerValue\(manifestSummary\.autoMinerSession\.rounds\)[\s\S]*manifestAutoMinerUniqueEpochs = positiveIntegerValue\(manifestSummary\.autoMinerSession\.uniqueEpochs\)[\s\S]*function positiveIntegerValue/,
    "canary proof analyzer must canonicalize manifest auto-miner counts before comparing live evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(manifestSummary\.autoMinerSession\.rounds\)|Number\(manifestSummary\.autoMinerSession\.uniqueEpochs\)/,
    "canary proof analyzer must not use broad numeric fallback for manifest auto-miner counts",
  );
  assert.match(
    analyzeCanarySource,
    /targetNetworkOk:[\s\S]*normalizeNetwork\(targetNetwork\.network\) === profile\.network[\s\S]*normalizeNetwork\(targetNetwork\.network\) === normalizeNetwork\(expectedNetwork\)[\s\S]*targetChainIdString === String\(profile\.chainId\)[\s\S]*targetChainIdString === expectedChainIdString[\s\S]*normalizeAddress\(targetNetwork\.contractAddress\) === normalizeAddress\(expectedContract\)/,
    "canary manifest summary must mark targetNetwork as issue when configured network, chain id, or contract address mismatches strict validation",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedEpochLog[\s\S]*epoch: "4\.0"[\s\S]*canary-live-log-malformed-epoch[\s\S]*malformed bet epoch evidence 1/,
    "proof draft regression suite must reject malformed canary epoch evidence in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /malformedBetTimestampEvidence = okBets\.filter\(\(event\) => !hasIsoTimestamp\(event\.timestamp\)\)[\s\S]*malformed bet timestamp evidence/,
    "canary proof analyzer must fail closed on malformed timestamps in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /function elapsedRunMs\(events\)[\s\S]*\.map\(\(event\) => isoTimestampMs\(event\.timestamp\)\)/,
    "canary elapsed-time proof must use canonical ISO timestamp parsing",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Date\.parse\(event\.timestamp\)/,
    "canary elapsed-time proof must not use broad Date.parse parsing",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTimestampLog[\s\S]*timestamp: "2026-07-09 00:03:00"[\s\S]*canary-live-log-malformed-timestamp[\s\S]*malformed bet timestamp evidence 1/,
    "proof draft regression suite must reject malformed canary timestamp evidence in successful live-log bets",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTxMetricLog[\s\S]*durationMs: "1\.5"[\s\S]*gasUsed: "2e1"[\s\S]*canary-live-log-malformed-tx-metric[\s\S]*malformed successful tx metric evidence 1/,
    "proof draft regression suite must reject malformed canary tx metric evidence in successful live-log bets",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedSessionCountsManifest[\s\S]*rounds: "51\.0"[\s\S]*uniqueEpochs: "5\.1e1"[\s\S]*canary-malformed-session-counts[\s\S]*autoMinerSession\.rounds must be a positive integer/,
    "proof draft regression suite must reject malformed canary manifest auto-miner counts",
  );
  assert.match(
    analyzeCanarySource,
    /function duplicateRoleEntries[\s\S]*autoMinerSession\.successfulRoles contains duplicate role entries/,
    "canary proof analyzer must fail closed on duplicate auto-miner role entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryDuplicateSessionRolesManifest[\s\S]*successfulRoles: \["MANUAL", "AUTOMINER_A", "AUTOMINER_A", "AUTOMINER_B"\][\s\S]*canary-duplicate-session-roles[\s\S]*autoMinerSession\.successfulRoles contains duplicate role entries 2/,
    "proof draft regression suite must reject duplicate canary auto-miner role entries",
  );
  assert.match(
    analyzeCanarySource,
    /autoMinerSessionOk:[\s\S]*duplicateManifestRequiredRoles\.length === 0[\s\S]*duplicateManifestSuccessfulRoles\.length === 0[\s\S]*hasAutoMinerSessionProof\(autoMinerSession\)/,
    "canary manifest summary must mark Auto-Miner session as issue when duplicate roles or weak evidence are present",
  );
  assert.match(
    analyzeCanarySource,
    /function malformedTxHashEntries[\s\S]*transactionHealth\.txHashes contains malformed tx hash entries/,
    "canary proof analyzer must fail closed on malformed transactionHealth tx hash entries",
  );
  assert.match(
    analyzeCanarySource,
    /function duplicateTxHashEntries[\s\S]*transactionHealth\.txHashes contains duplicate tx hash entries/,
    "canary proof analyzer must fail closed on duplicate transactionHealth tx hash entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTransactionHashesManifest[\s\S]*txHashes: \[canaryFullTxHashes\[0\], "0x1234"\][\s\S]*canary-malformed-transaction-hashes[\s\S]*transactionHealth\.txHashes contains malformed tx hash entries 1/,
    "proof draft regression suite must reject mixed valid and malformed canary manifest tx hash entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryDuplicateTransactionHashesManifest[\s\S]*txHashes: \[canaryFullTxHashes\[0\], canaryFullTxHashes\[0\]\][\s\S]*canary-duplicate-transaction-hashes[\s\S]*transactionHealth\.txHashes contains duplicate tx hash entries 1/,
    "proof draft regression suite must reject duplicate canary manifest tx hash entries",
  );
  assert.match(
    analyzeCanarySource,
    /transactionHealthOk:[\s\S]*malformedTransactionHealthTxHashes\.length === 0[\s\S]*duplicateTransactionHealthTxHashes\.length === 0[\s\S]*hasTransactionHealthProof\(transactionHealth\)/,
    "canary manifest summary must mark transaction health as issue when malformed hashes, duplicate hashes, or weak evidence are present",
  );
  assert.match(
    createCanaryDraftSource,
    /requiredRoles = normalizeRoleList\(profile\.requiredRoles\)[\s\S]*requiredRoles,[\s\S]*successfulRoles: summary\.successfulRoles/,
    "canary proof draft must preserve required and observed successful roles",
  );
  for (const canaryGateScript of ["scripts/check-launch-gates.mjs", "scripts/report-launch-remaining.mjs"]) {
    assert.match(
      readFileSync(canaryGateScript, "utf8"),
      /"G10"[\s\S]*MANUAL[\s\S]*AUTOMINER_A[\s\S]*AUTOMINER_B[\s\S]*50 successful auto-miner unique epochs/,
      `${canaryGateScript} must keep launch canary role coverage visible`,
    );
    assert.match(
      readFileSync(canaryGateScript, "utf8"),
      /"G12"[\s\S]*Privy allowed origins[\s\S]*redacted production App ID configured proof[\s\S]*wrong network/,
      `${canaryGateScript} must keep production Privy App ID proof visible in the wallet QA gate`,
    );
  }
  assert.match(
    readFileSync("docs/mainnet-status-board.md", "utf8"),
    /Latest aggregate verification:[\s\S]*V10 dry-run Preview[\s\S]*transactionSent=false[\s\S]*preview:canary:v10:authorization-ready:summary[\s\S]*npm\.cmd run proof:prelaunch:summary[\s\S]*all required local rows passed[\s\S]*24 external\/status blockers[\s\S]*0\/14 Complete[\s\S]*residual security follow-up 8\/8[\s\S]*appResolveEpochFiles=0[\s\S]*ABI\/indexer storage[\s\S]*sameBlockEventOrdering=true/,
    "mainnet status board must show the latest aggregate local verification without claiming launch completion",
  );
  assert.match(
    readFileSync("docs/mainnet-status-board.md", "utf8"),
    /Last local verification:[\s\S]*L1-L17[\s\S]*residual security follow-up 8\/8[\s\S]*appResolveEpochFiles=0[\s\S]*G1-G14 remain Missing pending external evidence[\s\S]*G14[\s\S]*fresh final security scan[\s\S]*no open High\/Medium local findings/,
    "mainnet status board must keep L1-L17 local verification and final security scan G14 blocker visible",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /TODO: verified\/pass/,
    "canary draft instructions must not suggest a combined status rejected by the strict validator",
  );
  assert.match(
    collectSignoffSource,
    /randomness-decision[\s\S]*randomness-operator[\s\S]*randomness-signed-at[\s\S]*randomness-evidence[\s\S]*randomness-risk-accepted/,
    "signoff collector must support reproducible CLI-provided randomness acceptance evidence",
  );
  assert.match(
    collectSignoffSource,
    /MAX_SIGNOFF_LOG_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_SIGNOFF_LOG_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "signoff collector must reject directory and oversized paths before reading evidence artifacts",
  );
  assert.match(
    createSignoffDraftSource,
    /MAX_SIGNOFF_LOG_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_SIGNOFF_LOG_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "signoff proof draft must reject directory and oversized paths before reading evidence artifacts",
  );
  assert.doesNotMatch(
    `${collectSignoffSource}\n${createSignoffDraftSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "signoff collector and draft generator must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    collectSignoffSource,
    /function requireChainComparisonLog[\s\S]*proof:chain[\s\S]*direct\[-\\s\]\?chain[\s\S]*jackpot, safetyPool, deposits, rewards, rebates, and resolve/,
    "signoff collector must reject chain logs missing direct-chain comparison coverage",
  );
  assert.match(
    `${readFileSync("docs/mainnet-readiness-checklist.md", "utf8")}\n${readFileSync("docs/production-runbook.md", "utf8")}`,
    /current non-VRF[\s\S]*not a requirement to redesign randomness before mainnet[\s\S]*randomness\.decision=accepted-risk[\s\S]*current non-VRF model/,
    "launch docs must frame randomness as explicit current-model acceptance, not a mandatory pre-mainnet redesign",
  );
  assert.match(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /Local\s+V10 compiler provenance is reproducible and manifest-matched[\s\S]*Final mainnet\s+readiness still requires fresh external/,
    "V10 design doc must distinguish local reproducibility from remaining external launch evidence",
  );
  assert.match(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /local production-build API\/UI smoke pass[\s\S]*Fresh external deployed-bytecode[\s\S]*long-soak evidence remain open/,
    "V10 design doc must not confuse local production-build smoke with final production evidence",
  );
  assert.doesNotMatch(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /metadata-only Remix source-unit layout mismatch|not yet the final reproducible deployment/,
    "V10 design doc must not preserve stale deployed-provenance blockers after manifest-matched local proof",
  );
  assert.match(
    collectSignoffSource,
    /protected-bets-required[\s\S]*NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*protectedBetsRequired: isTruthyEnvValue/,
    "signoff collector must carry the V10 protected-bet flag into final signoff evidence",
  );
  assert.match(
    collectSignoffSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveIntegerString\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT[\s\S]*finalityBlocksPositive: isPositiveIntegerString\(finalityBlocks\)/,
    "signoff collector must BigInt-bound finality block evidence before setting the finality-positive proof flag",
  );
  assert.match(
    readFileSync("scripts/collect-proof-common.mjs", "utf8"),
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*export function parsePositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*export function isPositiveInteger\(value\)[\s\S]*parsePositiveInteger\(value\) !== null/,
    "proof collectors must share parsed positive-integer evidence with boolean validation",
  );
  assert.match(
    collectSignoffSource,
    /parsePositiveInteger[\s\S]*const requestedEpochs = parsePositiveInteger\(epochs\)[\s\S]*requireCondition\(requestedEpochs !== null[\s\S]*requestedEpochs,/,
    "signoff collector must publish the same canonical parsed --epochs value it validates",
  );
  assert.doesNotMatch(
    `${readFileSync("scripts/collect-proof-common.mjs", "utf8")}\n${collectSignoffSource}`,
    /function (?:parsePositiveInteger|isPositiveIntegerString)\(value\)[\s\S]*\^\[1-9\]\\d\*\$|const requestedEpochs = Number\(epochs\)/,
    "signoff collector must not broadly coerce finality block or requested epoch evidence",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /signoff-collector-unsafe-epochs[\s\S]*9999999999999999[\s\S]*--epochs must be a positive integer/,
    "proof draft regression suite must reject unsafe signoff collector requested epoch evidence",
  );
  assert.match(
    createSignoffDraftSource,
    /randomness-decision[\s\S]*randomness-operator[\s\S]*randomness-signed-at[\s\S]*randomness-evidence[\s\S]*randomness-risk-accepted/,
    "signoff draft generator must support the same reproducible randomness acceptance evidence fields",
  );
  assert.match(
    createSignoffDraftSource,
    /function requireChainComparisonLog[\s\S]*proof:chain[\s\S]*direct\[-\\s\]\?chain[\s\S]*jackpot, safetyPool, deposits, rewards, rebates, and resolve/,
    "signoff draft generator must reject chain logs missing direct-chain comparison coverage",
  );
  assert.match(
    createSignoffDraftSource,
    /protected-bets-required[\s\S]*NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*protectedBetsRequired: isTruthyEnvValue/,
    "signoff draft generator must carry the V10 protected-bet flag into final signoff evidence",
  );
  assert.match(
    createSignoffDraftSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT[\s\S]*finalityBlocksPositive: isPositiveInteger\(finalityBlocks\)/,
    "signoff draft generator must BigInt-bound finality block evidence before setting the finality-positive proof flag",
  );
  assert.doesNotMatch(
    createSignoffDraftSource,
    /function isPositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\*\$|function isPositiveInteger\(value\)[\s\S]*Number\(String\(value \?\? ""\)\.trim\(\)\)[\s\S]*parsed > 0/,
    "signoff draft generator must not broadly coerce finality block evidence",
  );
  assert.match(
    readFileSync("scripts/check-signoff-proof.mjs", "utf8"),
    /contractEnv\.protectedBetsRequired !== true[\s\S]*V10 mainnet launch/,
    "strict signoff proof must reject manifests missing the V10 protected-bet flag",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_RANDOMIZE_ROUNDS/,
    "live canary must support randomized stress rounds for amount/tile coverage",
  );
  assert.match(
    liveRoundCanarySource,
    /CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*placeBatchBetsBitmapForEpoch[\s\S]*\[epoch, tileIdsToMask\(tiles\), plan\.amount\]/,
    "V10 live canary must dispatch the protected bitmap selector with its observed epoch",
  );
  assert.ok(
    liveRoundCanarySource.indexOf("await assertEpochBoundBetCapability(publicClient)") <
      liveRoundCanarySource.indexOf("await runPreflight(logPath, publicClient, wallets, plannedSpendByRole)"),
    "V10 live canary must reject missing protected bytecode before wallet preflight or allowance transactions",
  );
  assert.ok(
    liveRoundCanarySource.indexOf("if (V10_MATRIX_ONLY && !CONTRACT_REQUIRES_EPOCH_BOUND_BETS)") <
      liveRoundCanarySource.indexOf("const wallets = DRY_RUN ? loadDryRunWallets() : loadWallets()"),
    "V10 matrix mode must reject stale runtime configuration before loading wallet secrets",
  );
  assert.match(
    liveRoundCanarySource,
    /approvalRequired = FORCE_ALLOWANCE_APPROVE \|\| allowance < plannedSpend[\s\S]*approvalsRequired=/,
    "V10 dry-run must report the bounded plan's approval transaction count",
  );
  assert.match(
    liveRoundCanarySource,
    /plannedStake = \[\.\.\.plannedSpendByRole\.values\(\)\][\s\S]*plannedBetTransactions = TARGET_ROUNDS \* \(REPEAT_SAME_BET \? 2 : 1\)[\s\S]*plannedStake=/,
    "live canary must report the exact planned stake and bet transaction count",
  );
  assert.match(
    liveRoundCanarySource,
    /MAX_RESOLVE_TRANSACTIONS = V10_MATRIX_ONLY \? TARGET_ROUNDS - 1 : null[\s\S]*submittedResolveTransactions >= MAX_RESOLVE_TRANSACTIONS[\s\S]*submittedResolveTransactions \+= 1/,
    "V10 matrix mode must cap submitted resolve transactions before wallet writes",
  );
  assert.match(
    analyzeCanarySource,
    /--require-epoch-bound[\s\S]*successful epoch-unbound bets/,
    "V10 canary proof must reject successful legacy bets when epoch-bound evidence is required",
  );
  assert.match(
    liveRoundCanarySource,
    /V10_CANARY_MATRIX = \[[\s\S]*tileCount: 1, sparse: false[\s\S]*tileCount: 3, sparse: false[\s\S]*tileCount: 3, sparse: true[\s\S]*tileCount: 5, sparse: false[\s\S]*tileCount: 5, sparse: true[\s\S]*tileCount: 25, sparse: false/,
    "V10 live canary must schedule single, contiguous, sparse, and full-grid gas cases before randomized rounds",
  );
  assert.match(
    liveRoundCanarySource,
    /V10_MATRIX_ONLY = process\.argv\.includes\("--v10-matrix-only"\)[\s\S]*DRY_RUN = [^;]*\(V10_MATRIX_ONLY && !V10_MATRIX_EXECUTE\)[\s\S]*TARGET_ROUNDS = V10_MATRIX_ONLY \? 6[\s\S]*REPEAT_SAME_BET = V10_MATRIX_ONLY/,
    "bounded V10 matrix mode must run six repeated cases and remain transaction-free without explicit --execute",
  );
  assert.equal(
    packageScripts["live:canary:v10:matrix"],
    "tsx scripts/live-round-canary.ts --v10-matrix-only",
    "the bounded V10 matrix command must default to the script's fail-closed dry-run mode",
  );
  assert.match(
    analyzeCanarySource,
    /--require-v10-gas-matrix[\s\S]*missing V10 gas cases[\s\S]*V10 Mined Gas Matrix/,
    "V10 canary proof must fail closed on missing mined-gas matrix cases and report per-case gas",
  );
  assert.match(
    analyzeCanarySource,
    /malformedV10GasMatrixEvidence[\s\S]*malformed V10 gas matrix evidence \$\{malformedV10GasMatrixEvidence\.length\}[\s\S]*function parseBetTiles[\s\S]*function tileCountValue[\s\S]*function gasValue/,
    "V10 canary proof must fail closed on malformed mined-gas matrix evidence",
  );
  assert.match(
    analyzeCanarySource,
    /function formatCounts\(counts\)[\s\S]*safeCountKey\(key\)[\s\S]*function safeCountKey\(value\)[\s\S]*\^\[A-Za-z0-9_-\]\{1,48\}\$[\s\S]*return "unsafe-token"/,
    "V10 canary proof summary must sanitize raw role/mode/error count keys before printing them",
  );
  assert.doesNotMatch(
    analyzeCanarySource.match(/function formatCounts\(counts\)[\s\S]*?function summarizeV10GasMatrix/)?.[0] ?? "",
    /\$\{key\}:\$\{value\}/,
    "V10 canary proof summary must not print raw count keys from canary logs",
  );
  assert.doesNotMatch(
    analyzeCanarySource.match(/function v10GasCase\(event\)[\s\S]*?function parseBetTiles/)?.[0] ?? "",
    /tiles\.map\(Number\)|Number\(event\.tileCount\)/,
    "V10 canary proof must not use broad numeric fallback for gas matrix tiles or tileCount",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:v10"],
    "node scripts/analyze-live-canary-proof.mjs --profile=v10-matrix --strict --require-epoch-bound --require-v10-gas-matrix",
    "V10 testnet proof command must fail closed on epoch-bound and mined-gas matrix evidence",
  );
  assert.match(
    prelaunchStatusSource,
    /proof:testnet:canary:strict:summary[\s\S]*proof:testnet:canary:v10:summary[\s\S]*db:backup:summary/,
    "prelaunch status summary must keep missing V10 mined-gas matrix evidence visible before backup gates",
  );
  const v10CanaryProofDir = mkdtempSync(join(tmpdir(), "lore-v10-canary-proof-"));
  try {
    const baseBetEvent = {
      mode: "bitmap",
      round: 0,
      ok: true,
      txStatus: "success",
      role: "AUTOMINER_A",
      network: "sepolia",
      chainId: 59141,
      contractAddress: `0x${"1".repeat(40)}`,
      epoch: "1",
      hash: `0x${"1".repeat(64)}`,
      nonceLatest: 0,
      noncePending: 0,
      durationMs: 1,
      gasUsed: "1",
      tileCount: 1,
      tiles: [1],
      timestamp: "2026-07-22T00:00:00.000Z",
    };
    const runV10CanaryProof = (name, events) => {
      const logPath = join(v10CanaryProofDir, `${name}.jsonl`);
      writeFileSync(logPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      return spawnSync(process.execPath, [
        "scripts/analyze-live-canary-proof.mjs",
        logPath,
        "--profile=v10-matrix",
        "--strict",
        "--require-epoch-bound",
        "--require-v10-gas-matrix",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
          LINEA_NETWORK: "sepolia",
          NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
          LINEA_CHAIN_ID: "59141",
          NEXT_PUBLIC_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`,
          LIVE_CANARY_MIN_EPOCHS: "1",
          LIVE_CANARY_MIN_AUTOMINER_EPOCHS: "1",
          LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH: "1",
        },
        encoding: "utf8",
      });
    };
    const legacyProof = runV10CanaryProof("legacy", [{ ...baseBetEvent, epochBound: false }]);
    assert.equal(legacyProof.status, 1);
    assert.match(legacyProof.stdout, /successful epoch-unbound bets 1/);
    const pendingProof = runV10CanaryProof("pending", [{
      ...baseBetEvent,
      epochBound: true,
      ok: true,
      txStatus: "pending",
    }]);
    assert.equal(pendingProof.status, 1);
    assert.match(pendingProof.stdout, /failed bets 1/);
    const protectedProof = runV10CanaryProof("protected", [{ ...baseBetEvent, epochBound: true }]);
    assert.equal(protectedProof.status, 1, "the synthetic proof still lacks its required gas matrix");
    assert.doesNotMatch(protectedProof.stdout, /successful epoch-unbound bets/);
    assert.match(protectedProof.stdout, /missing V10 gas cases 3-contiguous,3-sparse,5-contiguous,5-sparse,25/);
    const malformedMatrixProof = runV10CanaryProof("malformed-matrix", [{
      ...baseBetEvent,
      epochBound: true,
      tileCount: "1.0",
    }]);
    assert.equal(malformedMatrixProof.status, 1);
    assert.match(malformedMatrixProof.stdout, /malformed V10 gas matrix evidence 1/);
    const unsafeRoleProof = runV10CanaryProof("unsafe-role", [{
      ...baseBetEvent,
      epochBound: true,
      role: "https://rpc.example/?token=secret",
    }]);
    assert.equal(unsafeRoleProof.status, 1);
    assert.match(unsafeRoleProof.stdout, /malformed successful role evidence 1/);
    assert.match(unsafeRoleProof.stdout, /\| roles \| unsafe-token:1 \|/);
    assert.doesNotMatch(unsafeRoleProof.stdout, /rpc\.example|token=secret/);
    const matrixTiles = [[1], [1, 2, 3], [1, 8, 15], [1, 2, 3, 4, 5], [1, 8, 15, 22, 4], Array.from({ length: 25 }, (_, index) => index + 1)];
    const matrixEvents = matrixTiles.flatMap((tiles, index) => {
      const first = {
        ...baseBetEvent,
        epoch: String(index + 1),
        epochBound: true,
        gasUsed: String(100_000 + index),
        hash: `0x${String(index + 1).repeat(64)}`,
        nonceLatest: index * 2,
        noncePending: index * 2,
        round: index,
        tileCount: tiles.length,
        tiles,
        timestamp: new Date(Date.parse("2026-07-22T00:00:00.000Z") + index * 2_000).toISOString(),
      };
      return [first, {
        ...first,
        gasUsed: String(200_000 + index),
        hash: `0x${"abcdef"[index].repeat(64)}`,
        nonceLatest: index * 2 + 1,
        noncePending: index * 2 + 1,
        repeat: true,
        timestamp: new Date(Date.parse(first.timestamp) + 1_000).toISOString(),
      }];
    });
    const matrixProof = runV10CanaryProof("matrix", matrixEvents);
    assert.equal(matrixProof.status, 0, "the complete bounded matrix must not require the 50-epoch soak manifest");
    assert.doesNotMatch(matrixProof.stdout, /missing V10 gas cases/);
    assert.doesNotMatch(matrixProof.stdout, /duplicate role\/epoch\/tile keys [1-9]/);
    assert.match(matrixProof.stdout, /\| 3-sparse \| 2 \| 100002 \| 100002 \| 200002 \|/);
    const orphanRepeatProof = runV10CanaryProof("orphan-repeat", [{ ...baseBetEvent, epochBound: true, repeat: true }]);
    assert.match(orphanRepeatProof.stdout, /duplicate role\/epoch\/tile keys 1/);
    const duplicateProof = runV10CanaryProof("duplicate", [
      { ...baseBetEvent, epochBound: true },
      {
        ...baseBetEvent,
        epochBound: true,
        hash: `0x${"a".repeat(64)}`,
        nonceLatest: 1,
        noncePending: 1,
        timestamp: "2026-07-22T00:00:01.000Z",
      },
    ]);
    assert.match(duplicateProof.stdout, /duplicate role\/epoch\/tile keys 1/);
  } finally {
    rmSync(v10CanaryProofDir, { recursive: true, force: true });
  }
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_HEALTH_BASE_URL[\s\S]*x-health-diagnostics-secret[\s\S]*mode: "diagnostic"/,
    "live canary must support redacted runtime and storage telemetry during long soak runs",
  );
  assert.match(
    liveRoundCanarySource,
    /nonceQueueClear = noncePending <= nonceLatest[\s\S]*enoughEth: eth >= MIN_ETH_PER_WALLET[\s\S]*enoughToken: token >= requiredToken[\s\S]*pending-nonce-blocked[\s\S]*insufficient-native-and-token[\s\S]*insufficient-token/,
    "wallet preflight must expose safe balance categories and reject an existing pending nonce queue",
  );
  assert.match(
    liveRoundCanarySource,
    /for \(let attempt = 0; attempt < 2; attempt \+= 1\)[\s\S]*healthRetryCount: attempt[\s\S]*healthRetryCount: 1/,
    "live canary health telemetry must retry one transient timeout while preserving retry evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /estimateGasMs: gasEstimatedAt - preparedAt[\s\S]*nonceReadMs: nonceReadAt - gasEstimatedAt[\s\S]*prepareMs: preparedAt - startedAt[\s\S]*sendMs: sentAt - nonceReadAt[\s\S]*receiptMs: receiptAt - sentAt/,
    "live canary must preserve prepare, estimate, nonce, send, and receipt latency phases",
  );
  assert.match(
    liveRoundCanarySource,
    /noncePending > nonceLatest[\s\S]*Pending transaction blocked by nonce/,
    "live canary must not dispatch another transaction while a wallet already has a pending nonce",
  );
  assert.match(
    liveRoundCanarySource,
    /const sentEvent = \{[\s\S]*hash,[\s\S]*catch \(error\)[\s\S]*\.\.\.sentEvent[\s\S]*errorKind: classified\.kind[\s\S]*txStatus: "pending"/,
    "live canary must retain post-send transaction evidence when receipt polling times out",
  );
  assert.match(
    liveRoundCanarySource,
    /for \(const \[resolverIndex, resolver\] of resolvers\.entries\(\)\)[\s\S]*insufficient-native-gas[\s\S]*mode: "resolver-candidate"[\s\S]*continue;[\s\S]*pendingHash[\s\S]*return;/,
    "live canary may fall back before resolve dispatch but must not switch wallets after an uncertain send",
  );
  assert.match(
    liveRoundCanarySource,
    /mode: "resolve"[\s\S]*resolverFallbackUsed: resolverIndex > 0/,
    "live canary must record successful resolver fallback without classifying pre-send skips as failed resolves",
  );
  assert.match(
    soakSupervisorSource,
    /randomBytes\(32\)[\s\S]*HEALTH_DIAGNOSTICS_SECRET: HEALTH_SECRET/,
    "testnet soak supervisor must generate and pass an ephemeral diagnostics secret without persisting it",
  );
  assert.match(
    soakSupervisorSource,
    /SOAK_EXECUTE_LIVE === "1"[\s\S]*process\.argv\.includes\("--execute-live"\)[\s\S]*LIVE_TEST_DRY_RUN: DRY_RUN[\s\S]*LIVE_TEST_EXECUTE: LIVE_EXECUTION_CONFIRMED/,
    "testnet soak supervisor must default to a transaction-free run and require explicit live execution confirmation",
  );
  assert.match(
    soakSupervisorSource,
    /DECIMAL_INTEGER_RE = \/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger\(name, fallbackValue, min, max\)[\s\S]*process\.env\[name\]\?\.trim\(\)[\s\S]*!DECIMAL_INTEGER_RE\.test\(raw\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "testnet soak supervisor env integer parsing must require canonical decimal text and BigInt bounds before Number narrowing",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /const raw = process\.env\[name\];[\s\S]*const parsed = Number\(raw\);/,
    "testnet soak supervisor env integer parsing must not accept broad Number(raw) coercion",
  );
  assert.match(
    soakSupervisorSource,
    /writeFileSync\(STATUS_TMP_PATH[\s\S]*renameSync\(STATUS_TMP_PATH, STATUS_PATH\)/,
    "testnet soak status must be atomically replaced",
  );
  assert.match(
    soakSupervisorSource,
    /stopChild\(canary\)[\s\S]*stopChild\(server\)/,
    "testnet soak supervisor must stop both managed children on completion or failure",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /Number\(status\?\.supervisorPid\)|Number\(lock\?\.pid\)|Number\(JSON\.parse\(readFileSync\(LOCK_PATH, "utf8"\)\)\.pid\)/,
    "testnet soak supervisor must not broad-coerce status or lock PIDs",
  );
  assert.match(
    soakSupervisorSource,
    /MAX_SOAK_STATUS_JSON_BYTES = 128 \* 1024[\s\S]*MAX_SOAK_LOCK_JSON_BYTES = 4 \* 1024[\s\S]*function readJson\(path, maxBytes = MAX_SOAK_STATUS_JSON_BYTES\)[\s\S]*const stats = statSync\(path\)[\s\S]*!stats\.isFile\(\) \|\| stats\.size > maxBytes[\s\S]*JSON\.parse\(readFileSync\(path, "utf8"\)\)[\s\S]*readJson\(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES\)/,
    "testnet soak supervisor status and lock JSON reads must be size-gated before parsing",
  );
  assert.match(
    soakSupervisorSource,
    /existsSync\(LOCK_PATH\)[\s\S]*statSync\(LOCK_PATH\)\.size > MAX_SOAK_LOCK_JSON_BYTES[\s\S]*lock file is too large to validate safely[\s\S]*const previousLock = readJson\(LOCK_PATH, MAX_SOAK_LOCK_JSON_BYTES\)[\s\S]*parseTrackedPid\(previousLock\?\.pid\)[\s\S]*parseProcessStartToken\(previousLock\?\.supervisorStartToken\)/,
    "testnet soak startup must fail closed on oversized lock files before stale-lock cleanup",
  );
  assert.match(
    soakSupervisorSource,
    /status: "stopped"[\s\S]*stopReason: "operator-stop"[\s\S]*removeLockFile/,
    "testnet soak stop command must repair Windows stale status and remove its matching lock",
  );
  assert.match(
    soakSupervisorSource,
    /function removeLockFile\(\)[\s\S]*fileExists\(LOCK_PATH\)[\s\S]*rmSync\(LOCK_PATH/,
    "managed soak lock cleanup must only remove regular lock files",
  );
  assert.match(
    soakSupervisorSource,
    /existsSync\(LOCK_PATH\)[\s\S]*!fileExists\(LOCK_PATH\)[\s\S]*lock path exists but is not a file/,
    "managed soak startup must fail closed when the lock path is not a file",
  );
  assert.match(
    soakSupervisorSource,
    /createReadStream[\s\S]*summarizeLiveLog[\s\S]*uniqueTxHashes[\s\S]*duplicateNonces/,
    "testnet soak status command must stream compact transaction progress without loading raw artifacts into memory",
  );
  assert.match(
    soakSupervisorSource,
    /printSafeStatus[\s\S]*liveLogReady[\s\S]*hasLiveLog: liveLogReady[\s\S]*progress/,
    "testnet soak status command must emit compact state and progress without raw artifact contents and without treating non-files as live logs",
  );
  assert.match(
    soakSupervisorSource,
    /function fileExists\(path\)[\s\S]*statSync\(path\)\.isFile\(\)[\s\S]*if \(!path \|\| !fileExists\(path\)\) return summary/,
    "testnet soak status command must reject directory live-log inputs before streaming",
  );
  assert.match(
    soakSupervisorSource,
    /STATUS_SUMMARY_ONLY[\s\S]*diskCapacity[\s\S]*failedBetErrorKinds[\s\S]*failedBetFamilies[\s\S]*failedBetModes[\s\S]*failedBetStages[\s\S]*maxConsecutiveFailedBetsByRole[\s\S]*uniqueTxHashes[\s\S]*duplicateNonces[\s\S]*healthGrowth/,
    "testnet soak summary mode must retain sanitized operational and failure counters without raw event payloads",
  );
  assert.match(
    soakSupervisorSource,
    /function formatStatusCounts\(counts\)[\s\S]*safePositiveStatusCount\(count\)[\s\S]*function safePositiveStatusCount\(value\)[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > 0n && parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null/,
    "testnet soak compact status counters must be BigInt-bound before Number narrowing",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /Number\(count\) > 0/,
    "testnet soak compact status counters must not use broad Number(count) coercion",
  );
  assert.match(
    soakSupervisorSource,
    /status\?\.artifacts\?\.liveLog \|\| readLiveLogPath\(\)/,
    "running soak status must recover the JSONL marker written after the initial status snapshot",
  );
  assert.match(
    soakSupervisorSource,
    /LIVE_LOG_MARKER_SCAN_BYTES[\s\S]*function readLiveLogPath[\s\S]*readSync/,
    "running soak status must scan only a bounded wrapper-log prefix to recover the JSONL marker",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /readFileSync\(CANARY_LOG_PATH,\s*"utf8"\)\.match/,
    "running soak status must not load the full wrapper log when recovering the JSONL marker",
  );
  assert.match(
    soakSupervisorSource,
    /numericSummary[\s\S]*p95[\s\S]*growthSummary[\s\S]*estimateGasRetries[\s\S]*rpcFailoverInjectionEvents[\s\S]*healthGrowth/,
    "running soak status must summarize latency, failover, and bounded health growth without raw telemetry",
  );
  assert.match(
    soakSupervisorSource,
    /SLOW_SEND_THRESHOLD_MS = 20_000[\s\S]*slowSendCount/,
    "running soak status must count send delays that cross the RPC timeout threshold",
  );
  assert.match(
    soakSupervisorSource,
    /SOAK_MIN_DISK_FREE_BYTES[\s\S]*while \(!existsSync\(capacityPath\)\)[\s\S]*assertDiskCapacity\(\)[\s\S]*acquireLock\(\)[\s\S]*managedRunStarted = true[\s\S]*writeStatus\("starting"\)/,
    "testnet soak must reject low disk capacity before starting runtime processes or transactions",
  );
  assert.match(
    soakSupervisorSource,
    /function bigIntToNonNegativeSafeInteger\(value\)[\s\S]*typeof value !== "bigint"[\s\S]*MAX_SAFE_INTEGER_BIGINT[\s\S]*diskFreeBytesNow: bigIntToNonNegativeSafeInteger\(freeBytes\)/,
    "testnet soak disk capacity summary must cap BigInt free-space evidence before publishing JSON numbers",
  );
  assert.doesNotMatch(
    soakSupervisorSource,
    /diskFreeBytesNow:\s*Number\(freeBytes\)/,
    "testnet soak disk capacity summary must not publish raw Number(freeBytes)",
  );
  assert.match(
    soakSupervisorSource,
    /SOAK_DISK_CHECK_INTERVAL_MS[\s\S]*function waitForExit\(child\)[\s\S]*setInterval[\s\S]*readDiskCapacitySummary\(\)[\s\S]*disk-capacity-below-minimum[\s\S]*disk-capacity-unavailable[\s\S]*stopChild\(child\)/,
    "running testnet soak must stop its managed canary when disk capacity becomes unsafe",
  );
  assert.match(
    soakSupervisorSource,
    /if \(managedRunStarted\) await shutdown\(message, 1\)/,
    "preflight failures must preserve the previous completed soak status and evidence pointers",
  );
  assert.match(
    cleanupNextCandidatesSource,
    /candidatePattern = \/\^\\\.next-candidate[\s\S]*dirname\(candidate\.path\) !== root[\s\S]*if \(apply\) rmSync/,
    "generated Next cleanup must default to dry-run and constrain recursive deletion to root candidate directories",
  );
  assert.match(
    soakSupervisorSource,
    /lastEventAt[\s\S]*secondsSinceLastEvent/,
    "running soak status must expose a compact event-age signal for stall diagnosis",
  );
  assert.match(
    clearPendingNonceSource,
    /function nonNegativeSafeInteger\(value: unknown\): number[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*pendingNonceGap: nonNegativeSafeInteger\(state\.gap\)[\s\S]*replacementCount: nonNegativeSafeInteger\(replacementCount \+ 1\)/,
    "pending-nonce recovery summary must normalize nonce-gap and replacement counters before publishing JSON",
  );
  assert.doesNotMatch(
    clearPendingNonceSource,
    /pendingNonceGap:\s*Number\(state\.gap\)|replacementCount:\s*replacementCount \+ 1,\s*pendingNonceGap:\s*Number\(state\.gap\)/,
    "pending-nonce recovery summary must not broad-coerce nonce gaps with Number(state.gap)",
  );
  assert.match(
    clearPendingNonceSource,
    /const MAX_REPLACEMENTS = 1[\s\S]*to: address,[\s\S]*value: 0n,[\s\S]*nonce: state\.latest,[\s\S]*gas: 21_000n[\s\S]*return;/,
    "pending-nonce recovery must replace only one blocked nonce with a bounded zero-value self-transfer",
  );
  assert.doesNotMatch(
    clearPendingNonceSource,
    /GAME_ABI|TOKEN_ABI|writeContract/,
    "pending-nonce recovery must not call the game contract or token contract",
  );
  const v10PreviewRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
  assert.match(
    v10PreviewRunbookSource,
    /soak:testnet:clear-pending:summary[\s\S]*pendingGap=0[\s\S]*wouldSend=false[\s\S]*do not execute anything[\s\S]*--execute --confirm-lowest-pending-nonce-replacement[\s\S]*never calls the game or token contracts[\s\S]*post-execution dry-run reports a zero gap/,
    "production runbook must document the bounded pending-nonce recovery procedure before soak restart",
  );
  const soakStatusDir = mkdtempSync(join(tmpdir(), "lore-soak-status-"));
  try {
    const soakStatusFixtureMinimumDiskBytes = 1;
    const soakStatusEnv = {
      ...process.env,
      SOAK_OUT_DIR: soakStatusDir,
      // Status aggregation fixtures must not inherit the host's capacity
      // threshold; the low-capacity branch is asserted explicitly below.
      SOAK_MIN_DISK_FREE_BYTES: String(soakStatusFixtureMinimumDiskBytes),
    };
    const soakLiveLogPath = join(soakStatusDir, "live.jsonl");
    writeFileSync(soakLiveLogPath, `${JSON.stringify({
      mode: "preflight",
      ok: false,
      role: "AUTOMINER_C",
      enoughEth: false,
      enoughToken: true,
      errorKind: "untrusted raw error text",
      timestamp: "2026-07-18T00:00:00.000Z",
    })}\n${JSON.stringify({
      mode: "preflight",
      ok: false,
      role: "AUTOMINER_A",
      enoughEth: true,
      enoughToken: true,
      errorKind: "pending-nonce-blocked",
      timestamp: "2026-07-18T00:00:01.000Z",
    })}\n${JSON.stringify({
      mode: "bitmap",
      ok: true,
      round: 0,
      epochBound: true,
      txStatus: "success",
      role: "MANUAL",
      epoch: "1",
      hash: `0x${"2".repeat(64)}`,
      noncePending: 0,
      timestamp: "2026-07-18T00:00:01.500Z",
    })}\n${JSON.stringify({
      mode: "single",
      ok: false,
      round: 0,
      errorKind: "network",
      role: "MANUAL",
      timestamp: "2026-07-18T00:00:02.000Z",
    })}\n${JSON.stringify({
      mode: "bitmap",
      ok: false,
      round: 1,
      errorKind: "untrusted raw error text",
      role: "AUTOMINER_A",
      timestamp: "2026-07-18T00:00:03.000Z",
    })}\n${JSON.stringify({
      mode: "arrays",
      ok: false,
      round: 2,
      errorKind: "receipt-timeout",
      role: "AUTOMINER_A",
      hash: `0x${"1".repeat(64)}`,
      txStatus: "pending",
      timestamp: "2026-07-18T00:00:04.000Z",
    })}\n${JSON.stringify({
      mode: "sameAmount",
      ok: false,
      round: 3,
      errorKind: "pending-nonce-blocked",
      role: "AUTOMINER_B",
      timestamp: "2026-07-18T00:00:05.000Z",
    })}\n`, "utf8");
    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "failed",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:01.000Z",
      exitCode: 1,
      stopReason: "canary-1",
      supervisorPid: -1,
      artifacts: { liveLog: soakLiveLogPath },
    })}\n`, "utf8");
    const soakStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakStatusResult.status, 0, soakStatusResult.stderr);
    const safeSoakStatus = JSON.parse(soakStatusResult.stdout);
    assert.deepEqual(safeSoakStatus.progress.preflightFailures, [
      { role: "AUTOMINER_C", reason: "insufficient-native-gas" },
      { role: "AUTOMINER_A", reason: "pending-nonce-blocked" },
    ]);
    assert.equal(safeSoakStatus.progress.successfulBets, 1);
    assert.equal(safeSoakStatus.progress.epochBoundBets, 1);
    assert.equal(safeSoakStatus.progress.epochUnboundBets, 0);
    assert.equal(safeSoakStatus.progress.failedBets, 4);
    assert.deepEqual(safeSoakStatus.progress.failedBetErrorKinds, {
      network: 1,
      unknown: 1,
      "receipt-timeout": 1,
      "pending-nonce-blocked": 1,
    });
    assert.deepEqual(safeSoakStatus.progress.failedBetFamilies, { network: 2, "missing-error": 1, "nonce-state": 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetModes, { single: 1, bitmap: 1, arrays: 1, sameAmount: 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetRoles, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.consecutiveFailedBetsByRole, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.maxConsecutiveFailedBetsByRole, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetStages, { "pre-send": 3, "post-send-unconfirmed": 1 });
    assert.equal(safeSoakStatus.diskCapacity.diskCapacityAvailable, true);
    assert.equal(Number.isSafeInteger(safeSoakStatus.diskCapacity.diskFreeBytesNow), true);
    assert.equal(safeSoakStatus.diskCapacity.diskFreeMinimumBytes, soakStatusFixtureMinimumDiskBytes);
    assert.doesNotMatch(soakStatusResult.stdout, /untrusted raw error text/);
    const soakSummaryResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakSummaryResult.status, 0, soakSummaryResult.stderr);
    const safeSoakSummary = JSON.parse(soakSummaryResult.stdout);
    assert.equal(safeSoakSummary.progress.successfulBets, 1);
    assert.equal(safeSoakSummary.progress.epochBoundBets, 1);
    assert.equal(safeSoakSummary.progress.epochUnboundBets, 0);
    assert.deepEqual(safeSoakSummary.progress.successfulBetRoles, { MANUAL: 1 });
    assert.equal(safeSoakSummary.progress.failedBets, 4);
    assert.deepEqual(safeSoakSummary.progress.failedBetRoles, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetErrorKinds, {
      network: 1,
      unknown: 1,
      "receipt-timeout": 1,
      "pending-nonce-blocked": 1,
    });
    assert.deepEqual(safeSoakSummary.progress.failedBetFamilies, { network: 2, "missing-error": 1, "nonce-state": 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetModes, { single: 1, bitmap: 1, arrays: 1, sameAmount: 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetStages, { "pre-send": 3, "post-send-unconfirmed": 1 });
    assert.deepEqual(safeSoakSummary.progress.maxConsecutiveFailedBetsByRole, {
      MANUAL: 1,
      AUTOMINER_A: 2,
      AUTOMINER_B: 1,
    });
    assert.equal(safeSoakSummary.progress.duplicateNonces, 0);
    assert.equal(safeSoakSummary.diskCapacity.diskCapacityAvailable, true);
    assert.equal(Number.isSafeInteger(safeSoakSummary.diskCapacity.diskFreeBytesNow), true);
    assert.equal(safeSoakSummary.diskCapacity.diskFreeMinimumBytes, soakStatusFixtureMinimumDiskBytes);
    assert.doesNotMatch(soakSummaryResult.stdout, /untrusted raw error text/);
    const soakCompactResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--compact"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakCompactResult.status, 0, soakCompactResult.stderr);
    assert.match(
      soakCompactResult.stdout,
      /status=failed dry=true alive=false stop=canary-1 ok=1 bound=1 unbound=0 fail=4 roles=MANUAL=1\/AUTOMINER_A=2,AUTOMINER_B=1,MANUAL=1 epochs=1 tx=1 nonces=1 dupTx=0 dupNonce=0 rev=0 health=0\/0 rpc=0 gas=0 resolver=0 slow=0 p95=n\/a diskLow=false diskFree=\d+ preflight=AUTOMINER_C:insufficient-native-gas,AUTOMINER_A:pending-nonce-blocked fk=network=1,pending-nonce-blocked=1,receipt-timeout=1,unknown=1 ff=missing-error=1,network=2,nonce-state=1/,
      "managed soak compact status must surface safe one-line aggregates without raw logs or addresses",
    );
    assert.doesNotMatch(soakCompactResult.stdout, /0x[a-fA-F0-9]{40}|untrusted raw error text|\{|\}/);
    const lowDiskSoakSummaryResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: { ...soakStatusEnv, SOAK_MIN_DISK_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) },
      encoding: "utf8",
    });
    assert.equal(lowDiskSoakSummaryResult.status, 1, lowDiskSoakSummaryResult.stderr);
    const lowDiskSoakSummary = JSON.parse(lowDiskSoakSummaryResult.stdout);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskCapacityAvailable, true);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskFreeBelowMinimum, true);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskFreeMinimumBytes, Number.MAX_SAFE_INTEGER);

    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "failed",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:01.000Z",
      exitCode: 1,
      stopReason: "canary-directory-log",
      supervisorPid: -1,
      artifacts: { liveLog: soakStatusDir },
    })}\n`, "utf8");
    const soakDirectoryLogResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakDirectoryLogResult.status, 0, soakDirectoryLogResult.stderr);
    const safeDirectoryLogSummary = JSON.parse(soakDirectoryLogResult.stdout);
    assert.equal(safeDirectoryLogSummary.hasLiveLog, false, "directory live-log paths must not be reported as present");
    assert.equal(safeDirectoryLogSummary.progress.successfulBets, 0, "directory live-log paths must not be streamed");

    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "running",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      supervisorPid: "1e3",
      artifacts: { liveLog: soakLiveLogPath },
    })}\n`, "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), `${JSON.stringify({
      pid: "1e3",
      startedAt: "2026-07-18T00:00:00.000Z",
    })}\n`, "utf8");
    const malformedPidStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(malformedPidStatusResult.status, 0, malformedPidStatusResult.stderr);
    const malformedPidStatus = JSON.parse(malformedPidStatusResult.stdout);
    assert.equal(malformedPidStatus.supervisorAlive, false, "malformed matching PID strings must not count as an alive managed supervisor");
    writeFileSync(join(soakStatusDir, "status.json"), JSON.stringify({
      status: "running",
      supervisorPid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
      padding: "x".repeat(128 * 1024),
    }), "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), JSON.stringify({
      pid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
    }), "utf8");
    const oversizedStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(oversizedStatusResult.status, 0, oversizedStatusResult.stderr);
    const oversizedStatus = JSON.parse(oversizedStatusResult.stdout);
    assert.equal(oversizedStatus.status, "not-started", "oversized status JSON must not be parsed as trusted running state");
    assert.equal(oversizedStatus.supervisorAlive, false, "oversized status JSON must not combine with lock evidence to mark a supervisor alive");
    writeFileSync(join(soakStatusDir, "status.json"), JSON.stringify({
      status: "running",
      dryRun: true,
      supervisorPid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
    }), "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), JSON.stringify({
      pid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
      padding: "x".repeat(4 * 1024),
    }), "utf8");
    const oversizedLockStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(oversizedLockStatusResult.status, 0, oversizedLockStatusResult.stderr);
    const oversizedLockStatus = JSON.parse(oversizedLockStatusResult.stdout);
    assert.equal(oversizedLockStatus.status, "running", "oversized lock JSON must not hide the bounded status JSON");
    assert.equal(oversizedLockStatus.supervisorAlive, false, "oversized lock JSON must not be parsed as matching supervisor evidence");
  } finally {
    rmSync(soakStatusDir, { recursive: true, force: true });
  }
  assert.match(
    analyzeCanarySource,
    /successful health samples[\s\S]*failed health samples/,
    "strict canary proof must reject incomplete health telemetry when sampling was enabled",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_ROLES \?\? "MANUAL,AUTOMINER_A,AUTOMINER_B"/,
    "live canary default role set must stay MANUAL/AUTOMINER_A/AUTOMINER_B unless explicitly overridden",
  );
  assert.match(
    liveRoundCanarySource,
    /SAFE_ROLE_NAMES[\s\S]*MANUAL[\s\S]*AUTOMINER_A[\s\S]*AUTOMINER_B[\s\S]*AUTOMINER_C[\s\S]*LIVE_TEST_ROLES contains unsupported role/,
    "live canary must reject unsupported role overrides before wallet lookup",
  );
  assert.match(
    liveRoundCanarySource,
    /ROLES\.length === 0[\s\S]*LIVE_TEST_ROLES must include at least one supported role[\s\S]*new Set\(ROLES\)\.size !== ROLES\.length[\s\S]*LIVE_TEST_ROLES contains duplicate roles/,
    "live canary must reject empty and duplicate role overrides before wallet lookup",
  );
  assert.match(
    soakSupervisorSource,
    /LIVE_TEST_ROLES: process\.env\.LIVE_TEST_ROLES \|\| "MANUAL,AUTOMINER_A,AUTOMINER_B"/,
    "managed soak supervisor must pass the same three-role default to the live canary",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_INJECT_RPC_FAILOVER[\s\S]*Injected RPC transport failure before dispatch[\s\S]*fallback\(transports\)/,
    "live canary RPC injection must fail before dispatch and exercise the configured fallback transport",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_MIN_TOTAL_BET_AMOUNT/,
    "live canary stress mode must configure a minimum total bet amount per tx",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_MAX_TOTAL_BET_AMOUNT/,
    "live canary stress mode must configure a maximum total bet amount per tx",
  );
  assert.match(
    liveRoundCanarySource,
    /targetTotalAmount/,
    "live canary logs must preserve requested total amount before per-tile normalization",
  );
  assert.match(
    liveRoundCanarySource,
    /tileCount/,
    "live canary logs must include tile count for stress analysis",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_VERBOSE_WALLETS/,
    "live canary must keep detailed wallet inventory behind an explicit opt-in",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_VERBOSE_TARGETS[\s\S]*contract=\$\{VERBOSE_TARGETS \? CONTRACT_ADDRESS : "configured"\}[\s\S]*token=\$\{VERBOSE_TARGETS \? LINEA_TOKEN_ADDRESS : "configured"\}/,
    "live canary must keep contract and token addresses behind an explicit opt-in for routine dry-runs",
  );
  assert.match(
    liveRoundCanarySource,
    /CANONICAL_INTEGER_ENV_RE[\s\S]*function parseIntegerEnv\(name: string, fallbackValue: number, min: number, max: number\)[\s\S]*CANONICAL_INTEGER_ENV_RE\.test\(raw\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "live canary integer env parsing must require canonical safe integers before dry-run or live setup",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /function parseIntegerEnv\(name: string, fallbackValue: number, min: number, max: number\)[\s\S]*const parsed = Number\(raw\);\s*if \(!Number\.isInteger\(parsed\)/,
    "live canary integer env parsing must not accept exponent, fractional, or leading-zero values through broad Number(raw) coercion",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_REPEAT_SAME_BET[\s\S]*repeat: true[\s\S]*if \(REPEAT_SAME_BET\) throw error/,
    "live canary fee measurement must be explicit and stop after a failed duplicate bet",
  );
  assert.match(
    liveRoundCanarySource,
    /walletPreflight ready=.*roles=.*\n.*if \(VERBOSE_WALLET_PREFLIGHT\) console\.table\(rows\)/s,
    "live canary must default to a redacted wallet preflight summary",
  );
  assert.match(
    liveRoundCanarySource,
    /let emptyResolveBootstrapUsed = false[\s\S]*emptyEpoch && \(!ALLOW_EMPTY_RESOLVE \|\| emptyResolveBootstrapUsed\)\) return[\s\S]*emptyEpoch && receipt\.status === "success"\) emptyResolveBootstrapUsed = true/,
    "live canary must allow at most one explicit empty-epoch bootstrap",
  );
  assert.match(
    liveRoundCanarySource,
    /RESOLVE_GAS_FLOOR[\s\S]*gasEstimate > RESOLVE_GAS_FLOOR \? gasEstimate : RESOLVE_GAS_FLOOR[\s\S]*gasEstimate: gasEstimate\.toString\(\)[\s\S]*gasLimit: gas\.toString\(\)/,
    "resolver canary must protect variable randomness branches with a floor and preserve estimate-versus-limit evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /function bigintDeltaToBoundedSeconds\(upper: bigint, lower: bigint\)[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*Number\.MIN_SAFE_INTEGER[\s\S]*const secondsLeft = bigintDeltaToBoundedSeconds\(endTime, block\.timestamp\)/,
    "live canary must bound epoch-window second deltas before safe-window decisions",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /(^|[^A-Za-z0-9_])Number\(endTime - block\.timestamp\)/,
    "live canary must not broadly coerce epoch-window second deltas",
  );
  assert.match(
    liveRoundCanarySource,
    /window\.secondsLeft <= 0[\s\S]*epochData\[0\] === 0n\) return \{ \.\.\.window, atomicAdvance: true \}[\s\S]*recordedEpoch = atomicAdvance && receipt\.status === "success" \? epoch \+ 1n : epoch/,
    "live canary must atomically advance an expired empty epoch without paying the resolver",
  );
  assert.match(
    liveRoundCanarySource,
    /window\.secondsLeft <= 0[\s\S]*params\.afterEpoch == null \|\| window\.epoch >= params\.afterEpoch[\s\S]*epochData\[0\] === 0n\) return \{ \.\.\.window, atomicAdvance: true \}/,
    "live canary must recover from a reverted bet that leaves the same expired epoch empty",
  );
  assert.match(
    liveRoundCanarySource,
    /errorKind: receipt\.status === "reverted" \? "contract-revert" : undefined/,
    "live canary must classify confirmed receipt reverts without preserving raw provider errors",
  );

  const indexerSource = readFileSync("scripts/indexer.ts", "utf8");
  assert.match(
    indexerSource,
    /function filterLogsByTopics[\s\S]*topics\.every/,
    "indexer reconciliation must locally verify every requested topic",
  );
  assert.match(
    indexerSource,
    /fetchAllLogs[\s\S]*fetchLogsByTopicsAdaptive\(\[\], "ContractEvents"/,
    "indexer must fetch each contract chunk once per independent RPC, then classify topics locally",
  );
  assert.match(
    indexerSource,
    /const REPAIR_CHUNK_BLOCKS = 10_000n/,
    "indexer repair must stay within the confirmed Sepolia RPC log range",
  );
  assert.match(
    indexerSource,
    /RECONCILE_SCAN_CHUNK_BLOCKS = CHUNK_BLOCKS[\s\S]*recentCandidate[\s\S]*recentCandidate > INDEXER_START_BLOCK/,
    "indexer reconcile must stay within the supported log range and never scan before deployment",
  );
  assert.match(
    indexerSource,
    /recordIndexerWatchFailure\(consecutiveFailures, WATCH_FAILURE_LIMIT\)[\s\S]*Persistent watch failure threshold reached; exiting for supervisor restart[\s\S]*process\.exit\(1\)/,
    "persistent indexer watch failures must exit for supervisor restart",
  );
  assert.match(
    indexerSource,
    /watchTimer = setInterval[\s\S]*await runIndexerPass\(\);[\s\S]*consecutiveFailures = 0;/,
    "a successful indexer watch cycle must reset the failure threshold",
  );
  assert.match(
    indexerSource,
    /function parseChainCurrentEpochNumber\(value: bigint, observedBlock: bigint\)[\s\S]*parsePlausibleCurrentEpoch\(value, INDEXER_START_BLOCK, observedBlock\)[\s\S]*const currentEpochNumber = parseChainCurrentEpochNumber\(currentEpoch, currentBlock\)[\s\S]*storagePut\("gamedata\/_meta\/currentEpoch", currentEpochNumber\)[\s\S]*createReconcileEpochPlan\(\{[\s\S]*currentEpoch: currentEpochNumber/,
    "indexer must safely narrow chain currentEpoch before metadata writes and reconcile range construction",
  );
  assert.match(
    indexerSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*CANONICAL_INDEXED_EPOCH_RE = \/\^\[1-9\]\\d\{0,15\}\$\/[\s\S]*function parseIndexedEpochKey\(value: string\)[\s\S]*CANONICAL_INDEXED_EPOCH_RE\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const n = parseIndexedEpochKey\(key\)/,
    "indexer reconcile must BigInt-bound stored epoch keys before missing-epoch checks",
  );
  assert.doesNotMatch(
    indexerSource,
    /(^|[^A-Za-z0-9_])Number\(currentEpoch\)/,
    "indexer must not broadly coerce chain currentEpoch evidence",
  );
  assert.doesNotMatch(
    indexerSource,
    /function parseIndexedEpochKey\(value: string\)\s*{\s*if \(!CANONICAL_INDEXED_EPOCH_RE\.test\(value\)\) return null;\s*const parsed = Number\(value\)|const n = Number\(key\)[\s\S]*Number\.isInteger\(n\)/,
    "indexer reconcile must not broadly coerce stored epoch keys",
  );
  assert.match(
    indexerSource,
    /function buildNormalizedEventId\(log: Log\)[\s\S]*!log\.transactionHash \|\| log\.logIndex === null \|\| log\.logIndex === undefined[\s\S]*const normalizedHash = log\.transactionHash\.toLowerCase\(\)\.trim\(\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalizedHash\)[\s\S]*return `\$\{normalizedHash\}_\$\{log\.logIndex\.toString\(\)\}`/,
    "indexer normalized transaction events must require a full 32-byte tx hash and log index before building storage ids",
  );
  assert.doesNotMatch(
    indexerSource,
    /return `\$\{log\.transactionHash\.toLowerCase\(\)\}_\$\{log\.logIndex\.toString\(\)\}`/,
    "indexer normalized transaction events must not use raw transactionHash strings as storage ids",
  );
  assert.match(
    indexerSource,
    /buildIndexerBetIdentity,[\s\S]*const identity = buildIndexerBetIdentity\([\s\S]*normalizedBet\.logIndex[\s\S]*if \(identity === null\) continue;[\s\S]*patch\[identity\.id\]/,
    "indexer bet writes must use the shared transaction-hash and log-index identity boundary",
  );
  assert.doesNotMatch(
    indexerSource,
    /\/\^0x\[0-9a-f\]\+\$\/\.test\(normalizedHash\)/,
    "indexer bet storage keys must not accept short or malformed tx hashes as tx identity",
  );
  assert.doesNotMatch(
    indexerSource,
    /id:\s*`\$\{log\.transactionHash \?\? "nohash"\}_\$\{log\.logIndex\?\.toString\(\) \?\? "0"\}`/,
    "indexer normalized claim/dust/resolver/fee events must not collapse partial logs into nohash_0 ids",
  );
  assert.match(
    liveRoundCanarySource,
    /afterEpoch\?: bigint \| null[\s\S]*window\.epoch > params\.afterEpoch[\s\S]*lastAttemptedEpoch = BigInt\(event\.epoch \?\? epoch\)/,
    "canary must require a strictly newer epoch and retain the actual epoch after an atomic advance",
  );
  const walletPlaytestSource = readFileSync("scripts/playtest-wallet.ts", "utf8");
  assert.match(
    walletPlaytestSource,
    /rpcCount=\$\{rpcUrls\.length\}/,
    "wallet playtest must report only RPC count by default",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /rpc=\$\{rpcUrls\[0\]\}|depositsJson:|rebatesJson:/,
    "wallet playtest must not print raw RPC URLs or API payloads",
  );
  assert.match(
    walletPlaytestSource,
    /MAX_PLAYTEST_JSON_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function readBoundedResponseText[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*function parseContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "wallet playtest API reads must strictly parse and bound response bodies",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "wallet playtest API reads must not broadly coerce content-length headers",
  );
  assert.match(
    walletPlaytestSource,
    /API_FETCH_TIMEOUT_MS[\s\S]*fetchJson[\s\S]*AbortSignal\.timeout\(API_FETCH_TIMEOUT_MS\)[\s\S]*accept: "text\/html"[\s\S]*AbortSignal\.timeout\(API_FETCH_TIMEOUT_MS\)/,
    "wallet playtest API and home probes must use bounded request timeouts",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /response\.text\(\)/,
    "wallet playtest must not read unbounded API response text",
  );
  assert.match(
    walletPlaytestSource,
    /supportsEpochBoundBets[\s\S]*getBytecode[\s\S]*CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*placeBatchBetsBitmapForEpoch[\s\S]*\[epoch, tileIdsToMask\(tiles\), amount\]/,
    "wallet playtest must detect and use the protected epoch-bound bitmap path",
  );
  assert.match(
    walletPlaytestSource,
    /const singleTx = useEpochBoundBets[\s\S]*const batchTx = useEpochBoundBets/,
    "wallet playtest must keep both V10 sends on the protected path",
  );
  assert.match(
    walletPlaytestSource,
    /EXECUTE_REQUESTED = process\.argv\.includes\("--execute"\)[\s\S]*LIVE_EXECUTION_CONFIRMED = process\.env\.TEST_WALLET_EXECUTE === "1" && EXECUTE_REQUESTED[\s\S]*DRY_RUN = !LIVE_EXECUTION_CONFIRMED/,
    "wallet playtest must default to dry-run and require both an env flag and execute flag for live execution",
  );
  assert.match(
    walletPlaytestSource,
    /EXECUTE_REQUESTED && process\.env\.TEST_WALLET_EXECUTE !== "1"[\s\S]*Refusing wallet playtest execution without TEST_WALLET_EXECUTE=1[\s\S]*account = LIVE_EXECUTION_CONFIRMED && process\.env\.TEST_WALLET_PRIVATE_KEY/,
    "wallet playtest must fail closed on --execute alone before loading signing material",
  );
  assert.match(
    liveRoundCanarySource,
    /const DRY_RUN = !LIVE_EXECUTION_CONFIRMED[\s\S]*PUBLIC_ADDRESS_ENV_PATH = "\.env\.live-test-addresses"[\s\S]*loadPublicAddressEnvFileIfPresent\(\);[\s\S]*DRY_RUN && hasSigningMaterialInEnvironment\(\)[\s\S]*function loadWallets\(\)[\s\S]*loadSigningEnvFileIfPresent\(\)[\s\S]*function loadDryRunWallets\(\)[\s\S]*LORE_LIVE_TEST_\$\{role\}_ADDRESS[\s\S]*const wallets = DRY_RUN \? loadDryRunWallets\(\) : loadWallets\(\)/,
    "live canary dry-run must read only public role addresses and defer wallet-key loading to explicit execution",
  );
  assert.match(
    liveRoundCanarySource,
    /await runPreflight\(logPath, publicClient, wallets, plannedSpendByRole\);\s*if \(DRY_RUN\) return;[\s\S]*LORE_LIVE_TEST_RESOLVER_PRIVATE_KEY[\s\S]*privateKeyToAccount/,
    "live canary dry-run must not parse optional resolver signing material before returning",
  );
  const v10DryRunPreviewSource = readFileSync("scripts/create-v10-canary-dry-run-preview.mjs", "utf8");
  const v10DryRunPreviewCheckSource = readFileSync("scripts/check-v10-dry-run-preview.mjs", "utf8");
  assert.equal(
    packageScripts["preview:canary:v10:dry-run"],
    "node scripts/create-v10-canary-dry-run-preview.mjs",
    "V10 dry-run Preview must expose a one-command reproducible operator path",
  );
  assert.equal(
    packageScripts["preview:canary:v10:dry-run:summary"],
    "node scripts/check-v10-dry-run-preview.mjs",
    "V10 dry-run Preview must expose a lightweight validator for autonomous status without rerunning live dry-run commands",
  );
  assert.equal(
    packageScripts["preview:canary:v10:authorization-ready:summary"],
    "node scripts/check-v10-dry-run-preview.mjs --require-fresh-authorization",
    "V10 dry-run Preview must expose a strict freshness validator before requesting real-transaction authorization",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /staleError\.previewAgeMinutes = Math\.floor\(ageMs \/ 60_000\)[\s\S]*previewAgeMinutes[\s\S]*ageMinutes: previewAgeMinutes/,
    "V10 dry-run Preview stale authorization failures must report the actual Preview age instead of letting dashboards show ageMinutes=0",
  );
  assert.match(
    v10DryRunPreviewSource,
    /plan:canary:v10:postdeploy:summary[\s\S]*soak:testnet:clear-pending:summary[\s\S]*live:canary:v10:matrix[\s\S]*analyze-live-canary-proof\.mjs[\s\S]*--profile=v10-matrix[\s\S]*--require-epoch-bound[\s\S]*--require-v10-gas-matrix/,
    "V10 dry-run Preview must compose the read-only planner, pending nonce dry-run, V10 matrix dry-run, and strict analyzer",
  );
  assert.match(
    v10DryRunPreviewSource,
    /LIVE_TEST_DRY_RUN: "1"[\s\S]*LIVE_TEST_EXECUTE: "0"[\s\S]*SOAK_EXECUTE_LIVE: "0"[\s\S]*TEST_WALLET_EXECUTE: "0"/,
    "V10 dry-run Preview must force child commands into non-executing dry-run mode",
  );
  assert.match(
    v10DryRunPreviewSource,
    /parseSummaryTimeoutEnv[\s\S]*V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS", 240_000[\s\S]*timeout: CHILD_TIMEOUT_MS/,
    "V10 dry-run Preview timeout env must be canonical decimal and range checked before child process execution",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /Number\.parseInt\(process\.env\.V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS|Number\.isFinite\(CHILD_TIMEOUT_MS\)/,
    "V10 dry-run Preview timeout env must not use partial parseInt or broad numeric fallback",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /--execute-live|--execute"|--confirm-lowest-pending-nonce-replacement|LIVE_TEST_EXECUTE: "1"|SOAK_EXECUTE_LIVE: "1"|TEST_WALLET_EXECUTE: "1"/,
    "V10 dry-run Preview must not contain live execution flags or enabling env values",
  );
  assert.match(
    v10DryRunPreviewSource,
    /redactProofText[\s\S]*docs["'], ["']v10-canary-dry-run-preview\.md[\s\S]*dryRunProofBlocksG10G11[\s\S]*Fresh Consent Boundary/,
    "V10 dry-run Preview must write a redacted markdown Preview and keep G10/G11 blocked until live evidence exists",
  );
  assert.match(
    v10DryRunPreviewSource,
    /MAX_PREVIEW_FIELD_CHARS[\s\S]*function bullet\(label, value\)[\s\S]*formatPreviewField\(value\)[\s\S]*function formatPreviewField\(value\)[\s\S]*redactProofText\(String\(value\)\)[\s\S]*replace\(\/\\s\+\/g, " "\)[\s\S]*<truncated>/,
    "V10 dry-run Preview compact bullet fields must be redacted, single-line, and bounded",
  );
  assert.match(
    v10DryRunPreviewSource,
    /function extractCanaryLog\(output\)[\s\S]*safeCanaryLogPath\(raw\)[\s\S]*function safeCanaryLogPath\(value\)[\s\S]*path\.isAbsolute\(normalized\)[\s\S]*data[\s\S]*live-test-runs[\s\S]*\^live-canary-\[0-9TZ-\]\+\\\.jsonl\$/,
    "V10 dry-run Preview must accept only relative live-test-run canary logs before running the analyzer",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /function extractCanaryLog\(output\)[\s\S]*return extractValue\(output,[\s\S]*\?\? extractValue\(output,/,
    "V10 dry-run Preview must not pass raw child log paths directly into the analyzer",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /PREVIEW_PATH = path\.join\("docs", "v10-canary-dry-run-preview\.md"\)[\s\S]*MAX_PREVIEW_BYTES = 512 \* 1024[\s\S]*MAX_DRY_RUN_LOG_BYTES = 256 \* 1024[\s\S]*V10_DRY_RUN_PREVIEW_MAX_AGE_MS/,
    "V10 dry-run Preview validator must use bounded artifact reads and a freshness window",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*DECIMAL_INTEGER_RE[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "V10 dry-run Preview validator freshness env must be BigInt-bound before Number narrowing",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /not an authorization to send transactions[\s\S]*Do not execute any of the following without a fresh exact authorization[\s\S]*requireBullet\(overall, "transactionSent", "false"\)[\s\S]*requireBullet\(overall, "dryRunProofBlocksG10G11", "true"\)/,
    "V10 dry-run Preview validator must preserve non-authorization, fresh consent, no-transaction, and G10/G11 blocked boundaries",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /function safeCanaryLogPath\(value\)[\s\S]*path\.isAbsolute\(normalized\)[\s\S]*data[\s\S]*live-test-runs[\s\S]*\^live-canary-\[0-9TZ-\]\+\\\.jsonl\$[\s\S]*readBoundedText\(logPath, MAX_DRY_RUN_LOG_BYTES/,
    "V10 dry-run Preview validator must only validate bounded safe relative dry-run logs",
  );
  assert.doesNotMatch(
    v10DryRunPreviewCheckSource,
    /preview:canary:v10:dry-run|live:canary:v10:matrix|--execute-live|LIVE_TEST_EXECUTE: "1"|SOAK_EXECUTE_LIVE: "1"/,
    "V10 dry-run Preview validator must not rerun Preview commands or contain live execution flags",
  );
  assert.match(
    walletPlaytestSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describePlaytestError\(error: unknown\)[\s\S]*redactProofText\(/,
    "wallet playtest terminal diagnostics must use the shared proof redactor",
  );
  assert.match(
    walletPlaytestSource,
    /MAX_PLAYTEST_ERROR_CHARS[\s\S]*<truncated>[\s\S]*const bitmapMessage = describePlaytestError\(bitmapError\)[\s\S]*const message = describePlaytestError\(error\)[\s\S]*\[playtest\] failed: \$\{describePlaytestError\(error\)\}/,
    "wallet playtest fallback and fatal errors must be compact and bounded",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /console\.error\("\[playtest\] failed", error\)/,
    "wallet playtest must not print raw fatal Error objects",
  );
  const v10CompilerMatrixSource = readFileSync("scripts/benchmark-contract-v10.mjs", "utf8");
  const v10BenchmarkSource = readFileSync("scripts/benchmark-v10-linea-gas.ts", "utf8");
  assert.match(
    v10CompilerMatrixSource,
    /MAX_BENCHMARK_CONTRACT_SOURCE_BYTES = 2 \* 1024 \* 1024[\s\S]*function readBoundedUtf8File\(filePath, maxBytes, label\)[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to benchmark safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "V10 compiler matrix benchmark must size-gate local contract sources and imports before reading",
  );
  assert.match(
    v10CompilerMatrixSource,
    /function readImport\(importPath\)[\s\S]*path\.resolve\(importPath\)[\s\S]*path\.resolve\("node_modules", importPath\)[\s\S]*readBoundedUtf8File\(candidate, MAX_BENCHMARK_CONTRACT_SOURCE_BYTES[\s\S]*error\?\.code !== "ENOENT"[\s\S]*throw error/,
    "V10 compiler matrix benchmark must keep deterministic import lookup while failing closed on non-file or oversized matches",
  );
  assert.match(
    v10CompilerMatrixSource,
    /function compile\(\{ compiler, contractPath, contractName, runs, viaIR \}\)[\s\S]*readBoundedUtf8File\([\s\S]*contractPath[\s\S]*MAX_BENCHMARK_CONTRACT_SOURCE_BYTES[\s\S]*`contract source \$\{contractPath\}`[\s\S]*replace\(\/\\r\\n\?\//,
    "V10 compiler matrix benchmark must size-gate root contract sources before compiling",
  );
  assert.match(
    v10BenchmarkSource,
    /BEHAVIOR_ONLY_TIMEOUT_MS[\s\S]*withBenchmarkTimeout[\s\S]*behavior-benchmark-timeout/,
    "V10 behavior benchmark must fail closed instead of hanging indefinitely",
  );
  assert.match(
    v10BenchmarkSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*BEHAVIOR_ONLY_TIMEOUT_MS = parsePositiveIntegerEnv\("V10_BEHAVIOR_TIMEOUT_MS", 90_000, 1_000, 900_000\)[\s\S]*function parsePositiveIntegerEnv\(name: string, fallback: number, min: number, max: number\): number[\s\S]*function parsePositiveIntegerValue\(name: string, raw: string, min: number, max: number\): number[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*Number\.isSafeInteger\(numeric\)/,
    "V10 behavior benchmark timeout env must be canonical decimal and range checked before the timeout guard",
  );
  assert.match(
    v10BenchmarkSource,
    /function parsePositiveIntegerValue\(name: string, raw: string, min: number, max: number\): number[\s\S]*must be a canonical decimal integer[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*Number\.isSafeInteger\(numeric\)[\s\S]*v10RunsArg !== undefined[\s\S]*parsePositiveIntegerValue\("--v10-runs", v10RunsArg, 1, 1_000_000\)/,
    "V10 gas benchmark optimizer run CLI override must reject partial, malformed, and out-of-range values",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /behaviorOnlyTimeoutOverride|Number\.parseInt\(process\.env\.V10_BEHAVIOR_TIMEOUT_MS|Number\.parseInt\(v10RunsArg|const parsed = Number\(raw\)/,
    "V10 behavior benchmark timeout env and optimizer run override must not use partial parseInt coercion",
  );
  assert.match(
    v10BenchmarkSource,
    /type BenchmarkRow = \{[\s\S]*gasLimit: number;[\s\S]*gasDeltaVsV9\?: number;[\s\S]*function toSafeDisplayInteger\(value: bigint, label: string\): number[\s\S]*value < 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(value\)[\s\S]*const rows: BenchmarkRow\[\] = \[\][\s\S]*gasLimitNumber = toSafeDisplayInteger\(gasLimit[\s\S]*gasLimit: gasLimitNumber[\s\S]*gasLimit: toSafeDisplayInteger\(BigInt\(estimate\.gasLimit\)[\s\S]*baselineByCase[\s\S]*row\.gasLimit - baseline[\s\S]*row\.gasDeltaVsV9 >= 0/,
    "V10 gas benchmark must safely narrow RPC gas limits before report rows and regression deltas",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /Number\(BigInt\((?:estimate|jackpotCheckEstimate|jackpotAwardEstimate|emptyAdvanceEstimate)\.gasLimit\)\)|Number\((?:v9Deployment|v10Deployment)\.gasLimit\)|Number\(row\.gasLimit\)|Number\(row\.gasDeltaVsV9\)/,
    "V10 gas benchmark must not broadly coerce gas-limit or delta fields after parsing",
  );
  assert.match(
    v10BenchmarkSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*MAX_RPC_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*function parseContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*async function readBoundedJsonResponse[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*reader\.cancel[\s\S]*rpcRequest/,
    "V10 Linea gas benchmark RPC reads must strictly parse and bound JSON response bodies in the shared helper",
  );
  assert.match(
    v10BenchmarkSource,
    /MAX_BENCHMARK_SOURCE_BYTES = 2 \* 1024 \* 1024;[\s\S]*MAX_BENCHMARK_COMPILER_CONFIG_BYTES = 512 \* 1024;[\s\S]*MAX_PREPARED_INITCODE_BYTES = 256 \* 1024;[\s\S]*function readBoundedUtf8File\(filePath: string, maxBytes: number, label: string\): string[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to benchmark safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "V10 gas benchmark must size-gate local source, compiler config, and prepared initcode reads",
  );
  assert.match(
    v10BenchmarkSource,
    /JSON\.parse\([\s\S]*readBoundedUtf8File\([\s\S]*"contracts\/LineaOreV10\.compiler-config\.json"[\s\S]*MAX_BENCHMARK_COMPILER_CONFIG_BYTES[\s\S]*"V10 compiler config"/,
    "V10 gas benchmark must size-gate the compiler config before JSON parsing",
  );
  assert.match(
    v10BenchmarkSource,
    /function readImport\(importPath: string\)[\s\S]*path\.resolve\(importPath\)[\s\S]*path\.resolve\("node_modules", importPath\)[\s\S]*readBoundedUtf8File\(candidate, MAX_BENCHMARK_SOURCE_BYTES[\s\S]*NodeJS\.ErrnoException[\s\S]*code !== "ENOENT"[\s\S]*throw error/,
    "V10 gas benchmark must keep deterministic import lookup while failing closed on non-file or oversized matches",
  );
  assert.match(
    v10BenchmarkSource,
    /function compileContract\([\s\S]*readBoundedUtf8File\([\s\S]*contractPath[\s\S]*MAX_BENCHMARK_SOURCE_BYTES[\s\S]*`contract source \$\{contractPath\}`[\s\S]*replace\(\/\\r\\n\?\//,
    "V10 gas benchmark must size-gate root contract sources before compiling",
  );
  assert.match(
    v10BenchmarkSource,
    /if \(deploymentOnly\) \{[\s\S]*readBoundedUtf8File\([\s\S]*"\.tmp\/v10-canonical-initcode\.hex"[\s\S]*MAX_PREPARED_INITCODE_BYTES[\s\S]*"prepared V10 initcode"[\s\S]*prepared V10 initcode does not match/,
    "V10 deployment gas benchmark must size-gate prepared initcode before comparing it",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "V10 Linea gas benchmark RPC reads must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /response\.json\(\)/,
    "V10 Linea gas benchmark RPC reads must not use unbounded response.json",
  );
  const v10PostdeployPlanSource = readFileSync("scripts/plan-v10-postdeploy-canary.ts", "utf8");
  const sharedGameFunctions = new Set(
    gameConstants.GAME_ABI
      .filter((item) => item.type === "function")
      .map((item) => item.name),
  );
  const sharedGameEvents = new Set(
    gameConstants.GAME_EVENTS_ABI
      .filter((item) => item.type === "event")
      .map((item) => item.name),
  );
  const sharedTokenFunctions = new Set(
    gameConstants.TOKEN_ABI
      .filter((item) => item.type === "function")
      .map((item) => item.name),
  );
  assert.equal(
    sharedGameFunctions.has("epochRewardClaimed"),
    true,
    "the shared game ABI must expose aggregate reward claims for solvency planning",
  );
  assert.equal(
    sharedTokenFunctions.has("decimals"),
    true,
    "the shared token ABI must expose the 18-decimal runtime boundary",
  );
  const indexedFinancialEvents = [
    "BetPlaced",
    "BatchBetsPlaced",
    "BatchBetsSameAmountPlaced",
    "BatchBetsBitmapPlaced",
    "EpochResolved",
    "DailyJackpotAwarded",
    "WeeklyJackpotAwarded",
    "RewardClaimed",
    "RewardBatchClaimed",
    "RebateClaimed",
    "RebateBatchClaimed",
    "RewardDustSettled",
    "RebateDustSettled",
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "ProtocolFeesFlushed",
  ];
  const indexerAbiSource = readFileSync("scripts/indexer.ts", "utf8");
  for (const eventName of indexedFinancialEvents) {
    assert.equal(
      sharedGameEvents.has(eventName),
      true,
      `shared GAME_EVENTS_ABI must preserve ${eventName} for frontend/indexer compatibility`,
    );
    assert.match(
      indexerAbiSource,
      new RegExp(`eventName: "${eventName}"|eventName !== "${eventName}"|eventName === "${eventName}"|eventName, "${eventName}"`),
      `indexer must keep an explicit ${eventName} decode/handler reference`,
    );
  }
  for (const aggregateDustEvent of ["RewardDustBatchSettled", "RebateDustBatchSettled"]) {
    assert.equal(
      sharedGameEvents.has(aggregateDustEvent),
      true,
      `shared GAME_EVENTS_ABI must preserve ${aggregateDustEvent} for frontend compatibility`,
    );
    assert.doesNotMatch(
      indexerAbiSource,
      new RegExp(aggregateDustEvent),
      `${aggregateDustEvent} is aggregate-only and must not double-count the per-epoch dust settlement index`,
    );
  }
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /createWalletClient|privateKey|writeContract|sendTransaction|\bwalletClient\b/,
    "V10 post-deploy planning must remain transaction-free and must not load signing material",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /\.env\.live-test-wallets/,
    "V10 post-deploy planning must never read the secret-bearing live wallet file",
  );
  assert.match(
    v10PostdeployPlanSource,
    /\.env\.live-test-addresses[\s\S]*replace\(\/\^\\uFEFF\/[\s\S]*public-only/,
    "V10 post-deploy planning must use a dedicated public-address file when process env is absent",
  );
  assert.match(
    v10PostdeployPlanSource,
    /function parsePublicAddressEnvLine\(line: string\)[\s\S]*replace\(\/\^export\\s\+\/[\s\S]*match\(\/\^\(\[A-Z0-9_\]\+\)\\s\*=\\s\*\(\.\*\?\)\\s\*\(\?:#\.\*\)\?\$\/\)[\s\S]*replace\(\/\^\["'\]\|\["'\]\$\/g, ""\)/,
    "V10 post-deploy planning must parse normal dotenv public-address lines without requiring exact KEY=value formatting",
  );
  assert.match(
    v10PostdeployPlanSource,
    /MAX_V10_COMPILATION_MANIFEST_BYTES = 512 \* 1024;[\s\S]*MAX_V10_PUBLIC_ADDRESS_FILE_BYTES = 64 \* 1024;[\s\S]*function readBoundedUtf8File\(filePath: string, maxBytes: number, label: string\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "V10 post-deploy planning must size-gate local manifest and public-address artifacts before reading",
  );
  assert.match(
    v10PostdeployPlanSource,
    /readRuntimeIdentityManifest\(\)[\s\S]*readBoundedUtf8File\([\s\S]*COMPILATION_MANIFEST_PATH[\s\S]*MAX_V10_COMPILATION_MANIFEST_BYTES[\s\S]*Canonical V10 compilation manifest/,
    "V10 post-deploy planning must size-gate the canonical compilation manifest before parsing",
  );
  assert.match(
    v10PostdeployPlanSource,
    /\.env\.live-test-addresses[\s\S]*existsSync\(addressFile\)[\s\S]*readBoundedUtf8File\([\s\S]*addressFile[\s\S]*MAX_V10_PUBLIC_ADDRESS_FILE_BYTES[\s\S]*public-only address file[\s\S]*replace\(\/\^\\uFEFF\//,
    "V10 post-deploy planning must reject directory or oversized public-address files before reading",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /fallback\([^;]*rank:\s*true/s,
    "one-shot V10 post-deploy planning must not keep the process alive with RPC ranking timers",
  );
  const v10SnapshotReadCalls = v10PostdeployPlanSource.split("client.readContract({").length - 1;
  const v10SnapshotReadPins = v10PostdeployPlanSource.split("...readSnapshot").length - 1;
  assert.equal(
    v10SnapshotReadPins,
    v10SnapshotReadCalls,
    "every V10 post-deploy contract read must use the fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const \[chainId, block\] = await Promise\.all[\s\S]*const snapshotBlock = block\.number;[\s\S]*getBytecode\(\{ address: CONTRACT_ADDRESS, blockNumber: snapshotBlock \}\)[\s\S]*snapshot: \{[\s\S]*blockNumber: snapshotBlock\.toString\(\)/,
    "V10 post-deploy identity and output must bind to one explicit block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /getBytecode\(\{ address: LINEA_TOKEN_ADDRESS, blockNumber: snapshotBlock \}\)[\s\S]*functionName: "decimals"[\s\S]*if \(!tokenBytecode\)[\s\S]*contractToken[\s\S]*if \(tokenDecimals !== 18\)[\s\S]*tokenBoundary: \{[\s\S]*runtimePresent: true[\s\S]*immutableMatch: true[\s\S]*decimals: tokenDecimals/,
    "V10 post-deploy planning must prove token runtime, immutable identity, and decimals before financial output",
  );
  assert.match(
    v10PostdeployPlanSource,
    /async function simulateAndEstimate\([\s\S]*snapshotBlock: bigint[\s\S]*simulateContract\(\{[\s\S]*blockNumber: snapshotBlock[\s\S]*estimateContractGas\(\{[\s\S]*blockNumber: snapshotBlock/,
    "positive V10 simulations and estimates must use the fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /async function requireExpectedRevert\([\s\S]*snapshotBlock: bigint[\s\S]*simulateContract\(\{[\s\S]*blockNumber: snapshotBlock[\s\S]*requireExpectedRevert\(client, call, snapshotBlock\)/,
    "negative V10 simulations must use the same fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /simulateContract[\s\S]*estimateContractGas[\s\S]*claimRewards[\s\S]*claimEpochsRebate[\s\S]*claimResolverRewards[\s\S]*flushProtocolFees[\s\S]*resolveEpoch/,
    "V10 post-deploy planning must simulate every remaining bounded mutation class",
  );
  assert.match(
    v10PostdeployPlanSource,
    /nextAuthorization: !adminStateClean[\s\S]*blockedBy: adminBlockReason[\s\S]*: resolveReady[\s\S]*transactionLimit: 1[\s\S]*rerunRequiredAfterReceipt: true[\s\S]*invalidatedByResolve: resolveReady/,
    "V10 post-deploy planning must block untrusted governance before isolating resolve from claims",
  );
  const v10ResolveBarrierIndex = v10PostdeployPlanSource.indexOf("const resolveReady =");
  const v10ClaimPlanningIndex = v10PostdeployPlanSource.indexOf("const rolesToPlan =");
  assert.ok(
    v10ResolveBarrierIndex >= 0 && v10ResolveBarrierIndex < v10ClaimPlanningIndex,
    "V10 post-deploy planning must decide the resolve barrier before discovering role claims",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const claimPlanningReady = scanComplete && !resolveReady && adminStateClean;[\s\S]*const rolesToPlan = claimPlanningReady \? roles : \[\];[\s\S]*if \(claimPlanningReady && \(ownerFees > 0n \|\| burnFees > 0n\)\)/,
    "V10 post-deploy planning must skip claim and fee-flush simulations while resolve or governance blocks the phase",
  );
  assert.match(
    v10PostdeployPlanSource,
    /V10_EXPECTED_CURRENT_OWNER[\s\S]*V10_EXPECTED_CURRENT_FEE_RECIPIENT[\s\S]*V10_EXPECTED_CURRENT_EPOCH_DURATION[\s\S]*functionName: "owner"[\s\S]*functionName: "feeRecipient"[\s\S]*functionName: "epochDuration"[\s\S]*const ownerMatches =[\s\S]*const feeRecipientMatches =[\s\S]*const epochDurationMatches =[\s\S]*const adminBlockReason =[\s\S]*const adminStateClean = adminBlockReason === null;[\s\S]*const resolvePlanningReady = resolveReady && adminStateClean;[\s\S]*if \(resolvePlanningReady\)[\s\S]*recommendedResolveGasLimit = resolvePlanningReady/,
    "V10 post-deploy planning must fail closed before recommending mutations under unexpected or pending governance",
  );
  assert.match(
    v10PostdeployPlanSource,
    /function plannedCallCount\(ready: boolean\)[\s\S]*return ready \? 1 : 0[\s\S]*plannedTransactions:[\s\S]*plannedCallCount\(rewardEpochs\.length > 0\)[\s\S]*plannedCallCount\(rebateEpochs\.length > 0\)[\s\S]*plannedCallCount\(resolverReward > 0n\)[\s\S]*admin: \{[\s\S]*clean: adminStateClean[\s\S]*ownerMatch: ownerMatches[\s\S]*feeRecipientMatch: feeRecipientMatches[\s\S]*epochDurationMatch: epochDurationMatches[\s\S]*currentlySimulatedTransactions: claimPhaseTransactions \+ plannedCallCount\(resolvePlanningReady\)/,
    "V10 post-deploy output must expose governance matches without printing addresses and count only permitted simulations through explicit planned-call counters",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /Number\(resolvePlanningReady\)|Number\(rewardEpochs\.length > 0\)|Number\(rebateEpochs\.length > 0\)|Number\(resolverReward > 0n\)/,
    "V10 post-deploy planner must not count authorization calls through broad boolean-to-number coercion",
  );
  assert.match(
    v10PostdeployPlanSource,
    /operationalBoundary: \{[\s\S]*transactionSent: false[\s\S]*signingMaterialLoaded: false[\s\S]*walletClientCreated: false[\s\S]*contractWriteSubmitted: false[\s\S]*outputAddressFree: true[\s\S]*operationalBoundary: output\.operationalBoundary/,
    "V10 post-deploy summary must explicitly state that planning is transaction-free and does not load signing material",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /createWalletClient|privateKeyToAccount|sendTransaction|writeContract/,
    "V10 post-deploy planner must remain a read-only public-client planner with no wallet signing or write helpers",
  );
  assert.match(
    v10PostdeployPlanSource,
    /if \(resolveReady\) \{[\s\S]*negativeCalls\.push\([\s\S]*expectedError: "EpochClosing"[\s\S]*label: "funded expired protected bet"/,
    "V10 post-deploy planning must only expect EpochClosing from a currently funded expired epoch",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const openClaimWindowEpoch = resolvedEpochs\.find\([\s\S]*block\.timestamp < epoch\.resolvedAt \+ DUST_SETTLE_DELAY[\s\S]*expectedError: openClaimWindowEpoch \? "NoWinningBet" : "RewardClaimWindowExpired"[\s\S]*if \(openClaimWindowEpoch\) \{[\s\S]*DustSettlementDelayNotReached[\s\S]*openClaimWindowChecksApplied: Boolean\(openClaimWindowEpoch\)/,
    "V10 post-deploy claim and dust negatives must follow the one-year lifecycle instead of becoming stale",
  );
  assert.match(
    v10PostdeployPlanSource,
    /resolverRewardsByRole = new Map\([\s\S]*pendingResolverRewards[\s\S]*knownResolverLiability[\s\S]*resolverRewardsByRole\.get\(role\.role\)/,
    "V10 post-deploy planning must include known resolver liabilities without rereading them during claim planning",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const claimPhaseCalls: SanitizedPlannedCall\[\] = \[\];[\s\S]*functionName: "claimRewards"[\s\S]*functionName: "claimEpochsRebate"[\s\S]*functionName: "claimResolverRewards"[\s\S]*functionName: "flushProtocolFees"[\s\S]*claimPhaseCalls\.length !== claimPhaseTransactions[\s\S]*calls: claimPhaseCalls/,
    "V10 post-deploy authorization must expose one sanitized exact call per permitted claim or flush transaction",
  );
  assert.match(
    v10PostdeployPlanSource,
    /SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)[\s\S]*output\.nextAuthorization\.calls\.reduce[\s\S]*typeof call === "string" \? call : call\.functionName[\s\S]*callCounts/,
    "V10 post-deploy planner must support compact summary output without dropping resolve-only authorization calls",
  );
  assert.match(
    v10PostdeployPlanSource,
    /claimManifestGas[\s\S]*BigInt\(call\.estimatedGas\)[\s\S]*claimManifestTransfers[\s\S]*parseUnits\(call\.expectedTransferLinea, 18\)[\s\S]*claimManifestGas !== claimPhaseGas[\s\S]*claimManifestTransfers !== claimPhaseTransfers[\s\S]*recommendedGasLimit\) <= BigInt\(call\.estimatedGas\)/,
    "V10 post-deploy authorization must fail closed when exact call totals or gas limits diverge",
  );
  assert.match(
    v10PostdeployPlanSource,
    /type SanitizedPlannedCall = \{[\s\S]*role: RoleName;[\s\S]*functionName: PlannedCall\["functionName"\];[\s\S]*epochs: string\[\];[\s\S]*estimatedGas: string;[\s\S]*recommendedGasLimit: string;[\s\S]*expectedTransferLinea: string;/,
    "V10 post-deploy call manifests must remain address-free while carrying exact gas and transfer bounds",
  );
  assert.match(
    v10PostdeployPlanSource,
    /epochRewardClaimed[\s\S]*epoch\.rewardClaimed > epoch\.rewardPool \|\| epoch\.rebateClaimed > epoch\.rebatePool[\s\S]*outstandingRewardLiability \+= epoch\.rewardPool - epoch\.rewardClaimed[\s\S]*outstandingRebateLiability \+= epoch\.rebatePool - epoch\.rebateClaimed/,
    "V10 post-deploy planning must fail closed on overclaimed pools and retain every unsettled epoch liability",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const lowerBoundLiability =[\s\S]*currentData\[0\][\s\S]*rolloverPool[\s\S]*dailyJackpotPool[\s\S]*weeklyJackpotPool[\s\S]*ownerFees[\s\S]*burnFees[\s\S]*knownResolverLiability[\s\S]*outstandingRewardLiability[\s\S]*outstandingRebateLiability[\s\S]*covered: lowerBoundCovered[\s\S]*if \(!lowerBoundCovered \|\| contractBalance < claimPhaseTransfers\)/,
    "V10 post-deploy planning must enforce the complete observable liability lower bound",
  );
  assert.match(
    v10PostdeployPlanSource,
    /currentClaimPhase: \{[\s\S]*complete: claimPlanningReady[\s\S]*skipped: !claimPlanningReady[\s\S]*skipReason: claimPlanningSkipReason/,
    "V10 post-deploy output must explain when the claim phase was deliberately skipped",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const scanComplete = scanFrom === 1n[\s\S]*truncated: !scanComplete[\s\S]*transactionLimit: 0[\s\S]*resolved-history scan is truncated/,
    "V10 post-deploy planning must block claim and fee-flush authorization when history is truncated",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const READ_BATCH_SIZE = 4;[\s\S]*async function mapInBatches[\s\S]*values\.slice\(offset, offset \+ READ_BATCH_SIZE\)\.map\(mapper\)[\s\S]*readBatchSize: READ_BATCH_SIZE/,
    "V10 post-deploy discovery must expose and enforce bounded read concurrency",
  );
  assert.match(
    v10PostdeployPlanSource,
    /LineaOreV10\.compilation\.json[\s\S]*normalizedExecutableRuntimeSha256[\s\S]*runtimeImmutableReferences[\s\S]*normalizeExecutableRuntime/,
    "V10 post-deploy planning must bind deployed executable code to the canonical manifest",
  );
  const runtimeIdentityGateIndex = v10PostdeployPlanSource.indexOf("const runtimeIdentity = normalizeExecutableRuntime");
  const firstLiabilityReadIndex = v10PostdeployPlanSource.indexOf('functionName: "accruedOwnerFees"');
  assert.ok(
    runtimeIdentityGateIndex >= 0 &&
      firstLiabilityReadIndex >= 0 &&
      runtimeIdentityGateIndex < firstLiabilityReadIndex,
    "V10 runtime identity must pass before any mutation planning reads or simulations",
  );
  assert.match(
    v10PostdeployPlanSource,
    /manifestMatched:\s*true[\s\S]*runtimeIdentity,[\s\S]*scan:/,
    "V10 post-deploy output must expose the successful executable-runtime identity gate",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const scannedEpochs = await mapInBatches<bigint, ResolvedEpoch \| null>[\s\S]*winningPool = claimPlanningReady[\s\S]*const roleEpochStates = await mapInBatches\(resolvedEpochs/,
    "V10 post-deploy discovery must batch epoch and per-role reads while loading each winning pool once",
  );
  assert.match(
    v10PostdeployPlanSource,
    /expectedResolverReward = \(currentData\[0\] \* 5n\) \/ 10_000n[\s\S]*estimatedResolveFee = resolveGas \* currentGasPrice[\s\S]*breakEvenEthPerLinea/,
    "V10 post-deploy planning must expose resolver break-even without assuming a token price",
  );
  assert.match(
    v10PostdeployPlanSource,
    /RESOLVE_GAS_FLOOR = 500_000n[\s\S]*bufferedResolveGas[\s\S]*recommendedResolveGasLimit[\s\S]*recommendedGasLimit:/,
    "V10 post-deploy planning must separate dynamic resolve estimates from a conservative execution gas limit",
  );
  for (const expectedError of [
    "NotResolved",
    "NoWinningBet",
    "RewardClaimWindowExpired",
    "NothingToClaim",
    "NoRebateAvailable",
    "UnexpectedEpoch",
    "InvalidTile",
    "InvalidTileMask",
    "ArraysMismatch",
    "InvalidEpochDuration",
    "InvalidFeeRecipient",
    "NoPendingEpochDurationChange",
    "NoPendingFeeRecipientChange",
    "OwnershipRenounceDisabled",
    "DustSettlementDelayNotReached",
    "OwnableUnauthorizedAccount",
    "EpochClosing",
  ]) {
    assert.ok(
      v10PostdeployPlanSource.includes(`"${expectedError}"`),
      `V10 post-deploy planning must require exact deployed ${expectedError} errors`,
    );
  }
  assert.equal(
    packageScripts["plan:canary:v10:postdeploy"],
    "npm run proof:contract-compile:v10 && tsx scripts/plan-v10-postdeploy-canary.ts",
    "V10 post-deploy planner must verify canonical provenance before its stable read-only command",
  );
  assert.equal(
    packageScripts["proof:contract-compile:summary"],
    "node scripts/check-contract-compilation-provenance.mjs --summary-only",
    "V9 provenance must expose a compact summary command for routine evidence collection",
  );
  assert.equal(
    packageScripts["proof:contract-compile:v10:summary"],
    "node scripts/check-contract-compilation-provenance.mjs --target=v10 --summary-only",
    "V10 provenance must expose a compact summary command for routine evidence collection",
  );
  assert.equal(
    packageScripts["plan:canary:v10:postdeploy:summary"],
    "npm run proof:contract-compile:v10:summary && tsx scripts/plan-v10-postdeploy-canary.ts --summary-only",
    "V10 post-deploy planner must expose a canonical compact read-only command",
  );
  const contractProvenanceSource = readFileSync("scripts/check-contract-compilation-provenance.mjs", "utf8");
  assert.match(
    contractProvenanceSource,
    /const SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)/,
    "contract compilation provenance must support compact summary output",
  );
  assert.match(
    contractProvenanceSource,
    /process\.argv\.includes\("--write-manifest"\) && !SUMMARY_ONLY[\s\S]*if \(!SUMMARY_ONLY\) \{[\s\S]*fs\.mkdirSync\(path\.dirname\(OUTPUT_PATH\), \{ recursive: true \}\);[\s\S]*fs\.writeFileSync\(OUTPUT_PATH,[\s\S]*wouldWrite: false/,
    "contract compilation provenance summary must be read-only and skip manifest/output artifact writes",
  );
  assert.match(
    contractProvenanceSource,
    /MAX_CONTRACT_SOURCE_BYTES = 2 \* 1024 \* 1024[\s\S]*MAX_COMPILER_CONFIG_BYTES = 512 \* 1024[\s\S]*MAX_COMPILATION_MANIFEST_BYTES = 512 \* 1024[\s\S]*MAX_PACKAGE_LOCK_BYTES = 5 \* 1024 \* 1024[\s\S]*function readBoundedUtf8File\(filePath, maxBytes, label\)[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to validate safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "contract compilation provenance must size-gate contract sources, config, manifests, and package lock before reading",
  );
  for (const docPath of ["docs/production-runbook.md", "docs/v10-contract-design.md"]) {
    const docSource = readFileSync(docPath, "utf8");
    assert.ok(
      docSource.includes("npm.cmd run plan:canary:v10:postdeploy:summary"),
      `${docPath} must direct routine V10 post-deploy planning to the compact command`,
    );
  }
  const productionRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
  assert.match(
    productionRunbookSource,
    /npm\.cmd run preview:canary:v10:dry-run[\s\S]*npm\.cmd run preview:canary:v10:dry-run:summary[\s\S]*npm\.cmd run preview:canary:v10:authorization-ready:summary/,
    "production runbook must list the V10 dry-run Preview and authorization-ready freshness commands before fresh transaction consent",
  );
  assert.match(
    productionRunbookSource,
    /docs\/v10-canary-dry-run-preview\.md[\s\S]*fresh consent input[\s\S]*not[\s\S]*canary proof/,
    "production runbook must treat the V10 dry-run Preview as fresh consent input without treating it as proof",
  );
  assert.match(
    productionRunbookSource,
    /regular summary command validates the existing Preview[\s\S]*transactionSent=false[\s\S]*G10\/G11 dry-run blocker/,
    "production runbook must document the regular V10 dry-run Preview validator boundary",
  );
  assert.match(
    productionRunbookSource,
    /The authorization-ready summary applies the stricter fresh-consent[\s\S]*window/,
    "production runbook must require and validate the V10 dry-run Preview plus authorization-ready freshness check before fresh transaction consent without treating it as proof",
  );
  const v10PreviewCommandMapSource = readFileSync("docs/launch-evidence-command-map.md", "utf8");
  assert.match(
    v10PreviewCommandMapSource,
    /## Pre-Bet Dry-Run Preview[\s\S]*does not satisfy G10[\s\S]*npm\.cmd run preview:canary:v10:dry-run[\s\S]*npm\.cmd run preview:canary:v10:dry-run:summary[\s\S]*npm\.cmd run preview:canary:v10:authorization-ready:summary/,
    "launch command map must expose the V10 dry-run Preview and authorization-ready freshness commands while keeping G10/G11 live-evidence blocked",
  );
  assert.match(
    v10PreviewCommandMapSource,
    /docs\/v10-canary-dry-run-preview\.md[\s\S]*regular summary command validates the existing Preview[\s\S]*transactionSent=false[\s\S]*The authorization-ready summary applies the[\s\S]*stricter fresh-consent[\s\S]*window[\s\S]*does not satisfy live[\s\S]*canary\/soak proof/,
    "launch command map must expose the V10 dry-run Preview artifact, validator, and authorization-ready freshness gate while keeping G10/G11 live-evidence blocked",
  );
  const testnetDeepAuditSource = readFileSync("docs/testnet-deep-audit-2026-07-19.md", "utf8");
  assert.doesNotMatch(
    testnetDeepAuditSource,
    /optionally flush fees|every-120th external-transfer liveness coupling|Safety Pool discovery is still capped/,
    "testnet deep-audit docs must not preserve stale pre-V10 fee-flush or discovery blockers",
  );
  assert.match(
    testnetDeepAuditSource,
    /V10 accrues owner and burn fees during resolve[\s\S]*explicit permissionless `flushProtocolFees\(\)` path/,
    "testnet deep-audit docs must describe current V10 fee delivery accurately",
  );
  assert.match(
    testnetDeepAuditSource,
    /Safety Pool now exposes an explicit bounded load-older flow/,
    "testnet deep-audit docs must record the bounded Safety Pool older-history flow",
  );
  const restoreProofSource = readFileSync("scripts/verify-db-restore.mjs", "utf8");
  const backupSqliteSource = readFileSync("scripts/backup-sqlite.mjs", "utf8");
  assert.equal(
    packageScripts["proof:restore:summary"],
    "node scripts/verify-db-restore.mjs --summary-only",
    "restore proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["db:backup:summary"],
    "node scripts/backup-sqlite.mjs --summary-only",
    "SQLite backup must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["db:backup:strict:summary"],
    "node scripts/backup-sqlite.mjs --strict --summary-only",
    "SQLite backup must expose a compact strict summary command for launch checks",
  );
  assert.match(
    backupSqliteSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "SQLite backup must support compact output without changing backup validation",
  );
  assert.match(
    backupSqliteSource,
    /if \(summaryOnly\) \{[\s\S]*status: "ready"[\s\S]*wouldWrite: false[\s\S]*process\.exit\(0\)[\s\S]*mkdirSync\(path\.dirname\(path\.resolve\(output\)\)/,
    "SQLite backup summary must be read-only and exit before creating backup directories or files",
  );
  assert.match(
    backupSqliteSource,
    /futureTimestampSkewMs = 5 \* 60 \* 1000[\s\S]*function hasFutureModifiedTime[\s\S]*fileStat\.mtimeMs > Date\.now\(\) \+ futureTimestampSkewMs[\s\S]*Backup source modified time must not be in the future/,
    "strict SQLite backup proof must reject future-dated source DB modified timestamps",
  );
  assert.match(
    backupSqliteSource,
    /function failRuntime[\s\S]*!summaryOnly\) throw error[\s\S]*JSON\.stringify\(\{ status: "fail", groups: backupSummaryGroups, issue: compactIssue\(error\) \}\)/,
    "SQLite backup summary runtime failures must remain compact JSON without stack traces",
  );
  assert.ok(
    backupSqliteSource.includes('import { redactProofText } from "./redact-proof-output.mjs";') &&
      backupSqliteSource.includes("function compactIssue(error)") &&
      backupSqliteSource.includes("redactProofText(message)") &&
      backupSqliteSource.includes("(?:https?|wss?)") &&
      backupSqliteSource.includes("[A-Za-z]:\\\\") &&
      backupSqliteSource.includes("(^|[\\s\"'])\\/"),
    "SQLite backup summary runtime failures must redact shared proof secrets, URLs, Windows paths, and POSIX paths",
  );
  assert.match(
    backupSqliteSource,
    /requiresExternalBackupPaths[\s\S]*strict[\s\S]*LORE_BACKUP_REQUIRE_EXTERNAL[\s\S]*NODE_ENV === "production"[\s\S]*LINEA_NETWORK === "mainnet"[\s\S]*Production backup \$\{label\} path must be absolute and outside the repo checkout/,
    "production and strict SQLite backups must require absolute external source and output paths",
  );
  assert.match(
    backupSqliteSource,
    /if \(requiresExternalBackupPaths\(\)\) \{[\s\S]*retentionDays < 1[\s\S]*Production backup retention days must be configured[\s\S]*Production backup \$\{label\} path must be absolute and outside the repo checkout/,
    "production and strict SQLite backups must require an explicit retention policy before launch",
  );
  assert.match(
    backupSqliteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*const retentionDays = retentionText \? parseRetentionDays\(retentionText\) : 0[\s\S]*function parseRetentionDays\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT && parsed >= 1n && parsed <= 3650n \? Number\(parsed\) : null[\s\S]*retentionText && retentionDays === null/,
    "SQLite backup retention env must be canonical positive decimal days before strict backup readiness",
  );
  assert.doesNotMatch(
    backupSqliteSource,
    /const retentionDays = retentionText \? Number\(retentionText\) : 0|function parseRetentionDays\(value\)[\s\S]*\^\[1-9\]\\d\*\$|const parsed = Number\(normalized\)/,
    "SQLite backup retention env must not use broad Number coercion",
  );
  const sqliteOperationsSource = readFileSync("scripts/test-sqlite-operations.mjs", "utf8");
  const sqliteBackupLibrarySource = readFileSync("scripts/sqlite-backup-lib.mjs", "utf8");
  assert.match(
    sqliteBackupLibrarySource,
    /function removeTemporaryBackupArtifacts[\s\S]*"-shm"[\s\S]*"-wal"[\s\S]*temporaryOutputPath[\s\S]*backup\(source, temporaryOutputPath\)[\s\S]*PRAGMA integrity_check[\s\S]*renameSync\(temporaryOutputPath, outputPath\)[\s\S]*removeTemporaryBackupArtifacts\(temporaryOutputPath\)/,
    "SQLite backups must verify a same-directory temporary artifact before atomically publishing it and clean it on failure",
  );
  assert.match(
    sqliteBackupLibrarySource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*createSqliteBackup\(sourceInput, outputInput\)[\s\S]*!regularFileStat\(sourcePath\)[\s\S]*Backup source must be an existing regular file/,
    "SQLite backup library must reject missing or directory source DB paths through a shared regular-file stat boundary",
  );
  assert.match(
    sqliteBackupLibrarySource,
    /function pruneSqliteBackups\(directoryInput, retentionDays, excludePaths = \[\], now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(retentionDays\)[\s\S]*Number\.isSafeInteger\(now\) \|\| now < 0[\s\S]*Backup retention clock must be a safe non-negative integer/,
    "SQLite backup retention pruning must fail closed on malformed clocks before deleting generated backups",
  );
  assert.match(
    sqliteScopeAuditSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*auditSqliteScopes\(sourceInput, activeScope\)[\s\S]*!regularFileStat\(sourcePath\)[\s\S]*Scope audit source must be an existing regular file/,
    "SQLite scope audit must reject missing or directory DB paths through a shared regular-file stat boundary",
  );
  assert.match(
    sqliteOperationsSource,
    /createSqliteBackup\(sourcePath, sourcePath\)[\s\S]*Backup output must differ from source DB[\s\S]*createSqliteBackup\(sourcePath, backupPath\)[\s\S]*Backup output already exists/,
    "SQLite backup operation tests must reject source collisions and existing-output overwrites",
  );
  assert.match(
    sqliteOperationsSource,
    /readdirSync\(drillDir\)[\s\S]*partial-[\s\S]*backup must publish only the validated final artifact/,
    "SQLite backup operation tests must reject leftover partial artifacts after publication",
  );
  assert.match(
    sqliteOperationsSource,
    /pruneSqliteBackups\(retentionDir, 14, \[\], Number\.NaN\)[\s\S]*Backup retention clock must be a safe non-negative integer[\s\S]*retention pruning must reject malformed clocks before deleting files/,
    "SQLite backup operation tests must cover malformed retention clock rejection",
  );
  assert.match(
    sqliteOperationsSource,
    /futureBackupRoot[\s\S]*utimesSync\(futureBackupSource, futureMtime, futureMtime\)[\s\S]*Backup source modified time must not be in the future[\s\S]*futureSourceBackupSummaryRejected: true/,
    "SQLite operations regression must prove strict backup summary rejects future-dated source DB timestamps",
  );
  assert.match(
    sqliteOperationsSource,
    /LORE_BACKUP_RETENTION_DAYS: "14\.0"[\s\S]*LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650[\s\S]*malformedRetentionBackupSummaryRejected: true/,
    "SQLite operations regression must prove backup summary rejects non-canonical retention days",
  );
  assert.match(
    sqliteOperationsSource,
    /LORE_BACKUP_RETENTION_DAYS: "9999999999999999"[\s\S]*LORE_BACKUP_RETENTION_DAYS must be an integer between 1 and 3650[\s\S]*unsafeRetentionBackupSummaryRejected: true/,
    "SQLite operations regression must prove backup summary rejects unsafe retention days",
  );
  assert.match(
    restoreProofSource,
    /mkdirSync\(dirname\(restoreMain\), \{ recursive: true \}\);\s*copyFileSync\(backupMain, restoreMain\)/,
    "restore drill must create its target directory before copying the backup",
  );
  assert.match(
    restoreProofSource,
    /const summaryOnly = process\.argv\.includes\("--summary-only"\)/,
    "restore drill must support compact output without changing validation",
  );
  assert.match(
    restoreProofSource,
    /const restoreLaunchGates = \["G8"\][\s\S]*const restoreLaunchGateGroups = "restore=1"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(issues\.length\)/,
    "restore proof summary must identify the blocked or covered launch gate without printing local restore paths",
  );
  assert.match(
    restoreProofSource,
    /function printSummaryAndExit\(\)[\s\S]*Would write: false[\s\S]*process\.exit\(\)[\s\S]*if \(summaryOnly\) printSummaryAndExit\(\);[\s\S]*copyFileSync\(backupMain, restoreMain\)/,
    "restore proof summary must exit before copying backup or restore files",
  );
  assert.match(
    restoreProofSource,
    /if \(!summaryOnly\) \{[\s\S]*## Copied Files[\s\S]*## Row Counts/,
    "restore drill must keep detailed file and row-count tables out of summary-only output",
  );
  assert.match(
    restoreProofSource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fmtSize\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*function fileExists\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null[\s\S]*Manifest: \$\{fileExists\(resolve\(repoRoot, manifestPath\)\) \? "present" : "missing"\}[\s\S]*source DB must be a file[\s\S]*backup artifact must be a file/,
    "restore proof summary and restore inputs must only treat regular files as present",
  );
  assert.match(
    restoreProofSource,
    /function hasRestoreDrillIntegrityProof\(value\)[\s\S]*restore\|restored\|copy\|copied\|backup[\s\S]*integrity_check[\s\S]*restoreDrill evidence must include restored SQLite integrity_check proof/,
    "restore proof must require restored SQLite integrity evidence, not only a generic successful restore summary",
  );
  assert.match(
    restoreProofSource,
    /const MAX_HEALTH_BASE_MARKERS = 64[\s\S]*function healthEvidenceBaseMatches\(value, expectedOrigin\)[\s\S]*pattern\.exec\(text\)[\s\S]*inspected > MAX_HEALTH_BASE_MARKERS[\s\S]*normalizedOrigin\(match\[1\]\) === expected/,
    "restore proof must cap restored health base evidence scans before accepting restored origin proof",
  );
  assert.doesNotMatch(
    restoreProofSource,
    /\[\.\.\.text\.matchAll/,
    "restore proof must not spread restored health base evidence matchAll output into arrays",
  );
  const previousWindow = globalThis.window;
  try {
    const storage = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    };
    const snapshotKey = liveStateSnapshot.getLiveStateSnapshotKey();
    storage.set(snapshotKey, JSON.stringify({ currentEpoch: "7", fetchedAt: Date.now() - 13 * 60 * 60 * 1000 }));
    assert.equal(liveStateSnapshot.loadLiveStateSnapshot(), null);
    assert.equal(storage.has(snapshotKey), false, "stale live-state snapshots must be removed from localStorage");
    storage.set(snapshotKey, "{bad json");
    assert.equal(liveStateSnapshot.loadLiveStateSnapshot(), null);
    assert.equal(storage.has(snapshotKey), false, "corrupt live-state snapshots must be removed from localStorage");
    storage.set(snapshotKey, JSON.stringify({ currentEpoch: "8", fetchedAt: Date.now() }));
    assert.deepEqual(liveStateSnapshot.loadLiveStateSnapshot()?.currentEpoch, "8");
  } finally {
    globalThis.window = previousWindow;
  }
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(2n, 2n), false);
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(0n, 2n), false);
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(null, 10_000), null);
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(9_500, 10_000), "Updated now");
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(40_000, 100_000), "Updated 1m ago");
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(100_000, 360_000), "Updated 4m ago");
}
