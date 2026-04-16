"use client";

import { memo, type ReactElement, type ReactNode } from "react";
import { CHAT_AVATAR_IDS, isPresetChatAvatarId, type ChatAvatarId } from "../../lib/chatAvatar";

export const AVATAR_IDS = CHAT_AVATAR_IDS;
export type AvatarId = ChatAvatarId;

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

/* ──────────────────────────────────────────────────────────────────────────
   Preset avatar icons — premium inline SVG, mining/LORE themed.
   Each icon uses multi-stop gradients, glow filters, layered highlights
   and atmospheric details so it reads as a small piece of game art rather
   than a flat pictogram.
   ────────────────────────────────────────────────────────────────────── */

type ThemePalette = {
  bgInner: string;
  bgMid: string;
  bgOuter: string;
  rim: string;
  spot: string;
  accent: string;
};

const THEMES: Record<AvatarId, ThemePalette> = {
  "miner-helmet":   { bgInner: "#5b3a14", bgMid: "#1d1330", bgOuter: "#050410", rim: "#fbbf24", spot: "#fde68a", accent: "#fb923c" },
  "crossed-picks":  { bgInner: "#28324f", bgMid: "#101428", bgOuter: "#04050f", rim: "#cbd5f5", spot: "#e2e8f0", accent: "#7dd3fc" },
  "crystal-cluster":{ bgInner: "#3a1466", bgMid: "#160a32", bgOuter: "#050216", rim: "#c084fc", spot: "#f5d0fe", accent: "#22d3ee" },
  "mine-cart":      { bgInner: "#4a2410", bgMid: "#181028", bgOuter: "#050410", rim: "#f59e0b", spot: "#fde68a", accent: "#fcd34d" },
  dynamite:         { bgInner: "#5a0f12", bgMid: "#1b0a18", bgOuter: "#06040c", rim: "#f87171", spot: "#fecaca", accent: "#fde047" },
  "gold-ingot":     { bgInner: "#4a3408", bgMid: "#1a1208", bgOuter: "#050308", rim: "#fde68a", spot: "#fef9c3", accent: "#fbbf24" },
  "wall-torch":     { bgInner: "#4a200a", bgMid: "#170c1c", bgOuter: "#040208", rim: "#fb923c", spot: "#fef08a", accent: "#facc15" },
  "drill-bit":      { bgInner: "#1c2a45", bgMid: "#0a1020", bgOuter: "#04060f", rim: "#7dd3fc", spot: "#e0f2fe", accent: "#fbbf24" },
  "mega-diamond":   { bgInner: "#0c2f55", bgMid: "#061226", bgOuter: "#03040f", rim: "#7dd3fc", spot: "#f0f9ff", accent: "#a5f3fc" },
  "fire-gem":       { bgInner: "#5a0a22", bgMid: "#1c0612", bgOuter: "#06030c", rim: "#fb7185", spot: "#fecdd3", accent: "#fde047" },
  "shield-pick":    { bgInner: "#152a4d", bgMid: "#080d22", bgOuter: "#03040f", rim: "#60a5fa", spot: "#dbeafe", accent: "#fbbf24" },
  potion:           { bgInner: "#06382f", bgMid: "#04101a", bgOuter: "#020610", rim: "#2dd4bf", spot: "#a7f3d0", accent: "#f0abfc" },
  "dragon-eye":     { bgInner: "#3a0a30", bgMid: "#100618", bgOuter: "#040210", rim: "#e879f9", spot: "#fae8ff", accent: "#fbbf24" },
  "crown-gems":     { bgInner: "#4a2e08", bgMid: "#180e1c", bgOuter: "#050310", rim: "#fde68a", spot: "#fef9c3", accent: "#a855f7" },
  skull:            { bgInner: "#262236", bgMid: "#0d0a1c", bgOuter: "#040310", rim: "#cbd5f5", spot: "#f4f4f5", accent: "#a855f7" },
  "lantern-glow":   { bgInner: "#4a2a08", bgMid: "#170c1c", bgOuter: "#04020a", rim: "#fbbf24", spot: "#fef9c3", accent: "#fb923c" },
};

/* ----------------------- shared frame primitive ----------------------- */

function AvatarFrame({
  uid,
  theme,
  children,
}: {
  uid: string;
  theme: ThemePalette;
  children: ReactNode;
}): ReactElement {
  return (
    <svg width="100%" height="100%" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}-bg`} cx="32%" cy="22%" r="95%">
          <stop offset="0%" stopColor={theme.bgInner} />
          <stop offset="55%" stopColor={theme.bgMid} />
          <stop offset="100%" stopColor={theme.bgOuter} />
        </radialGradient>
        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor={theme.rim} stopOpacity="0.95" />
          <stop offset="50%" stopColor={theme.rim} stopOpacity="0.35" />
          <stop offset="100%" stopColor={theme.rim} stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="40%" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${uid}-spot`} cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor={theme.spot} stopOpacity="0.45" />
          <stop offset="60%" stopColor={theme.spot} stopOpacity="0.08" />
          <stop offset="100%" stopColor={theme.spot} stopOpacity="0" />
        </radialGradient>
        <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.45" />
        </filter>
        <filter id={`${uid}-glow`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id={`${uid}-bevel`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.7" stdDeviation="0.6" floodColor="#000" floodOpacity="0.55" />
          <feDropShadow dx="0" dy="-0.4" stdDeviation="0.3" floodColor="#fff" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* frame */}
      <rect x="1" y="1" width="62" height="62" rx="17" fill={`url(#${uid}-bg)`} />
      <rect x="1" y="1" width="62" height="62" rx="17" fill={`url(#${uid}-spot)`} />
      <rect x="2" y="2" width="60" height="60" rx="16" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="1.2" />
      <rect x="3.4" y="3.4" width="57.2" height="57.2" rx="14.5" fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="0.6" />
      {/* gloss sweep */}
      <path d="M4 14 Q32 -2 60 14 L60 22 Q32 8 4 22 Z" fill={`url(#${uid}-shine)`} />
      {/* corner sparkle */}
      <circle cx="48" cy="10" r="1.1" fill="#fff" opacity="0.85" />
      <circle cx="50.5" cy="13" r="0.55" fill="#fff" opacity="0.7" />

      {children}

      {/* vignette */}
      <rect x="1" y="1" width="62" height="62" rx="17" fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="2" filter={`url(#${uid}-glow)`} />
    </svg>
  );
}

/* ───────────────────────────── 1. miner-helmet ───────────────────────── */

function IconMinerHelmet({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-shell`} x1="14" y1="14" x2="50" y2="46">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="35%" stopColor="#f59e0b" />
          <stop offset="70%" stopColor="#b45309" />
          <stop offset="100%" stopColor="#451a03" />
        </linearGradient>
        <linearGradient id={`${uid}-brim`} x1="0" y1="38" x2="0" y2="48">
          <stop offset="0%" stopColor="#92400e" />
          <stop offset="100%" stopColor="#3f1d05" />
        </linearGradient>
        <radialGradient id={`${uid}-lamp`} cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#fff8dc" />
          <stop offset="55%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#a16207" />
        </radialGradient>
        <radialGradient id={`${uid}-beam`} cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#fde047" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* light beam */}
      <path d="M32 22 L8 6 L4 28 L8 50 L32 30 Z" fill={`url(#${uid}-beam)`} opacity="0.7" />
      <path d="M32 22 L60 6 L62 28 L58 50 L32 30 Z" fill={`url(#${uid}-beam)`} opacity="0.55" />

      {/* drop shadow under helmet */}
      <ellipse cx="32" cy="50" rx="20" ry="3" fill="#000" opacity="0.55" />

      {/* shell */}
      <path d="M11 44 Q11 18 32 18 Q53 18 53 44 Z" fill={`url(#${uid}-shell)`} />
      {/* shell ridge */}
      <path d="M11 44 Q11 18 32 18 Q53 18 53 44" fill="none" stroke="#451a03" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M16 38 Q32 22 48 38" fill="none" stroke="#fef9c3" strokeOpacity="0.55" strokeWidth="1.1" />
      <path d="M16 32 Q32 16 48 32" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="0.7" />
      {/* speculars */}
      <path d="M18 36 Q23 23 32 21 Q22 21 18 36 Z" fill="#fff" opacity="0.22" />
      <path d="M44 24 Q49 32 49 41" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.8" />

      {/* brim */}
      <path d="M9 44 L55 44 Q57 47 55 49 L9 49 Q7 47 9 44 Z" fill={`url(#${uid}-brim)`} />
      <path d="M9 44 L55 44" stroke="#fbbf24" strokeOpacity="0.6" strokeWidth="0.6" />
      <rect x="9" y="48" width="46" height="0.7" fill="#000" opacity="0.4" />

      {/* lamp housing */}
      <rect x="26" y="20" width="12" height="9" rx="1.6" fill="#1f2937" stroke="#000" strokeWidth="0.6" />
      <rect x="26" y="20" width="12" height="2.2" fill="#374151" />
      <rect x="26" y="20" width="12" height="0.6" fill="#94a3b8" />
      {/* lamp lens */}
      <circle cx="32" cy="25" r="3.6" fill={`url(#${uid}-lamp)`} stroke="#1f2937" strokeWidth="0.5" />
      <circle cx="32" cy="25" r="2.6" fill="#fef9c3" />
      <circle cx="30.6" cy="23.6" r="0.8" fill="#fff" />
      <circle cx="33" cy="26.6" r="0.4" fill="#fff" opacity="0.7" />

      {/* rivets */}
      <circle cx="14" cy="42" r="0.9" fill="#7c2d12" />
      <circle cx="14" cy="42" r="0.4" fill="#fde68a" />
      <circle cx="50" cy="42" r="0.9" fill="#7c2d12" />
      <circle cx="50" cy="42" r="0.4" fill="#fde68a" />

      {/* dust on brim */}
      <circle cx="20" cy="46.5" r="0.4" fill="#000" opacity="0.5" />
      <circle cx="40" cy="46.5" r="0.5" fill="#000" opacity="0.45" />
      <circle cx="34" cy="47" r="0.3" fill="#000" opacity="0.4" />
    </g>
  );
}

/* ───────────────────────────── 2. crossed-picks ──────────────────────── */

function IconCrossedPicks({ uid }: { uid: string }): ReactElement {
  const haft = `${uid}-haft`;
  const head = `${uid}-head`;
  const headHi = `${uid}-headHi`;
  return (
    <g>
      <defs>
        <linearGradient id={haft} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#c2843a" />
          <stop offset="35%" stopColor="#8a4b14" />
          <stop offset="100%" stopColor="#3b1c05" />
        </linearGradient>
        <linearGradient id={head} x1="0" y1="0" x2="0" y2="20">
          <stop offset="0%" stopColor="#f4f4f5" />
          <stop offset="40%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id={headHi} x1="0" y1="0" x2="64" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* shadow under */}
      <ellipse cx="32" cy="52" rx="22" ry="3" fill="#000" opacity="0.5" />

      {/* spark/glow at center */}
      <circle cx="32" cy="32" r="10" fill="#fbbf24" opacity="0.18" />
      <circle cx="32" cy="32" r="4" fill="#fde047" opacity="0.45" />

      {/* pick 1: top-left to bottom-right */}
      <g transform="rotate(45 32 32)">
        <rect x="30.4" y="9" width="3.2" height="46" rx="1.4" fill={`url(#${haft})`} />
        <rect x="30.4" y="9" width="3.2" height="46" rx="1.4" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="0.4" />
        {/* grain */}
        <line x1="30.6" y1="14" x2="33.4" y2="14" stroke="#3b1c05" strokeWidth="0.3" />
        <line x1="30.6" y1="22" x2="33.4" y2="22" stroke="#3b1c05" strokeWidth="0.3" />
        <line x1="30.6" y1="42" x2="33.4" y2="42" stroke="#3b1c05" strokeWidth="0.3" />
        {/* knob */}
        <circle cx="32" cy="55" r="2.2" fill="#3b1c05" stroke="#000" strokeWidth="0.4" />
        {/* head */}
        <path d="M14 11 Q32 6 50 11 L48 16 Q32 12 16 16 Z" fill={`url(#${head})`} stroke="#0f172a" strokeWidth="0.6" />
        <path d="M14 11 Q32 6 50 11" fill="none" stroke={`url(#${headHi})`} strokeWidth="1.2" />
        {/* tip flares */}
        <path d="M50 11 L54 11 L52 14 Z" fill="#475569" />
        <path d="M14 11 L10 11 L12 14 Z" fill="#475569" />
        {/* iron collar */}
        <rect x="29" y="13" width="6" height="3.4" rx="0.6" fill="#475569" stroke="#0f172a" strokeWidth="0.4" />
        <rect x="29.5" y="13.4" width="5" height="0.5" fill="#fff" opacity="0.6" />
      </g>

      {/* pick 2: top-right to bottom-left */}
      <g transform="rotate(-45 32 32)">
        <rect x="30.4" y="9" width="3.2" height="46" rx="1.4" fill={`url(#${haft})`} />
        <rect x="30.4" y="9" width="3.2" height="46" rx="1.4" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="0.4" />
        <line x1="30.6" y1="18" x2="33.4" y2="18" stroke="#3b1c05" strokeWidth="0.3" />
        <line x1="30.6" y1="30" x2="33.4" y2="30" stroke="#3b1c05" strokeWidth="0.3" />
        <line x1="30.6" y1="46" x2="33.4" y2="46" stroke="#3b1c05" strokeWidth="0.3" />
        <circle cx="32" cy="55" r="2.2" fill="#3b1c05" stroke="#000" strokeWidth="0.4" />
        <path d="M14 11 Q32 6 50 11 L48 16 Q32 12 16 16 Z" fill={`url(#${head})`} stroke="#0f172a" strokeWidth="0.6" />
        <path d="M14 11 Q32 6 50 11" fill="none" stroke={`url(#${headHi})`} strokeWidth="1.2" />
        <path d="M50 11 L54 11 L52 14 Z" fill="#475569" />
        <path d="M14 11 L10 11 L12 14 Z" fill="#475569" />
        <rect x="29" y="13" width="6" height="3.4" rx="0.6" fill="#475569" stroke="#0f172a" strokeWidth="0.4" />
        <rect x="29.5" y="13.4" width="5" height="0.5" fill="#fff" opacity="0.6" />
      </g>

      {/* center medallion */}
      <circle cx="32" cy="32" r="3.2" fill="#1f2937" stroke="#fbbf24" strokeWidth="0.7" />
      <circle cx="32" cy="32" r="1.4" fill="#fde047" />
      <circle cx="31.4" cy="31.4" r="0.5" fill="#fff" />
    </g>
  );
}

/* ───────────────────────────── 3. crystal-cluster ────────────────────── */

function IconCrystalCluster({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-c1`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fae8ff" />
          <stop offset="35%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#3b0764" />
        </linearGradient>
        <linearGradient id={`${uid}-c2`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#a5f3fc" />
          <stop offset="40%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
        <linearGradient id={`${uid}-rock`} x1="0" y1="40" x2="0" y2="58">
          <stop offset="0%" stopColor="#52525b" />
          <stop offset="100%" stopColor="#18181b" />
        </linearGradient>
        <radialGradient id={`${uid}-aura`} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#e9d5ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#7e22ce" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* aura */}
      <circle cx="32" cy="32" r="26" fill={`url(#${uid}-aura)`} />

      {/* rock base */}
      <ellipse cx="32" cy="54" rx="22" ry="3" fill="#000" opacity="0.55" />
      <path d="M10 50 Q14 42 22 44 Q32 38 42 44 Q52 42 54 50 Q48 56 32 56 Q16 56 10 50 Z" fill={`url(#${uid}-rock)`} stroke="#000" strokeWidth="0.6" />
      <path d="M14 48 Q22 46 30 48" stroke="#71717a" strokeWidth="0.5" fill="none" />
      <path d="M34 49 Q42 47 50 49" stroke="#71717a" strokeWidth="0.5" fill="none" />

      {/* back crystal — tall cyan */}
      <path d="M30 48 L34 12 L38 48 Z" fill={`url(#${uid}-c2)`} stroke="#0e7490" strokeWidth="0.5" />
      <path d="M34 12 L36 20 L38 48 Z" fill="#fff" opacity="0.45" />
      <path d="M34 12 L32 20 L30 48 Z" fill="#000" opacity="0.18" />
      <path d="M34 12 L34 48" stroke="#fff" strokeOpacity="0.6" strokeWidth="0.5" />

      {/* left crystal — purple */}
      <path d="M14 50 L20 18 L26 50 Z" fill={`url(#${uid}-c1)`} stroke="#3b0764" strokeWidth="0.5" />
      <path d="M20 18 L23 26 L26 50 Z" fill="#fff" opacity="0.4" />
      <path d="M20 18 L17 26 L14 50 Z" fill="#000" opacity="0.18" />
      <path d="M20 18 L20 50" stroke="#fff" strokeOpacity="0.45" strokeWidth="0.4" />

      {/* right crystal — purple shorter */}
      <path d="M40 50 L46 22 L52 50 Z" fill={`url(#${uid}-c1)`} stroke="#3b0764" strokeWidth="0.5" />
      <path d="M46 22 L48 30 L52 50 Z" fill="#fff" opacity="0.4" />
      <path d="M46 22 L44 30 L40 50 Z" fill="#000" opacity="0.18" />

      {/* tiny front crystal */}
      <path d="M22 50 L26 36 L30 50 Z" fill={`url(#${uid}-c2)`} opacity="0.95" stroke="#0e7490" strokeWidth="0.4" />
      <path d="M26 36 L27 42 L30 50 Z" fill="#fff" opacity="0.45" />

      {/* sparkles */}
      <g fill="#fff">
        <path d="M44 14 L45 16 L47 17 L45 18 L44 20 L43 18 L41 17 L43 16 Z" opacity="0.95" />
        <path d="M16 24 L16.6 25.2 L17.8 25.6 L16.6 26 L16 27.2 L15.4 26 L14.2 25.6 L15.4 25.2 Z" opacity="0.85" />
        <circle cx="50" cy="32" r="0.6" />
        <circle cx="12" cy="38" r="0.5" />
        <circle cx="34" cy="14" r="0.5" />
      </g>
    </g>
  );
}

/* ───────────────────────────── 4. mine-cart ──────────────────────────── */

function IconMineCart({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-body`} x1="0" y1="20" x2="0" y2="50">
          <stop offset="0%" stopColor="#7c2d12" />
          <stop offset="60%" stopColor="#3b1206" />
          <stop offset="100%" stopColor="#1c0a04" />
        </linearGradient>
        <linearGradient id={`${uid}-iron`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#a16207" />
        </linearGradient>
      </defs>

      {/* rails */}
      <ellipse cx="32" cy="56" rx="26" ry="2" fill="#000" opacity="0.55" />
      <rect x="6" y="52" width="52" height="1.2" fill="#94a3b8" />
      <rect x="6" y="53.5" width="52" height="0.6" fill="#1e293b" />
      <rect x="10" y="55" width="3" height="2" fill="#3b2410" />
      <rect x="22" y="55" width="3" height="2" fill="#3b2410" />
      <rect x="34" y="55" width="3" height="2" fill="#3b2410" />
      <rect x="46" y="55" width="3" height="2" fill="#3b2410" />

      {/* cart body */}
      <path d="M10 28 L54 28 L48 48 L16 48 Z" fill={`url(#${uid}-body)`} stroke="#000" strokeWidth="0.6" />
      {/* planks */}
      <line x1="20" y1="28" x2="18" y2="48" stroke="#1c0a04" strokeWidth="0.5" />
      <line x1="28" y1="28" x2="27" y2="48" stroke="#1c0a04" strokeWidth="0.5" />
      <line x1="36" y1="28" x2="37" y2="48" stroke="#1c0a04" strokeWidth="0.5" />
      <line x1="44" y1="28" x2="46" y2="48" stroke="#1c0a04" strokeWidth="0.5" />
      {/* iron bands */}
      <path d="M9 28 L55 28 L55 31 L9 31 Z" fill={`url(#${uid}-iron)`} />
      <path d="M9 28 L55 28" stroke="#fff" strokeOpacity="0.6" strokeWidth="0.5" />
      <path d="M14 44 L50 44 L48 48 L16 48 Z" fill="#0f172a" />
      <path d="M14 44 L50 44" stroke="#94a3b8" strokeWidth="0.4" />
      {/* rivets */}
      <circle cx="12" cy="29.5" r="0.6" fill="#fde68a" />
      <circle cx="20" cy="29.5" r="0.6" fill="#fde68a" />
      <circle cx="32" cy="29.5" r="0.6" fill="#fde68a" />
      <circle cx="44" cy="29.5" r="0.6" fill="#fde68a" />
      <circle cx="52" cy="29.5" r="0.6" fill="#fde68a" />

      {/* ore overflow */}
      <ellipse cx="32" cy="28" rx="22" ry="4" fill={`url(#${uid}-gold)`} stroke="#451a03" strokeWidth="0.4" />
      <circle cx="20" cy="24" r="3.2" fill="#fbbf24" stroke="#451a03" strokeWidth="0.4" />
      <circle cx="20" cy="24" r="1.2" fill="#fef08a" />
      <circle cx="28" cy="22" r="3.6" fill="#fde047" stroke="#451a03" strokeWidth="0.4" />
      <circle cx="28" cy="22" r="1.4" fill="#fff8dc" />
      <circle cx="36" cy="23" r="3" fill="#a855f7" stroke="#3b0764" strokeWidth="0.4" />
      <circle cx="36" cy="23" r="1.2" fill="#e9d5ff" />
      <circle cx="44" cy="25" r="2.4" fill="#22d3ee" stroke="#0e7490" strokeWidth="0.4" />
      <circle cx="44" cy="25" r="1" fill="#cffafe" />
      <circle cx="32" cy="25" r="2" fill="#f87171" stroke="#7f1d1d" strokeWidth="0.4" />

      {/* wheels */}
      <circle cx="20" cy="50" r="5.2" fill="#0f172a" stroke="#94a3b8" strokeWidth="0.9" />
      <circle cx="20" cy="50" r="3.4" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
      <circle cx="20" cy="50" r="1.2" fill="#94a3b8" />
      <line x1="20" y1="46" x2="20" y2="54" stroke="#475569" strokeWidth="0.6" />
      <line x1="16" y1="50" x2="24" y2="50" stroke="#475569" strokeWidth="0.6" />
      <circle cx="44" cy="50" r="5.2" fill="#0f172a" stroke="#94a3b8" strokeWidth="0.9" />
      <circle cx="44" cy="50" r="3.4" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
      <circle cx="44" cy="50" r="1.2" fill="#94a3b8" />
      <line x1="44" y1="46" x2="44" y2="54" stroke="#475569" strokeWidth="0.6" />
      <line x1="40" y1="50" x2="48" y2="50" stroke="#475569" strokeWidth="0.6" />
    </g>
  );
}

/* ───────────────────────────── 5. dynamite ───────────────────────────── */

function IconDynamite({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-stick`} x1="18" y1="0" x2="46" y2="0">
          <stop offset="0%" stopColor="#7f1d1d" />
          <stop offset="35%" stopColor="#dc2626" />
          <stop offset="65%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#7f1d1d" />
        </linearGradient>
        <linearGradient id={`${uid}-stick2`} x1="18" y1="0" x2="46" y2="0">
          <stop offset="0%" stopColor="#7f1d1d" />
          <stop offset="50%" stopColor="#b91c1c" />
          <stop offset="100%" stopColor="#450a0a" />
        </linearGradient>
        <radialGradient id={`${uid}-spark`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="25%" stopColor="#fef9c3" />
          <stop offset="60%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* spark glow */}
      <circle cx="46" cy="12" r="11" fill={`url(#${uid}-spark)`} />

      {/* shadow */}
      <ellipse cx="32" cy="56" rx="20" ry="2.5" fill="#000" opacity="0.5" />

      {/* back stick */}
      <rect x="26" y="22" width="10" height="32" rx="2.4" fill={`url(#${uid}-stick2)`} stroke="#3b0a0a" strokeWidth="0.6" transform="rotate(-12 31 38)" />

      {/* main stick */}
      <rect x="20" y="22" width="14" height="34" rx="3" fill={`url(#${uid}-stick)`} stroke="#3b0a0a" strokeWidth="0.7" />
      {/* paper bands */}
      <rect x="20" y="26" width="14" height="2.4" fill="#fff7ed" />
      <rect x="20" y="26" width="14" height="0.6" fill="#fcd34d" />
      <rect x="20" y="49" width="14" height="2.4" fill="#fff7ed" />
      <rect x="20" y="49" width="14" height="0.6" fill="#fcd34d" />
      {/* highlight */}
      <rect x="22" y="29" width="2.6" height="20" rx="1.2" fill="#fff" opacity="0.35" />
      {/* label */}
      <rect x="20" y="33" width="14" height="13" fill="#0a0a0a" opacity="0.8" />
      <text x="27" y="42" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#fef08a" fontFamily="monospace">TNT</text>
      <line x1="20" y1="36" x2="34" y2="36" stroke="#fbbf24" strokeWidth="0.4" opacity="0.6" />
      <line x1="20" y1="44" x2="34" y2="44" stroke="#fbbf24" strokeWidth="0.4" opacity="0.6" />

      {/* third stick (right) */}
      <rect x="32" y="22" width="10" height="32" rx="2.4" fill={`url(#${uid}-stick2)`} stroke="#3b0a0a" strokeWidth="0.6" transform="rotate(10 37 38)" />

      {/* fuse */}
      <path d="M27 22 Q34 14 40 12 Q44 11 46 12" stroke="#3b1c05" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M27 22 Q34 14 40 12 Q44 11 46 12" stroke="#fbbf24" strokeWidth="0.8" fill="none" strokeLinecap="round" strokeDasharray="1 2" opacity="0.7" />
      {/* spark */}
      <circle cx="46" cy="12" r="3.2" fill="#fef9c3" />
      <circle cx="46" cy="12" r="1.8" fill="#fff" />
      <g stroke="#fde047" strokeWidth="0.7" strokeLinecap="round">
        <line x1="46" y1="6" x2="46" y2="3" />
        <line x1="46" y1="21" x2="46" y2="18" />
        <line x1="40" y1="12" x2="37" y2="12" />
        <line x1="55" y1="12" x2="52" y2="12" />
        <line x1="50.5" y1="7.5" x2="52.5" y2="5.5" />
        <line x1="41.5" y1="16.5" x2="39.5" y2="18.5" />
      </g>
    </g>
  );
}

/* ───────────────────────────── 6. gold-ingot ─────────────────────────── */

function IconGoldIngot({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-top`} x1="0" y1="0" x2="0" y2="20">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
        <linearGradient id={`${uid}-side`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="50%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#451a03" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="34" r="26" fill={`url(#${uid}-glow)`} />
      <ellipse cx="32" cy="54" rx="24" ry="3" fill="#000" opacity="0.55" />

      {/* bottom ingot */}
      <path d="M10 44 L54 44 L48 54 L16 54 Z" fill={`url(#${uid}-side)`} stroke="#451a03" strokeWidth="0.6" />
      <path d="M14 41 L50 41 L54 44 L10 44 Z" fill={`url(#${uid}-top)`} stroke="#451a03" strokeWidth="0.6" />
      <path d="M14 41 L50 41 L48 43 L16 43 Z" fill="#fff" opacity="0.55" />
      <text x="32" y="51" textAnchor="middle" fontSize="5" fontWeight="bold" fill="#451a03" fontFamily="monospace" opacity="0.8">999.9</text>

      {/* middle ingot */}
      <path d="M14 30 L50 30 L46 41 L18 41 Z" fill={`url(#${uid}-side)`} stroke="#451a03" strokeWidth="0.6" />
      <path d="M18 27 L46 27 L50 30 L14 30 Z" fill={`url(#${uid}-top)`} stroke="#451a03" strokeWidth="0.6" />
      <path d="M18 27 L46 27 L44 29 L20 29 Z" fill="#fff" opacity="0.6" />

      {/* top ingot */}
      <path d="M20 18 L44 18 L40 27 L24 27 Z" fill={`url(#${uid}-side)`} stroke="#451a03" strokeWidth="0.6" />
      <path d="M22 15 L42 15 L44 18 L20 18 Z" fill={`url(#${uid}-top)`} stroke="#451a03" strokeWidth="0.6" />
      <path d="M22 15 L42 15 L40 17 L24 17 Z" fill="#fff" opacity="0.7" />
      {/* stamp */}
      <circle cx="32" cy="22" r="1.6" fill="#451a03" opacity="0.8" />
      <text x="32" y="23.6" textAnchor="middle" fontSize="2.4" fontWeight="bold" fill="#fef08a" fontFamily="monospace">L</text>

      {/* sparkles */}
      <g fill="#fff">
        <path d="M48 12 L49 14 L51 15 L49 16 L48 18 L47 16 L45 15 L47 14 Z" opacity="0.95" />
        <circle cx="14" cy="22" r="0.6" />
        <circle cx="50" cy="36" r="0.7" />
      </g>
    </g>
  );
}

/* ───────────────────────────── 7. wall-torch ─────────────────────────── */

function IconWallTorch({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-fire1`} cx="50%" cy="65%" r="55%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="20%" stopColor="#fef9c3" />
          <stop offset="55%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#f97316" />
        </radialGradient>
        <radialGradient id={`${uid}-fire2`} cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#f97316" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-pole`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#a16207" />
          <stop offset="55%" stopColor="#5b3008" />
          <stop offset="100%" stopColor="#1c0a04" />
        </linearGradient>
        <linearGradient id={`${uid}-iron`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>

      {/* glow halo */}
      <ellipse cx="32" cy="22" rx="22" ry="20" fill={`url(#${uid}-fire2)`} opacity="0.8" />

      {/* shadow */}
      <ellipse cx="32" cy="56" rx="14" ry="2" fill="#000" opacity="0.5" />

      {/* pole */}
      <rect x="29" y="32" width="6" height="22" rx="1" fill={`url(#${uid}-pole)`} stroke="#1c0a04" strokeWidth="0.5" />
      <rect x="29" y="32" width="1.4" height="22" fill="#fde68a" opacity="0.4" />
      <rect x="29" y="38" width="6" height="0.6" fill="#1c0a04" />
      <rect x="29" y="46" width="6" height="0.6" fill="#1c0a04" />

      {/* iron cup */}
      <path d="M22 28 L42 28 L38 34 L26 34 Z" fill={`url(#${uid}-iron)`} stroke="#000" strokeWidth="0.5" />
      <ellipse cx="32" cy="28" rx="10" ry="2.4" fill="#1f2937" stroke="#000" strokeWidth="0.5" />
      <ellipse cx="32" cy="28" rx="9" ry="1.8" fill="#0a0a0f" />
      {/* rivets */}
      <circle cx="24" cy="32" r="0.7" fill="#fde68a" />
      <circle cx="40" cy="32" r="0.7" fill="#fde68a" />
      <circle cx="32" cy="33.4" r="0.7" fill="#fde68a" />

      {/* bracket on wall */}
      <rect x="30" y="50" width="4" height="4" fill="#475569" stroke="#0f172a" strokeWidth="0.4" />
      <rect x="28" y="54" width="8" height="1.6" rx="0.5" fill="#475569" stroke="#0f172a" strokeWidth="0.4" />

      {/* flame outer */}
      <path d="M32 4 Q22 14 22 22 Q22 30 32 30 Q42 30 42 22 Q42 14 32 4 Z" fill={`url(#${uid}-fire2)`} />
      {/* flame mid */}
      <path d="M32 8 Q24 16 25 22 Q26 28 32 28 Q38 28 39 22 Q40 16 32 8 Z" fill={`url(#${uid}-fire1)`} />
      {/* flame core */}
      <path d="M32 14 Q28 18 29 22 Q30 26 32 26 Q34 26 35 22 Q36 18 32 14 Z" fill="#fef9c3" opacity="0.95" />
      {/* white core */}
      <ellipse cx="32" cy="22" rx="1.4" ry="2.5" fill="#fff" />
      {/* embers */}
      <circle cx="22" cy="10" r="0.7" fill="#fbbf24" opacity="0.85" />
      <circle cx="42" cy="6" r="0.5" fill="#fde047" opacity="0.85" />
      <circle cx="46" cy="14" r="0.5" fill="#fb923c" opacity="0.85" />
      <circle cx="18" cy="18" r="0.4" fill="#fbbf24" opacity="0.85" />
      <circle cx="48" cy="20" r="0.4" fill="#fbbf24" opacity="0.85" />
    </g>
  );
}

/* ───────────────────────────── 8. drill-bit ──────────────────────────── */

function IconDrillBit({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2="64" y2="0">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="35%" stopColor="#cbd5f5" />
          <stop offset="65%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="50%" stopColor="#a16207" />
          <stop offset="100%" stopColor="#3f1d05" />
        </linearGradient>
        <radialGradient id={`${uid}-spark`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="50%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* spark glow at tip */}
      <circle cx="32" cy="56" r="9" fill={`url(#${uid}-spark)`} />

      {/* shadow */}
      <ellipse cx="32" cy="58" rx="14" ry="2" fill="#000" opacity="0.55" />

      {/* hex base */}
      <path d="M22 8 L42 8 L46 14 L42 20 L22 20 L18 14 Z" fill={`url(#${uid}-base)`} stroke="#1c0a04" strokeWidth="0.6" />
      <path d="M22 8 L42 8 L46 14 L42 12 L22 12 L18 14 Z" fill="#fef08a" opacity="0.5" />
      <line x1="22" y1="8" x2="22" y2="20" stroke="#1c0a04" strokeWidth="0.4" />
      <line x1="42" y1="8" x2="42" y2="20" stroke="#1c0a04" strokeWidth="0.4" />
      {/* logo */}
      <circle cx="32" cy="14" r="2" fill="#1c0a04" />
      <circle cx="32" cy="14" r="0.9" fill="#fde047" />

      {/* shaft collar */}
      <rect x="20" y="20" width="24" height="3.5" rx="0.6" fill="#475569" stroke="#0f172a" strokeWidth="0.5" />
      <rect x="20" y="20" width="24" height="0.7" fill="#fff" opacity="0.6" />

      {/* main spiral body */}
      <path d="M22 23.5 L42 23.5 L40 50 L32 58 L24 50 Z" fill={`url(#${uid}-metal)`} stroke="#0a0a0f" strokeWidth="0.6" />

      {/* spiral grooves (alternating dark/highlight) */}
      <path d="M22 26 L42 31" stroke="#0a0a0f" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M22.5 27 L42 32" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.5" strokeLinecap="round" />
      <path d="M22 31 L41 36" stroke="#0a0a0f" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M22.5 32 L41 37" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.5" strokeLinecap="round" />
      <path d="M22 36 L41 41" stroke="#0a0a0f" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M22.5 37 L41 42" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.5" strokeLinecap="round" />
      <path d="M23 41 L40 46" stroke="#0a0a0f" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M23.5 42 L40 47" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.5" strokeLinecap="round" />
      <path d="M24 46 L39 50" stroke="#0a0a0f" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M24.5 47 L39 51" stroke="#fff" strokeOpacity="0.6" strokeWidth="0.5" strokeLinecap="round" />

      {/* tip highlight */}
      <path d="M28 54 L32 58 L36 54 Z" fill="#fff" opacity="0.7" />

      {/* sparks */}
      <g fill="#fde047">
        <circle cx="22" cy="56" r="0.6" />
        <circle cx="42" cy="55" r="0.7" />
        <circle cx="38" cy="60" r="0.5" />
        <circle cx="26" cy="60" r="0.5" />
      </g>
      <g stroke="#fef9c3" strokeWidth="0.5" strokeLinecap="round">
        <line x1="32" y1="60" x2="32" y2="62" />
        <line x1="29" y1="60" x2="27" y2="62" />
        <line x1="35" y1="60" x2="37" y2="62" />
      </g>
    </g>
  );
}

/* ───────────────────────────── 9. mega-diamond ───────────────────────── */

function IconMegaDiamond({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-top`} x1="0" y1="0" x2="0" y2="32">
          <stop offset="0%" stopColor="#f0f9ff" />
          <stop offset="100%" stopColor="#7dd3fc" />
        </linearGradient>
        <linearGradient id={`${uid}-bot`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#082f49" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="32" r="28" fill={`url(#${uid}-glow)`} />

      {/* crown facets (top) */}
      <path d="M14 24 L22 12 L42 12 L50 24 L32 24 Z" fill={`url(#${uid}-top)`} stroke="#082f49" strokeWidth="0.7" />
      <path d="M22 12 L14 24 L24 24 Z" fill="#e0f2fe" />
      <path d="M14 24 L24 24 L22 12 L17 18 Z" fill="#fff" opacity="0.55" />
      <path d="M42 12 L50 24 L40 24 Z" fill="#bae6fd" />
      <path d="M50 24 L40 24 L42 12 L47 18 Z" fill="#fff" opacity="0.4" />
      <path d="M22 12 L42 12 L40 18 L24 18 Z" fill="#f0f9ff" />
      <path d="M22 12 L42 12 L32 24 Z" fill="#bae6fd" opacity="0.85" />
      <path d="M22 12 L32 24 L24 18 Z" fill="#fff" opacity="0.55" />
      {/* girdle line */}
      <line x1="14" y1="24" x2="50" y2="24" stroke="#082f49" strokeWidth="0.6" />

      {/* pavilion (bottom) */}
      <path d="M14 24 L50 24 L32 56 Z" fill={`url(#${uid}-bot)`} stroke="#082f49" strokeWidth="0.7" />
      {/* pavilion facets */}
      <path d="M14 24 L24 24 L26 36 L20 32 Z" fill="#0ea5e9" opacity="0.9" />
      <path d="M24 24 L40 24 L32 56 L26 36 Z" fill="#38bdf8" opacity="0.95" />
      <path d="M40 24 L50 24 L44 32 L38 36 Z" fill="#0c4a6e" opacity="0.85" />
      <path d="M26 36 L38 36 L32 56 Z" fill="#082f49" opacity="0.9" />
      <path d="M26 36 L32 56 L24 42 Z" fill="#0ea5e9" opacity="0.4" />
      <path d="M38 36 L32 56 L40 42 Z" fill="#7dd3fc" opacity="0.4" />
      {/* bright facet edge */}
      <path d="M14 24 L32 56" stroke="#bae6fd" strokeWidth="0.5" opacity="0.7" />
      <path d="M50 24 L32 56" stroke="#bae6fd" strokeWidth="0.5" opacity="0.5" />
      <path d="M24 24 L32 56" stroke="#fff" strokeOpacity="0.4" strokeWidth="0.4" />
      <path d="M40 24 L32 56" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.4" />

      {/* white star */}
      <path d="M22 14 L23 16 L25 17 L23 18 L22 20 L21 18 L19 17 L21 16 Z" fill="#fff" opacity="0.95" />
      {/* sparkles */}
      <circle cx="48" cy="14" r="0.6" fill="#fff" />
      <circle cx="12" cy="32" r="0.5" fill="#fff" />
      <circle cx="52" cy="40" r="0.5" fill="#fff" />
    </g>
  );
}

/* ───────────────────────────── 10. fire-gem ──────────────────────────── */

function IconFireGem({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.8" />
          <stop offset="35%" stopColor="#fb7185" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-core`} cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="35%" stopColor="#f97316" />
          <stop offset="75%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#450a0a" />
        </radialGradient>
        <linearGradient id={`${uid}-facet`} x1="0" y1="0" x2="64" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      <circle cx="32" cy="34" r="26" fill={`url(#${uid}-glow)`} />

      {/* gem body — round-cut */}
      <path d="M32 8 L46 16 L52 32 L46 48 L32 56 L18 48 L12 32 L18 16 Z" fill={`url(#${uid}-core)`} stroke="#450a0a" strokeWidth="0.8" />
      {/* facets */}
      <path d="M32 8 L46 16 L32 32 Z" fill="#fff" opacity="0.35" />
      <path d="M32 8 L18 16 L32 32 Z" fill="#fff" opacity="0.25" />
      <path d="M46 16 L52 32 L32 32 Z" fill="#000" opacity="0.18" />
      <path d="M18 16 L12 32 L32 32 Z" fill="#fff" opacity="0.2" />
      <path d="M12 32 L18 48 L32 32 Z" fill="#000" opacity="0.18" />
      <path d="M52 32 L46 48 L32 32 Z" fill="#000" opacity="0.25" />
      <path d="M18 48 L32 56 L32 32 Z" fill="#000" opacity="0.3" />
      <path d="M46 48 L32 56 L32 32 Z" fill="#000" opacity="0.4" />

      {/* inner flame */}
      <path d="M32 18 Q38 26 36 34 Q40 32 40 38 Q40 46 32 48 Q24 46 24 38 Q24 32 28 34 Q26 26 32 18 Z" fill="#fef08a" opacity="0.9" />
      <path d="M32 24 Q35 30 33 36 Q36 36 34 42 Q34 44 32 44 Q30 44 30 42 Q28 36 31 36 Q29 30 32 24 Z" fill="#fff" opacity="0.85" />

      {/* facet edge sheen */}
      <path d="M18 16 L32 8 L46 16" stroke={`url(#${uid}-facet)`} strokeWidth="0.6" fill="none" />
      <path d="M12 32 L32 8" stroke="#fff" strokeOpacity="0.4" strokeWidth="0.4" />

      {/* sparkles */}
      <path d="M14 18 L15 20 L17 21 L15 22 L14 24 L13 22 L11 21 L13 20 Z" fill="#fff" opacity="0.9" />
      <circle cx="50" cy="22" r="0.6" fill="#fff" />
      <circle cx="48" cy="46" r="0.5" fill="#fff" />
    </g>
  );
}

/* ───────────────────────────── 11. shield-pick ───────────────────────── */

function IconShieldPick({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-shield`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="40%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0c1842" />
        </linearGradient>
        <linearGradient id={`${uid}-trim`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#a16207" />
        </linearGradient>
        <linearGradient id={`${uid}-pickH`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#c2843a" />
          <stop offset="100%" stopColor="#3b1c05" />
        </linearGradient>
        <linearGradient id={`${uid}-pickM`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#f4f4f5" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
      </defs>

      <ellipse cx="32" cy="58" rx="20" ry="2.5" fill="#000" opacity="0.55" />

      {/* shield body */}
      <path d="M32 6 L54 12 Q54 36 32 58 Q10 36 10 12 Z" fill={`url(#${uid}-shield)`} stroke="#02061f" strokeWidth="0.8" />
      {/* gold trim */}
      <path d="M32 6 L54 12 Q54 36 32 58 Q10 36 10 12 Z" fill="none" stroke={`url(#${uid}-trim)`} strokeWidth="1.4" />
      {/* inner panel */}
      <path d="M32 11 L49 16 Q49 33 32 52 Q15 33 15 16 Z" fill="#0c1842" opacity="0.6" />
      {/* shine */}
      <path d="M32 8 L52 13 Q50 22 46 28 L32 22 Z" fill="#fff" opacity="0.22" />
      {/* heraldic stripe */}
      <path d="M14 20 Q32 26 50 20" stroke={`url(#${uid}-trim)`} strokeWidth="0.6" fill="none" opacity="0.7" />

      {/* crossed pickaxe */}
      <g transform="rotate(15 32 32)">
        <rect x="30.6" y="14" width="2.8" height="36" rx="1.2" fill={`url(#${uid}-pickH)`} stroke="#1c0a04" strokeWidth="0.4" />
        <path d="M16 18 Q32 14 48 18 L46 22 Q32 18 18 22 Z" fill={`url(#${uid}-pickM)`} stroke="#0a0a0f" strokeWidth="0.5" />
        <path d="M16 18 Q32 14 48 18" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.5" fill="none" />
      </g>

      {/* central gem */}
      <circle cx="32" cy="32" r="3.4" fill="#fde047" stroke="#7c2d12" strokeWidth="0.6" />
      <circle cx="32" cy="32" r="2" fill="#fff7ed" />
      <circle cx="31.2" cy="31.2" r="0.6" fill="#fff" />

      {/* corner studs */}
      <circle cx="14" cy="14" r="1" fill="#fde68a" stroke="#7c2d12" strokeWidth="0.3" />
      <circle cx="50" cy="14" r="1" fill="#fde68a" stroke="#7c2d12" strokeWidth="0.3" />
      <circle cx="20" cy="42" r="1" fill="#fde68a" stroke="#7c2d12" strokeWidth="0.3" />
      <circle cx="44" cy="42" r="1" fill="#fde68a" stroke="#7c2d12" strokeWidth="0.3" />
    </g>
  );
}

/* ───────────────────────────── 12. potion ────────────────────────────── */

function IconPotion({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-liquid`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#a7f3d0" />
          <stop offset="40%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#064e3b" />
        </linearGradient>
        <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.4" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="42" r="22" fill={`url(#${uid}-glow)`} />
      <ellipse cx="32" cy="56" rx="18" ry="2.5" fill="#000" opacity="0.5" />

      {/* cork */}
      <rect x="27" y="6" width="10" height="6" rx="1.4" fill="#a16207" stroke="#3b1c05" strokeWidth="0.5" />
      <rect x="27" y="6" width="10" height="1.2" fill="#fde68a" opacity="0.6" />
      <rect x="27" y="10" width="10" height="0.6" fill="#3b1c05" />

      {/* neck */}
      <rect x="28" y="12" width="8" height="6" fill="#0a1a14" stroke="#000" strokeWidth="0.5" />
      <rect x="28" y="12" width="2" height="6" fill="#fff" opacity="0.35" />

      {/* round body */}
      <path d="M22 18 L42 18 Q50 22 50 36 Q50 52 32 56 Q14 52 14 36 Q14 22 22 18 Z" fill="#0a1a14" stroke="#000" strokeWidth="0.7" />
      {/* liquid */}
      <path d="M22 22 L42 22 Q48 26 48 36 Q48 50 32 54 Q16 50 16 36 Q16 26 22 22 Z" fill={`url(#${uid}-liquid)`} />
      {/* surface meniscus */}
      <ellipse cx="32" cy="22" rx="14" ry="2.4" fill="#a7f3d0" />
      <ellipse cx="32" cy="22" rx="13" ry="1.8" fill="#fff" opacity="0.6" />
      {/* glass highlight */}
      <path d="M18 28 Q14 36 18 50" fill="none" stroke={`url(#${uid}-glass)`} strokeWidth="3" strokeLinecap="round" />
      <path d="M44 28 Q48 38 46 48" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.4" strokeLinecap="round" />

      {/* bubbles */}
      <circle cx="24" cy="40" r="1.4" fill="#a7f3d0" opacity="0.9" />
      <circle cx="24" cy="40" r="0.5" fill="#fff" />
      <circle cx="34" cy="46" r="1.8" fill="#a7f3d0" opacity="0.9" />
      <circle cx="34" cy="46" r="0.6" fill="#fff" />
      <circle cx="40" cy="38" r="1" fill="#a7f3d0" opacity="0.85" />
      <circle cx="28" cy="50" r="0.8" fill="#a7f3d0" opacity="0.85" />
      <circle cx="30" cy="34" r="0.7" fill="#a7f3d0" opacity="0.85" />

      {/* label */}
      <rect x="22" y="36" width="20" height="6" rx="1" fill="#fef9c3" opacity="0.85" />
      <line x1="24" y1="38" x2="40" y2="38" stroke="#7c2d12" strokeWidth="0.3" />
      <line x1="24" y1="40" x2="38" y2="40" stroke="#7c2d12" strokeWidth="0.3" />
      <path d="M30 36 L30 42 M34 36 L34 42" stroke="#7c2d12" strokeWidth="0.3" opacity="0.6" />

      {/* sparkle on top */}
      <path d="M44 8 L45 10 L47 11 L45 12 L44 14 L43 12 L41 11 L43 10 Z" fill="#fff" opacity="0.95" />
    </g>
  );
}

/* ───────────────────────────── 13. dragon-eye ────────────────────────── */

function IconDragonEye({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-iris`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="20%" stopColor="#fef08a" />
          <stop offset="50%" stopColor="#f97316" />
          <stop offset="80%" stopColor="#c026d3" />
          <stop offset="100%" stopColor="#3b0764" />
        </radialGradient>
        <linearGradient id={`${uid}-lid`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#3a0a30" />
          <stop offset="100%" stopColor="#0a0414" />
        </linearGradient>
        <linearGradient id={`${uid}-scale`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#52525b" />
          <stop offset="100%" stopColor="#18181b" />
        </linearGradient>
        <radialGradient id={`${uid}-aura`} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#f5d0fe" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#86198f" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="32" r="26" fill={`url(#${uid}-aura)`} />

      {/* scales background */}
      <g fill={`url(#${uid}-scale)`} stroke="#000" strokeWidth="0.4">
        <circle cx="10" cy="14" r="3" />
        <circle cx="16" cy="10" r="2.6" />
        <circle cx="54" cy="14" r="3" />
        <circle cx="48" cy="10" r="2.6" />
        <circle cx="10" cy="50" r="3" />
        <circle cx="16" cy="54" r="2.6" />
        <circle cx="54" cy="50" r="3" />
        <circle cx="48" cy="54" r="2.6" />
      </g>

      {/* outer eye lid */}
      <path d="M4 32 Q14 12 32 12 Q50 12 60 32 Q50 52 32 52 Q14 52 4 32 Z" fill={`url(#${uid}-lid)`} stroke="#c026d3" strokeWidth="0.7" />

      {/* eyeball white edge */}
      <path d="M8 32 Q16 16 32 16 Q48 16 56 32 Q48 48 32 48 Q16 48 8 32 Z" fill="#fef9c3" opacity="0.15" />

      {/* iris */}
      <ellipse cx="32" cy="32" rx="18" ry="14" fill={`url(#${uid}-iris)`} />
      {/* iris rings */}
      <ellipse cx="32" cy="32" rx="14" ry="10.5" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="0.5" />
      <ellipse cx="32" cy="32" rx="9" ry="6.8" fill="none" stroke="#fef08a" strokeOpacity="0.7" strokeWidth="0.5" />
      {/* iris streaks */}
      <g stroke="#fff" strokeOpacity="0.55" strokeWidth="0.5">
        <line x1="32" y1="22" x2="32" y2="42" />
        <line x1="22" y1="32" x2="42" y2="32" />
        <line x1="24" y1="24" x2="40" y2="40" />
        <line x1="40" y1="24" x2="24" y2="40" />
      </g>

      {/* slit pupil */}
      <ellipse cx="32" cy="32" rx="3.4" ry="13.5" fill="#0a0414" stroke="#000" strokeWidth="0.5" />
      <ellipse cx="32" cy="32" rx="1.2" ry="11" fill="#000" />
      {/* pupil glint */}
      <ellipse cx="30.5" cy="26" rx="1.4" ry="2" fill="#fff" opacity="0.85" />
      <circle cx="33.5" cy="36" r="0.7" fill="#fff" opacity="0.7" />

      {/* lid sheen */}
      <path d="M6 32 Q14 14 32 14 Q50 14 58 32" fill="none" stroke="#f5d0fe" strokeOpacity="0.6" strokeWidth="0.5" />
      {/* eyelashes / spikes */}
      <g stroke="#c026d3" strokeWidth="0.7" strokeLinecap="round">
        <line x1="14" y1="14" x2="10" y2="6" />
        <line x1="22" y1="11" x2="20" y2="3" />
        <line x1="32" y1="10" x2="32" y2="2" />
        <line x1="42" y1="11" x2="44" y2="3" />
        <line x1="50" y1="14" x2="54" y2="6" />
      </g>
    </g>
  );
}

/* ───────────────────────────── 14. crown-gems ────────────────────────── */

function IconCrownGems({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="35%" stopColor="#fbbf24" />
          <stop offset="70%" stopColor="#a16207" />
          <stop offset="100%" stopColor="#3f1d05" />
        </linearGradient>
        <linearGradient id={`${uid}-band`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#78350f" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="34" r="26" fill={`url(#${uid}-glow)`} />
      <ellipse cx="32" cy="56" rx="22" ry="2.5" fill="#000" opacity="0.55" />

      {/* crown body */}
      <path d="M8 22 Q12 18 16 22 L22 36 L26 16 Q28 12 32 12 Q36 12 38 16 L42 36 L48 22 Q52 18 56 22 L52 50 L12 50 Z" fill={`url(#${uid}-gold)`} stroke="#3f1d05" strokeWidth="0.9" />
      {/* highlight */}
      <path d="M14 22 L52 22 L50 26 L14 26 Z" fill="#fef9c3" opacity="0.55" />

      {/* base band */}
      <rect x="10" y="46" width="44" height="6" rx="1.2" fill={`url(#${uid}-band)`} stroke="#3f1d05" strokeWidth="0.6" />
      <rect x="10" y="46" width="44" height="1.4" fill="#fef9c3" opacity="0.7" />
      <rect x="10" y="50" width="44" height="0.6" fill="#3f1d05" opacity="0.6" />

      {/* tip jewels */}
      <circle cx="12" cy="20" r="2.4" fill="#fb7185" stroke="#7f1d1d" strokeWidth="0.5" />
      <circle cx="11.4" cy="19.4" r="0.7" fill="#fff" />
      <circle cx="32" cy="10" r="3" fill="#a855f7" stroke="#3b0764" strokeWidth="0.6" />
      <circle cx="31.2" cy="9" r="0.9" fill="#fff" />
      <circle cx="52" cy="20" r="2.4" fill="#22d3ee" stroke="#0e7490" strokeWidth="0.5" />
      <circle cx="51.4" cy="19.4" r="0.7" fill="#fff" />

      {/* band gems */}
      <g>
        <ellipse cx="20" cy="49" rx="2.4" ry="1.6" fill="#22c55e" stroke="#14532d" strokeWidth="0.5" />
        <circle cx="19.4" cy="48.6" r="0.5" fill="#fff" />
        <ellipse cx="32" cy="49" rx="2.6" ry="1.8" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.5" />
        <circle cx="31.4" cy="48.6" r="0.5" fill="#fff" />
        <ellipse cx="44" cy="49" rx="2.4" ry="1.6" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="0.5" />
        <circle cx="43.4" cy="48.6" r="0.5" fill="#fff" />
      </g>

      {/* fleur cross detail above */}
      <path d="M30 12 L34 12 L34 8 L30 8 Z" fill="#fde68a" stroke="#7c2d12" strokeWidth="0.4" />
      <path d="M28 6 L36 6 L34 10 L30 10 Z" fill="#fde68a" stroke="#7c2d12" strokeWidth="0.4" />

      {/* sparkles */}
      <g fill="#fff">
        <path d="M48 8 L48.6 9.4 L50 10 L48.6 10.6 L48 12 L47.4 10.6 L46 10 L47.4 9.4 Z" opacity="0.9" />
        <circle cx="14" cy="34" r="0.5" />
        <circle cx="50" cy="34" r="0.5" />
      </g>
    </g>
  );
}

/* ───────────────────────────── 15. skull ─────────────────────────────── */

function IconSkull({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-bone`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fafafa" />
          <stop offset="60%" stopColor="#a1a1aa" />
          <stop offset="100%" stopColor="#27272a" />
        </radialGradient>
        <radialGradient id={`${uid}-eye`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="40%" stopColor="#581c87" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
      </defs>

      <ellipse cx="32" cy="56" rx="18" ry="2" fill="#000" opacity="0.6" />

      {/* cranium */}
      <path d="M14 30 Q14 8 32 8 Q50 8 50 30 L50 42 Q48 46 44 46 L42 52 L36 46 L28 46 L22 52 L20 46 Q16 46 14 42 Z" fill={`url(#${uid}-bone)`} stroke="#0a0a0a" strokeWidth="0.9" />
      {/* dome shading */}
      <path d="M14 30 Q14 8 32 8 Q34 8 36 9 Q22 14 18 32 Z" fill="#fff" opacity="0.25" />
      <path d="M50 30 Q50 14 36 9 Q48 12 50 30 Z" fill="#000" opacity="0.18" />
      {/* cracks */}
      <path d="M22 14 L24 18 L22 22 L26 26" fill="none" stroke="#0a0a0a" strokeWidth="0.5" strokeLinecap="round" />
      <path d="M40 12 L38 16 L42 20" fill="none" stroke="#0a0a0a" strokeWidth="0.5" strokeLinecap="round" />

      {/* eye sockets */}
      <ellipse cx="23" cy="30" rx="5.4" ry="6.4" fill="#000" />
      <ellipse cx="23" cy="30" rx="4.6" ry="5.4" fill={`url(#${uid}-eye)`} />
      <circle cx="24" cy="28" r="1.2" fill="#fef08a" opacity="0.95" />
      <circle cx="24" cy="28" r="0.5" fill="#fff" />

      <ellipse cx="41" cy="30" rx="5.4" ry="6.4" fill="#000" />
      <ellipse cx="41" cy="30" rx="4.6" ry="5.4" fill={`url(#${uid}-eye)`} />
      <circle cx="42" cy="28" r="1.2" fill="#fef08a" opacity="0.95" />
      <circle cx="42" cy="28" r="0.5" fill="#fff" />

      {/* nose */}
      <path d="M30 36 Q32 42 34 36 L34 40 L32 42 L30 40 Z" fill="#000" />
      <path d="M31.2 38 L32.8 38" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.4" />

      {/* cheekbones */}
      <path d="M16 38 Q22 36 26 40" fill="none" stroke="#0a0a0a" strokeWidth="0.5" />
      <path d="M48 38 Q42 36 38 40" fill="none" stroke="#0a0a0a" strokeWidth="0.5" />

      {/* teeth */}
      <rect x="22" y="44" width="20" height="3" rx="0.4" fill="#27272a" />
      <g fill="#e4e4e7" stroke="#0a0a0a" strokeWidth="0.3">
        <rect x="23" y="44.4" width="2.6" height="3.4" rx="0.4" />
        <rect x="26" y="44.4" width="2.6" height="3.4" rx="0.4" />
        <rect x="29" y="44.4" width="2.6" height="3.4" rx="0.4" />
        <rect x="32.4" y="44.4" width="2.6" height="3.4" rx="0.4" />
        <rect x="35.4" y="44.4" width="2.6" height="3.4" rx="0.4" />
        <rect x="38.4" y="44.4" width="2.6" height="3.4" rx="0.4" />
      </g>

      {/* jaw */}
      <path d="M22 47 Q32 52 42 47 L42 52 L36 50 L28 50 L22 52 Z" fill={`url(#${uid}-bone)`} stroke="#0a0a0a" strokeWidth="0.6" />
    </g>
  );
}

/* ───────────────────────────── 16. lantern-glow ──────────────────────── */

function IconLanternGlow({ uid }: { uid: string }): ReactElement {
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-aura`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.85" />
          <stop offset="40%" stopColor="#fbbf24" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-flame`} cx="50%" cy="60%" r="55%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#f97316" />
        </radialGradient>
        <linearGradient id={`${uid}-iron`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#cbd5f5" />
          <stop offset="50%" stopColor="#475569" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="0" y2="64">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* aura */}
      <circle cx="32" cy="34" r="28" fill={`url(#${uid}-aura)`} />

      {/* hanging chain */}
      <line x1="32" y1="2" x2="32" y2="6" stroke={`url(#${uid}-iron)`} strokeWidth="1.4" />
      <circle cx="32" cy="6" r="1.6" fill="none" stroke={`url(#${uid}-iron)`} strokeWidth="0.8" />
      <circle cx="32" cy="9" r="1.6" fill="none" stroke={`url(#${uid}-iron)`} strokeWidth="0.8" />

      {/* top cap */}
      <path d="M22 12 L42 12 L40 16 L24 16 Z" fill={`url(#${uid}-iron)`} stroke="#000" strokeWidth="0.5" />
      <rect x="20" y="16" width="24" height="3" rx="0.5" fill={`url(#${uid}-iron)`} stroke="#000" strokeWidth="0.5" />
      <rect x="20" y="16" width="24" height="0.7" fill="#fff" opacity="0.5" />

      {/* glass body */}
      <path d="M18 19 L46 19 L48 44 L16 44 Z" fill="#0a0710" stroke="#000" strokeWidth="0.6" />
      <path d="M18 19 L46 19 L48 44 L16 44 Z" fill={`url(#${uid}-glass)`} />

      {/* glass panes — vertical bars */}
      <line x1="22" y1="19" x2="22" y2="44" stroke={`url(#${uid}-iron)`} strokeWidth="1.4" />
      <line x1="32" y1="19" x2="32" y2="44" stroke={`url(#${uid}-iron)`} strokeWidth="1.4" />
      <line x1="42" y1="19" x2="42" y2="44" stroke={`url(#${uid}-iron)`} strokeWidth="1.4" />
      {/* horizontal bar */}
      <line x1="16" y1="32" x2="48" y2="32" stroke={`url(#${uid}-iron)`} strokeWidth="1.4" />

      {/* corner brackets */}
      <path d="M16 19 L20 23" stroke="#94a3b8" strokeWidth="0.7" />
      <path d="M48 19 L44 23" stroke="#94a3b8" strokeWidth="0.7" />

      {/* flame inside */}
      <path d="M32 22 Q26 28 27 34 Q28 40 32 42 Q36 40 37 34 Q38 28 32 22 Z" fill={`url(#${uid}-flame)`} />
      <path d="M32 26 Q29 30 30 34 Q31 38 32 38 Q33 38 34 34 Q35 30 32 26 Z" fill="#fef9c3" opacity="0.9" />
      <ellipse cx="32" cy="33" rx="0.9" ry="2" fill="#fff" />
      {/* flame glow inside lantern */}
      <ellipse cx="32" cy="32" rx="14" ry="10" fill="#fbbf24" opacity="0.18" />

      {/* glass highlights */}
      <line x1="20" y1="22" x2="20" y2="42" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.5" />
      <line x1="44" y1="22" x2="44" y2="42" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.5" />

      {/* base */}
      <rect x="14" y="44" width="36" height="3.5" rx="0.6" fill={`url(#${uid}-iron)`} stroke="#000" strokeWidth="0.5" />
      <rect x="14" y="44" width="36" height="0.7" fill="#fff" opacity="0.55" />
      <rect x="18" y="47.5" width="28" height="4" rx="0.6" fill={`url(#${uid}-iron)`} stroke="#000" strokeWidth="0.5" />
      <rect x="20" y="51.5" width="24" height="2" fill={`url(#${uid}-iron)`} stroke="#000" strokeWidth="0.4" />

      {/* embers floating */}
      <circle cx="20" cy="14" r="0.6" fill="#fbbf24" opacity="0.85" />
      <circle cx="46" cy="10" r="0.5" fill="#fde047" opacity="0.85" />
      <circle cx="50" cy="20" r="0.5" fill="#fb923c" opacity="0.8" />
      <circle cx="14" cy="22" r="0.5" fill="#fde047" opacity="0.8" />
    </g>
  );
}

/* ─────────────────────────── icon dispatch table ─────────────────────── */

const ICON_RENDERERS: Record<AvatarId, (uid: string) => ReactElement> = {
  "miner-helmet":    (uid) => <IconMinerHelmet uid={uid} />,
  "crossed-picks":   (uid) => <IconCrossedPicks uid={uid} />,
  "crystal-cluster": (uid) => <IconCrystalCluster uid={uid} />,
  "mine-cart":       (uid) => <IconMineCart uid={uid} />,
  dynamite:          (uid) => <IconDynamite uid={uid} />,
  "gold-ingot":      (uid) => <IconGoldIngot uid={uid} />,
  "wall-torch":      (uid) => <IconWallTorch uid={uid} />,
  "drill-bit":       (uid) => <IconDrillBit uid={uid} />,
  "mega-diamond":    (uid) => <IconMegaDiamond uid={uid} />,
  "fire-gem":        (uid) => <IconFireGem uid={uid} />,
  "shield-pick":     (uid) => <IconShieldPick uid={uid} />,
  potion:            (uid) => <IconPotion uid={uid} />,
  "dragon-eye":      (uid) => <IconDragonEye uid={uid} />,
  "crown-gems":      (uid) => <IconCrownGems uid={uid} />,
  skull:             (uid) => <IconSkull uid={uid} />,
  "lantern-glow":    (uid) => <IconLanternGlow uid={uid} />,
};

function PresetAvatarIcon({ id, size }: { id: AvatarId; size: number }): ReactElement {
  const uid = `lore-av-${id}`;
  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden rounded-[30%] shadow-[0_12px_32px_rgba(3,7,18,0.6)]"
      style={{ width: size, height: size }}
    >
      <AvatarFrame uid={uid} theme={THEMES[id]}>
        {ICON_RENDERERS[id](uid)}
      </AvatarFrame>
    </span>
  );
}

/* ------------------------------ Wallet fallback --------------------------- */

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

/* --------------------------------- Public -------------------------------- */

export type ChatAvatarProps = {
  avatarId?: AvatarId | null;
  customSrc?: string | null;
  walletAddress?: string;
  size?: number;
  className?: string;
};

function CustomAvatarImage({
  src,
  size,
  className,
}: {
  src: string;
  size: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="avatar"
      width={size}
      height={size}
      loading="eager"
      decoding="async"
      draggable={false}
      className={`block rounded-[30%] object-cover shadow-[0_10px_28px_rgba(3,7,18,0.5)] ${className ?? ""}`}
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
    return <CustomAvatarImage src={customSrc} size={size} className={className} />;
  }

  if (avatarId && isAvatarId(avatarId)) {
    return (
      <span className={`inline-flex ${className ?? ""}`} style={{ width: size, height: size }}>
        <PresetAvatarIcon id={avatarId} size={size} />
      </span>
    );
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
