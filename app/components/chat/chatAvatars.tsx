"use client";

import React, { memo } from "react";
import Image from "next/image";

export const AVATAR_IDS = [
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

export type AvatarId = (typeof AVATAR_IDS)[number];

type SymbolId =
  | "helmet"
  | "pickaxes"
  | "crystal"
  | "cart"
  | "dynamite"
  | "ingot"
  | "torch"
  | "drill"
  | "diamond"
  | "ember"
  | "shield"
  | "potion"
  | "eye"
  | "crown"
  | "skull"
  | "lantern";

type Theme = {
  symbol: SymbolId;
  top: string;
  mid: string;
  deep: string;
  glow: string;
  icon: string;
};

const PRESET_THEMES: Record<AvatarId, Theme> = {
  "miner-helmet": {
    symbol: "helmet",
    top: "#5DFFB4",
    mid: "#20C888",
    deep: "#0E4D44",
    glow: "#7DFFD8",
    icon: "#EDFFF5",
  },
  "crossed-picks": {
    symbol: "pickaxes",
    top: "#FFE79A",
    mid: "#F6B33B",
    deep: "#734410",
    glow: "#FFD16B",
    icon: "#FFF6DB",
  },
  "crystal-cluster": {
    symbol: "crystal",
    top: "#FF8BCB",
    mid: "#D14AF1",
    deep: "#5E1478",
    glow: "#FF9EEA",
    icon: "#FFE8F8",
  },
  "mine-cart": {
    symbol: "cart",
    top: "#89C6FF",
    mid: "#4F89FF",
    deep: "#173A94",
    glow: "#98CFFF",
    icon: "#EBF5FF",
  },
  dynamite: {
    symbol: "dynamite",
    top: "#FF9C8D",
    mid: "#F45252",
    deep: "#871321",
    glow: "#FFB49A",
    icon: "#FFEAE7",
  },
  "gold-ingot": {
    symbol: "ingot",
    top: "#FFE88A",
    mid: "#F8B321",
    deep: "#865300",
    glow: "#FFD85A",
    icon: "#FFF8DD",
  },
  "wall-torch": {
    symbol: "torch",
    top: "#FFB271",
    mid: "#F06A1B",
    deep: "#812606",
    glow: "#FFCA93",
    icon: "#FFF0E1",
  },
  "drill-bit": {
    symbol: "drill",
    top: "#97C9FF",
    mid: "#346EFB",
    deep: "#162576",
    glow: "#9ED6FF",
    icon: "#EAF4FF",
  },
  "mega-diamond": {
    symbol: "diamond",
    top: "#9EFCFF",
    mid: "#38C0FF",
    deep: "#1266A6",
    glow: "#82EBFF",
    icon: "#EEFFFF",
  },
  "fire-gem": {
    symbol: "ember",
    top: "#FFB88C",
    mid: "#FF7D37",
    deep: "#9A3C00",
    glow: "#FFBC80",
    icon: "#FFF1E6",
  },
  "shield-pick": {
    symbol: "shield",
    top: "#AFBBFF",
    mid: "#7188FF",
    deep: "#273B9A",
    glow: "#B6C7FF",
    icon: "#F2F4FF",
  },
  potion: {
    symbol: "potion",
    top: "#99FFAD",
    mid: "#39BE58",
    deep: "#145328",
    glow: "#A8FFC6",
    icon: "#EDFFF1",
  },
  "dragon-eye": {
    symbol: "eye",
    top: "#FFCA86",
    mid: "#E87F17",
    deep: "#7E3B00",
    glow: "#FFD39A",
    icon: "#FFF5E3",
  },
  "crown-gems": {
    symbol: "crown",
    top: "#DCA3FF",
    mid: "#9D53FF",
    deep: "#4E1C93",
    glow: "#DAAEFF",
    icon: "#F8EEFF",
  },
  skull: {
    symbol: "skull",
    top: "#B2B8D8",
    mid: "#6973AD",
    deep: "#2A325A",
    glow: "#C0C5EB",
    icon: "#F4F6FF",
  },
  "lantern-glow": {
    symbol: "lantern",
    top: "#FFC885",
    mid: "#E29518",
    deep: "#774305",
    glow: "#FFD9A8",
    icon: "#FFF4DE",
  },
};

export function isAvatarId(value: string | null | undefined): value is AvatarId {
  return !!value && (AVATAR_IDS as readonly string[]).includes(value);
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function renderSymbol(symbol: SymbolId, fill: string, stroke: string): React.ReactNode {
  const commonStroke = {
    stroke,
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (symbol) {
    case "helmet":
      return (
        <>
          <path d="M18 38v-5c0-7.7 6.3-14 14-14s14 6.3 14 14v5h-6v-5c0-4.4-3.6-8-8-8s-8 3.6-8 8v5z" fill={fill} />
          <rect x="22" y="38" width="20" height="8" rx="4" fill={fill} opacity="0.9" />
          <path d="M28 20h8v10h-8z" fill={stroke} opacity="0.32" />
          <path d="M23 38h18" {...commonStroke} />
        </>
      );
    case "pickaxes":
      return (
        <>
          <path d="M22 42L42 22" {...commonStroke} />
          <path d="M22 22L42 42" {...commonStroke} />
          <path d="M18 24c4-5.5 10.5-7.7 16-5l-5.2 4.9c-3.1-.8-6.2 0-8.8 2.3z" fill={fill} />
          <path d="M46 24c-4-5.5-10.5-7.7-16-5l5.2 4.9c3.1-.8 6.2 0 8.8 2.3z" fill={fill} />
        </>
      );
    case "crystal":
      return (
        <>
          <polygon points="24,41 29,22 34,41 29,46" fill={fill} />
          <polygon points="16,42 21,28 25,42 21,47" fill={fill} opacity="0.9" />
          <polygon points="38,42 43,28 47,42 43,47" fill={fill} opacity="0.9" />
          <path d="M29 22l3 3 3-3M21 28l2.5 2 2.5-2M43 28l2.5 2 2.5-2" {...commonStroke} />
        </>
      );
    case "cart":
      return (
        <>
          <path d="M18 25h25l-3.6 13H22.3z" fill={fill} />
          <path d="M17 25h27M22 38h17" {...commonStroke} />
          <circle cx="24" cy="43" r="3.5" fill={stroke} opacity="0.34" />
          <circle cx="37" cy="43" r="3.5" fill={stroke} opacity="0.34" />
          <circle cx="24" cy="43" r="2.1" fill={fill} />
          <circle cx="37" cy="43" r="2.1" fill={fill} />
        </>
      );
    case "dynamite":
      return (
        <>
          <rect x="20" y="28" width="6.2" height="16" rx="2.2" fill={fill} />
          <rect x="28.9" y="28" width="6.2" height="16" rx="2.2" fill={fill} />
          <rect x="37.8" y="28" width="6.2" height="16" rx="2.2" fill={fill} />
          <path d="M41 25c2.2-3.7 5.3-4.8 7.2-1.6" {...commonStroke} />
          <circle cx="49" cy="21" r="2.2" fill={stroke} />
          <circle cx="49" cy="21" r="1.2" fill="#FFF7D7" />
        </>
      );
    case "ingot":
      return (
        <>
          <path d="M18 38l7-14h14l7 14z" fill={fill} />
          <path d="M18 38h28" {...commonStroke} />
          <path d="M24 31h16" {...commonStroke} />
          <path d="M28 24l-4 7M36 24l4 7" {...commonStroke} />
        </>
      );
    case "torch":
      return (
        <>
          <rect x="29" y="30" width="6" height="14" rx="2.5" fill={fill} />
          <path d="M32 20c4 3 5.2 7.4 0 11-5.2-3.6-4-8 0-11z" fill={fill} />
          <path d="M32 23c2.2 1.4 2.7 3.8 0 6-2.8-2.2-2.3-4.6 0-6z" fill={stroke} opacity="0.35" />
          <path d="M30 31h4M30 35h4M30 39h4" {...commonStroke} />
        </>
      );
    case "drill":
      return (
        <>
          <path d="M22 35h14l10-6v12l-10-6H22z" fill={fill} />
          <path d="M20 31h4v16h-4z" fill={fill} opacity="0.88" />
          <path d="M44 30l6 5-6 5" {...commonStroke} />
          <path d="M24 36h11M24 40h9" {...commonStroke} />
        </>
      );
    case "diamond":
      return (
        <>
          <polygon points="32,20 45,32 32,45 19,32" fill={fill} />
          <path d="M32 20v25M19 32h26M25 26l7 6 7-6M25 38l7-6 7 6" {...commonStroke} />
        </>
      );
    case "ember":
      return (
        <>
          <polygon points="32,19 44,31 32,45 20,31" fill={fill} />
          <path d="M32 24c3.8 3.2 4.9 7.3 0 11.1-4.9-3.8-3.8-7.9 0-11.1z" fill={stroke} opacity="0.34" />
          <path d="M32 19v26M20 31h24" {...commonStroke} />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M32 18l12 4v10c0 8.2-5 13.3-12 16-7-2.7-12-7.8-12-16V22z" fill={fill} />
          <path d="M32 21v23M24.5 29h15" {...commonStroke} />
        </>
      );
    case "potion":
      return (
        <>
          <path d="M27 20h10v5l3.7 5.2c3.5 5 0 13.8-8.7 13.8s-12.2-8.8-8.7-13.8L27 25z" fill={fill} />
          <path d="M24 36h16" {...commonStroke} />
          <path d="M29 20h6M29 25h6" {...commonStroke} />
          <circle cx="27.5" cy="39.5" r="1.4" fill={stroke} opacity="0.55" />
          <circle cx="35.5" cy="38" r="1.1" fill={stroke} opacity="0.55" />
        </>
      );
    case "eye":
      return (
        <>
          <path d="M16 32c3.8-6.4 9.2-9.8 16-9.8 6.8 0 12.2 3.4 16 9.8-3.8 6.4-9.2 9.8-16 9.8-6.8 0-12.2-3.4-16-9.8z" fill={fill} />
          <circle cx="32" cy="32" r="6.2" fill={stroke} opacity="0.36" />
          <circle cx="32" cy="32" r="3.1" fill={stroke} />
          <circle cx="34" cy="30" r="1.1" fill="#FFFFFF" />
        </>
      );
    case "crown":
      return (
        <>
          <path d="M18 40l3-15 11 9 11-9 3 15z" fill={fill} />
          <path d="M18 40h28M23 33h18" {...commonStroke} />
          <circle cx="21" cy="25" r="2.1" fill={fill} />
          <circle cx="32" cy="20" r="2.5" fill={fill} />
          <circle cx="43" cy="25" r="2.1" fill={fill} />
        </>
      );
    case "skull":
      return (
        <>
          <path d="M32 19c-8 0-13 5.7-13 12.2 0 4.5 2.1 7.5 5.4 9v4.8h15.2v-4.8c3.3-1.5 5.4-4.5 5.4-9C45 24.7 40 19 32 19z" fill={fill} />
          <circle cx="27.2" cy="31.3" r="2.5" fill={stroke} />
          <circle cx="36.8" cy="31.3" r="2.5" fill={stroke} />
          <rect x="29.6" y="36.8" width="4.8" height="2.8" rx="1.2" fill={stroke} />
          <path d="M27 44v3M32 44v3M37 44v3" {...commonStroke} />
        </>
      );
    case "lantern":
      return (
        <>
          <path d="M26 24h12v4h-12z" fill={fill} />
          <rect x="24" y="28" width="16" height="16" rx="4" fill={fill} />
          <path d="M27.5 28v16M36.5 28v16M24 36h16" {...commonStroke} />
          <circle cx="32" cy="36" r="3.1" fill="#FFF8CB" />
          <path d="M28 22c0-2.2 1.8-4 4-4s4 1.8 4 4" {...commonStroke} />
        </>
      );
    default:
      return null;
  }
}

function renderPresetAvatar(avatarId: AvatarId, size: number): React.ReactElement {
  const theme = PRESET_THEMES[avatarId];
  const root = `preset-${normalizeId(avatarId)}-${size}`;
  const bgGradient = `${root}-bg`;
  const ringGradient = `${root}-ring`;
  const iconGradient = `${root}-icon`;
  const glowFilter = `${root}-glow`;
  const iconFilter = `${root}-icon-shadow`;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={bgGradient} cx="30%" cy="22%" r="78%">
          <stop offset="0%" stopColor={theme.top} />
          <stop offset="56%" stopColor={theme.mid} />
          <stop offset="100%" stopColor={theme.deep} />
        </radialGradient>
        <linearGradient id={ringGradient} x1="16" y1="10" x2="48" y2="56">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id={iconGradient} x1="21" y1="18" x2="43" y2="46">
          <stop offset="0%" stopColor={theme.icon} />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.78" />
        </linearGradient>
        <filter id={glowFilter} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4.8" />
        </filter>
        <filter id={iconFilter} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.9" floodColor="#070B1F" floodOpacity="0.45" />
        </filter>
      </defs>

      <circle cx="32" cy="34" r="26.8" fill={theme.glow} opacity="0.34" filter={`url(#${glowFilter})`} />
      <circle cx="32" cy="32" r="26.5" fill={`url(#${bgGradient})`} />
      <circle cx="32" cy="32" r="26.5" fill="none" stroke={`url(#${ringGradient})`} strokeWidth="1.5" />
      <circle cx="22.5" cy="19" r="9.5" fill="#FFFFFF" opacity="0.2" />
      <ellipse cx="33" cy="18" rx="18" ry="7.8" fill="#FFFFFF" opacity="0.15" />
      <ellipse cx="32" cy="45.5" rx="17" ry="6.2" fill="#000000" opacity="0.18" />

      <g filter={`url(#${iconFilter})`}>
        {renderSymbol(theme.symbol, `url(#${iconGradient})`, "rgba(8, 12, 35, 0.44)")}
      </g>

      <circle cx="46" cy="21" r="1.8" fill="#FFFFFF" opacity="0.8" />
      <circle cx="19" cy="28" r="1.3" fill="#FFFFFF" opacity="0.5" />
    </svg>
  );
}

function renderWalletFallback(walletAddress: string | undefined, size: number): React.ReactElement {
  const seed = hashString((walletAddress ?? "wallet-fallback").toLowerCase());
  const hue = seed % 360;
  const secondaryHue = (hue + 42) % 360;
  const deepHue = (hue + 220) % 360;
  const root = `wallet-${seed}-${size}`;
  const bgGradient = `${root}-bg`;
  const ringGradient = `${root}-ring`;
  const glyphGradient = `${root}-glyph`;
  const blurFilter = `${root}-blur`;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={bgGradient} cx="30%" cy="20%" r="78%">
          <stop offset="0%" stopColor={`hsl(${hue} 100% 72%)`} />
          <stop offset="56%" stopColor={`hsl(${secondaryHue} 95% 52%)`} />
          <stop offset="100%" stopColor={`hsl(${deepHue} 65% 20%)`} />
        </radialGradient>
        <linearGradient id={ringGradient} x1="15" y1="12" x2="48" y2="55">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id={glyphGradient} x1="23" y1="20" x2="41" y2="44">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#DFF8FF" />
        </linearGradient>
        <filter id={blurFilter} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
      </defs>

      <circle cx="32" cy="34" r="27" fill={`hsl(${hue} 100% 72%)`} opacity="0.28" filter={`url(#${blurFilter})`} />
      <circle cx="32" cy="32" r="26.5" fill={`url(#${bgGradient})`} />
      <circle cx="32" cy="32" r="26.5" fill="none" stroke={`url(#${ringGradient})`} strokeWidth="1.4" />
      <ellipse cx="32" cy="18.5" rx="17.5" ry="7.5" fill="#FFFFFF" opacity="0.16" />
      <ellipse cx="32" cy="45.5" rx="16.8" ry="6.2" fill="#000000" opacity="0.16" />

      <g fill={`url(#${glyphGradient})`}>
        <path d="M32 19l13 13-13 13-13-13z" opacity="0.93" />
        <path d="M32 23l9 9-9 9-9-9z" opacity="0.65" />
        <circle cx="32" cy="32" r="3.4" opacity="0.92" />
      </g>
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

export const ChatAvatar = memo(function ChatAvatar({
  avatarId = null,
  customSrc = null,
  walletAddress,
  size = 32,
  className,
}: ChatAvatarProps) {
  if (customSrc) {
    return (
      <Image
        src={customSrc}
        alt="avatar"
        width={size}
        height={size}
        unoptimized
        className={`rounded-[30%] object-cover shadow-[0_8px_20px_rgba(4,8,22,0.45)] ${className ?? ""}`}
      />
    );
  }

  const content = avatarId && isAvatarId(avatarId)
    ? renderPresetAvatar(avatarId, size)
    : renderWalletFallback(walletAddress, size);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-[30%] ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {content}
    </span>
  );
});
