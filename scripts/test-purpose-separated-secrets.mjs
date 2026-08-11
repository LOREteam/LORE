import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as productionRuntimeModule from "../config/productionRuntime.ts";

const productionRuntime = productionRuntimeModule.default ?? productionRuntimeModule;
const { assertProductionRuntimeConfig, getRuntimePurposeSecretCollisions } = productionRuntime;

const DISTINCT_SECRETS = {
  healthDiagnosticsSecret: "health-".padEnd(40, "h"),
  trustProxySecret: "proxy-".padEnd(40, "p"),
  chatAuthSecret: "chat-".padEnd(40, "c"),
  nextAuthSecret: "next-".padEnd(40, "n"),
};

const MAINNET_WEB_ENV = {
  LINEA_NETWORK: "mainnet",
  NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
  LINEA_CHAIN_ID: "59144",
  NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
  KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
  NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
  INDEXER_START_BLOCK: "1",
  NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
  KEEPER_RPC_URL: "https://keeper-rpc.playlore.xyz",
  NEXT_PUBLIC_LINEA_RPCS: "https://linea-rpc.publicnode.com,https://rpc.linea.build",
  NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
  HEALTH_DIAGNOSTICS_SECRET: DISTINCT_SECRETS.healthDiagnosticsSecret,
  TRUST_PROXY_HEADERS: "1",
  TRUST_PROXY_SECRET: DISTINCT_SECRETS.trustProxySecret,
  ALLOW_WEAK_RATE_LIMIT_IDENTITY: "0",
  WEB_REPLICA_COUNT: "1",
  NEXT_PUBLIC_PRIVY_APP_ID: "cmprodprivyappid0000000000",
  CHAT_AUTH_SECRET: DISTINCT_SECRETS.chatAuthSecret,
  ADMIN_AUTH_SECRET: "admin-".padEnd(40, "a"),
  NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
  BOOTSTRAP_RESOLVE_SECRET: "bootstrap-".padEnd(40, "b"),
  BOOTSTRAP_KEEPER_PRIVATE_KEY: "1".repeat(64),
  LORE_DB_PATH: join(tmpdir(), "lore-purpose-separated-secrets.sqlite"),
};

const PREMAINNET_WEB_ENV = {
  ...MAINNET_WEB_ENV,
  LORE_PREMAINNET_RUNTIME_STRICT: "1",
  LINEA_NETWORK: "sepolia",
  NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
  LINEA_CHAIN_ID: "59141",
  NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
  NEXT_PUBLIC_LINEA_RPCS: "",
  NEXT_PUBLIC_LINEA_SEPOLIA_RPCS:
    "https://linea-sepolia.drpc.org,https://rpc.sepolia.linea.build",
  WEB_REPLICA_COUNT: "2",
  UPSTASH_REDIS_REST_URL: "https://upstash.playlore.xyz",
  UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
  RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
  RESEND_API_KEY: "re_synthetic",
  RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
  RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
};

function withIsolatedEnvironment(environment, callback) {
  const originalEnvironment = { ...process.env };
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, environment);
  try {
    return callback();
  } finally {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, originalEnvironment);
  }
}

function captureConfigError(environment) {
  return withIsolatedEnvironment(environment, () => {
    try {
      assertProductionRuntimeConfig("web");
    } catch (error) {
      assert.ok(error instanceof Error);
      return error;
    }
    assert.fail("expected production runtime validation to reject reused secrets");
  });
}

test("runtime secrets remain separated by purpose", () => {
  assert.deepEqual(getRuntimePurposeSecretCollisions(DISTINCT_SECRETS), []);

  for (const [left, right, expected] of [
    ["healthDiagnosticsSecret", "trustProxySecret", "HEALTH_DIAGNOSTICS_SECRET and TRUST_PROXY_SECRET"],
    ["healthDiagnosticsSecret", "chatAuthSecret", "HEALTH_DIAGNOSTICS_SECRET and effective chat authentication secret"],
    ["trustProxySecret", "chatAuthSecret", "TRUST_PROXY_SECRET and effective chat authentication secret"],
  ]) {
    assert.deepEqual(
      getRuntimePurposeSecretCollisions({
        ...DISTINCT_SECRETS,
        [right]: DISTINCT_SECRETS[left],
      }),
      [expected],
    );
  }
});

test("NEXTAUTH_SECRET fallback participates without exposing secret values", () => {
  const collisions = getRuntimePurposeSecretCollisions({
    ...DISTINCT_SECRETS,
    chatAuthSecret: "",
    nextAuthSecret: DISTINCT_SECRETS.healthDiagnosticsSecret,
  });
  assert.deepEqual(collisions, [
    "HEALTH_DIAGNOSTICS_SECRET and effective chat authentication secret",
  ]);
  assert.doesNotMatch(collisions.join("\n"), new RegExp(DISTINCT_SECRETS.healthDiagnosticsSecret));
  assert.deepEqual(
    getRuntimePurposeSecretCollisions({
      ...DISTINCT_SECRETS,
      nextAuthSecret: DISTINCT_SECRETS.healthDiagnosticsSecret,
    }),
    [],
    "a present CHAT_AUTH_SECRET must keep precedence over an unused NEXTAUTH_SECRET",
  );
});

test("missing values remain owned by existing length validators", () => {
  assert.deepEqual(
    getRuntimePurposeSecretCollisions({
      healthDiagnosticsSecret: "",
      trustProxySecret: " ",
      chatAuthSecret: "",
      nextAuthSecret: "",
    }),
    [],
  );
});

test("mainnet and strict pre-mainnet startup reject reused purpose secrets", () => {
  const reused = "synthetic-reused-purpose-secret".padEnd(40, "x");
  const mainnetError = captureConfigError({
    ...MAINNET_WEB_ENV,
    HEALTH_DIAGNOSTICS_SECRET: `  ${reused}  `,
    TRUST_PROXY_SECRET: reused,
  });
  assert.match(
    mainnetError.message,
    /HEALTH_DIAGNOSTICS_SECRET and TRUST_PROXY_SECRET must be distinct on mainnet/,
  );
  assert.doesNotMatch(mainnetError.message, new RegExp(reused));

  const preMainnetError = captureConfigError({
    ...PREMAINNET_WEB_ENV,
    CHAT_AUTH_SECRET: "",
    NEXTAUTH_SECRET: reused,
    TRUST_PROXY_SECRET: reused,
  });
  assert.match(
    preMainnetError.message,
    /TRUST_PROXY_SECRET and effective chat authentication secret must be distinct on pre-mainnet testnet/,
  );
  assert.doesNotMatch(preMainnetError.message, new RegExp(reused));

  assert.doesNotThrow(() =>
    withIsolatedEnvironment(MAINNET_WEB_ENV, () => assertProductionRuntimeConfig("web")),
  );
  assert.doesNotThrow(() =>
    withIsolatedEnvironment(PREMAINNET_WEB_ENV, () => assertProductionRuntimeConfig("web")),
  );
});

test("mainnet proof cannot report reused runtime secrets as green", () => {
  const proofEnvironment = {
    ...MAINNET_WEB_ENV,
    INDEXER_FINALITY_BLOCKS: "64",
    KEEPER_PRIVATE_KEY: "2".repeat(64),
    RUNTIME_MONITOR_BACKUP_DIR: join(tmpdir(), "lore-purpose-separated-backups"),
  };
  const distinctResult = spawnSync(
    process.execPath,
    ["scripts/collect-mainnet-proof.mjs", "--strict", "--summary-only"],
    { cwd: process.cwd(), env: proofEnvironment, encoding: "utf8" },
  );
  assert.equal(distinctResult.status, 0, `${distinctResult.stdout}\n${distinctResult.stderr}`);
  assert.match(distinctResult.stdout, /Failing gates: 0/);

  const reused = "proof-reused-purpose-secret".padEnd(40, "x");
  const reusedResult = spawnSync(
    process.execPath,
    ["scripts/collect-mainnet-proof.mjs", "--strict", "--summary-only"],
    {
      cwd: process.cwd(),
      env: {
        ...proofEnvironment,
        HEALTH_DIAGNOSTICS_SECRET: reused,
        CHAT_AUTH_SECRET: reused,
      },
      encoding: "utf8",
    },
  );
  const reusedOutput = `${reusedResult.stdout}\n${reusedResult.stderr}`;
  assert.equal(reusedResult.status, 1, reusedOutput);
  assert.match(reusedOutput, /Failing gate names: purpose-separated runtime secrets/);
  assert.doesNotMatch(reusedOutput, new RegExp(reused));
});
