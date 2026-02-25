"use client";

import React from "react";

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

const avatarPaths: Record<AvatarId, React.ReactNode> = {
  "miner-helmet": (
    <g>
      <defs>
        <linearGradient id="ah1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <radialGradient id="ah2" cx="0.5" cy="0.3" r="0.5">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#eab308" />
        </radialGradient>
        <radialGradient id="ah3" cx="0.5" cy="0.5" r="0.7">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fef08a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M6,21 Q6,9 16,6 Q26,9 26,21 L6,21Z" fill="url(#ah1)" />
      <rect x="6" y="19" width="20" height="4" rx="1" fill="#334155" />
      <rect x="8" y="15" width="16" height="3" rx="1" fill="#64748b" opacity="0.5" />
      <circle cx="16" cy="11" r="3.5" fill="url(#ah2)" />
      <circle cx="16" cy="11" r="6" fill="url(#ah3)" />
      <rect x="14.5" y="6" width="3" height="2" rx="0.5" fill="#64748b" />
    </g>
  ),

  "crossed-picks": (
    <g>
      <defs>
        <linearGradient id="ap1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a8a29e" />
          <stop offset="100%" stopColor="#78716c" />
        </linearGradient>
      </defs>
      <line x1="6" y1="26" x2="20" y2="8" stroke="#92400e" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="26" y1="26" x2="12" y2="8" stroke="#92400e" strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="18,8 24,4 22,10 18,12" fill="url(#ap1)" stroke="#57534e" strokeWidth="0.5" />
      <polygon points="14,8 8,4 10,10 14,12" fill="url(#ap1)" stroke="#57534e" strokeWidth="0.5" />
      <circle cx="16" cy="17" r="1" fill="#fbbf24" opacity="0.9" />
      <circle cx="14" cy="19" r="0.6" fill="#fb923c" opacity="0.7" />
      <circle cx="18" cy="15" r="0.7" fill="#fde68a" opacity="0.8" />
    </g>
  ),

  "crystal-cluster": (
    <g>
      <defs>
        <linearGradient id="ac1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="ac2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id="ac3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <ellipse cx="16" cy="27" rx="10" ry="3" fill="#44403c" />
      <polygon points="16,3 20,18 12,18" fill="url(#ac1)" />
      <polygon points="16,3 18.5,16 16,18 13.5,16" fill="#e9d5ff" opacity="0.3" />
      <polygon points="8,10 12,22 4,22" fill="url(#ac2)" />
      <polygon points="8,10 10.5,20 8,22 5.5,20" fill="#cffafe" opacity="0.3" />
      <polygon points="23,12 27,24 19,24" fill="url(#ac3)" />
      <polygon points="23,12 25.5,22 23,24 20.5,22" fill="#dcfce7" opacity="0.3" />
    </g>
  ),

  "mine-cart": (
    <g>
      <defs>
        <linearGradient id="am1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#78716c" />
          <stop offset="100%" stopColor="#44403c" />
        </linearGradient>
        <radialGradient id="am2" cx="0.5" cy="0.3" r="0.5">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </radialGradient>
      </defs>
      <polygon points="5,14 27,14 25,24 7,24" fill="url(#am1)" stroke="#57534e" strokeWidth="0.7" />
      <rect x="4" y="13" width="24" height="2" rx="0.5" fill="#57534e" />
      <circle cx="9" cy="26" r="2.5" fill="#57534e" stroke="#78716c" strokeWidth="0.7" />
      <circle cx="23" cy="26" r="2.5" fill="#57534e" stroke="#78716c" strokeWidth="0.7" />
      <circle cx="12" cy="16" r="2.5" fill="url(#am2)" opacity="0.9" />
      <circle cx="19" cy="15" r="2" fill="#a78bfa" opacity="0.8" />
      <circle cx="15.5" cy="13" r="1.8" fill="#e9d5ff" opacity="0.6" />
      <circle cx="21" cy="17" r="1.5" fill="#c084fc" opacity="0.7" />
    </g>
  ),

  dynamite: (
    <g>
      <defs>
        <linearGradient id="ad1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
        <radialGradient id="ad2" cx="0.5" cy="1" r="0.7">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="60%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="10" y="12" width="4" height="16" rx="1.5" fill="url(#ad1)" />
      <rect x="14.5" y="11" width="4" height="17" rx="1.5" fill="url(#ad1)" />
      <rect x="19" y="12" width="4" height="16" rx="1.5" fill="url(#ad1)" />
      <rect x="10" y="14" width="4" height="1.5" rx="0.3" fill="#fca5a5" opacity="0.4" />
      <rect x="14.5" y="13" width="4" height="1.5" rx="0.3" fill="#fca5a5" opacity="0.4" />
      <rect x="19" y="14" width="4" height="1.5" rx="0.3" fill="#fca5a5" opacity="0.4" />
      <path d="M16.5,11 Q17,7 19,5" fill="none" stroke="#a8a29e" strokeWidth="1" />
      <circle cx="19" cy="4" r="2.5" fill="url(#ad2)" />
      <circle cx="19" cy="3.5" r="1" fill="#fef9c3" opacity="0.9" />
    </g>
  ),

  "gold-ingot": (
    <g>
      <defs>
        <linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id="ag2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <polygon points="9,12 23,12 27,22 5,22" fill="url(#ag1)" />
      <polygon points="9,12 23,12 20,8 12,8" fill="url(#ag2)" />
      <polygon points="23,12 27,22 24,18 20,8" fill="#b45309" opacity="0.4" />
      <line x1="10" y1="12" x2="8" y2="18" stroke="#fef9c3" strokeWidth="0.5" opacity="0.5" />
      <rect x="14" y="14" width="5" height="3" rx="0.5" fill="#fef9c3" opacity="0.15" />
    </g>
  ),

  "wall-torch": (
    <g>
      <defs>
        <radialGradient id="at1" cx="0.5" cy="0.7" r="0.6">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="40%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ea580c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="at2" cx="0.5" cy="0.5" r="0.9">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="12" r="9" fill="url(#at2)" />
      <rect x="14" y="14" width="4" height="14" rx="1" fill="#92400e" />
      <rect x="14.8" y="14" width="1.5" height="14" rx="0.5" fill="#a16207" opacity="0.4" />
      <ellipse cx="16" cy="11" rx="5" ry="7" fill="url(#at1)" />
      <ellipse cx="16" cy="9" rx="2.5" ry="4.5" fill="#fef08a" opacity="0.7" />
      <ellipse cx="16" cy="8" rx="1" ry="2.5" fill="#fefce8" opacity="0.9" />
    </g>
  ),

  "drill-bit": (
    <g>
      <defs>
        <linearGradient id="adr1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
      </defs>
      <rect x="13" y="20" width="6" height="8" rx="1" fill="#475569" />
      <rect x="11" y="24" width="10" height="3" rx="1" fill="#334155" />
      <polygon points="16,2 20,20 12,20" fill="url(#adr1)" />
      <path d="M16,4 Q20,8 18,12 Q22,14 19,18" fill="none" stroke="#94a3b8" strokeWidth="1.2" opacity="0.6" />
      <path d="M16,4 Q12,8 14,12 Q10,14 13,18" fill="none" stroke="#94a3b8" strokeWidth="1.2" opacity="0.6" />
      <line x1="16" y1="3" x2="16" y2="19" stroke="#e2e8f0" strokeWidth="0.5" opacity="0.3" />
    </g>
  ),

  "mega-diamond": (
    <g>
      <defs>
        <linearGradient id="adm1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="50%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id="adm2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0f9ff" />
          <stop offset="100%" stopColor="#bae6fd" />
        </linearGradient>
      </defs>
      <polygon points="16,3 28,13 16,29 4,13" fill="url(#adm1)" />
      <polygon points="4,13 16,3 28,13 16,16" fill="url(#adm2)" opacity="0.6" />
      <polygon points="10,13 16,3 16,16" fill="#f0f9ff" opacity="0.3" />
      <polygon points="22,13 16,16 16,3" fill="#0284c7" opacity="0.15" />
      <line x1="16" y1="16" x2="16" y2="29" stroke="#bae6fd" strokeWidth="0.5" opacity="0.4" />
      <line x1="4" y1="13" x2="16" y2="16" stroke="#e0f2fe" strokeWidth="0.3" opacity="0.5" />
      <line x1="28" y1="13" x2="16" y2="16" stroke="#e0f2fe" strokeWidth="0.3" opacity="0.5" />
      <circle cx="12" cy="10" r="0.8" fill="#fff" opacity="0.7" />
      <circle cx="20" cy="18" r="0.5" fill="#fff" opacity="0.5" />
    </g>
  ),

  "fire-gem": (
    <g>
      <defs>
        <radialGradient id="af1" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="40%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#dc2626" />
        </radialGradient>
        <radialGradient id="af2" cx="0.5" cy="0.5" r="0.8">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="10" fill="url(#af2)" />
      <polygon points="16,4 26,16 16,28 6,16" fill="url(#af1)" />
      <polygon points="16,4 21,16 16,26" fill="#fef08a" opacity="0.2" />
      <polygon points="16,8 20,16 16,24 12,16" fill="#fef9c3" opacity="0.15" />
      <circle cx="14" cy="13" r="1" fill="#fff" opacity="0.5" />
    </g>
  ),

  "shield-pick": (
    <g>
      <defs>
        <linearGradient id="as1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <linearGradient id="as2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <path d="M16,3 L26,8 L26,17 Q26,26 16,29 Q6,26 6,17 L6,8 Z" fill="url(#as1)" />
      <path d="M16,5 L24,9 L24,17 Q24,24 16,27 Q8,24 8,17 L8,9 Z" fill="#1e293b" />
      <line x1="11" y1="20" x2="19" y2="12" stroke="#92400e" strokeWidth="1.5" strokeLinecap="round" />
      <polygon points="18,12 22,9 21,14 18,15" fill="url(#as2)" />
      <path d="M16,5 L24,9 L16,9 Z" fill="#475569" opacity="0.4" />
    </g>
  ),

  potion: (
    <g>
      <defs>
        <radialGradient id="apo1" cx="0.4" cy="0.4" r="0.6">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#059669" />
        </radialGradient>
        <radialGradient id="apo2" cx="0.5" cy="0" r="1">
          <stop offset="0%" stopColor="#bbf7d0" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="13" y="4" width="6" height="4" rx="1" fill="#78716c" />
      <rect x="14" y="3" width="4" height="2" rx="0.7" fill="#a8a29e" />
      <path d="M13,8 L11,14 Q8,18 8,22 Q8,28 16,28 Q24,28 24,22 Q24,18 21,14 L19,8 Z" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
      <path d="M11,16 Q8,19 8,22 Q8,28 16,28 Q24,28 24,22 Q24,19 21,16 Z" fill="url(#apo1)" opacity="0.8" />
      <ellipse cx="16" cy="16" rx="5" ry="1.5" fill="url(#apo2)" />
      <circle cx="13" cy="22" r="1" fill="#bbf7d0" opacity="0.5" />
      <circle cx="18" cy="20" r="0.7" fill="#dcfce7" opacity="0.4" />
      <circle cx="15" cy="25" r="0.5" fill="#bbf7d0" opacity="0.3" />
    </g>
  ),

  "dragon-eye": (
    <g>
      <defs>
        <radialGradient id="ade1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
        <radialGradient id="ade2" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="13" ry="9" fill="#1c1917" stroke="#78716c" strokeWidth="0.7" />
      <ellipse cx="16" cy="16" rx="8" ry="8" fill="url(#ade1)" />
      <ellipse cx="16" cy="16" rx="2" ry="7" fill="#1c1917" />
      <ellipse cx="16" cy="16" rx="1" ry="5" fill="#292524" />
      <circle cx="14" cy="13" r="1.5" fill="url(#ade2)" />
      <path d="M3,16 Q8,8 16,7 Q24,8 29,16" fill="none" stroke="#57534e" strokeWidth="0.5" opacity="0.6" />
      <path d="M3,16 Q8,24 16,25 Q24,24 29,16" fill="none" stroke="#57534e" strokeWidth="0.5" opacity="0.6" />
    </g>
  ),

  "crown-gems": (
    <g>
      <defs>
        <linearGradient id="acr1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <polygon points="4,24 4,14 9,18 16,8 23,18 28,14 28,24" fill="url(#acr1)" />
      <rect x="4" y="22" width="24" height="4" rx="1" fill="#b45309" />
      <rect x="4" y="22" width="24" height="1.5" rx="0.5" fill="#fde68a" opacity="0.3" />
      <circle cx="9" cy="24" r="1.5" fill="#ef4444" />
      <circle cx="16" cy="23.5" r="2" fill="#3b82f6" />
      <circle cx="23" cy="24" r="1.5" fill="#22c55e" />
      <circle cx="16" cy="10" r="1" fill="#fef9c3" opacity="0.8" />
      <circle cx="9" cy="17" r="0.7" fill="#fef9c3" opacity="0.6" />
      <circle cx="23" cy="17" r="0.7" fill="#fef9c3" opacity="0.6" />
    </g>
  ),

  skull: (
    <g>
      <defs>
        <radialGradient id="ask1" cx="0.5" cy="0.4" r="0.5">
          <stop offset="0%" stopColor="#f5f5f4" />
          <stop offset="100%" stopColor="#a8a29e" />
        </radialGradient>
        <radialGradient id="ask2" cx="0.5" cy="0.5" r="0.4">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="14" rx="10" ry="11" fill="url(#ask1)" />
      <rect x="12" y="22" width="8" height="6" rx="1" fill="#d6d3d1" />
      <ellipse cx="11.5" cy="13" rx="3" ry="3.5" fill="#292524" />
      <ellipse cx="20.5" cy="13" rx="3" ry="3.5" fill="#292524" />
      <ellipse cx="11.5" cy="13" rx="2" ry="2.5" fill="url(#ask2)" opacity="0.8" />
      <ellipse cx="20.5" cy="13" rx="2" ry="2.5" fill="url(#ask2)" opacity="0.8" />
      <ellipse cx="16" cy="19" rx="1.5" ry="1" fill="#57534e" />
      <line x1="13.5" y1="24" x2="13.5" y2="28" stroke="#a8a29e" strokeWidth="0.5" />
      <line x1="16" y1="24" x2="16" y2="28" stroke="#a8a29e" strokeWidth="0.5" />
      <line x1="18.5" y1="24" x2="18.5" y2="28" stroke="#a8a29e" strokeWidth="0.5" />
    </g>
  ),

  "lantern-glow": (
    <g>
      <defs>
        <radialGradient id="al1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
        <radialGradient id="al2" cx="0.5" cy="0.5" r="0.8">
          <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="11" fill="url(#al2)" />
      <rect x="14" y="4" width="4" height="2" rx="0.7" fill="#78716c" />
      <path d="M14,6 L12,6 Q10,6 10,8 L10,10 Q10,12 12,12 L14,12 Z" fill="#57534e" />
      <path d="M18,6 L20,6 Q22,6 22,8 L22,10 Q22,12 20,12 L18,12 Z" fill="#57534e" />
      <rect x="11" y="8" width="10" height="14" rx="2" fill="#44403c" stroke="#57534e" strokeWidth="0.5" />
      <rect x="13" y="10" width="6" height="10" rx="1" fill="url(#al1)" opacity="0.8" />
      <rect x="13" y="10" width="3" height="10" rx="1" fill="#fef9c3" opacity="0.2" />
      <rect x="11" y="22" width="10" height="2" rx="0.7" fill="#57534e" />
      <rect x="13" y="24" width="6" height="1.5" rx="0.5" fill="#44403c" />
    </g>
  ),
};

interface AvatarProps {
  avatarId: AvatarId | null;
  customSrc?: string | null;
  walletAddress?: string;
  size?: number;
  className?: string;
}

export function ChatAvatar({ avatarId, customSrc, walletAddress, size = 32, className = "" }: AvatarProps) {
  if (customSrc) {
    return (
      <img
        src={customSrc}
        alt="avatar"
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  if (avatarId && avatarPaths[avatarId]) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        className={`rounded-full bg-[#0d0d1a] ${className}`}
      >
        {avatarPaths[avatarId]}
      </svg>
    );
  }

  const colors = generateColors(walletAddress ?? "0x0000");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`rounded-full ${className}`}
    >
      <rect width="32" height="32" rx="16" fill={colors[0]} />
      <circle cx="16" cy="12" r="5" fill={colors[1]} opacity="0.7" />
      <rect x="10" y="19" width="12" height="8" rx="3" fill={colors[1]} opacity="0.5" />
    </svg>
  );
}

function generateColors(addr: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = addr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return [`hsl(${h1}, 50%, 25%)`, `hsl(${h2}, 60%, 65%)`];
}
