import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runReleaseDocumentationTests() {
  assert.doesNotMatch(
    readFileSync(".env.example", "utf8"),
    /NEXT_PUBLIC_PRIVY_APP_ID=cmlqkgtmg00og0cjueu4mxmn9/,
    ".env.example must not encourage copying the development Privy app id into production",
  );
  assert.match(
    readFileSync(".env.example", "utf8"),
    /Mainnet rejects localhost\/private\/example\/test URLs[\s\S]*KEEPER_RPC_URL=https:\/\/rpc\.provider\.your-domain\.com\/path/,
    ".env.example must document a mainnet-valid keeper RPC shape and the public-endpoint guard",
  );
  assert.match(
    readFileSync("docs/production-runbook.md", "utf8"),
    /WEB_REPLICA_COUNT=2\+[\s\S]*non-placeholder `UPSTASH_REDIS_REST_TOKEN`[\s\S]*RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1/,
    "production runbook must document that multi-replica rate limiting requires a real non-placeholder Redis token",
  );
  for (const envTemplatePath of [".env.example", ".env.local.example"]) {
    assert.doesNotMatch(
      readFileSync(envTemplatePath, "utf8"),
      /NEXT_PUBLIC_LINEA_RPCS=.*\.example\b/,
      `${envTemplatePath} must not encourage copying placeholder backup RPC endpoints`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /TRUST_PROXY_HEADERS=0[\s\S]*TRUST_PROXY_SECRET=replace-with-at-least-32-random-characters[\s\S]*ALLOW_WEAK_RATE_LIMIT_IDENTITY=0/,
      `${envTemplatePath} must document trusted proxy identity and keep weak identity disabled by default`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /LORE_PREMAINNET_RUNTIME_STRICT=0[\s\S]*WEB_REPLICA_COUNT=2[\s\S]*UPSTASH_REDIS_REST_URL=https:\/\/your-database\.upstash\.io[\s\S]*UPSTASH_REDIS_REST_TOKEN=replace-with-server-only-standard-token[\s\S]*RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1/,
      `${envTemplatePath} must document strict pre-mainnet two-replica external rate-limit requirements`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /RUNTIME_MONITOR_BACKUP_DIR[\s\S]*RUNTIME_MONITOR_BACKUP_MAX_AGE_MS=129600000/,
      `${envTemplatePath} must document backup freshness configuration for production-like monitoring`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /RESEND_API_KEY=re_xxxxxxxxx[\s\S]*RUNTIME_MONITOR_EMAIL_FROM=LORE <alerts@playlore\.xyz>[\s\S]*RUNTIME_MONITOR_EMAIL_TO=playlore88@gmail\.com/,
      `${envTemplatePath} must document Resend email alert configuration for production-like monitoring`,
    );
    assert.match(
      readFileSync(envTemplatePath, "utf8"),
      /BUNDLE_BASELINE_MAX_FILES=300[\s\S]*BUNDLE_BASELINE_MAX_TOTAL_BYTES=10500000[\s\S]*BUNDLE_BASELINE_MAX_JS_BYTES=8800000[\s\S]*BUNDLE_BASELINE_MAX_SINGLE_JS_BYTES=1250000[\s\S]*BUNDLE_BASELINE_MAX_CSS_BYTES=400000[\s\S]*BUNDLE_BASELINE_MAX_WASM_BYTES=1500000/,
      `${envTemplatePath} must document bundle baseline budget overrides`,
    );
  }

  const npmrcSource = readFileSync(".npmrc", "utf8");
  assert.match(npmrcSource, /^update-notifier=false$/m, "repo npm config must suppress update notices in compact evidence output");
  assert.match(npmrcSource, /^fund=false$/m, "repo npm config must suppress funding prompts in compact evidence output");

  for (const launchDocPath of ["docs/launch-evidence-command-map.md", "docs/production-runbook.md"]) {
    const launchDocSource = readFileSync(launchDocPath, "utf8");
    assert.match(
      launchDocSource,
      /proof:prelaunch:summary[\s\S]*proof:local:summary[\s\S]*proof:security-followup:summary[\s\S]*proof:autonomous:daily:summary[\s\S]*proof:process-model:summary[\s\S]*proof:templates:summary[\s\S]*proof:files:summary[\s\S]*proof:collector-redaction:summary[\s\S]*proof:readiness:summary[\s\S]*proof:launch-map:summary[\s\S]*proof:remaining:summary[\s\S]*proof:mainnet:summary[\s\S]*proof:mainnet:strict:summary[\s\S]*proof:chain:summary[\s\S]*proof:chain:strict:summary[\s\S]*proof:signoff:summary[\s\S]*proof:signoff:strict:summary[\s\S]*proof:host:summary[\s\S]*proof:host:strict:summary[\s\S]*proof:indexer:summary[\s\S]*proof:indexer:strict:summary[\s\S]*proof:restore:summary[\s\S]*proof:restore:strict:summary[\s\S]*proof:monitoring:summary[\s\S]*proof:monitoring:strict:summary[\s\S]*proof:qa:summary[\s\S]*proof:qa:strict:summary[\s\S]*proof:canary:summary[\s\S]*proof:testnet:canary:strict:summary[\s\S]*proof:testnet:canary:v10:summary[\s\S]*db:backup:summary[\s\S]*db:backup:strict:summary[\s\S]*proof:launch:summary[\s\S]*proof:launch:strict:summary/,
      `${launchDocPath} must document the compact launch status loop before long proof output`,
    );
  }

  const v10DeployedIdentityBoundaryDoc = readFileSync("docs/v10-deployed-identity-boundary.md", "utf8");
  assert.match(
    v10DeployedIdentityBoundaryDoc,
    /npm\.cmd run proof:contract-deployed:v10:summary[\s\S]*runtimeBytecode: false[\s\S]*runtimeExecutable: true[\s\S]*metadataOnlyMismatch: true[\s\S]*transactionSent: false/,
    "V10 deployed identity boundary doc must preserve the current read-only metadata mismatch facts",
  );
  assert.match(
    v10DeployedIdentityBoundaryDoc,
    /npm\.cmd run proof:contract-deployed:v10:offline:summary[\s\S]*status: pass[\s\S]*manifestMatches: true[\s\S]*transactionSent: false/,
    "V10 deployed identity boundary doc must pair the deployed mismatch with passing offline canonical identity",
  );
  assert.match(
    v10DeployedIdentityBoundaryDoc,
    /Do not redeploy V10[\s\S]*Do not hide `metadataOnlyMismatch=true`[\s\S]*G1-G4/,
    "V10 deployed identity boundary doc must keep redeploy and launch sign-off as explicit external decisions",
  );
}
