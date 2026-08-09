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
const MAX_CUSTOM_AVATAR_DIMENSION = 512;
const MAX_CUSTOM_AVATAR_PIXELS = MAX_CUSTOM_AVATAR_DIMENSION * MAX_CUSTOM_AVATAR_DIMENSION;

function decodeAvatarDataUrl(value: string): Uint8Array | null {
  const separator = value.indexOf(",");
  if (separator < 0) return null;
  try {
    const binary = atob(value.slice(separator + 1));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function readAvatarDimensions(value: string): { width: number; height: number } | null {
  const bytes = decodeAvatarDataUrl(value);
  if (!bytes) return null;
  const read16be = (offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
  const read16le = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);

  if (value.startsWith("data:image/png") && bytes.length >= 24) {
    return { width: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19], height: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23] };
  }
  if (value.startsWith("data:image/gif") && bytes.length >= 10) {
    return { width: read16le(6), height: read16le(8) };
  }
  if ((value.startsWith("data:image/jpeg") || value.startsWith("data:image/jpg")) && bytes.length >= 4) {
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 1 >= bytes.length) return null;
      const length = read16be(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: read16be(offset + 5), height: read16be(offset + 3) };
      }
      offset += length;
    }
    return null;
  }
  if (value.startsWith("data:image/webp") && bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const type = String.fromCharCode(...bytes.slice(12, 16));
    if (type === "VP8X") {
      return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    }
    if (type === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: read16le(26) & 0x3fff, height: read16le(28) & 0x3fff };
    }
    if (type === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      return { width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10) };
    }
  }
  return null;
}

export function isPresetChatAvatarId(value: string | null | undefined): value is ChatAvatarId {
  return !!value && (CHAT_AVATAR_IDS as readonly string[]).includes(value);
}

export function isSupportedChatAvatarDataUrl(value: string | null | undefined): boolean {
  if (!value || !CHAT_CUSTOM_AVATAR_DATA_URL.test(value)) return false;
  const dimensions = readAvatarDimensions(value);
  return !!dimensions &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    dimensions.width <= MAX_CUSTOM_AVATAR_DIMENSION &&
    dimensions.height <= MAX_CUSTOM_AVATAR_DIMENSION &&
    dimensions.width * dimensions.height <= MAX_CUSTOM_AVATAR_PIXELS;
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
