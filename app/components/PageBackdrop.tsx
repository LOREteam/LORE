"use client";

import React from "react";
import { CrystalParticles } from "./CrystalParticles";

const ORB_STYLE = { animationDelay: "-10s" } as const;

interface PageBackdropProps {
  motionReady: boolean;
  reducedMotion: boolean;
}

export function PageBackdrop({ motionReady, reducedMotion }: PageBackdropProps) {
  return (
    <>
      {motionReady && !reducedMotion && <CrystalParticles />}

      <div className="fixed top-[-20%] left-[-15%] w-[50%] h-[50%] bg-violet-600 rounded-full blur-[250px] opacity-[0.07] pointer-events-none animate-orb-1" />
      <div className="fixed bottom-[-25%] right-[-15%] w-[45%] h-[45%] bg-sky-500 rounded-full blur-[250px] opacity-[0.05] pointer-events-none animate-orb-2" />
      <div className="fixed top-[30%] left-[50%] w-[30%] h-[30%] bg-fuchsia-500 rounded-full blur-[200px] opacity-[0.03] pointer-events-none animate-orb-1" style={ORB_STYLE} />
    </>
  );
}
