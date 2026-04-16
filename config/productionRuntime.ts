import { isAbsolute } from "node:path";
import { getConfiguredLineaNetwork } from "./publicConfig";

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

  if (!getEnv("HEALTH_DIAGNOSTICS_SECRET")) {
    issues.push("HEALTH_DIAGNOSTICS_SECRET is required for mainnet.");
  }

  if (scope === "web" || scope === "server") {
    if (!getEnv("NEXT_PUBLIC_PRIVY_APP_ID")) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID is required for mainnet web runtime.");
    }
    if (!getEnv("CHAT_AUTH_SECRET") && !getEnv("NEXTAUTH_SECRET")) {
      issues.push("CHAT_AUTH_SECRET or NEXTAUTH_SECRET is required for mainnet web runtime.");
    }
  }

  if (scope === "bot") {
    if (!getEnv("KEEPER_PRIVATE_KEY")) {
      issues.push("KEEPER_PRIVATE_KEY is required for mainnet keeper runtime.");
    }
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
