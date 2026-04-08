export const uiTokens = {
  radius: {
    sm: "rounded-lg",
    md: "rounded-xl",
    lg: "rounded-2xl",
  },
  focusRing:
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#060612]",
  modalSurface: "border border-violet-500/20 bg-[#0d0d1a] shadow-2xl shadow-violet-500/10",
  panelBase: "border transition-colors",
  sectionLabel: "text-[10px] font-bold uppercase tracking-widest",
  helperText: "text-[10px] text-slate-500",
  inputBase:
    "w-full bg-[#060612] border px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none transition-all duration-200",
  /** Reusable shadow presets to avoid inline duplication */
  shadow: {
    /** Subtle inset + outer glow for panels */
    panelInset: "shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)]",
    /** Standard inset-only top highlight */
    insetHighlight: "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
    /** Violet glow for cards */
    cardGlow: "shadow-[0_0_16px_rgba(139,92,246,0.05)]",
  },
  /** Semantic label for secondary/muted text — passes WCAG AA on dark bg */
  mutedText: "text-slate-500",
  /** Very muted text for decorative labels */
  dimText: "text-slate-600",
} as const;
