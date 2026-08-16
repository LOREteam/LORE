import { sanitizeCustomChatAvatar, sanitizePresetChatAvatar } from "./chatAvatar";
import { normalizeChatAuthAddress } from "./chatAuth";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { readJsonResponse } from "./readJsonResponse";

export const CHAT_PROFILE_LEGACY_STORAGE_KEY = "lore:chat-profile";
export const CHAT_PROFILE_STORAGE_KEY_PREFIX = "lore:chat-profile:";
export const CHAT_PROFILE_NAME_MAX = 20;
export const CHAT_PROFILE_MAX_AVATAR_LEN = 8_000;

export interface ChatProfile {
  name: string | null;
  avatar: string | null;
  customAvatar: string | null;
  updatedAt?: number;
}

type ChatProfileStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ChatProfileFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function removeChatProfileStorageKey(storage: Pick<Storage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage cleanup is best effort in private/quota-restricted contexts.
  }
}

export function getChatProfileStorageKey(walletAddress: string | null): string {
  const normalizedWallet = normalizeChatAuthAddress(walletAddress);
  return normalizedWallet
    ? `${CHAT_PROFILE_STORAGE_KEY_PREFIX}${normalizedWallet}`
    : CHAT_PROFILE_LEGACY_STORAGE_KEY;
}

export function emptyChatProfile(): ChatProfile {
  return { name: null, avatar: null, customAvatar: null, updatedAt: 0 };
}

export function normalizeChatProfile(input: Partial<ChatProfile>): ChatProfile {
  const nameRaw = typeof input.name === "string" ? input.name.trim() : "";
  const name = nameRaw ? nameRaw.slice(0, CHAT_PROFILE_NAME_MAX) : null;
  const avatar = sanitizePresetChatAvatar(input.avatar);
  const customAvatar = sanitizeCustomChatAvatar(input.customAvatar, CHAT_PROFILE_MAX_AVATAR_LEN);
  const updatedAt = typeof input.updatedAt === "number" &&
    Number.isSafeInteger(input.updatedAt) &&
    input.updatedAt >= 0
    ? input.updatedAt
    : 0;
  return { name, avatar, customAvatar, updatedAt };
}

function parseStoredChatProfile(raw: string): ChatProfile | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeChatProfile(parsed as Partial<ChatProfile>);
  } catch {
    return null;
  }
}

export function readChatProfileCache(
  storage: ChatProfileStorage,
  walletAddress: string | null,
): ChatProfile {
  const normalizedWallet = normalizeChatAuthAddress(walletAddress);
  const key = getChatProfileStorageKey(normalizedWallet);
  try {
    const currentRaw = storage.getItem(key);
    if (currentRaw) {
      const current = parseStoredChatProfile(currentRaw);
      if (current) return current;
      removeChatProfileStorageKey(storage, key);
      return emptyChatProfile();
    }

    if (!normalizedWallet) return emptyChatProfile();
    const legacyRaw = storage.getItem(CHAT_PROFILE_LEGACY_STORAGE_KEY);
    if (!legacyRaw) return emptyChatProfile();
    const legacy = parseStoredChatProfile(legacyRaw);
    if (!legacy) {
      removeChatProfileStorageKey(storage, CHAT_PROFILE_LEGACY_STORAGE_KEY);
      return emptyChatProfile();
    }

    storage.removeItem(CHAT_PROFILE_LEGACY_STORAGE_KEY);
    storage.setItem(key, JSON.stringify(legacy));
    return legacy;
  } catch {
    removeChatProfileStorageKey(storage, key);
    return emptyChatProfile();
  }
}

export function persistChatProfileCache(
  storage: Pick<Storage, "setItem">,
  walletAddress: string | null,
  profile: ChatProfile,
): void {
  try {
    storage.setItem(getChatProfileStorageKey(walletAddress), JSON.stringify(profile));
  } catch {
    // Ignore quota/private-mode failures; the remote copy remains authoritative.
  }
}

export function hasMeaningfulChatProfile(profile: ChatProfile): boolean {
  return Boolean(profile.name || profile.avatar || profile.customAvatar);
}

export function sameChatProfileContent(a: ChatProfile | null, b: ChatProfile | null): boolean {
  if (!a || !b) return false;
  return a.name === b.name && a.avatar === b.avatar && a.customAvatar === b.customAvatar;
}

export function selectNewerChatProfile(
  local: ChatProfile | null,
  remote: ChatProfile | null,
): ChatProfile | null {
  if (!local) return remote;
  if (!remote) return local;
  return (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0) ? local : remote;
}

export async function fetchRemoteChatProfile(
  walletAddress: string,
  fetcher: ChatProfileFetcher = fetchWithTimeout,
): Promise<ChatProfile | null> {
  const normalizedWallet = normalizeChatAuthAddress(walletAddress);
  if (!normalizedWallet) return null;
  try {
    const response = await fetcher(
      `/api/chat/profile?walletAddress=${normalizedWallet}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const json = await readJsonResponse<{ profile?: Partial<ChatProfile> | null }>(response);
    if (!json?.profile || typeof json.profile !== "object" || Array.isArray(json.profile)) return null;
    const profile = normalizeChatProfile(json.profile);
    return hasMeaningfulChatProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}

export async function saveRemoteChatProfile(
  walletAddress: string,
  profile: ChatProfile,
  options: { fetcher?: ChatProfileFetcher; now?: () => number } = {},
): Promise<void> {
  const normalizedWallet = normalizeChatAuthAddress(walletAddress);
  if (!normalizedWallet) throw new Error("Invalid chat wallet address");
  const fetcher = options.fetcher ?? fetchWithTimeout;
  const payload = {
    walletAddress: normalizedWallet,
    name: profile.name,
    avatar: profile.avatar,
    customAvatar: profile.customAvatar,
    updatedAt: profile.updatedAt ?? options.now?.() ?? Date.now(),
  };
  const response = await fetcher("/api/chat/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    await readJsonResponse<unknown>(response).catch(() => null);
    throw new Error(`HTTP ${response.status}`);
  }
}
