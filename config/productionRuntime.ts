import { isAbsolute, relative, resolve } from "node:path";
import { getAddress, isAddress, zeroAddress } from "viem";
import {
  getConfiguredLineaNetwork,
  getContractRequiresEpochBoundBets,
} from "./publicConfig";

type ProductionRuntimeScope = "web" | "bot" | "indexer" | "server";

const validatedScopes = new Set<string>();
const DEFAULT_DB_PATH = "data/lore.sqlite";
const REPO_ROOT = process.cwd();
const MAX_RUNTIME_FINALITY_BLOCKS = 1_000_000n;
const KNOWN_DEVELOPMENT_PRIVY_APP_IDS = new Set(["cmlqkgtmg00og0cjueu4mxmn9"]);
const BOOTSTRAP_LOWER_PURPOSE_SECRET_NAMES = [
  "HEALTH_DIAGNOSTICS_SECRET",
  "TRUST_PROXY_SECRET",
  "CHAT_AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "ADMIN_AUTH_SECRET",
] as const;

function getEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function parseRequiredRuntimeFinalityBlocks(value?: string | null) {
  const raw = value ?? "";
  if (!/^[1-9]\d{0,6}$/.test(raw)) {
    throw new Error(
      "INDEXER_FINALITY_BLOCKS must be a canonical positive decimal integer.",
    );
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_RUNTIME_FINALITY_BLOCKS) {
    throw new Error(
      `INDEXER_FINALITY_BLOCKS must not exceed ${MAX_RUNTIME_FINALITY_BLOCKS.toString()}.`,
    );
  }
  return parsed;
}

function validateRequiredRuntimeFinalityBlocks(
  scope: ProductionRuntimeScope,
  label: string,
  issues: string[],
) {
  const bootstrapKeeperEnabled = Boolean(getEnv("BOOTSTRAP_KEEPER_PRIVATE_KEY"));
  const required =
    scope === "indexer" ||
    scope === "bot" ||
    (scope === "web" && bootstrapKeeperEnabled);
  if (!required) return;
  const runtimeLabel = label === "pre-mainnet testnet" && scope === "indexer"
    ? "pre-mainnet testnet indexer runtime"
    : `${label} ${scope} runtime`;
  try {
    parseRequiredRuntimeFinalityBlocks(process.env.INDEXER_FINALITY_BLOCKS);
  } catch {
    issues.push(
      `INDEXER_FINALITY_BLOCKS must be set to a positive block count for ${runtimeLabel} and must be a canonical decimal integer from 1 through ${MAX_RUNTIME_FINALITY_BLOCKS.toString()}.`,
    );
  }
}

type RuntimePurposeSecrets = {
  healthDiagnosticsSecret: string;
  trustProxySecret: string;
  chatAuthSecret: string;
  nextAuthSecret: string;
};

export function getRuntimePurposeSecretCollisions(
  secrets: RuntimePurposeSecrets,
): string[] {
  const entries = [
    ["HEALTH_DIAGNOSTICS_SECRET", secrets.healthDiagnosticsSecret.trim()],
    ["TRUST_PROXY_SECRET", secrets.trustProxySecret.trim()],
    [
      "effective chat authentication secret",
      secrets.chatAuthSecret.trim() || secrets.nextAuthSecret.trim(),
    ],
  ] as const;
  const collisions: string[] = [];

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftName, leftValue] = entries[leftIndex];
      const [rightName, rightValue] = entries[rightIndex];
      if (leftValue && leftValue === rightValue) {
        collisions.push(`${leftName} and ${rightName}`);
      }
    }
  }

  return collisions;
}

function validateRuntimePurposeSecretSeparation(label: string, issues: string[]) {
  const collisions = getRuntimePurposeSecretCollisions({
    healthDiagnosticsSecret: getEnv("HEALTH_DIAGNOSTICS_SECRET"),
    trustProxySecret: getEnv("TRUST_PROXY_SECRET"),
    chatAuthSecret: getEnv("CHAT_AUTH_SECRET"),
    nextAuthSecret: getEnv("NEXTAUTH_SECRET"),
  });
  for (const collision of collisions) {
    issues.push(`${collision} must be distinct on ${label}.`);
  }
}

function isDisallowedMainnetHost(host: string) {
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".example") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^192\.0\.2\./.test(host) ||
    /^198\.(1[89])\./.test(host) ||
    /^198\.51\.100\./.test(host) ||
    /^203\.0\.113\./.test(host) ||
    /^f[cd][0-9a-f]*:/i.test(host) ||
    /^fe80:/i.test(host)
  );
}

function isPublicHttpsEndpoint(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    if (!host.includes(".") && !host.includes(":")) return false;
    return !isDisallowedMainnetHost(host);
  } catch {
    return false;
  }
}

function parseEndpointList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getCanonicalRpcHostname(
  value: string,
  options: { httpsOnly?: boolean } = {},
): string | null {
  try {
    const parsed = new URL(value.trim());
    if (
      (options.httpsOnly ? parsed.protocol !== "https:" : !/^https?:$/.test(parsed.protocol)) ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/^\[(.*)\]$/, "$1")
      .replace(/\.+$/, "");
    return hostname || null;
  } catch {
    return null;
  }
}

export function hasTwoIndependentPublicRpcOrigins(urls: readonly string[]) {
  const hostnames = new Set<string>();
  for (const value of urls) {
    const hostname = getCanonicalRpcHostname(value, { httpsOnly: true });
    if (hostname !== null) hostnames.add(hostname);
  }
  return hostnames.size >= 2;
}

function isPublicMainnetSiteUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    if (!host.includes(".") && !host.includes(":")) return false;
    return !isDisallowedMainnetHost(host);
  } catch {
    return false;
  }
}

function isTruthyEnv(value: string) {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isPrivateKeyHex(value: string) {
  return /^(?:0x)?[a-fA-F0-9]{64}$/.test(value.trim());
}

function normalizePrivateKeyForComparison(value: string) {
  return value.trim().replace(/^0x/i, "").toLowerCase();
}

function validateBootstrapResolveCredentials(label: string, issues: string[]) {
  const bootstrapSecret = getEnv("BOOTSTRAP_RESOLVE_SECRET");
  if (
    bootstrapSecret &&
    BOOTSTRAP_LOWER_PURPOSE_SECRET_NAMES.some(
      (name) => getEnv(name) === bootstrapSecret,
    )
  ) {
    issues.push(
      `BOOTSTRAP_RESOLVE_SECRET must be distinct from lower-purpose authentication and diagnostics secrets on ${label}.`,
    );
  }

  const bootstrapKeeperKey = getEnv("BOOTSTRAP_KEEPER_PRIVATE_KEY");
  const keeperKey = getEnv("KEEPER_PRIVATE_KEY");
  if (!bootstrapKeeperKey) {
    issues.push(`BOOTSTRAP_KEEPER_PRIVATE_KEY is required for ${label} bootstrap resolve.`);
  } else if (!isPrivateKeyHex(bootstrapKeeperKey)) {
    issues.push(`BOOTSTRAP_KEEPER_PRIVATE_KEY must be a 64-hex private key on ${label}.`);
  }
  if (
    bootstrapKeeperKey &&
    keeperKey &&
    normalizePrivateKeyForComparison(bootstrapKeeperKey) ===
      normalizePrivateKeyForComparison(keeperKey)
  ) {
    issues.push(
      `BOOTSTRAP_KEEPER_PRIVATE_KEY must be distinct from KEEPER_PRIVATE_KEY on ${label}.`,
    );
  }
}

function isPositiveSafeInteger(value: string) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

const MAX_EMAIL_RECIPIENTS = 10;
const MAX_EMAIL_ENTRY_LENGTH = 254;

function extractEmailAddress(value: string) {
  const trimmed = value.trim();
  const angleMatch = trimmed.match(/<([^<>\s@]+@[^<>\s@]+)>$/);
  return angleMatch ? angleMatch[1] : trimmed;
}

function isEmailAddress(value: string) {
  const email = extractEmailAddress(value);
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}

function parseEmailRecipients(value: string) {
  const recipients = value
    .split(",")
    .map((entry) => entry.trim());
  if (
    recipients.length === 0 ||
    recipients.length > MAX_EMAIL_RECIPIENTS ||
    recipients.some((recipient) => (
      recipient.length === 0 ||
      recipient.length > MAX_EMAIL_ENTRY_LENGTH ||
      !isEmailAddress(recipient)
    ))
  ) return null;
  return recipients;
}

function isLikelyResendApiKey(value: string) {
  return /^re_[a-zA-Z0-9_-]{8,}$/.test(value) && !isPlaceholderPublicValue(value);
}

function isConfiguredSecretToken(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 16 && !isPlaceholderPublicValue(trimmed);
}

function isPlaceholderPublicValue(value: string) {
  return /^(?:your-[a-z0-9-]+|[a-z0-9-]*placeholder[a-z0-9-]*|[a-z0-9-]*changeme[a-z0-9-]*|example|demo|test|privy-app)$/i
    .test(value.trim());
}

function parseRuntimeBlockNumber(name: string, value: string, label: string, issues: string[]) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    issues.push(`${name} must be a positive integer block number on ${label}.`);
    return null;
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    issues.push(`${name} must be a positive integer block number on ${label}.`);
    return null;
  }
  return parsed;
}

function parseMainnetBlockNumber(name: string, value: string, issues: string[]) {
  return parseRuntimeBlockNumber(name, value, "mainnet", issues);
}

function validateRuntimeAddress(name: string, value: string, label: string, issues: string[]) {
  if (!value) return null;
  if (!isAddress(value)) {
    issues.push(`${name} must be a valid EVM address on ${label}.`);
    return null;
  }
  const normalized = getAddress(value);
  if (normalized === zeroAddress) {
    issues.push(`${name} must not be the zero address on ${label}.`);
    return null;
  }
  return normalized;
}

function validateMainnetAddress(name: string, value: string, issues: string[]) {
  return validateRuntimeAddress(name, value, "mainnet", issues);
}

function isPathInsideRepo(filePath: string) {
  const absolute = resolve(filePath);
  const rel = relative(REPO_ROOT, absolute);
  return rel === "" || (rel && !rel.startsWith("..") && !rel.includes(":"));
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
  const chainId = getEnv("LINEA_CHAIN_ID");
  const publicChainId = getEnv("NEXT_PUBLIC_LINEA_CHAIN_ID");
  if (!chainId) issues.push("LINEA_CHAIN_ID must be set explicitly to 59144 for mainnet.");
  if (!publicChainId) issues.push("NEXT_PUBLIC_LINEA_CHAIN_ID must be set explicitly to 59144 for mainnet.");
  if (chainId && chainId !== "59144") {
    issues.push(`LINEA_CHAIN_ID must be 59144 on mainnet, got "${chainId}".`);
  }
  if (publicChainId && publicChainId !== "59144") {
    issues.push(`NEXT_PUBLIC_LINEA_CHAIN_ID must be 59144 on mainnet, got "${publicChainId}".`);
  }
  if (chainId && publicChainId && chainId !== publicChainId) {
    issues.push("LINEA_CHAIN_ID and NEXT_PUBLIC_LINEA_CHAIN_ID must match on mainnet.");
  }

  const keeperContractAddress = getEnv("KEEPER_CONTRACT_ADDRESS");
  const publicContractAddress = getEnv("NEXT_PUBLIC_CONTRACT_ADDRESS");
  if (!keeperContractAddress) issues.push("KEEPER_CONTRACT_ADDRESS is required for mainnet.");
  if (!publicContractAddress) issues.push("NEXT_PUBLIC_CONTRACT_ADDRESS is required for mainnet.");
  const normalizedKeeperContractAddress = validateMainnetAddress(
    "KEEPER_CONTRACT_ADDRESS",
    keeperContractAddress,
    issues,
  );
  const normalizedPublicContractAddress = validateMainnetAddress(
    "NEXT_PUBLIC_CONTRACT_ADDRESS",
    publicContractAddress,
    issues,
  );
  if (
    normalizedKeeperContractAddress &&
    normalizedPublicContractAddress &&
    normalizedKeeperContractAddress !== normalizedPublicContractAddress
  ) {
    issues.push("KEEPER_CONTRACT_ADDRESS and NEXT_PUBLIC_CONTRACT_ADDRESS must match on mainnet.");
  }

  const lineaTokenAddress = getEnv("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS");
  if (!lineaTokenAddress) {
    issues.push("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS is required for mainnet.");
  }
  validateMainnetAddress("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS", lineaTokenAddress, issues);
  if (!getContractRequiresEpochBoundBets(getEnv("NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS"))) {
    issues.push("NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1 is required for the V10 mainnet launch.");
  }

  const indexerStartBlock = getEnv("INDEXER_START_BLOCK");
  const deployBlock = getEnv("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
  if (!indexerStartBlock) issues.push("INDEXER_START_BLOCK is required for mainnet.");
  if (!deployBlock) issues.push("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK is required for mainnet.");
  const normalizedIndexerStartBlock = parseMainnetBlockNumber("INDEXER_START_BLOCK", indexerStartBlock, issues);
  const normalizedDeployBlock = parseMainnetBlockNumber("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK", deployBlock, issues);
  if (
    normalizedIndexerStartBlock !== null &&
    normalizedDeployBlock !== null &&
    normalizedIndexerStartBlock !== normalizedDeployBlock
  ) {
    issues.push("INDEXER_START_BLOCK and NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must match on mainnet.");
  }

  const keeperRpcUrl = getEnv("KEEPER_RPC_URL");
  if (!keeperRpcUrl) {
    issues.push("KEEPER_RPC_URL is required for mainnet.");
  } else if (!isPublicHttpsEndpoint(keeperRpcUrl)) {
    issues.push("KEEPER_RPC_URL must be a public https:// URL on mainnet.");
  }

  const publicRpcUrls = parseEndpointList(getEnv("NEXT_PUBLIC_LINEA_RPCS"));
  if (publicRpcUrls.some((url) => !isPublicHttpsEndpoint(url))) {
    issues.push("NEXT_PUBLIC_LINEA_RPCS must contain only public https:// URLs on mainnet.");
  }
  if (scope === "web" && !hasTwoIndependentPublicRpcOrigins(publicRpcUrls)) {
    issues.push(
      "NEXT_PUBLIC_LINEA_RPCS must contain at least two distinct canonical public https:// origins for wallet transfer quorum on mainnet web builds.",
    );
  }
  if (getEnv("NEXT_PUBLIC_LINEA_SEPOLIA_RPCS")) {
    issues.push("NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must not be configured on mainnet; use NEXT_PUBLIC_LINEA_RPCS.");
  }

  const siteUrl = getEnv("NEXT_PUBLIC_SITE_URL");
  if (!siteUrl) {
    issues.push("NEXT_PUBLIC_SITE_URL is required for mainnet.");
  } else if (!isPublicMainnetSiteUrl(siteUrl)) {
    issues.push("NEXT_PUBLIC_SITE_URL must be a public https:// URL on mainnet.");
  }

  if (getEnv("HEALTH_DIAGNOSTICS_SECRET").length < 32) {
    issues.push("HEALTH_DIAGNOSTICS_SECRET must contain at least 32 characters on mainnet.");
  }
  if (isTruthyEnv(getEnv("RUNTIME_MONITOR_ALLOW_NO_ALERTS"))) {
    issues.push("RUNTIME_MONITOR_ALLOW_NO_ALERTS must not be enabled on mainnet.");
  }
  const resendApiKey = getEnv("RESEND_API_KEY");
  const resendFrom = getEnv("RUNTIME_MONITOR_EMAIL_FROM");
  const resendToRaw = getEnv("RUNTIME_MONITOR_EMAIL_TO");
  const resendTo = parseEmailRecipients(resendToRaw);
  const resendPartiallyConfigured = Boolean(resendApiKey || resendFrom || resendToRaw);
  const resendRequired = scope === "server";
  if (resendPartiallyConfigured || resendRequired) {
    if (!resendApiKey) {
      issues.push(
        resendRequired
          ? "RESEND_API_KEY is required for mainnet server email alerts."
          : "RESEND_API_KEY is required when Resend email alerts are configured on mainnet.",
      );
    } else if (!isLikelyResendApiKey(resendApiKey)) {
      issues.push("RESEND_API_KEY must look like a Resend API key on mainnet.");
    }
    if (!isEmailAddress(resendFrom)) {
      issues.push("RUNTIME_MONITOR_EMAIL_FROM must be a valid Resend-verified email sender on mainnet.");
    }
    if (resendTo === null) {
      issues.push("RUNTIME_MONITOR_EMAIL_TO must contain valid email recipient addresses on mainnet.");
    }
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
    const rawReplicaCount = getEnv("WEB_REPLICA_COUNT");
    const replicaCount = Number(rawReplicaCount);
    if (!rawReplicaCount) {
      issues.push("WEB_REPLICA_COUNT must be explicitly set for mainnet web/server runtime.");
    } else if (!Number.isSafeInteger(replicaCount) || replicaCount < 1) {
      issues.push("WEB_REPLICA_COUNT must be a positive integer when set.");
    } else if (replicaCount > 1) {
      if (
        !isPublicHttpsEndpoint(getEnv("UPSTASH_REDIS_REST_URL")) ||
        !isConfiguredSecretToken(getEnv("UPSTASH_REDIS_REST_TOKEN"))
      ) {
        issues.push("Multiple mainnet web replicas require UPSTASH_REDIS_REST_URL and a non-placeholder UPSTASH_REDIS_REST_TOKEN for shared rate limiting.");
      }
      if (getEnv("RATE_LIMIT_EXTERNAL_FAIL_CLOSED") !== "1") {
        issues.push("RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1 is required with multiple mainnet web replicas.");
      }
    }
    const privyAppId = getEnv("NEXT_PUBLIC_PRIVY_APP_ID");
    if (!privyAppId) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID is required for mainnet web runtime.");
    } else if (isPlaceholderPublicValue(privyAppId)) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID must not use an example or placeholder value on mainnet.");
    } else if (KNOWN_DEVELOPMENT_PRIVY_APP_IDS.has(privyAppId)) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID must not use the development Privy app id on mainnet.");
    }
    const chatAuthSecret = getEnv("CHAT_AUTH_SECRET") || getEnv("NEXTAUTH_SECRET");
    if (chatAuthSecret.length < 32) {
      issues.push("CHAT_AUTH_SECRET or NEXTAUTH_SECRET must contain at least 32 characters for mainnet web runtime.");
    }
    validateRuntimePurposeSecretSeparation("mainnet", issues);
    const adminAuthSecret = getEnv("ADMIN_AUTH_SECRET");
    if (adminAuthSecret.length < 32) {
      issues.push("The effective ADMIN_AUTH_SECRET must contain at least 32 characters for mainnet admin sessions.");
    } else if (chatAuthSecret && adminAuthSecret === chatAuthSecret) {
      issues.push("ADMIN_AUTH_SECRET must be distinct from the chat authentication secret on mainnet.");
    }
    const adminWalletAddress = getEnv("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS");
    if (!adminWalletAddress) {
      issues.push("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS is required for mainnet admin auth.");
    }
    validateMainnetAddress("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS", adminWalletAddress, issues);
    if (getEnv("BOOTSTRAP_RESOLVE_SECRET").length < 32) {
      issues.push("BOOTSTRAP_RESOLVE_SECRET must contain at least 32 characters for mainnet bootstrap resolve.");
    }
    validateBootstrapResolveCredentials("mainnet", issues);
  }

  if (scope === "bot") {
    if (!getEnv("KEEPER_PRIVATE_KEY")) {
      issues.push("KEEPER_PRIVATE_KEY is required for mainnet keeper runtime.");
    } else if (!isPrivateKeyHex(getEnv("KEEPER_PRIVATE_KEY"))) {
      issues.push("KEEPER_PRIVATE_KEY must be a 64-hex private key on mainnet.");
    }
  }

  validateRequiredRuntimeFinalityBlocks(scope, "mainnet", issues);

  if (scope === "web" || scope === "indexer" || scope === "server") {
    const dbPath = getEnv("LORE_DB_PATH");
    if (!dbPath) {
      issues.push("LORE_DB_PATH must point to a persistent absolute path on mainnet.");
    } else {
      if (!isAbsolute(dbPath)) {
        issues.push("LORE_DB_PATH must be absolute on mainnet.");
      }
      if (dbPath === DEFAULT_DB_PATH || /[/\\]data[/\\]lore\.sqlite$/i.test(resolve(dbPath))) {
        issues.push("LORE_DB_PATH must not use the repo-local default data/lore.sqlite on mainnet.");
      }
      if (isAbsolute(dbPath) && isPathInsideRepo(dbPath)) {
        issues.push("LORE_DB_PATH must be outside the repo checkout on mainnet.");
      }
    }
  }

  if (scope === "server") {
    const backupDirNames = ["LORE_BACKUP_DIR", "RUNTIME_MONITOR_BACKUP_DIR"] as const;
    if (!backupDirNames.some((name) => getEnv(name))) {
      issues.push("LORE_BACKUP_DIR or RUNTIME_MONITOR_BACKUP_DIR is required for mainnet server backup monitoring.");
    }
    if (!isPositiveSafeInteger(getEnv("RUNTIME_MONITOR_BACKUP_MAX_AGE_MS"))) {
      issues.push("RUNTIME_MONITOR_BACKUP_MAX_AGE_MS must be a positive safe integer for mainnet server backup monitoring.");
    }
    for (const name of backupDirNames) {
      const backupDir = getEnv(name);
      if (!backupDir) continue;
      if (!isAbsolute(backupDir)) {
        issues.push(`${name} must be absolute on mainnet when configured.`);
      } else if (isPathInsideRepo(backupDir)) {
        issues.push(`${name} must be outside the repo checkout on mainnet.`);
      }
    }
  }

  return issues;
}

function validatePremainnetTestnetProductionEnv(scope: ProductionRuntimeScope) {
  const issues: string[] = [];
  const label = "pre-mainnet testnet";
  const lineaNetwork = getEnv("LINEA_NETWORK");
  const publicLineaNetwork = getEnv("NEXT_PUBLIC_LINEA_NETWORK");
  const normalizedLineaNetwork = getConfiguredLineaNetwork(lineaNetwork || null);
  const normalizedPublicLineaNetwork = getConfiguredLineaNetwork(publicLineaNetwork || null);

  if (!lineaNetwork) issues.push("LINEA_NETWORK must be set explicitly for pre-mainnet testnet.");
  if (!publicLineaNetwork) issues.push("NEXT_PUBLIC_LINEA_NETWORK must be set explicitly for pre-mainnet testnet.");
  if (lineaNetwork && normalizedLineaNetwork !== "sepolia") {
    issues.push(`LINEA_NETWORK must resolve to sepolia for pre-mainnet testnet, got "${lineaNetwork}".`);
  }
  if (publicLineaNetwork && normalizedPublicLineaNetwork !== "sepolia") {
    issues.push(`NEXT_PUBLIC_LINEA_NETWORK must resolve to sepolia for pre-mainnet testnet, got "${publicLineaNetwork}".`);
  }

  const chainId = getEnv("LINEA_CHAIN_ID");
  const publicChainId = getEnv("NEXT_PUBLIC_LINEA_CHAIN_ID");
  if (!chainId) issues.push("LINEA_CHAIN_ID must be set explicitly to 59141 for pre-mainnet testnet.");
  if (!publicChainId) issues.push("NEXT_PUBLIC_LINEA_CHAIN_ID must be set explicitly to 59141 for pre-mainnet testnet.");
  if (chainId && chainId !== "59141") {
    issues.push(`LINEA_CHAIN_ID must be 59141 on pre-mainnet testnet, got "${chainId}".`);
  }
  if (publicChainId && publicChainId !== "59141") {
    issues.push(`NEXT_PUBLIC_LINEA_CHAIN_ID must be 59141 on pre-mainnet testnet, got "${publicChainId}".`);
  }
  if (chainId && publicChainId && chainId !== publicChainId) {
    issues.push("LINEA_CHAIN_ID and NEXT_PUBLIC_LINEA_CHAIN_ID must match on pre-mainnet testnet.");
  }

  const keeperContractAddress = getEnv("KEEPER_CONTRACT_ADDRESS");
  const publicContractAddress = getEnv("NEXT_PUBLIC_CONTRACT_ADDRESS");
  if (!keeperContractAddress) issues.push("KEEPER_CONTRACT_ADDRESS is required for pre-mainnet testnet.");
  if (!publicContractAddress) issues.push("NEXT_PUBLIC_CONTRACT_ADDRESS is required for pre-mainnet testnet.");
  const normalizedKeeperContractAddress = validateRuntimeAddress(
    "KEEPER_CONTRACT_ADDRESS",
    keeperContractAddress,
    label,
    issues,
  );
  const normalizedPublicContractAddress = validateRuntimeAddress(
    "NEXT_PUBLIC_CONTRACT_ADDRESS",
    publicContractAddress,
    label,
    issues,
  );
  if (
    normalizedKeeperContractAddress &&
    normalizedPublicContractAddress &&
    normalizedKeeperContractAddress !== normalizedPublicContractAddress
  ) {
    issues.push("KEEPER_CONTRACT_ADDRESS and NEXT_PUBLIC_CONTRACT_ADDRESS must match on pre-mainnet testnet.");
  }

  const lineaTokenAddress = getEnv("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS");
  if (!lineaTokenAddress) {
    issues.push("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS is required for pre-mainnet testnet.");
  }
  validateRuntimeAddress("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS", lineaTokenAddress, label, issues);
  if (!getContractRequiresEpochBoundBets(getEnv("NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS"))) {
    issues.push("NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1 is required for the V10 pre-mainnet testnet runtime.");
  }

  const indexerStartBlock = getEnv("INDEXER_START_BLOCK");
  const deployBlock = getEnv("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
  if (!indexerStartBlock) issues.push("INDEXER_START_BLOCK is required for pre-mainnet testnet.");
  if (!deployBlock) issues.push("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK is required for pre-mainnet testnet.");
  const normalizedIndexerStartBlock = parseRuntimeBlockNumber("INDEXER_START_BLOCK", indexerStartBlock, label, issues);
  const normalizedDeployBlock = parseRuntimeBlockNumber("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK", deployBlock, label, issues);
  if (
    normalizedIndexerStartBlock !== null &&
    normalizedDeployBlock !== null &&
    normalizedIndexerStartBlock !== normalizedDeployBlock
  ) {
    issues.push("INDEXER_START_BLOCK and NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must match on pre-mainnet testnet.");
  }

  const keeperRpcUrl = getEnv("KEEPER_RPC_URL");
  if (!keeperRpcUrl) {
    issues.push("KEEPER_RPC_URL is required for pre-mainnet testnet.");
  } else if (!isPublicHttpsEndpoint(keeperRpcUrl)) {
    issues.push("KEEPER_RPC_URL must be a public https:// URL on pre-mainnet testnet.");
  }

  const publicSepoliaRpcUrls = parseEndpointList(getEnv("NEXT_PUBLIC_LINEA_SEPOLIA_RPCS"));
  if (publicSepoliaRpcUrls.some((url) => !isPublicHttpsEndpoint(url))) {
    issues.push("NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must contain only public https:// URLs on pre-mainnet testnet.");
  }
  if (scope === "web" && !hasTwoIndependentPublicRpcOrigins(publicSepoliaRpcUrls)) {
    issues.push(
      "NEXT_PUBLIC_LINEA_SEPOLIA_RPCS must contain at least two distinct canonical public https:// origins for wallet transfer quorum on pre-mainnet testnet web builds.",
    );
  }
  if (getEnv("NEXT_PUBLIC_LINEA_RPCS")) {
    issues.push("NEXT_PUBLIC_LINEA_RPCS must not be configured for pre-mainnet testnet; use NEXT_PUBLIC_LINEA_SEPOLIA_RPCS.");
  }

  const siteUrl = getEnv("NEXT_PUBLIC_SITE_URL");
  if (!siteUrl) {
    issues.push("NEXT_PUBLIC_SITE_URL is required for pre-mainnet testnet.");
  } else if (!isPublicMainnetSiteUrl(siteUrl)) {
    issues.push("NEXT_PUBLIC_SITE_URL must be a public https:// URL on pre-mainnet testnet.");
  }

  if (getEnv("HEALTH_DIAGNOSTICS_SECRET").length < 32) {
    issues.push("HEALTH_DIAGNOSTICS_SECRET must contain at least 32 characters on pre-mainnet testnet.");
  }
  if (isTruthyEnv(getEnv("RUNTIME_MONITOR_ALLOW_NO_ALERTS"))) {
    issues.push("RUNTIME_MONITOR_ALLOW_NO_ALERTS must not be enabled on pre-mainnet testnet.");
  }
  const resendApiKey = getEnv("RESEND_API_KEY");
  const resendFrom = getEnv("RUNTIME_MONITOR_EMAIL_FROM");
  const resendTo = parseEmailRecipients(getEnv("RUNTIME_MONITOR_EMAIL_TO"));
  if (!resendApiKey) issues.push("RESEND_API_KEY is required for pre-mainnet testnet email alerts.");
  else if (!isLikelyResendApiKey(resendApiKey)) {
    issues.push("RESEND_API_KEY must look like a Resend API key on pre-mainnet testnet.");
  }
  if (!isEmailAddress(resendFrom)) {
    issues.push("RUNTIME_MONITOR_EMAIL_FROM must be a valid Resend-verified email sender on pre-mainnet testnet.");
  }
  if (resendTo === null) {
    issues.push("RUNTIME_MONITOR_EMAIL_TO must contain valid email recipient addresses on pre-mainnet testnet.");
  }

  if (scope === "web" || scope === "server") {
    if (isTruthyEnv(getEnv("ALLOW_WEAK_RATE_LIMIT_IDENTITY"))) {
      issues.push("ALLOW_WEAK_RATE_LIMIT_IDENTITY must not be enabled on pre-mainnet testnet.");
    }
    if (getEnv("TRUST_PROXY_HEADERS") !== "1") {
      issues.push("TRUST_PROXY_HEADERS=1 is required for pre-mainnet testnet web runtime behind a trusted proxy.");
    }
    if (getEnv("TRUST_PROXY_SECRET").length < 32) {
      issues.push("TRUST_PROXY_SECRET must contain at least 32 characters on pre-mainnet testnet.");
    }
    const replicaCount = Number(getEnv("WEB_REPLICA_COUNT") || "1");
    if (!Number.isSafeInteger(replicaCount) || replicaCount < 1) {
      issues.push("WEB_REPLICA_COUNT must be a positive integer when set.");
    } else if (replicaCount < 2) {
      issues.push("WEB_REPLICA_COUNT must be at least 2 for pre-mainnet testnet production-like rate-limit validation.");
    } else if (replicaCount > 1) {
      if (
        !isPublicHttpsEndpoint(getEnv("UPSTASH_REDIS_REST_URL")) ||
        !isConfiguredSecretToken(getEnv("UPSTASH_REDIS_REST_TOKEN"))
      ) {
        issues.push("Multiple pre-mainnet testnet web replicas require UPSTASH_REDIS_REST_URL and a non-placeholder UPSTASH_REDIS_REST_TOKEN for shared rate limiting.");
      }
      if (getEnv("RATE_LIMIT_EXTERNAL_FAIL_CLOSED") !== "1") {
        issues.push("RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1 is required with multiple pre-mainnet testnet web replicas.");
      }
    }
    const privyAppId = getEnv("NEXT_PUBLIC_PRIVY_APP_ID");
    if (!privyAppId) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID is required for pre-mainnet testnet web runtime.");
    } else if (isPlaceholderPublicValue(privyAppId)) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID must not use an example or placeholder value on pre-mainnet testnet.");
    } else if (KNOWN_DEVELOPMENT_PRIVY_APP_IDS.has(privyAppId)) {
      issues.push("NEXT_PUBLIC_PRIVY_APP_ID must not use the development Privy app id on pre-mainnet testnet.");
    }
    const chatAuthSecret = getEnv("CHAT_AUTH_SECRET") || getEnv("NEXTAUTH_SECRET");
    if (chatAuthSecret.length < 32) {
      issues.push("CHAT_AUTH_SECRET or NEXTAUTH_SECRET must contain at least 32 characters for pre-mainnet testnet web runtime.");
    }
    validateRuntimePurposeSecretSeparation(label, issues);
    const adminAuthSecret = getEnv("ADMIN_AUTH_SECRET");
    if (adminAuthSecret.length < 32) {
      issues.push("The effective ADMIN_AUTH_SECRET must contain at least 32 characters for pre-mainnet testnet admin sessions.");
    } else if (chatAuthSecret && adminAuthSecret === chatAuthSecret) {
      issues.push("ADMIN_AUTH_SECRET must be distinct from the chat authentication secret on pre-mainnet testnet.");
    }
    const adminWalletAddress = getEnv("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS");
    if (!adminWalletAddress) {
      issues.push("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS is required for pre-mainnet testnet admin auth.");
    }
    validateRuntimeAddress("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS", adminWalletAddress, label, issues);
    if (getEnv("BOOTSTRAP_RESOLVE_SECRET").length < 32) {
      issues.push("BOOTSTRAP_RESOLVE_SECRET must contain at least 32 characters for pre-mainnet testnet bootstrap resolve.");
    }
    validateBootstrapResolveCredentials(label, issues);
  }

  if (scope === "bot") {
    if (!getEnv("KEEPER_PRIVATE_KEY")) {
      issues.push("KEEPER_PRIVATE_KEY is required for pre-mainnet testnet keeper runtime.");
    } else if (!isPrivateKeyHex(getEnv("KEEPER_PRIVATE_KEY"))) {
      issues.push("KEEPER_PRIVATE_KEY must be a 64-hex private key on pre-mainnet testnet.");
    }
  }

  validateRequiredRuntimeFinalityBlocks(scope, label, issues);

  if (scope === "web" || scope === "indexer" || scope === "server") {
    const dbPath = getEnv("LORE_DB_PATH");
    if (!dbPath) {
      issues.push("LORE_DB_PATH must point to a persistent absolute path on pre-mainnet testnet.");
    } else {
      if (!isAbsolute(dbPath)) {
        issues.push("LORE_DB_PATH must be absolute on pre-mainnet testnet.");
      }
      if (dbPath === DEFAULT_DB_PATH || /[/\\]data[/\\]lore\.sqlite$/i.test(resolve(dbPath))) {
        issues.push("LORE_DB_PATH must not use the repo-local default data/lore.sqlite on pre-mainnet testnet.");
      }
      if (isAbsolute(dbPath) && isPathInsideRepo(dbPath)) {
        issues.push("LORE_DB_PATH must be outside the repo checkout on pre-mainnet testnet.");
      }
    }
  }

  if (scope === "server") {
    const backupDirNames = ["LORE_BACKUP_DIR", "RUNTIME_MONITOR_BACKUP_DIR"] as const;
    if (!backupDirNames.some((name) => getEnv(name))) {
      issues.push("LORE_BACKUP_DIR or RUNTIME_MONITOR_BACKUP_DIR is required for pre-mainnet testnet server backup monitoring.");
    }
    if (!isPositiveSafeInteger(getEnv("RUNTIME_MONITOR_BACKUP_MAX_AGE_MS"))) {
      issues.push("RUNTIME_MONITOR_BACKUP_MAX_AGE_MS must be a positive safe integer for pre-mainnet testnet server backup monitoring.");
    }
    for (const name of backupDirNames) {
      const backupDir = getEnv(name);
      if (!backupDir) continue;
      if (!isAbsolute(backupDir)) {
        issues.push(`${name} must be absolute on pre-mainnet testnet when configured.`);
      } else if (isPathInsideRepo(backupDir)) {
        issues.push(`${name} must be outside the repo checkout on pre-mainnet testnet.`);
      }
    }
  }

  return issues;
}

export function assertProductionRuntimeConfig(scope: ProductionRuntimeScope) {
  const configuredNetwork = getConfiguredLineaNetwork();
  const strictPremainnetTestnet =
    configuredNetwork === "sepolia" && isTruthyEnv(getEnv("LORE_PREMAINNET_RUNTIME_STRICT"));
  if (configuredNetwork !== "mainnet" && !strictPremainnetTestnet) return;

  const hermeticBuildVariables = Object.entries(process.env)
    .filter(([name, value]) => name.toUpperCase().startsWith("LORE_HERMETIC_BUILD") && value?.trim())
    .map(([name]) => name)
    .sort();
  if (hermeticBuildVariables.length > 0) {
    throw new Error(
      `Hermetic build-only environment variables are forbidden in a strict runtime: ${hermeticBuildVariables.join(", ")}.`,
    );
  }

  const cacheKey = `${strictPremainnetTestnet ? "pre-mainnet-testnet" : "mainnet"}:${scope}`;
  if (validatedScopes.has(cacheKey)) return;

  const issues = strictPremainnetTestnet
    ? validatePremainnetTestnetProductionEnv(scope)
    : validateMainnetProductionEnv(scope);
  if (issues.length > 0) {
    const label = strictPremainnetTestnet ? "pre-mainnet testnet" : "mainnet";
    throw new Error(
      [
        `[prod-config] invalid ${label} runtime configuration for ${scope}:`,
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
  }

  validatedScopes.add(cacheKey);
}
