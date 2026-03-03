export const uiTokens = {
  radius: {
    sm: "rounded-lg",
    md: "rounded-xl",
    lg: "rounded-2xl",
  },
  focusRing:
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/55 focus-visible:ring-offset-0",
  modalSurface: "border border-violet-500/20 bg-[#0d0d1a] shadow-2xl shadow-violet-500/10",
  panelBase: "border transition-colors",
  sectionLabel: "text-[10px] font-bold uppercase tracking-widest",
  helperText: "text-[10px] text-slate-600",
  inputBase:
    "w-full bg-[#060612] border px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition-all duration-200",
} as const;
