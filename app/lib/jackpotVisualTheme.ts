export type JackpotVisualKind = "daily" | "weekly" | "dual";

export interface JackpotVisualTheme {
  kind: JackpotVisualKind;
  label: string;
  winTitle: string;
  cardTitle: string;
  cardCaption: string;
  payoutName: string;
  ogArt: string;
  colors: {
    title: string;
    amount: string;
    accent: string;
    accentSoft: string;
    shadow: string;
    chipBg: string;
    chipBorder: string;
  };
  card: {
    vaultClass: string;
    pulseClass: string;
    sweepClass: string;
    titleClass: string;
    amountClass: string;
    subtleClass: string;
    labelClass: string;
    valueClass: string;
    fillClass: string;
    bodyClass: string;
  };
  banner: {
    shell: string;
    shellInner: string;
    glow: string;
    frame: string;
    rim: string;
    beam: string;
    beamAlt: string;
    accent: string;
    headlineFrom: string;
    headlineVia: string;
    headlineTo: string;
    prize: string;
    prizeBorder: string;
    button: string;
    buttonBorder: string;
    shareBorder: string;
    shareBg: string;
    shareText: string;
    sparkle: string;
    mote: string;
  };
}

export const JACKPOT_VISUAL_THEMES: Record<JackpotVisualKind, JackpotVisualTheme> = {
  daily: {
    kind: "daily",
    label: "Daily Jackpot",
    winTitle: "Daily Jackpot Win",
    cardTitle: "Forge Core",
    cardCaption: "Daily Jackpot",
    payoutName: "Sunforge payout",
    ogArt: "/jackpot-og-daily-painted.png",
    colors: {
      title: "#fff0a8",
      amount: "#ffffff",
      accent: "#ffb932",
      accentSoft: "#ffe29a",
      shadow: "rgba(255,138,24,0.72)",
      chipBg: "rgba(75,33,0,0.48)",
      chipBorder: "rgba(255,226,154,0.38)",
    },
    card: {
      vaultClass: "jackpot-vault-daily",
      pulseClass: "bg-amber-400/8",
      sweepClass: "via-amber-300/25",
      titleClass: "text-amber-300",
      amountClass: "text-amber-400",
      subtleClass: "text-amber-400/75",
      labelClass: "text-amber-300/60",
      valueClass: "text-amber-300/70",
      fillClass: "bg-linear-to-r from-amber-500 via-yellow-400 to-orange-400",
      bodyClass: "text-amber-300/65",
    },
    banner: {
      shell: "from-[#120d08] via-[#25170b] to-[#0e0b10]",
      shellInner: "from-[#1b120b] via-[#2b1a0e] to-[#111018]",
      glow: "rgba(255,192,76,0.28)",
      frame: "border-[#f1c66e]/45",
      rim: "border-[#fff0bd]/12",
      beam: "rgba(255,196,81,0.1)",
      beamAlt: "rgba(255,238,181,0.035)",
      accent: "text-[#e2bc75]",
      headlineFrom: "#fff7d8",
      headlineVia: "#ffc95d",
      headlineTo: "#df8a24",
      prize: "from-[#1b120b] via-[#27190d] to-[#131018]",
      prizeBorder: "border-[#f1c66e]/38",
      button: "from-[#765123] via-[#c69035] to-[#6d431e]",
      buttonBorder: "border-[#f0d08c]/55",
      shareBorder: "border-[#f1c66e]/22",
      shareBg: "bg-[#f1c66e]/7",
      shareText: "text-[#f3e3c1]",
      sparkle: "#ffe9ad",
      mote: "radial-gradient(circle at 30% 30%, #fff6ba, #ffcb4e 45%, #d97b15 100%)",
    },
  },
  weekly: {
    kind: "weekly",
    label: "Weekly Jackpot",
    winTitle: "Weekly Jackpot Win",
    cardTitle: "Moon Vault",
    cardCaption: "Weekly Jackpot",
    payoutName: "Moonvault payout",
    ogArt: "/jackpot-og-weekly-painted.png",
    colors: {
      title: "#f0e6ff",
      amount: "#ffffff",
      accent: "#b68cff",
      accentSoft: "#8ff7ff",
      shadow: "rgba(155,104,255,0.74)",
      chipBg: "rgba(22,10,48,0.56)",
      chipBorder: "rgba(216,180,254,0.4)",
    },
    card: {
      vaultClass: "jackpot-vault-weekly",
      pulseClass: "bg-violet-400/8",
      sweepClass: "via-violet-300/25",
      titleClass: "text-violet-300",
      amountClass: "text-violet-300",
      subtleClass: "text-violet-300/75",
      labelClass: "text-violet-300/60",
      valueClass: "text-violet-300/70",
      fillClass: "bg-linear-to-r from-violet-500 via-fuchsia-400 to-cyan-300",
      bodyClass: "text-violet-300/65",
    },
    banner: {
      shell: "from-[#0b0719] via-[#211044] to-[#080f22]",
      shellInner: "from-[#120a25] via-[#241352] to-[#0d1429]",
      glow: "rgba(168,85,247,0.32)",
      frame: "border-[#c4b5fd]/44",
      rim: "border-[#e9d5ff]/12",
      beam: "rgba(168,85,247,0.1)",
      beamAlt: "rgba(103,232,249,0.045)",
      accent: "text-[#c4b5fd]",
      headlineFrom: "#ffffff",
      headlineVia: "#c4b5fd",
      headlineTo: "#67e8f9",
      prize: "from-[#111022] via-[#1f1542] to-[#0f172a]",
      prizeBorder: "border-[#c4b5fd]/38",
      button: "from-[#4c1d95] via-[#7c3aed] to-[#0e7490]",
      buttonBorder: "border-[#d8b4fe]/48",
      shareBorder: "border-[#c4b5fd]/24",
      shareBg: "bg-[#a78bfa]/8",
      shareText: "text-[#f2eaff]",
      sparkle: "#d8b4fe",
      mote: "radial-gradient(circle at 30% 30%, #f0e7ff, #a78bfa 44%, #22d3ee 100%)",
    },
  },
  dual: {
    kind: "dual",
    label: "Double Jackpot",
    winTitle: "Double Jackpot Win",
    cardTitle: "Twin Vault",
    cardCaption: "Double Jackpot",
    payoutName: "Twin pool payout",
    ogArt: "/jackpot-og-weekly-painted.png",
    colors: {
      title: "#fff0c8",
      amount: "#ffffff",
      accent: "#ffcf5f",
      accentSoft: "#c084fc",
      shadow: "rgba(192,132,252,0.74)",
      chipBg: "rgba(32,12,45,0.56)",
      chipBorder: "rgba(245,208,254,0.4)",
    },
    card: {
      vaultClass: "jackpot-vault-dual",
      pulseClass: "bg-fuchsia-400/8",
      sweepClass: "via-fuchsia-300/25",
      titleClass: "text-fuchsia-200",
      amountClass: "text-amber-200",
      subtleClass: "text-fuchsia-200/75",
      labelClass: "text-fuchsia-200/60",
      valueClass: "text-fuchsia-200/70",
      fillClass: "bg-linear-to-r from-amber-400 via-fuchsia-400 to-cyan-300",
      bodyClass: "text-fuchsia-200/65",
    },
    banner: {
      shell: "from-[#110b18] via-[#25163a] to-[#0c111f]",
      shellInner: "from-[#181021] via-[#23193a] to-[#101827]",
      glow: "rgba(190,137,255,0.28)",
      frame: "border-[#d8b4fe]/42",
      rim: "border-[#fff0bd]/12",
      beam: "rgba(216,180,254,0.09)",
      beamAlt: "rgba(255,214,102,0.04)",
      accent: "text-[#d8b4fe]",
      headlineFrom: "#fff7d8",
      headlineVia: "#d8b4fe",
      headlineTo: "#75a7ff",
      prize: "from-[#171120] via-[#211735] to-[#111827]",
      prizeBorder: "border-[#d8b4fe]/38",
      button: "from-[#5d3a91] via-[#8b5cf6] to-[#2f5f9b]",
      buttonBorder: "border-[#d8b4fe]/45",
      shareBorder: "border-[#d8b4fe]/22",
      shareBg: "bg-[#d8b4fe]/7",
      shareText: "text-[#f4e8ff]",
      sparkle: "#fff0bd",
      mote: "radial-gradient(circle at 30% 30%, #fff6ba, #c084fc 48%, #67e8f9 100%)",
    },
  },
};

export function getJackpotVisualTheme(kind: JackpotVisualKind): JackpotVisualTheme {
  return JACKPOT_VISUAL_THEMES[kind];
}

export function resolveJackpotVisualKind(isDailyJackpot: boolean, isWeeklyJackpot: boolean): JackpotVisualKind {
  if (isDailyJackpot && isWeeklyJackpot) return "dual";
  if (isWeeklyJackpot) return "weekly";
  return "daily";
}
