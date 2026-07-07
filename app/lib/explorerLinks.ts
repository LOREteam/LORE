import { getAddress } from "viem";
import { getLineaExplorerAddressBaseUrl } from "../../config/publicConfig";
import { APP_NETWORK, EXPLORER_TX_BASE_URL } from "./constants";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function getExplorerTxUrl(txHash: string | null | undefined) {
  const normalized = txHash?.trim();
  if (!normalized || !TX_HASH_RE.test(normalized)) return null;
  return `${EXPLORER_TX_BASE_URL}/${normalized}`;
}

export function getExplorerAddressUrl(address: string | null | undefined) {
  if (!address) return null;
  try {
    return `${getLineaExplorerAddressBaseUrl(APP_NETWORK)}/${getAddress(address)}`;
  } catch {
    return null;
  }
}
