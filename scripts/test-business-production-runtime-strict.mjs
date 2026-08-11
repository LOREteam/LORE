import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as productionRuntimeModule from "../config/productionRuntime.ts";

function withTemporaryEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) { previous.set(key, process.env[key]); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return fn(); } finally { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

export function runProductionRuntimeStrictTests() {
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
      INDEXER_START_BLOCK: "abc",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "0",
      KEEPER_RPC_URL: "https://",
      NEXT_PUBLIC_SITE_URL: "https://play.example",
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
      let error;
      try {
        productionRuntime.assertProductionRuntimeConfig("web");
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof Error);
      assert.match(error.message, /INDEXER_START_BLOCK must be a positive integer block number/);
      assert.match(error.message, /NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must be a positive integer block number/);
      assert.match(error.message, /KEEPER_RPC_URL must be a public https:\/\/ URL/);
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
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: undefined,
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
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK is required for mainnet/,
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
      NEXT_PUBLIC_SITE_URL: "https://localhost:3000",
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
        /NEXT_PUBLIC_SITE_URL must be a public https:\/\/ URL/,
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
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
      RUNTIME_MONITOR_ALLOW_NO_ALERTS: "1",
      RESEND_API_KEY: "not-a-resend-key",
      RUNTIME_MONITOR_EMAIL_FROM: "not-an-email",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com, broken-recipient",
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "c".repeat(32),
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
      assert.match(error.message, /ALLOW_WEAK_RATE_LIMIT_IDENTITY must not be enabled/);
      assert.match(error.message, /RUNTIME_MONITOR_ALLOW_NO_ALERTS must not be enabled/);
      assert.match(error.message, /RESEND_API_KEY must look like a Resend API key/);
      assert.match(error.message, /RUNTIME_MONITOR_EMAIL_FROM must be a valid Resend-verified email sender/);
      assert.match(error.message, /RUNTIME_MONITOR_EMAIL_TO must contain valid email recipient addresses/);
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
      HEALTH_DIAGNOSTICS_SECRET: "health-secret",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: undefined,
      WEB_REPLICA_COUNT: "2",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      RATE_LIMIT_EXTERNAL_FAIL_CLOSED: undefined,
      NEXT_PUBLIC_PRIVY_APP_ID: validPrivyAppId,
      CHAT_AUTH_SECRET: "chat-secret",
      ADMIN_AUTH_SECRET: "admin-secret",
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "resolve-secret",
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
      assert.match(error.message, /TRUST_PROXY_SECRET must contain at least 32 characters/);
      assert.match(error.message, /Multiple mainnet web replicas require UPSTASH_REDIS_REST_URL/);
      assert.match(error.message, /RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1 is required/);
      assert.match(error.message, /HEALTH_DIAGNOSTICS_SECRET must contain at least 32 characters/);
      assert.match(error.message, /CHAT_AUTH_SECRET or NEXTAUTH_SECRET must contain at least 32 characters/);
      assert.match(error.message, /effective ADMIN_AUTH_SECRET must contain at least 32 characters/);
      assert.match(error.message, /BOOTSTRAP_RESOLVE_SECRET must contain at least 32 characters/);
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
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      NEXT_PUBLIC_PRIVY_APP_ID: undefined,
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_PRIVY_APP_ID is required/,
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
      NEXT_PUBLIC_SITE_URL: "https://play.example",
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "t".repeat(32),
      NEXT_PUBLIC_PRIVY_APP_ID: "your-privy-app-id",
      CHAT_AUTH_SECRET: "c".repeat(32),
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
      BOOTSTRAP_RESOLVE_SECRET: "r".repeat(32),
      BOOTSTRAP_KEEPER_PRIVATE_KEY: validPrivateKey,
      LORE_DB_PATH: absoluteTestDbPath,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("web"),
        /NEXT_PUBLIC_PRIVY_APP_ID must not use an example or placeholder value/,
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
      LORE_DB_PATH: absoluteTestDbPath,
      INDEXER_FINALITY_BLOCKS: undefined,
    },
    () => {
      assert.throws(
        () => productionRuntime.assertProductionRuntimeConfig("indexer"),
        /INDEXER_FINALITY_BLOCKS must be set to a positive block count/,
      );
    },
  );
}
