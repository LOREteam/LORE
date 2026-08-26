import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as productionRuntimeModule from "../config/productionRuntime.ts";

const productionRuntime = productionRuntimeModule.default ?? productionRuntimeModule;
const EPOCH_BOUND_PROBE = process.env.PRODUCTION_RUNTIME_ENV_TEST_MODE === "epoch-bound-probe";
const EPOCH_BOUND_ISSUE =
  "NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1 is required for the V10 mainnet launch.";

if (EPOCH_BOUND_PROBE) {
  assert.throws(
    () => productionRuntime.assertProductionRuntimeConfig("server"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.deepEqual(
        error.message.split("\n").filter((line) => line.startsWith("- ")),
        [`- ${EPOCH_BOUND_ISSUE}`],
      );
      return true;
    },
  );
  console.log("production-runtime-epoch-bound-probe:pass");
}

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
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function runProductionRuntimeEnvTests() {
  const absoluteTestDbPath = join(tmpdir(), "lore-mainnet.sqlite");
  const validPrivyAppId = "cmprodprivyappid0000000000";
  const validPrivateKey = "1".repeat(64);
  const validWebRuntimeEnv = (network, rpcUrls) => {
    const strictSepolia = network === "sepolia";
    return {
      LORE_PREMAINNET_RUNTIME_STRICT: strictSepolia ? "1" : undefined,
      LINEA_NETWORK: strictSepolia ? "sepolia" : "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: strictSepolia ? "sepolia" : "mainnet",
      LINEA_CHAIN_ID: strictSepolia ? "59141" : "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: strictSepolia ? "59141" : "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      INDEXER_FINALITY_BLOCKS: "8",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: strictSepolia ? undefined : rpcUrls,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: strictSepolia ? rpcUrls : undefined,
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      RUNTIME_MONITOR_ALLOW_NO_ALERTS: undefined,
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "0",
      WEB_REPLICA_COUNT: strictSepolia ? "2" : "1",
      UPSTASH_REDIS_REST_URL: strictSepolia ? "https://upstash.playlore.xyz" : undefined,
      UPSTASH_REDIS_REST_TOKEN: strictSepolia ? "synthetic-upstash-token" : undefined,
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: strictSepolia ? "1" : undefined,
      RESEND_API_KEY: strictSepolia ? "re_synthetic" : undefined,
      RUNTIME_MONITOR_EMAIL_FROM: strictSepolia ? "LORE <alerts@playlore.xyz>" : undefined,
      RUNTIME_MONITOR_EMAIL_TO: strictSepolia ? "playlore88@gmail.com" : undefined,
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXTAUTH_SECRET: undefined,
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      KEEPER_PRIVATE_KEY: undefined,
      LORE_DB_PATH: absoluteTestDbPath,
    };
  };
  const assertOnlyWebRpcQuorumIssue = (runtimeEnv, expectedIssue) => {
    withTemporaryEnv(runtimeEnv, () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        (error) => {
          assert.ok(error instanceof Error);
          assert.deepEqual(
            error.message.split("\n").filter((line) => line.startsWith("- ")),
            [`- ${expectedIssue}`],
            "the hostile alias fixture must isolate the independent RPC-origin quorum failure",
          );
          return true;
        },
      );
    });
  };
  const validPublicRpcUrls = {
    mainnet: "https://rpc-one.playlore.xyz,https://rpc-two.playlore.xyz",
    sepolia: "https://rpc-sepolia-one.playlore.xyz,https://rpc-sepolia-two.playlore.xyz",
  };
  const validResendEnv = {
    RESEND_API_KEY: "re_synthetic",
    RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
  };
  const assertRecipientPolicy = (network, recipients, expectedValid) => {
    const label = network === "sepolia" ? "pre-mainnet testnet" : "mainnet";
    const unrelatedControlIssue =
      `NEXT_PUBLIC_PRIVY_APP_ID must not use an example or placeholder value on ${label}.`;
    const runtimeEnv = {
      ...validWebRuntimeEnv(network, validPublicRpcUrls[network]),
      ...validResendEnv,
      RUNTIME_MONITOR_EMAIL_TO: recipients,
      ...(expectedValid ? { NEXT_PUBLIC_PRIVY_APP_ID: "placeholder" } : {}),
    };
    withTemporaryEnv(runtimeEnv, () => {
      if (expectedValid) {
        assert.throws(
          () => productionRuntime.assertProductionRuntimeConfig("web"),
          (error) => {
            assert.ok(error instanceof Error);
            const issueLines = error.message
              .split("\n")
              .filter((line) => line.startsWith("- "));
            assert.ok(
              issueLines.includes(`- ${unrelatedControlIssue}`),
              `${label} valid recipient control must retain its deterministic cache-blocking issue`,
            );
            assert.equal(
              issueLines.some((line) => line.includes("RUNTIME_MONITOR_EMAIL_TO")),
              false,
              `${label} startup must accept a bounded valid Resend recipient list`,
            );
            return true;
          },
        );
        return;
      }
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        new RegExp(`RUNTIME_MONITOR_EMAIL_TO must contain valid email recipient addresses on ${label}`),
        `${label} startup must reject a recipient list the runtime sender cannot deliver`,
      );
    });
  };
  const tenValidRecipients = Array.from(
    { length: 10 },
    (_, index) => `ops${index}@playlore.xyz`,
  ).join(",");
  const elevenValidRecipients = `${tenValidRecipients},ops10@playlore.xyz`;
  const overlongRecipient = `${"x".repeat(255 - "@playlore.xyz".length)}@playlore.xyz`;
  assert.equal(overlongRecipient.length, 255, "the overlong recipient fixture must cross the 254-char boundary");
  withTemporaryEnv(
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
      LINEA_CHAIN_ID: "59144",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: undefined,
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      RUNTIME_MONITOR_ALLOW_NO_ALERTS: undefined,
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "0",
      WEB_REPLICA_COUNT: "1",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: undefined,
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      LORE_BACKUP_DIR: join(tmpdir(), "lore-mainnet-backups"),
      RUNTIME_MONITOR_BACKUP_DIR: undefined,
      RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "60000",
    },
    () => {
      const probe = spawnSync(
        process.execPath,
        ["--import", "tsx", fileURLToPath(import.meta.url)],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            PRODUCTION_RUNTIME_ENV_TEST_MODE: "epoch-bound-probe",
          },
          shell: false,
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 128 * 1024,
        },
      );
      assert.equal(
        probe.status,
        0,
        `epoch-bound runtime probe failed: ${String(probe.stderr ?? "").slice(0, 1_000)}`,
      );
      assert.match(probe.stdout ?? "", /^production-runtime-epoch-bound-probe:pass\s*$/);
    },
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins([]),
    false,
    "an empty public RPC list must not satisfy wallet transfer quorum",
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins(["https://rpc-one.playlore.xyz"]),
    false,
    "one public RPC origin must not satisfy wallet transfer quorum",
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins([
      "HTTPS://RPC-ONE.PLAYLORE.XYZ:443/path?key=one",
      "https://rpc-one.playlore.xyz./other-path?key=two#fragment",
    ]),
    false,
    "case, default-port, trailing-dot, path, query, and fragment aliases must collapse to one origin",
  );
  assert.equal(
    productionRuntime.hasTwoIndependentPublicRpcOrigins([
      "https://rpc-one.playlore.xyz/path",
      "https://rpc-two.playlore.xyz/other-path",
    ]),
    true,
    "two canonical public RPC origins must satisfy wallet transfer quorum",
  );
  assertOnlyWebRpcQuorumIssue(
    validWebRuntimeEnv(
      "mainnet",
      "HTTPS://RPC-ONE.PLAYLORE.XYZ:443/path?key=one,https://rpc-one.playlore.xyz./alias?key=two#fragment",
    ),
    "NEXT_PUBLIC_LINEA_RPCS must contain at least two distinct canonical public https:// origins for wallet transfer quorum on mainnet web builds.",
  );
  assertOnlyWebRpcQuorumIssue(
    validWebRuntimeEnv(
      "sepolia",
      "HTTPS://RPC-SEPOLIA-ONE.PLAYLORE.XYZ:443/path?key=one,https://rpc-sepolia-one.playlore.xyz./alias?key=two#fragment",
    ),
    "NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must contain at least two distinct canonical public https:// origins for wallet transfer quorum on pre-mainnet testnet web builds.",
  );
  const assertMainnetWebIssue = (overrides, expectedIssue) => {
    withTemporaryEnv(
      {
        ...validWebRuntimeEnv("mainnet", validPublicRpcUrls.mainnet),
        ...overrides,
      },
      () => {
        assert.throws(
          () => productionRuntime.assertProductionRuntimeConfig("web"),
          expectedIssue,
        );
      },
    );
  };
  assertMainnetWebIssue(
    { WEB_REPLICA_COUNT: undefined },
    /WEB_REPLICA_COUNT must be explicitly set for mainnet web\/server runtime/,
  );
  for (const siteUrl of [
    "https://intranet",
    "https://localhost",
    "https://192.168.1.10",
    "https://play.example",
  ]) {
    assertMainnetWebIssue(
      { NEXT_PUBLIC_SITE_URL: siteUrl },
      /NEXT_PUBLIC_SITE_URL must be a public https:\/\/ URL on mainnet/,
    );
  }
  for (const keeperRpcUrl of [
    "https://user:password@rpc.playlore.xyz",
    "https://localhost:8545",
    "https://10.0.0.5",
    "https://rpc.example",
  ]) {
    assertMainnetWebIssue(
      { KEEPER_RPC_URL: keeperRpcUrl },
      /KEEPER_RPC_URL must be a public https:\/\/ URL on mainnet/,
    );
  }
  assertMainnetWebIssue(
    { NEXT_PUBLIC_PRIVY_APP_ID: "cmlqkgtmg00og0cjueu4mxmn9" },
    /NEXT_PUBLIC_PRIVY_APP_ID must not use the development Privy app id on mainnet/,
  );
  for (const network of ["mainnet", "sepolia"]) {
    const label = network === "sepolia" ? "pre-mainnet testnet" : "mainnet";
    withTemporaryEnv(
      {
        ...validWebRuntimeEnv(network, validPublicRpcUrls[network]),
        KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
        NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
      },
      () => {
        assert.throws(
          () => productionRuntime.assertProductionRuntimeConfig("web"),
          (error) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, new RegExp(`KEEPER_CONTRACT_ADDRESS must not be the zero address on ${label}`));
            assert.match(error.message, new RegExp(`NEXT_PUBLIC_CONTRACT_ADDRESS must not be the zero address on ${label}`));
            return true;
          },
        );
      },
    );
    withTemporaryEnv(
      {
        ...validWebRuntimeEnv(network, validPublicRpcUrls[network]),
        ...validResendEnv,
        RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz",
        LORE_BACKUP_DIR: undefined,
        RUNTIME_MONITOR_BACKUP_DIR: join(tmpdir(), `lore-${network}-backups`),
        RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: undefined,
      },
      () => {
        assert.throws(
          () => productionRuntime.assertProductionRuntimeConfig("server"),
          new RegExp(
            `RUNTIME_MONITOR_BACKUP_MAX_AGE_MS must be a positive safe integer for ${label} server backup monitoring`,
          ),
        );
      },
    );
  }
  withTemporaryEnv(
    {
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
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: "https://rate-limit.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "changeme",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /non-placeholder UPSTASH_REDIS_REST_TOKEN/,
      );
    },
  );
  withTemporaryEnv(
    {
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
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      RESEND_API_KEY: undefined,
      RUNTIME_MONITOR_EMAIL_FROM: undefined,
      RUNTIME_MONITOR_EMAIL_TO: undefined,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("server"),
        /RESEND_API_KEY is required for mainnet server email alerts/,
      );
    },
  );
  withTemporaryEnv(
    {
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
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      LORE_BACKUP_DIR: join(process.cwd(), "data", "backups"),
      RUNTIME_MONITOR_BACKUP_DIR: "relative-backups",
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("server"),
        /LORE_BACKUP_DIR must be outside the repo checkout[\s\S]*RUNTIME_MONITOR_BACKUP_DIR must be absolute/,
      );
    },
  );
  withTemporaryEnv(
    {
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
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must not be configured on mainnet/,
      );
    },
  );
  withTemporaryEnv(
    {
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
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: "https://rpc.playlore.xyz,http://localhost:8545",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_LINEA_RPCS must contain only public https:\/\/ URLs/,
      );
    },
  );
  // Every recipient-policy control retains at least one validation issue, so
  // none can populate the process-global validated scope cache.
  for (const network of ["mainnet", "sepolia"]) {
    assertRecipientPolicy(network, "ops@playlore.xyz,,security@playlore.xyz", false);
    assertRecipientPolicy(network, "ops@playlore.xyz,", false);
    assertRecipientPolicy(network, elevenValidRecipients, false);
    assertRecipientPolicy(network, overlongRecipient, false);
  }
  for (const network of ["mainnet", "sepolia"]) {
    assertRecipientPolicy(network, tenValidRecipients, true);
  }
}
