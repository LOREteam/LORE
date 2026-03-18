import { linea, lineaSepolia } from "viem/chains";

// Non-secret project defaults.
// Keep values here so deployment does not require duplicating them in server .env.

export const DEFAULT_FIREBASE_DB_URL =
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export type LineaNetwork = "mainnet" | "sepolia";

export const DEFAULT_LINEA_NETWORK: LineaNetwork = "sepolia";

export const DEFAULT_SEPOLIA_CONTRACT_ADDRESS =
  "0x40a87453f92f56aa7cd917af82a6f6cd26820515" as const;

export const DEFAULT_SEPOLIA_LINEA_TOKEN_ADDRESS =
  "0xad986c50d411055484d38bf779ba2450a42afd60" as const;

export const LEGACY_SEPOLIA_CONTRACT_ADDRESS =
  "0x3eab64b4de11355508b2656aedf832b33771c74e" as const;

// The previous Sepolia deployment was a legacy contract profile.
// The current default Sepolia deployment uses the V6-style APIs, while the
// old address still needs explicit legacy handling when selected via env.
export const LEGACY_CONTRACTS_WITHOUT_TOKEN_GETTER = [
  LEGACY_SEPOLIA_CONTRACT_ADDRESS.toLowerCase(),
] as const;
export const LEGACY_CONTRACTS_WITHOUT_REBATE_API = [
  LEGACY_SEPOLIA_CONTRACT_ADDRESS.toLowerCase(),
] as const;

export const DEFAULT_INDEXER_START_BLOCK = 26_997_266;

export const DEFAULT_INDEXER_RECONCILE_INTERVAL_MS = 120_000;
export const DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS = 8;
export const DEFAULT_API_EPOCHS_RECONCILE_MAX = 25;
export const DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS = 800;

const DEFAULT_LINEA_MAINNET_RPCS = [...linea.rpcUrls.default.http] as const;

// publicnode supports eth_sendRawTransaction and must be FIRST (Privy uses first URL for broadcast).
// drpc and rpc.sepolia.linea.build do NOT support eth_sendRawTransaction.
export const DEFAULT_LINEA_SEPOLIA_RPCS = [
  "https://linea-sepolia-rpc.publicnode.com",
  "https://linea-sepolia.drpc.org",
  "https://rpc.sepolia.linea.build",
] as const;

function normalizeLineaNetwork(value?: string | null): LineaNetwork {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "mainnet" ||
    normalized === "main" ||
    normalized === "linea" ||
    normalized === "prod" ||
    normalized === "production"
  ) {
    return "mainnet";
  }
  return "sepolia";
}

export function getConfiguredLineaNetwork(explicitValue?: string | null): LineaNetwork {
  return normalizeLineaNetwork(
    explicitValue ??
      process.env.LINEA_NETWORK ??
      process.env.NEXT_PUBLIC_LINEA_NETWORK,
  );
}

export function getLineaChain(network: LineaNetwork = getConfiguredLineaNetwork()) {
  return network === "mainnet" ? linea : lineaSepolia;
}

export function getLineaChainName(network: LineaNetwork = getConfiguredLineaNetwork()) {
  return network === "mainnet" ? "Linea" : "Linea Sepolia";
}

export function getLineaExplorerTxBaseUrl(network: LineaNetwork = getConfiguredLineaNetwork()) {
  return network === "mainnet"
    ? "https://lineascan.build/tx"
    : "https://sepolia.lineascan.build/tx";
}

function getRequiredConfigValue(
  value: string | null | undefined,
  envName: string,
  network: LineaNetwork,
): string {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  if (network === "mainnet") {
    throw new Error(`${envName} is required when LINEA_NETWORK=mainnet.`);
  }
  return "";
}

export function getConfiguredContractAddress(
  explicitValue?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const configured = getRequiredConfigValue(explicitValue, "CONTRACT_ADDRESS", network);
  return configured || DEFAULT_SEPOLIA_CONTRACT_ADDRESS;
}

export function getConfiguredFirebaseDbUrl(
  explicitValue?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const configured = getRequiredConfigValue(
    explicitValue,
    "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
    network,
  );
  return configured || DEFAULT_FIREBASE_DB_URL;
}

export function getConfiguredLineaTokenAddress(
  explicitValue?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const configured = getRequiredConfigValue(explicitValue, "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS", network);
  return configured || DEFAULT_SEPOLIA_LINEA_TOKEN_ADDRESS;
}

export function getConfiguredDeployBlock(
  explicitValue?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const configured = getRequiredConfigValue(explicitValue, "INDEXER_START_BLOCK", network);
  return BigInt(configured || String(DEFAULT_INDEXER_START_BLOCK));
}

export function isDeprecatedLineaRpc(url: string | null | undefined) {
  if (!url) return false;
  return url.toLowerCase().includes("blastapi.io");
}

export function getDefaultLineaRpcs(network: LineaNetwork = getConfiguredLineaNetwork()) {
  return network === "mainnet"
    ? [...DEFAULT_LINEA_MAINNET_RPCS]
    : [...DEFAULT_LINEA_SEPOLIA_RPCS];
}

export function getPreferredLineaRpcs(
  primaryRpc?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const urls = [primaryRpc?.trim(), ...getDefaultLineaRpcs(network)]
    .filter((url): url is string => Boolean(url))
    .filter((url) => !isDeprecatedLineaRpc(url));

  return [...new Set(urls)];
}

function parseBooleanEnv(value?: string | null) {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function isLegacyContractAddress(contractAddress?: string | null) {
  const normalizedAddress = contractAddress?.trim().toLowerCase();
  if (!normalizedAddress) return false;
  return LEGACY_CONTRACTS_WITHOUT_TOKEN_GETTER.includes(normalizedAddress);
}

export function getContractHasTokenGetter(
  contractAddress?: string | null,
  explicitFlag?: string | null,
) {
  if (isLegacyContractAddress(contractAddress)) return false;

  const envValue = parseBooleanEnv(explicitFlag);
  if (envValue !== null) return envValue;

  const normalizedAddress = contractAddress?.trim().toLowerCase();
  if (!normalizedAddress) return true;
  return true;
}

export function getContractHasRebateApi(
  contractAddress?: string | null,
  explicitFlag?: string | null,
) {
  const normalizedAddress = contractAddress?.trim().toLowerCase();
  if (normalizedAddress && LEGACY_CONTRACTS_WITHOUT_REBATE_API.includes(normalizedAddress)) {
    return false;
  }

  const envValue = parseBooleanEnv(explicitFlag);
  if (envValue !== null) return envValue;

  return true;
}
