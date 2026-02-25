"use client";

import React, { useState, useEffect } from "react";

const DISMISSED_KEY = "lore_intro_dismissed";

export const LoreIntro = React.memo(function LoreIntro() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const d = localStorage.getItem(DISMISSED_KEY);
    if (!d) setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  if (!visible) return null;

  return (
    <div className="relative mb-2 rounded-xl overflow-hidden animate-fade-in lore-border-glow">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d1a] via-[#120d2e] to-[#0d0d1a]" />
      <div className="absolute inset-0 bg-[url('/kael-hero.png')] bg-right bg-no-repeat bg-contain opacity-[0.12] pointer-events-none" />
      <div className="absolute inset-0 lore-hex-pattern opacity-[0.03]" />

      {/* Floating crystal shards */}
      <div className="absolute top-2 left-[15%] w-1 h-1 bg-violet-400 rotate-45 animate-crystal-float opacity-40" />
      <div className="absolute top-4 left-[45%] w-1.5 h-1.5 bg-violet-300 rotate-12 animate-crystal-float-delayed opacity-30" />
      <div className="absolute bottom-3 right-[30%] w-1 h-1 bg-cyan-400 rotate-45 animate-crystal-float opacity-25" />

      <div className="relative z-10 flex items-start gap-4 p-4">
        {/* Hero avatar */}
        <div className="hidden sm:block shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-violet-500/30 shadow-[0_0_20px_rgba(139,92,246,0.2)] lore-avatar-glow">
          <img
            src="/kael-hero.png"
            alt="KAEL – The First Miner"
            className="w-full h-full object-cover object-top"
            loading="eager"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400/80 lore-text-shimmer">
              The Crystal Lattice
            </span>
            <span className="w-8 h-px bg-gradient-to-r from-violet-500/50 to-transparent" />
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            <span className="text-violet-300 font-semibold">Deep beneath the Linea blockchain</span> lies the Crystal Lattice –
            an infinite network of crystalline veins pulsing with raw ORE energy. Once every epoch, the Lattice shifts,
            revealing a single resonant node.{" "}
            <span className="text-gray-500">You are the miner. Find the node. Claim the harvest.</span>
          </p>

          {expanded && (
            <div className="mt-2 text-xs text-gray-500 leading-relaxed animate-fade-in space-y-2">
              <p>
                Legend speaks of <span className="text-violet-400 font-medium">KAEL</span> – the First Miner – who discovered
                the Lattice when the genesis block was forged. Part digital, part ethereal, KAEL merged with the chain itself,
                becoming a guardian of the ORE veins. His crystal pickaxe still resonates through every epoch, guiding those
                who dare to stake their claim.
              </p>
              <p>
                The 25 tiles of the mining grid are fragments of the Lattice, each hiding a potential vein of concentrated ORE.
                Every epoch, the Lattice pulses and one tile glows bright – the winning node.
                Those who foresaw it share the harvest. Those who missed it sharpen their instinct for the next shift.
              </p>
              <p className="text-[10px] text-gray-600 italic">
                &quot;The chain remembers every miner. The Lattice rewards the bold.&quot; – KAEL
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] font-bold uppercase tracking-wider text-violet-400/70 hover:text-violet-300 transition-colors"
            >
              {expanded ? "Collapse" : "Read the lore"}
            </button>
            <button
              onClick={dismiss}
              className="text-[10px] font-bold uppercase tracking-wider text-gray-600 hover:text-gray-400 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={dismiss}
          className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors mt-0.5"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
});
