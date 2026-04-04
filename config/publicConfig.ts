import { linea, lineaSepolia } from "viem/chains";

// Non-secret project defaults.
// Keep values here so deployment does not require duplicating them in server .env.

export const DEFAULT_FIREBASE_DB_URL =
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export type LineaNetwork = "mainnet" | "sepolia";

export const DEFAULT_LINEA_NETWORK: LineaNetwork = "sepolia";

export const DEFAULT_SEPOLIA_CONTRACT_ADDRESS =
  "0x712538a24aba20d03a8a7e6590ffad9b2951ded1" as const;

export const DEFAULT_SEPOLIA_LINEA_TOKEN_ADDRESS =
  "0xad986c50d411055484d38bf779ba2450a42afd60" as const;

export const DEFAULT_INDEXER_START_BLOCK = 27_709_620;

export const DEFAULT_INDEXER_RECONCILE_INTERVAL_MS = 120_000;
export const DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS = 8;
export const DEFAULT_API_EPOCHS_RECONCILE_MAX = 25;
export const DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS = 800;
export const DEFAULT_EIP7702_ENABLED = false;
export const DEFAULT_EIP7702_MINING_ENABLED = false;
export const DEFAULT_SEPOLIA_EIP7702_DELEGATE_ADDRESS =
  "0x170067a88e64bba842ae6615ab277493de32629a" as const;

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

export function getLineaExplorerAddressBaseUrl(network: LineaNetwork = getConfiguredLineaNetwork()) {
  return network === "mainnet"
    ? "https://lineascan.build/address"
    : "https://sepolia.lineascan.build/address";
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

export function isUnstableLineaReadRpc(
  url: string | null | undefined,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  if (!url) return false;
  const normalized = url.toLowerCase();
  if (network === "sepolia" && normalized.includes("linea-sepolia.drpc.org")) {
    return true;
  }
  return false;
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

export function getStableLineaReadRpcs(
  primaryRpc?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const filtered = getPreferredLineaRpcs(primaryRpc, network)
    .filter((url) => !isUnstableLineaReadRpc(url, network));
  return filtered.length > 0 ? filtered : getPreferredLineaRpcs(primaryRpc, network);
}

function parseBooleanEnv(value?: string | null) {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function getConfiguredEip7702Enabled(explicitFlag?: string | null) {
  const envValue = parseBooleanEnv(
    explicitFlag ??
      process.env.NEXT_PUBLIC_EIP7702_ENABLED ??
      process.env.EIP7702_ENABLED,
  );
  return envValue ?? DEFAULT_EIP7702_ENABLED;
}

export function getConfiguredEip7702MiningEnabled(explicitFlag?: string | null) {
  const envValue = parseBooleanEnv(
    explicitFlag ??
      process.env.NEXT_PUBLIC_EIP7702_MINING_ENABLED ??
      process.env.EIP7702_MINING_ENABLED,
  );
  return envValue ?? DEFAULT_EIP7702_MINING_ENABLED;
}

export function getConfiguredEip7702DelegateAddress(
  explicitValue?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const configured =
    explicitValue?.trim() ??
    process.env.NEXT_PUBLIC_EIP7702_DELEGATE_ADDRESS?.trim() ??
    process.env.EIP7702_DELEGATE_ADDRESS?.trim() ??
    "";

  if (configured) return configured;
  if (network === "mainnet") return "";
  return DEFAULT_SEPOLIA_EIP7702_DELEGATE_ADDRESS;
}

export function getContractHasTokenGetter(
  contractAddress?: string | null,
  explicitFlag?: string | null,
) {
  const envValue = parseBooleanEnv(explicitFlag);
  if (envValue !== null) return envValue;

  return true;
}

export function getContractHasRebateApi(
  contractAddress?: string | null,
  explicitFlag?: string | null,
) {
  const envValue = parseBooleanEnv(explicitFlag);
  if (envValue !== null) return envValue;

  return true;
}
