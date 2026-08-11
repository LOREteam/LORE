import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PREVIEW_SCRIPT = path.join(SCRIPT_DIR, "create-v10-canary-dry-run-preview.mjs");
const CLEAR_PENDING_SCRIPT = path.join(SCRIPT_DIR, "clear-live-test-pending-nonce.ts");
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;

function inspectChildEnv(extraEnv) {
  const result = spawnSync(process.execPath, [PREVIEW_SCRIPT, "--inspect-read-only-child-env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function clearPendingEnv(extraEnv = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      SIGNING_ENV_NAME_RE.test(name) ||
      /^LORE_LIVE_TEST_(?:MANUAL|AUTOMINER_A|AUTOMINER_B|AUTOMINER_C|RESOLVER)_ADDRESS$/.test(name)
    ) {
      delete env[name];
    }
  }
  return {
    ...env,
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    LIVE_TEST_EXECUTE: "0",
    ...extraEnv,
  };
}

function inspectClearPendingAddressFile(contents, extraEnv = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-preview-address-env-"));
  try {
    writeFileSync(path.join(cwd, ".env.live-test-addresses"), contents, "utf8");
    return spawnSync(process.execPath, [TSX_CLI, CLEAR_PENDING_SCRIPT, "--inspect-public-address-env"], {
      cwd,
      encoding: "utf8",
      env: clearPendingEnv(extraEnv),
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("Preview child env preserves public planning config and excludes malicious credentials", () => {
  const publicConfig = {
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x2222222222222222222222222222222222222222",
    NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER: "1",
    V10_POSTDEPLOY_SCAN_EPOCHS: "17",
    V10_EXPECTED_CURRENT_OWNER: "0x3333333333333333333333333333333333333333",
    LIVE_CANARY_RPC_LABEL: "public-sepolia-fallback",
  };
  const forbidden = {
    TEST_WALLET_PRIVATE_KEY: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    KEEPER_MNEMONIC: "malicious test mnemonic",
    HEALTH_DIAGNOSTICS_SECRET: "malicious-health-secret",
    ADMIN_AUTH_TOKEN: "malicious-auth-token",
    SENTRY_DSN: "https://credential@example.invalid/1",
    ALERT_WEBHOOK_URL: "https://credential@example.invalid/hook",
    LIVE_TEST_RPC_URL: "https://credential@example.invalid/rpc",
    NEXT_PUBLIC_LINEA_RPCS: "https://credential@example.invalid/public-rpc",
  };
  const inspection = inspectChildEnv({
    ...publicConfig,
    ...forbidden,
    LIVE_TEST_EXECUTE: "1",
    SOAK_EXECUTE_LIVE: "1",
    TEST_WALLET_EXECUTE: "1",
  });

  assert.equal(inspection.signingMaterialLoaded, false);
  assert.equal(inspection.sensitiveCredentialKeysPresent, false);
  assert.deepEqual(inspection.publicConfig, publicConfig);
  assert.deepEqual(inspection.executionGates, {
    LIVE_TEST_EXECUTE: "0",
    SOAK_EXECUTE_LIVE: "0",
    TEST_WALLET_EXECUTE: "0",
  });
  for (const name of Object.keys(forbidden)) {
    assert.equal(inspection.childEnvKeys.includes(name), false, `${name} escaped the child env allowlist`);
  }
});

test("read-only planner, matrix, and playtest paths do not preload combined dotenv", () => {
  const previewSource = readFileSync(PREVIEW_SCRIPT, "utf8");
  const plannerSource = readFileSync(path.join(SCRIPT_DIR, "plan-v10-postdeploy-canary.ts"), "utf8");
  const liveSource = readFileSync(path.join(SCRIPT_DIR, "live-round-canary.ts"), "utf8");
  const playtestSource = readFileSync(path.join(SCRIPT_DIR, "playtest-wallet.ts"), "utf8");

  assert.doesNotMatch(previewSource, /\.\.\.process\.env/);
  assert.doesNotMatch(plannerSource, /dotenv\/config/);
  assert.doesNotMatch(liveSource, /dotenv\/config/);
  assert.doesNotMatch(playtestSource, /dotenv\/config/);
  assert.match(liveSource, /processEnv: isolatedEnv/);
  assert.match(liveSource, /may contain only public live-test role addresses/);
  assert.match(liveSource, /const wallets = DRY_RUN \? loadDryRunWallets\(\) : loadWallets\(\)/);
  assert.match(
    playtestSource,
    /if \(EXECUTE_REQUESTED[\s\S]*if \(LIVE_EXECUTION_CONFIRMED\) \{[\s\S]*loadDotenv\([\s\S]*const account = LIVE_EXECUTION_CONFIRMED/,
  );
});

test("Preview distinguishes an unreported child boundary from detected signing material", () => {
  const previewSource = readFileSync(PREVIEW_SCRIPT, "utf8");
  assert.match(
    previewSource,
    /const operationBoundaryReports = \[[\s\S]*plannerSummary\.signingMaterialLoaded,[\s\S]*pendingSummary\.signingMaterialLoaded,[\s\S]*matrixSummary\.signingMaterialLoaded,[\s\S]*\];[\s\S]*operationBoundaryReports\.some\(\(reported\) => reported === true\)[\s\S]*operationBoundaryReports\.every\(\(reported\) => reported === false\)/,
    "a child that exits before reporting its boundary must remain unverified, not be reported as signing material",
  );
  assert.match(
    previewSource,
    /hardFailures\.length === 0 &&[\s\S]*operationBoundaryVerified &&[\s\S]*!signingMaterialLoaded/,
    "Preview success must still fail closed until every child reports no signing material",
  );
  assert.match(
    previewSource,
    /operationalBoundaryVerified: operationBoundaryVerified/,
    "the compact Preview summary must publish the verified-boundary field without a misspelled shorthand",
  );
});

test("pending-nonce Preview child parses only exact public role address keys", () => {
  const publicAddressFile = [
    "LORE_LIVE_TEST_MANUAL_ADDRESS=0x1111111111111111111111111111111111111111",
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=0x2222222222222222222222222222222222222222",
    "LORE_LIVE_TEST_AUTOMINER_B_ADDRESS=0x3333333333333333333333333333333333333333",
    "LORE_LIVE_TEST_AUTOMINER_C_ADDRESS=0x4444444444444444444444444444444444444444",
    "LORE_LIVE_TEST_RESOLVER_ADDRESS=0x5555555555555555555555555555555555555555",
    "",
  ].join("\n");
  const result = inspectClearPendingAddressFile(publicAddressFile);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const inspection = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  assert.equal(inspection.mode, "dry-run");
  assert.equal(inspection.signingMaterialLoaded, false);
  assert.deepEqual(inspection.publicAddressKeys, [
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS",
    "LORE_LIVE_TEST_AUTOMINER_B_ADDRESS",
    "LORE_LIVE_TEST_AUTOMINER_C_ADDRESS",
    "LORE_LIVE_TEST_MANUAL_ADDRESS",
    "LORE_LIVE_TEST_RESOLVER_ADDRESS",
  ]);
  assert.equal(inspection.walletClientCreated, false);
  assert.equal(inspection.contractWriteSubmitted, false);
  assert.equal(inspection.transactionSent, false);
});

test("pending-nonce Preview child rejects signing material in the public address file", () => {
  const sentinel = "malicious-preview-private-key-sentinel";
  const result = inspectClearPendingAddressFile([
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=0x2222222222222222222222222222222222222222",
    `LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY=${sentinel}`,
    "",
  ].join("\n"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /may contain only public live-test role addresses/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(sentinel));
});

test("pending-nonce Preview child detects inherited signing material before RPC work", () => {
  const result = inspectClearPendingAddressFile(
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=0x2222222222222222222222222222222222222222\n",
    { LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY: "inherited-signing-sentinel" },
  );
  assert.notEqual(result.status, 0);
  const inspection = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  assert.equal(inspection.signingMaterialLoaded, true);
  assert.equal(inspection.walletClientCreated, false);
  assert.equal(inspection.contractWriteSubmitted, false);
  assert.equal(inspection.transactionSent, false);
  assert.match(result.stderr, /inspection refuses inherited signing material/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /inherited-signing-sentinel/);
});
