"use client";

import React from "react";
import { CrystalParticles } from "./CrystalParticles";

interface PageBackdropProps {
  motionReady: boolean;
  reducedMotion: boolean;
}

export function PageBackdrop({ motionReady, reducedMotion }: PageBackdropProps) {
  return (
    <>
      {motionReady && !reducedMotion && <CrystalParticles />}

      <div
        className="pointer-events-none fixed inset-0 bg-[#05040b]"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 bg-cover bg-center opacity-30 md:opacity-36"
          style={{
            backgroundImage: "url('/jackpot-og-weekly-painted.png')",
            transform: "scale(1.04)",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(78,52,150,0.2),transparent_36%),linear-gradient(180deg,rgba(5,4,11,0.68)_0%,rgba(5,4,11,0.82)_46%,rgba(5,4,11,0.96)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,4,11,0.92)_0%,rgba(5,4,11,0.48)_32%,rgba(5,4,11,0.42)_68%,rgba(5,4,11,0.82)_100%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(5,4,11,0.9),transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-60 bg-[linear-gradient(0deg,rgba(5,4,11,0.98),transparent)]" />
      </div>
    </>
  );
}
