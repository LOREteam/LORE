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

      {reducedMotion ? (
        <div className="fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(139,92,246,0.05),transparent_34%),radial-gradient(circle_at_80%_100%,rgba(14,165,233,0.04),transparent_32%)] pointer-events-none" />
      ) : (
        <>
          <div className="fixed top-[-20%] left-[-15%] w-[50%] h-[50%] max-md:w-[70%] max-md:h-[35%] bg-violet-600 rounded-full blur-[250px] max-md:blur-[120px] opacity-[0.07] pointer-events-none animate-orb-1" />
          <div className="fixed bottom-[-25%] right-[-15%] w-[45%] h-[45%] max-md:w-[65%] max-md:h-[35%] bg-sky-500 rounded-full blur-[250px] max-md:blur-[120px] opacity-[0.05] pointer-events-none animate-orb-2" />
          <div className="fixed top-[30%] left-[50%] w-[30%] h-[30%] bg-fuchsia-500 rounded-full blur-[200px] opacity-[0.03] pointer-events-none animate-orb-1 max-md:hidden" style={ORB_STYLE} />
        </>
      )}
    </>
  );
}
