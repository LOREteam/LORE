import type { Chain } from "viem";
import { parseRequiredNonNegativeBigIntEnv } from "./envParsing";

// Non-secret project defaults.
// Keep values here so deployment does not require duplicating them in server .env.

export type LineaNetwork = "mainnet" | "sepolia";

export const DEFAULT_LINEA_NETWORK: LineaNetwork = "sepolia";

export const DEFAULT_SEPOLIA_CONTRACT_ADDRESS =
  "0x5e40c6e31642ebe8670658fe84c660bd2a0f820f" as const;

export const DEFAULT_SEPOLIA_LINEA_TOKEN_ADDRESS =
  "0xad986c50d411055484d38bf779ba2450a42afd60" as const;

export const DEFAULT_SEPOLIA_EXPECTED_CURRENT_OWNER_ADDRESS =
  "0xc1E3819A1842338b55EA038f6D92555E084E040a" as const;

export const DEFAULT_SEPOLIA_EXPECTED_CURRENT_FEE_RECIPIENT_ADDRESS =
  "0x1Ea3AA15B7A4D8b82D9eB94CF58bDC007e4B6cDF" as const;

export const DEFAULT_SEPOLIA_EXPECTED_CURRENT_EPOCH_DURATION = 60;

export const DEFAULT_INDEXER_START_BLOCK = 31_035_418;

export const DEFAULT_INDEXER_RECONCILE_INTERVAL_MS = 120_000;
export const DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS = 8;
export const DEFAULT_API_EPOCHS_RECONCILE_MAX = 25;
export const DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS = 800;
export const DEFAULT_CLIENT_AUTO_RESOLVE_ENABLED = false;
export const DEFAULT_READ_ONLY_MODE = false;

const LINEA_MAINNET_CHAIN = {
  id: 59144,
  name: "Linea Mainnet",
  nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.linea.build"], webSocket: ["wss://rpc.linea.build"] },
  },
  blockExplorers: {
    default: { name: "Lineascan", url: "https://lineascan.build", apiUrl: "https://api.lineascan.build/api" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 42 },
    ensRegistry: { address: "0x50130b669B28C339991d8676FA73CF122a121267", blockCreated: 6682888 },
    ensUniversalResolver: { address: "0x4D41762915F83c76EcaF6776d9b08076aA32b492", blockCreated: 22222151 },
  },
  ensTlds: [".linea.eth"],
  testnet: false,
} as const satisfies Chain;

const LINEA_SEPOLIA_CHAIN = {
  id: 59141,
  name: "Linea Sepolia Testnet",
  nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.sepolia.linea.build"], webSocket: ["wss://rpc.sepolia.linea.build"] },
  },
  blockExplorers: {
    default: {
      name: "Lineascan",
      url: "https://sepolia.lineascan.build",
      apiUrl: "https://api-sepolia.lineascan.build/api",
    },
  },
  contracts: {
    multicall3: { address: "0xca11bde05977b3631167028862be2a173976ca11", blockCreated: 227427 },
    ensRegistry: { address: "0x5B2636F0f2137B4aE722C01dd5122D7d3e9541f7", blockCreated: 2395094 },
    ensUniversalResolver: { address: "0x4D41762915F83c76EcaF6776d9b08076aA32b492", blockCreated: 17168484 },
  },
  ensTlds: [".linea.eth"],
  testnet: true,
} as const satisfies Chain;

const DEFAULT_LINEA_MAINNET_RPCS = [...LINEA_MAINNET_CHAIN.rpcUrls.default.http] as const;

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
  return network === "mainnet" ? LINEA_MAINNET_CHAIN : LINEA_SEPOLIA_CHAIN;
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
  const value = configured || String(DEFAULT_INDEXER_START_BLOCK);
  return parseRequiredNonNegativeBigIntEnv(value, "INDEXER_START_BLOCK");
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
  if (network === "sepolia" && normalized.includes("linea-sepolia-rpc.publicnode.com")) {
    return true;
  }
  return false;
}

export function getDefaultLineaRpcs(network: LineaNetwork = getConfiguredLineaNetwork()) {
  return network === "mainnet"
    ? [...DEFAULT_LINEA_MAINNET_RPCS]
    : [...DEFAULT_LINEA_SEPOLIA_RPCS];
}

function parseLineaRpcInput(value?: string | null) {
  return value
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean) ?? [];
}

export function getPreferredLineaRpcs(
  primaryRpc?: string | null,
  network: LineaNetwork = getConfiguredLineaNetwork(),
) {
  const urls = [...parseLineaRpcInput(primaryRpc), ...getDefaultLineaRpcs(network)]
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

export function getConfiguredClientAutoResolveEnabled(explicitFlag?: string | null) {
  // Browser-triggered keeper resolve is intentionally isolated. The protected
  // server route remains available for explicitly authorized operator flows.
  void explicitFlag;
  return DEFAULT_CLIENT_AUTO_RESOLVE_ENABLED;
}

export function getConfiguredReadOnlyMode(explicitFlag?: string | null) {
  const envValue = parseBooleanEnv(
    explicitFlag ?? process.env.NEXT_PUBLIC_LORE_READ_ONLY_MODE,
  );
  return envValue ?? DEFAULT_READ_ONLY_MODE;
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

export function getContractRequiresEpochBoundBets(explicitFlag?: string | null) {
  return parseBooleanEnv(explicitFlag) ?? false;
}
