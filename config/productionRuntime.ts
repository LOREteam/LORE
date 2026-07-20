import { isAbsolute } from "node:path";
import {
  getConfiguredEip7702Enabled,
  getConfiguredEip7702MiningEnabled,
  getConfiguredLineaNetwork,
} from "./publicConfig";
import { hasMainnetIndexerFinality } from "../app/lib/indexerFinality";

type ProductionRuntimeScope = "web" | "bot" | "indexer" | "server";

const validatedScopes = new Set<ProductionRuntimeScope>();
const DEFAULT_DB_PATH = "data/lore.sqlite";

function getEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isTruthyEnv(value: string) {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function validateMainnetProductionEnv(scope: ProductionRuntimeScope) {
  const issues: string[] = [];
  const lineaNetwork = getEnv("LINEA_NETWORK");
  const publicLineaNetwork = getEnv("NEXT_PUBLIC_LINEA_NETWORK");
  const normalizedLineaNetwork = getConfiguredLineaNetwork(lineaNetwork || null);
  const normalizedPublicLineaNetwork = getConfiguredLineaNetwork(publicLineaNetwork || null);

  if (!lineaNetwork) issues.push("LINEA_NETWORK must be set explicitly for mainnet.");
  if (!publicLineaNetwork) issues.push("NEXT_PUBLIC_LINEA_NETWORK must be set explicitly for mainnet.");
  if (lineaNetwork && normalizedLineaNetwork !== "mainnet") {
    issues.push(`LINEA_NETWORK must resolve to mainnet, got "${lineaNetwork}".`);
  }
  if (publicLineaNetwork && normalizedPublicLineaNetwork !== "mainnet") {
    issues.push(`NEXT_PUBLIC_LINEA_NETWORK must resolve to mainnet, got "${publicLineaNetwork}".`);
  }

  if (
    getConfiguredEip7702Enabled() ||
    isTruthyEnv(getEnv("NEXT_PUBLIC_EIP7702_ENABLED")) ||
    isTruthyEnv(getEnv("EIP7702_ENABLED"))
  ) {
    issues.push("EIP-7702 must stay disabled for mainnet production unless a separate repair/diagnostic rollout is explicitly approved.");
  }
  if (
    getConfiguredEip7702MiningEnabled() ||
    isTruthyEnv(getEnv("NEXT_PUBLIC_EIP7702_MINING_ENABLED")) ||
    isTruthyEnv(getEnv("EIP7702_MINING_ENABLED"))
  ) {
    issues.push("EIP-7702 mining must stay disabled for mainnet production.");
  }

  const keeperContractAddress = getEnv("KEEPER_CONTRACT_ADDRESS");
  const publicContractAddress = getEnv("NEXT_PUBLIC_CONTRACT_ADDRESS");
  if (!keeperContractAddress) issues.push("KEEPER_CONTRACT_ADDRESS is required for mainnet.");
  if (!publicContractAddress) issues.push("NEXT_PUBLIC_CONTRACT_ADDRESS is required for mainnet.");
  if (
    keeperContractAddress &&
    publicContractAddress &&
    keeperContractAddress.toLowerCase() !== publicContractAddress.toLowerCase()
  ) {
    issues.push("KEEPER_CONTRACT_ADDRESS and NEXT_PUBLIC_CONTRACT_ADDRESS must match on mainnet.");
  }

  if (!getEnv("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS")) {
    issues.push("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS is required for mainnet.");
  }

  const indexerStartBlock = getEnv("INDEXER_START_BLOCK");
  const deployBlock = getEnv("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
  if (!indexerStartBlock && !deployBlock) {
    issues.push("INDEXER_START_BLOCK or NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK is required for mainnet.");
  }
  if (indexerStartBlock && deployBlock && indexerStartBlock !== deployBlock) {
    issues.push("INDEXER_START_BLOCK and NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must match on mainnet.");
  }

  const keeperRpcUrl = getEnv("KEEPER_RPC_URL");
  if (!keeperRpcUrl) {
    issues.push("KEEPER_RPC_URL is required for mainnet.");
  } else if (!keeperRpcUrl.startsWith("https://")) {
    issues.push("KEEPER_RPC_URL must use https:// on mainnet.");
  }

  const siteUrl = getEnv("NEXT_PUBLIC_SITE_URL");
  if (!siteUrl) {
    issues.push("NEXT_PUBLIC_SITE_URL is required for mainnet.");
  } else if (!isHttpsUrl(siteUrl)) {
    issues.push("NEXT_PUBLIC_SITE_URL must be a valid https:// URL on mainnet.");
  }

  if (getEnv("HEALTH_DIAGNOSTICS_SECRET").length < 32) {
    issues.push("HEALTH_DIAGNOSTICS_SECRET must contain at least 32 characters on mainnet.");
  }

  if (scope === "web" || scope === "server") {
    if (isTruthyEnv(getEnv("ALLOW_WEAK_RATE_LIMIT_IDENTITY"))) {
      issues.push("ALLOW_WEAK_RATE_LIMIT_IDENTITY must not be enabled on mainnet.");
    }
    if (getEnv("TRUST_PROXY_HEADERS") !== "1") {
      issues.push("TRUST_PROXY_HEADERS=1 is required for mainnet web runtime behind a trusted proxy; otherwise high-traffic rate limits collapse to weak browser fingerprints.");
    }
    if (getEnv("TRUST_PROXY_SECRET").length < 32) {
      issues.push("TRUST_PROXY_SECRET must contain at least 32 characters on mainnet so direct clients cannot spoof trusted IP headers.");
    }
    const replicaCount = Number(getEnv("WEB_REPLICA_COUNT") || "1");
    if (!Number.isSafeInteger(replicaCount) || replicaCount < 1) {
      issues.push("WEB_REPLICA_COUNT must be a positive integer when set.");
    } else if (replicaCount > 1) {
      if (!isHttpsUrl(getEnv("UPSTASH_REDIS_REST_URL")) || !getEnv("UPSTASH_REDIS_REST_TOKEN")) {
        issues.push("Multiple mainnet web replicas require UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for shared rate limiting.");
      }
      if (getEnv("RATE_LIMIT_EXTERNAL_FAIL_CLOSED") !== "1") {
        issues.push("RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1 is required with multiple mainnet web replicas.");
      }
    }
    if (!getEnv("NEXT_PUBLIC_PRIVY_APP_ID")) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID is required for mainnet web runtime.");
    }
    const chatAuthSecret = getEnv("CHAT_AUTH_SECRET") || getEnv("NEXTAUTH_SECRET");
    if (chatAuthSecret.length < 32) {
      issues.push("CHAT_AUTH_SECRET or NEXTAUTH_SECRET must contain at least 32 characters for mainnet web runtime.");
    }
    const adminAuthSecret = getEnv("ADMIN_AUTH_SECRET") || chatAuthSecret;
    if (adminAuthSecret.length < 32) {
      issues.push("The effective ADMIN_AUTH_SECRET must contain at least 32 characters for mainnet admin sessions.");
    }
    if (!getEnv("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS")) {
      issues.push("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS is required for mainnet admin auth.");
    }
    if (getEnv("BOOTSTRAP_RESOLVE_SECRET").length < 32) {
      issues.push("BOOTSTRAP_RESOLVE_SECRET must contain at least 32 characters for mainnet bootstrap resolve.");
    }
    if (!getEnv("BOOTSTRAP_KEEPER_PRIVATE_KEY") && !getEnv("KEEPER_PRIVATE_KEY")) {
      issues.push("BOOTSTRAP_KEEPER_PRIVATE_KEY or KEEPER_PRIVATE_KEY is required for mainnet bootstrap resolve.");
    }
  }

  if (scope === "bot") {
    if (!getEnv("KEEPER_PRIVATE_KEY")) {
      issues.push("KEEPER_PRIVATE_KEY is required for mainnet keeper runtime.");
    }
  }

  if (scope === "indexer" && !hasMainnetIndexerFinality(getEnv("INDEXER_FINALITY_BLOCKS"))) {
    issues.push("INDEXER_FINALITY_BLOCKS must be set to a positive block count for mainnet indexer runtime.");
  }

  if (scope === "web" || scope === "indexer" || scope === "server") {
    const dbPath = getEnv("LORE_DB_PATH");
    if (!dbPath) {
      issues.push("LORE_DB_PATH must point to a persistent absolute path on mainnet.");
    } else {
      if (!isAbsolute(dbPath)) {
        issues.push("LORE_DB_PATH must be absolute on mainnet.");
      }
      if (dbPath === DEFAULT_DB_PATH) {
        issues.push("LORE_DB_PATH must not use the repo-local default data/lore.sqlite on mainnet.");
      }
    }
  }

  return issues;
}

export function assertProductionRuntimeConfig(scope: ProductionRuntimeScope) {
  if (validatedScopes.has(scope)) return;
  if (getConfiguredLineaNetwork() !== "mainnet") return;

  const issues = validateMainnetProductionEnv(scope);
  if (issues.length > 0) {
    throw new Error(
      [
        `[prod-config] invalid mainnet runtime configuration for ${scope}:`,
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
  }

  validatedScopes.add(scope);
}
