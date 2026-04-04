"use client";

import { memo, type ReactElement } from "react";
import { CHAT_AVATAR_IDS, isPresetChatAvatarId, type ChatAvatarId } from "../../lib/chatAvatar";

export const AVATAR_IDS = CHAT_AVATAR_IDS;
export type AvatarId = ChatAvatarId;
const AVATAR_ASSET_VERSION = "lore-v7";

const PRESET_AVATAR_SRC: Record<AvatarId, string> = {
  "miner-helmet": `/chat-avatars/miner-helmet.png?v=${AVATAR_ASSET_VERSION}`,
  "crossed-picks": `/chat-avatars/crossed-picks.png?v=${AVATAR_ASSET_VERSION}`,
  "crystal-cluster": `/chat-avatars/crystal-cluster.png?v=${AVATAR_ASSET_VERSION}`,
  "mine-cart": `/chat-avatars/mine-cart.png?v=${AVATAR_ASSET_VERSION}`,
  dynamite: `/chat-avatars/dynamite.png?v=${AVATAR_ASSET_VERSION}`,
  "gold-ingot": `/chat-avatars/gold-ingot.png?v=${AVATAR_ASSET_VERSION}`,
  "wall-torch": `/chat-avatars/wall-torch.png?v=${AVATAR_ASSET_VERSION}`,
  "drill-bit": `/chat-avatars/drill-bit.png?v=${AVATAR_ASSET_VERSION}`,
  "mega-diamond": `/chat-avatars/mega-diamond.png?v=${AVATAR_ASSET_VERSION}`,
  "fire-gem": `/chat-avatars/fire-gem.png?v=${AVATAR_ASSET_VERSION}`,
  "shield-pick": `/chat-avatars/shield-pick.png?v=${AVATAR_ASSET_VERSION}`,
  potion: `/chat-avatars/potion.png?v=${AVATAR_ASSET_VERSION}`,
  "dragon-eye": `/chat-avatars/dragon-eye.png?v=${AVATAR_ASSET_VERSION}`,
  "crown-gems": `/chat-avatars/crown-gems.png?v=${AVATAR_ASSET_VERSION}`,
  skull: `/chat-avatars/skull.png?v=${AVATAR_ASSET_VERSION}`,
  "lantern-glow": `/chat-avatars/lantern-glow.png?v=${AVATAR_ASSET_VERSION}`,
};

export function isAvatarId(value: string | null | undefined): value is AvatarId {
  return isPresetChatAvatarId(value);
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function renderWalletFallback(walletAddress: string | undefined, size: number): ReactElement {
  const seed = hashString((walletAddress ?? "wallet-fallback").toLowerCase());
  const hue = seed % 360;
  const secondaryHue = (hue + 42) % 360;
  const deepHue = (hue + 220) % 360;
  const root = `wallet-${seed}-${size}`;
  const bgGradient = `${root}-bg`;
  const ringGradient = `${root}-ring`;
  const metalGradient = `${root}-metal`;
  const glyphGradient = `${root}-glyph`;
  const blurFilter = `${root}-blur`;
  const bevelFilter = `${root}-bevel`;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={bgGradient} cx="32%" cy="18%" r="80%">
          <stop offset="0%" stopColor={`hsl(${hue} 100% 72%)`} />
          <stop offset="42%" stopColor={`hsl(${secondaryHue} 95% 52%)`} />
          <stop offset="100%" stopColor={`hsl(${deepHue} 65% 20%)`} />
        </radialGradient>
        <linearGradient id={ringGradient} x1="15" y1="12" x2="48" y2="55">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id={metalGradient} x1="16" y1="10" x2="48" y2="56">
          <stop offset="0%" stopColor="#EEF3FF" stopOpacity="0.92" />
          <stop offset="45%" stopColor="#8090C2" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#F5F8FF" stopOpacity="0.84" />
        </linearGradient>
        <linearGradient id={glyphGradient} x1="23" y1="20" x2="41" y2="44">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#DFF8FF" />
        </linearGradient>
        <filter id={blurFilter} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5.3" />
        </filter>
        <filter id={bevelFilter} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodColor="#FFFFFF" floodOpacity="0.18" />
          <feDropShadow dx="0" dy="4.5" stdDeviation="3.8" floodColor="#061021" floodOpacity="0.36" />
        </filter>
      </defs>

      <circle cx="32" cy="34" r="27.8" fill={`hsl(${hue} 100% 72%)`} opacity="0.24" filter={`url(#${blurFilter})`} />
      <g filter={`url(#${bevelFilter})`}>
        <circle cx="32" cy="32" r="27.7" fill="#0A0F1B" opacity="0.9" />
        <circle cx="32" cy="32" r="26.6" fill={`url(#${metalGradient})`} opacity="0.84" />
        <circle cx="32" cy="32" r="24.7" fill={`url(#${bgGradient})`} />
      </g>
      <circle cx="32" cy="32" r="24.7" fill="none" stroke={`url(#${ringGradient})`} strokeWidth="1.2" />
      <ellipse cx="32" cy="18.6" rx="17.1" ry="7.2" fill="#FFFFFF" opacity="0.16" />
      <ellipse cx="32" cy="46.4" rx="15.8" ry="5.6" fill="#000000" opacity="0.18" />
      <circle cx="32" cy="32" r="15.4" fill="#07111F" opacity="0.15" />

      <g fill={`url(#${glyphGradient})`}>
        <path d="M32 19l13 13-13 13-13-13z" opacity="0.93" />
        <path d="M32 23l9 9-9 9-9-9z" opacity="0.65" />
        <circle cx="32" cy="32" r="3.4" opacity="0.92" />
      </g>
      <path d="M45.5 18.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="#FFFFFF" opacity="0.78" />
    </svg>
  );
}

export type ChatAvatarProps = {
  avatarId?: AvatarId | null;
  customSrc?: string | null;
  walletAddress?: string;
  size?: number;
  className?: string;
};

function AvatarImage({
  src,
  size,
  className,
  contain = false,
  rounded = true,
}: {
  src: string;
  size: number;
  className?: string;
  contain?: boolean;
  rounded?: boolean;
}) {
  return (
    // next/image caused intermittent preset avatar blanks in the chat settings grid.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="avatar"
      width={size}
      height={size}
      loading="eager"
      decoding="async"
      draggable={false}
      className={`block ${rounded ? "rounded-[30%]" : ""} ${contain ? "object-contain" : "object-cover"} shadow-[0_10px_28px_rgba(3,7,18,0.5)] ${className ?? ""}`}
    />
  );
}

export const ChatAvatar = memo(function ChatAvatar({
  avatarId = null,
  customSrc = null,
  walletAddress,
  size = 32,
  className,
}: ChatAvatarProps) {
  if (customSrc) {
    return <AvatarImage src={customSrc} size={size} className={className} />;
  }

  if (avatarId && isAvatarId(avatarId)) {
    return <AvatarImage src={PRESET_AVATAR_SRC[avatarId]} size={size} className={className} contain rounded={false} />;
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-[30%] ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {renderWalletFallback(walletAddress, size)}
    </span>
  );
});
