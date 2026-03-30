export const CHAT_AVATAR_IDS = [
  "miner-helmet",
  "crossed-picks",
  "crystal-cluster",
  "mine-cart",
  "dynamite",
  "gold-ingot",
  "wall-torch",
  "drill-bit",
  "mega-diamond",
  "fire-gem",
  "shield-pick",
  "potion",
  "dragon-eye",
  "crown-gems",
  "skull",
  "lantern-glow",
] as const;

export type ChatAvatarId = (typeof CHAT_AVATAR_IDS)[number];

const CHAT_CUSTOM_AVATAR_DATA_URL =
  /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i;

export function isPresetChatAvatarId(value: string | null | undefined): value is ChatAvatarId {
  return !!value && (CHAT_AVATAR_IDS as readonly string[]).includes(value);
}

export function isSupportedChatAvatarDataUrl(value: string | null | undefined): boolean {
  return !!value && CHAT_CUSTOM_AVATAR_DATA_URL.test(value);
}

export function sanitizePresetChatAvatar(value: unknown): string | null {
  return typeof value === "string" && isPresetChatAvatarId(value) ? value : null;
}

export function sanitizeCustomChatAvatar(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  if (value.length > maxLength) return null;
  return isSupportedChatAvatarDataUrl(value) ? value : null;
}

export function sanitizeChatAvatarValue(value: unknown, maxLength: number): string | null {
  return sanitizePresetChatAvatar(value) ?? sanitizeCustomChatAvatar(value, maxLength);
}
