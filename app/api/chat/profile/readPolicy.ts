import { normalizeChatAuthAddress } from "../../../lib/chatAuth";

export const MAX_REQUESTED_CHAT_PROFILE_WALLETS = 100;

type NormalizeChatProfileAddress = (value: unknown) => string;

export type ChatProfileReadScope =
  | { ok: true; kind: "single"; walletAddress: string }
  | { ok: true; kind: "batch"; walletAddresses: string[] }
  | {
      ok: false;
      error:
        | "Invalid walletAddress"
        | "Invalid walletAddresses"
        | "Too many walletAddresses"
        | "walletAddress or walletAddresses is required";
    };

export function parseChatProfileReadScope(
  walletAddress: string | null,
  walletAddressesParam: string | null,
  normalizeAddress: NormalizeChatProfileAddress = normalizeChatAuthAddress,
): ChatProfileReadScope {
  const rawRequestedAddresses = walletAddressesParam
    ? walletAddressesParam
        .split(",", MAX_REQUESTED_CHAT_PROFILE_WALLETS + 1)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  if (walletAddressesParam !== null && rawRequestedAddresses.length === 0) {
    return { ok: false, error: "Invalid walletAddresses" };
  }
  if (rawRequestedAddresses.length > MAX_REQUESTED_CHAT_PROFILE_WALLETS) {
    return { ok: false, error: "Too many walletAddresses" };
  }

  const normalizedRequestedAddresses = rawRequestedAddresses.map((value) =>
    normalizeAddress(value),
  );

  if (walletAddress) {
    const normalizedWalletAddress = normalizeAddress(walletAddress);
    if (!normalizedWalletAddress) {
      return { ok: false, error: "Invalid walletAddress" };
    }
    return { ok: true, kind: "single", walletAddress: normalizedWalletAddress };
  }

  if (rawRequestedAddresses.length > 0) {
    if (normalizedRequestedAddresses.some((value) => !value)) {
      return { ok: false, error: "Invalid walletAddresses" };
    }
    return {
      ok: true,
      kind: "batch",
      walletAddresses: [...new Set(normalizedRequestedAddresses)],
    };
  }

  return {
    ok: false,
    error: "walletAddress or walletAddresses is required",
  };
}
