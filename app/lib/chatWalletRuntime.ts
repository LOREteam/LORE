import { normalizeChatAuthAddress } from "./chatAuth";
import type { ChatMessage } from "./chatMessages";

export const CHAT_WALLET_STORAGE_KEY = "lore:chat-wallet-address";

type ChatWalletAddress = `0x${string}`;

export function normalizeChatWalletCandidate(
  address: string | null | undefined,
): ChatWalletAddress | null {
  return normalizeChatAuthAddress(address) || null;
}

export function normalizeChatWalletCandidates(
  addresses: Array<string | null | undefined>,
): ChatWalletAddress[] {
  const seen = new Set<string>();
  const candidates: ChatWalletAddress[] = [];
  for (const address of addresses) {
    const normalized = normalizeChatWalletCandidate(address);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(normalized);
  }
  return candidates;
}

function clearStoredChatWalletAddress(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(CHAT_WALLET_STORAGE_KEY);
  } catch {
    // Storage cleanup is best effort in private/quota-restricted contexts.
  }
}

export function selectStableChatWalletAddress(
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  candidates: readonly ChatWalletAddress[],
  currentAddress: string | null = null,
): ChatWalletAddress | null {
  const current = normalizeChatWalletCandidate(currentAddress);
  if (current && candidates.includes(current)) return current;
  if (!storage) return candidates[0] ?? null;

  try {
    const rawStored = storage.getItem(CHAT_WALLET_STORAGE_KEY);
    const stored = normalizeChatWalletCandidate(rawStored);
    if (stored && candidates.includes(stored)) return stored;
    if (rawStored !== null) clearStoredChatWalletAddress(storage);
  } catch {
    clearStoredChatWalletAddress(storage);
  }
  return candidates[0] ?? null;
}

export function persistStableChatWalletAddress(
  storage: Pick<Storage, "setItem" | "removeItem">,
  address: string | null,
): void {
  const normalized = normalizeChatWalletCandidate(address);
  try {
    if (normalized) storage.setItem(CHAT_WALLET_STORAGE_KEY, normalized);
    else storage.removeItem(CHAT_WALLET_STORAGE_KEY);
  } catch {
    // Ignore quota/private-mode failures; the selected runtime address remains valid.
  }
}

export function isOwnChatMessageSender(
  sender: string | null | undefined,
  walletAddress: string | null | undefined,
): boolean {
  const normalizedSender = normalizeChatWalletCandidate(sender);
  const normalizedWallet = normalizeChatWalletCandidate(walletAddress);
  return Boolean(normalizedSender && normalizedWallet && normalizedSender === normalizedWallet);
}

export function countOtherChatMessages(
  messages: readonly Pick<ChatMessage, "sender">[],
  walletAddress: string | null | undefined,
): number {
  return messages.reduce(
    (count, message) => count + (isOwnChatMessageSender(message.sender, walletAddress) ? 0 : 1),
    0,
  );
}
