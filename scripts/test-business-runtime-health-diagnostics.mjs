import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as diagnosticsAuthModule from "../app/api/health/_lib/diagnosticsAuth.ts";

export function runRuntimeHealthDiagnosticsTests() {
  const diagnosticsAuth = diagnosticsAuthModule.default ?? diagnosticsAuthModule;
  const runtimeHealthSource = readFileSync("app/api/health/runtime/route.ts", "utf8");
  const diagnosticsAuthSource = readFileSync("app/api/health/_lib/diagnosticsAuth.ts", "utf8");
  const smokeHttpSource = readFileSync("scripts/smoke-http.mjs", "utf8");
  const adminOpsClientSource = readFileSync("app/admin/AdminOpsClient.tsx", "utf8");

  const configuredPublicConfig = diagnosticsAuth.buildRuntimeHealthPublicConfig({
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_PRIVY_APP_ID: "  app-public-id  ",
      RUNTIME_MONITOR_BACKUP_DIR: "D:\\backups",
      RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "60000",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz, security@playlore.xyz",
      WEB_REPLICA_COUNT: "2",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "p".repeat(32),
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
    },
    chainId: 59144,
    chainName: "Linea",
    contractRequiresEpochBoundBets: true,
    readOnlyMode: true,
    externalRateLimitConfigured: true,
  });
  assert.deepEqual(configuredPublicConfig, {
    chainId: 59144,
    chainName: "Linea",
    privyAppIdConfigured: true,
    privyFallbackActive: false,
    contractRequiresEpochBoundBets: true,
    readOnlyMode: true,
    productionLikeMonitoring: true,
    backupMonitorConfigured: true,
    backupMonitorMaxAgeConfigured: true,
    emailAlertConfigured: true,
    multiReplicaWeb: true,
    externalRateLimitConfigured: true,
    trustedProxyConfigured: true,
    weakRateLimitIdentityAllowed: true,
  }, "runtime health must expose only derived readiness booleans and public chain identity");
  assert.equal("RESEND_API_KEY" in configuredPublicConfig, false, "runtime health must not return alert credentials");
  assert.equal("RUNTIME_MONITOR_EMAIL_TO" in configuredPublicConfig, false, "runtime health must not return recipients");
  assert.equal("TRUST_PROXY_SECRET" in configuredPublicConfig, false, "runtime health must not return proxy credentials");

  const failClosedEnvCases = [
    { env: { RUNTIME_MONITOR_EMAIL_TO: "" }, field: "emailAlertConfigured" },
    { env: { RUNTIME_MONITOR_EMAIL_TO: `a@b.co,${"x@b.co,".repeat(10)}z@b.co` }, field: "emailAlertConfigured" },
    { env: { RUNTIME_MONITOR_EMAIL_TO: `ops@playlore.xyz,${"x".repeat(255)}@playlore.xyz` }, field: "emailAlertConfigured" },
    { env: { RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz,,security@playlore.xyz" }, field: "emailAlertConfigured" },
    { env: { WEB_REPLICA_COUNT: "1e3" }, field: "multiReplicaWeb" },
    { env: { WEB_REPLICA_COUNT: "9007199254740992" }, field: "multiReplicaWeb" },
    { env: { TRUST_PROXY_HEADERS: "1", TRUST_PROXY_SECRET: `${"p".repeat(31)}\n` }, field: "trustedProxyConfigured" },
  ];
  for (const { env: override, field } of failClosedEnvCases) {
    const env = {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz",
      ...override,
    };
    const result = diagnosticsAuth.buildRuntimeHealthPublicConfig({
      env,
      chainId: 59141,
      chainName: "Linea Sepolia",
      contractRequiresEpochBoundBets: true,
      readOnlyMode: false,
      externalRateLimitConfigured: false,
    });
    assert.equal(result[field], false, `runtime health must fail closed for malformed ${field} inputs`);
  }

  assert.equal(diagnosticsAuth.normalizeHealthDiagnosticsSecret("s".repeat(32)), "s".repeat(32));
  for (const value of [null, "s".repeat(31), "s".repeat(257), `${"s".repeat(32)}\ncontrol`]) {
    assert.equal(diagnosticsAuth.normalizeHealthDiagnosticsSecret(value), null);
  }
  const configuredSecret = "health-secret-".padEnd(32, "s");
  assert.equal(
    diagnosticsAuth.matchesHealthDiagnosticsSecret(configuredSecret, configuredSecret),
    true,
    "an exact bounded diagnostics secret must authorize private health data",
  );
  assert.equal(
    diagnosticsAuth.matchesHealthDiagnosticsSecret(configuredSecret, `${configuredSecret.slice(0, -1)}x`),
    false,
    "same-length wrong diagnostics secrets must fail timing-safe equality",
  );
  assert.equal(
    diagnosticsAuth.matchesHealthDiagnosticsSecret(configuredSecret, "x".repeat(2_000)),
    false,
    "oversized provided diagnostics secrets must fail before Buffer comparison",
  );

  const filterEmptyRecipientsMutant = (value) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
  assert.deepEqual(
    filterEmptyRecipientsMutant("ops@playlore.xyz,,security@playlore.xyz"),
    ["ops@playlore.xyz", "security@playlore.xyz"],
    "the malformed-recipient vector must kill a silent-filter fail-open mutant",
  );
  assert.equal(
    diagnosticsAuth.buildRuntimeHealthPublicConfig({
      env: {
        RESEND_API_KEY: "re_synthetic",
        RUNTIME_MONITOR_EMAIL_FROM: "alerts@playlore.xyz",
        RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz,,security@playlore.xyz",
      },
      chainId: 59141,
      chainName: "Linea Sepolia",
      contractRequiresEpochBoundBets: true,
      readOnlyMode: false,
      externalRateLimitConfigured: false,
    }).emailAlertConfigured,
    false,
  );

  assert.match(runtimeHealthSource, /applyNoStoreHeaders\(NextResponse\.json/, "runtime health responses must use the shared no-store response helper");
  assert.match(runtimeHealthSource, /buildRuntimeHealthPublicConfig\([\s\S]*env: process\.env[\s\S]*externalRateLimitConfigured: hasPublicExternalRateLimitStore\(\)/, "runtime health GET must use the behavior-tested public config policy");
  assert.match(diagnosticsAuthSource, /return matchesHealthDiagnosticsSecret\([\s\S]*process\.env\.HEALTH_DIAGNOSTICS_SECRET[\s\S]*request\.headers\.get\(headerName\)/, "runtime health auth must use the behavior-tested secret matcher after admin-session validation");
  assert.match(smokeHttpSource, /readOnlyMode/, "HTTP smoke must verify runtime health read-only mode diagnostics");
  assert.match(smokeHttpSource, /backup monitoring diagnostics[\s\S]*backup freshness diagnostics/, "HTTP smoke must verify runtime health backup monitoring and freshness diagnostics");
  assert.match(smokeHttpSource, /email alert diagnostics/, "HTTP smoke must verify runtime health email alert diagnostics");
  assert.match(smokeHttpSource, /external rate-limit diagnostics/, "HTTP smoke must verify runtime health external rate-limit diagnostics");
  assert.match(smokeHttpSource, /trusted proxy diagnostics[\s\S]*weak identity diagnostics/, "HTTP smoke must verify runtime health trusted-proxy diagnostics");
  assert.match(smokeHttpSource, /stale build without required protected V10 bets/, "HTTP smoke must reject a stale frontend build when V10 protected bets are required");
  assert.match(adminOpsClientSource, /readOnlyMode/, "admin ops runtime card must surface read-only betting mode");
  assert.match(adminOpsClientSource, /safePersonalSignError\s*=\s*sanitizeSupportLogPayload\([\s\S]*personalSignError[\s\S]*console\.warn\([\s\S]*safePersonalSignError/, "admin auth wallet fallback warnings must sanitize provider error text before console output");
  assert.match(adminOpsClientSource, /readJsonResponse<DataSyncHealth>[\s\S]*readJsonResponse<RuntimeHealth>[\s\S]*readJsonResponse<OpsData \| OpsErrorPayload>[\s\S]*readJsonResponse<AdminProcessesPayload \| OpsErrorPayload>[\s\S]*readJsonResponse<\{ error\?: string \}>/, "admin ops UI API reads must use the bounded JSON response helper");
  assert.doesNotMatch(adminOpsClientSource, /\.\s*json\(\)/, "admin ops UI API reads must not use unbounded response.json");
}
