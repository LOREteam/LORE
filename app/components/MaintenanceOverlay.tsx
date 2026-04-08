"use client";

import { maintenance } from "../lib/loreTexts";
import Image from "next/image";

export function MaintenanceOverlay() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#060612]">
      {/* Animated gradient orbs */}
      <div className="absolute top-[15%] left-[20%] w-[40%] h-[40%] rounded-full bg-violet-500/20 blur-[120px] animate-[orb-drift-1_12s_ease-in-out_infinite]" />
      <div className="absolute bottom-[20%] right-[15%] w-[35%] h-[35%] rounded-full bg-sky-500/15 blur-[100px] animate-[orb-drift-2_14s_ease-in-out_infinite]" />
      <div className="absolute top-[50%] left-[50%] w-[50%] h-[50%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-500/10 blur-[150px] animate-[breathe_6s_ease-in-out_infinite]" />

      {/* Floating grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Central content */}
      <div className="relative z-10 flex flex-col items-center justify-center px-6 text-center max-w-2xl">
        {/* Logo */}
        <div className="mb-8 animate-float">
          <Image
            src="/icon.png"
            alt="LORE"
            width={80}
            height={80}
            className="w-20 h-20 object-contain drop-shadow-[0_0_20px_rgba(139,92,246,0.4)]"
          />
        </div>

        {/* Main heading */}
        <h1
          className="text-3xl md:text-4xl font-black uppercase tracking-[0.15em] text-white mb-4 animate-[fade-in_0.8s_ease-out_0.2s_both]"
          style={{
            textShadow: "0 0 40px rgba(139,92,246,0.3), 0 0 80px rgba(139,92,246,0.15)",
          }}
        >
          {maintenance.heading}
        </h1>

        {/* Lore subtext */}
        <p
          className="text-base md:text-lg text-gray-400 font-medium leading-relaxed animate-[fade-in_0.8s_ease-out_0.5s_both] italic"
          style={{ maxWidth: "460px" }}
        >
          {maintenance.body}
        </p>

        {/* Animated divider */}
        <div
          className="mt-8 h-px w-32 rounded-full opacity-70 animate-gradient-x"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.9), transparent)",
            backgroundSize: "200% 100%",
          }}
        />

        {/* Status indicator */}
        <div className="mt-8 flex items-center gap-2 animate-[fade-in_0.8s_ease-out_0.7s_both]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-amber-400/90">
            {maintenance.status}
          </span>
        </div>
      </div>

      {/* Bottom branding */}
      <div
        className="absolute bottom-8 left-0 right-0 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 animate-[fade-in_1s_ease-out_1s_both]"
      >
        {maintenance.brand}
      </div>
    </div>
  );
}
