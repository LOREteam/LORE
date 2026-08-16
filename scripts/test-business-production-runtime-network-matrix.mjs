import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as productionRuntimeModule from "../config/productionRuntime.ts";

function withTemporaryEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function runProductionRuntimeNetworkMatrixTests() {
  const absoluteTestDbPath = join(tmpdir(), "lore-mainnet.sqlite");
  const validPrivyAppId = "cmprodprivyappid0000000000";
  const validPrivateKey = "1".repeat(64);
  const productionRuntime = productionRuntimeModule.default ?? productionRuntimeModule;
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
      RUNTIME_MONITOR_ALLOW_NO_ALERTS: undefined,
      RESEND_API_KEY: undefined,
      RUNTIME_MONITOR_EMAIL_FROM: undefined,
      RUNTIME_MONITOR_EMAIL_TO: undefined,
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: "64",
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("indexer"));
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
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
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: undefined,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("indexer"),
        /INDEXER_FINALITY_BLOCKS must be set to a positive block count for pre-mainnet testnet indexer runtime/,
      );
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
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
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: "8",
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("indexer"));
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: "https://linea-mainnet.example",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "http://localhost:8545",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: undefined,
      RESEND_API_KEY: undefined,
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid pre-mainnet testnet runtime configuration/);
      assert.match(error.message, /NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must contain only public https:\/\/ URLs/);
      assert.match(error.message, /NEXT_PUBLIC_LINEA_RPCS must not be configured for pre-mainnet testnet/);
      assert.match(error.message, /RESEND_API_KEY is required for pre-mainnet testnet email alerts/);
      assert.match(error.message, /Multiple pre-mainnet testnet web replicas require UPSTASH_REDIS_REST_URL/);
      assert.match(error.message, /RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1 is required/);
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
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
      WEB_REPLICA_COUNT: "1",
      UPSTASH_REDIS_REST_URL: "https://upstash.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      RESEND_API_KEY: "not-a-resend-key",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /WEB_REPLICA_COUNT must be at least 2 for pre-mainnet testnet production-like rate-limit validation/);
      assert.match(error.message, /RESEND_API_KEY must look like a Resend API key/);
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
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
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: "https://localhost:6379",
      UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /Multiple pre-mainnet testnet web replicas require UPSTASH_REDIS_REST_URL/);
    },
  );
  withTemporaryEnv(
    {
      LORE_PREMAINNET_RUNTIME_STRICT: "1",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000002",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      INDEXER_START_BLOCK: "1",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
      KEEPER_RPC_URL: "https://rpc.playlore.xyz",
      NEXT_PUBLIC_LINEA_RPCS: undefined,
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "https://linea-sepolia.drpc.org,https://rpc.sepolia.linea.build",
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: "https://upstash.playlore.xyz",
      UPSTASH_REDIS_REST_TOKEN: "synthetic-upstash-token",
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      INDEXER_FINALITY_BLOCKS: "8",
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("web"));
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
      NEXT_PUBLIC_LINEA_RPCS: "https://linea-rpc.publicnode.com",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: undefined,
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      LORE_BACKUP_DIR: undefined,
      RUNTIME_MONITOR_BACKUP_DIR: undefined,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("server"),
        /LORE_BACKUP_DIR or RUNTIME_MONITOR_BACKUP_DIR is required for mainnet server backup monitoring/,
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
      NEXT_PUBLIC_LINEA_RPCS: "https://linea-rpc.publicnode.com",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: undefined,
      NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      WEB_REPLICA_COUNT: "1",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
      ADMIN_AUTH_SECRET: "a".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
      RUNTIME_MONITOR_BACKUP_DIR: join(tmpdir(), "lore-mainnet-backups"),
      RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "129600000",
    },
    () => {
      assert.doesNotThrow(() => productionRuntime.assertProductionRuntimeConfig("server"));
    },
  );
}
