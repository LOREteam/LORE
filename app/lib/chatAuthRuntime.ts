import { toHex } from "viem";
import { APP_CHAIN_ID } from "./constants";
import { buildChatAuthMessage, createChatAuthNonce, normalizeChatAuthAddress } from "./chatAuth";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { readJsonResponse } from "./readJsonResponse";
import { normalizeChatAuthSessionExpiresAt } from "./chatSessionClient";

export const CHAT_AUTH_CHAIN_ID = APP_CHAIN_ID;

type ChatAuthProvider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

type ChatAuthWallet = {
  address: string;
  getEthereumProvider(): Promise<ChatAuthProvider>;
};

type ChatAuthProofOptions = {
  walletAddress: string | null;
  origin: string;
  wallets: readonly ChatAuthWallet[];
  signMessage: (message: string, uiTitle: string) => Promise<string>;
  uiTitle: string;
  issuedAt?: string;
  nonce?: string;
};

export async function createChatAuthProof({
  walletAddress,
  origin,
  wallets,
  signMessage,
  uiTitle,
  issuedAt = new Date().toISOString(),
  nonce = createChatAuthNonce(),
}: ChatAuthProofOptions): Promise<Record<string, string> | null> {
  const normalizedWallet = normalizeChatAuthAddress(walletAddress);
  if (!normalizedWallet) return null;
  const message = buildChatAuthMessage({
    address: normalizedWallet,
    uri: `${origin}/chat`,
    chainId: CHAT_AUTH_CHAIN_ID,
    nonce,
    issuedAt,
  });
  const targetWallet = wallets.find(
    (wallet) => normalizeChatAuthAddress(wallet.address) === normalizedWallet,
  );
  let signature: string;
  if (targetWallet) {
    const provider = await targetWallet.getEthereumProvider();
    signature = String(await provider.request({
      method: "personal_sign",
      params: [toHex(message), normalizedWallet],
    }));
  } else {
    signature = await signMessage(message, uiTitle);
  }
  return {
    authAddress: normalizedWallet,
    authMessage: message,
    authSignature: signature,
  };
}

export async function requestChatAuthSession(
  method: "GET" | "POST",
  payload?: Record<string, unknown>,
  fetcher: typeof fetchWithTimeout = fetchWithTimeout,
): Promise<number | null> {
  const response = await fetcher("/api/chat/auth", {
    method,
    ...(method === "POST"
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload ?? {}),
        }
      : {}),
    cache: "no-store",
  });
  const json = await readJsonResponse<{ error?: string }>(response).catch(() => null);
  if (!response.ok || json?.error) {
    throw new Error(json?.error || `Chat auth HTTP ${response.status}`);
  }
  return normalizeChatAuthSessionExpiresAt(response.headers.get("x-chat-session-expires-at"));
}
