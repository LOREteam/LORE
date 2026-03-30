"use client";

import React from "react";
import { shortenAddress } from "../../lib/utils";
import type { SoundName } from "../../hooks/useSound";
import { SOUND_LABELS } from "../../hooks/useSound";
import { UiPanel } from "../ui/UiPanel";

interface WalletSettingsOverviewPanelProps {
  connectedWalletAddress?: string;
  soundSettings?: Partial<Record<SoundName, boolean>>;
  onSoundSettingChange?: (name: SoundName, enabled: boolean) => void;
  reducedMotion: boolean;
  onReducedMotionChange?: (enabled: boolean) => void;
}

export function WalletSettingsOverviewPanel({
  connectedWalletAddress,
  soundSettings,
  onSoundSettingChange,
  reducedMotion,
  onReducedMotionChange,
}: WalletSettingsOverviewPanelProps) {
  return (
    <>
      {soundSettings && onSoundSettingChange && (
        <UiPanel tone="subtle" padding="sm" className="animate-slide-up" style={{ animationDelay: "0.02s" }}>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">Sound</span>
            <span className="text-[8px] text-gray-600">when unmuted</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
            {(["bet", "autoBet", "reveal", "win", "myWin", "tick"] as SoundName[]).map((name) => (
              <label
                key={name}
                className="flex items-center gap-2 py-1 rounded cursor-pointer hover:bg-white/[0.03] transition-colors group"
              >
                <input
                  type="checkbox"
                  checked={soundSettings[name] !== false}
                  onChange={(e) => onSoundSettingChange(name, e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-violet-500/30 bg-violet-500/10 text-violet-500 focus:ring-violet-500/50 focus:ring-offset-0 shrink-0"
                />
                <span className="text-[10px] text-gray-400 group-hover:text-gray-300">{SOUND_LABELS[name]}</span>
              </label>
            ))}
          </div>
        </UiPanel>
      )}

      {onReducedMotionChange && (
        <UiPanel tone="subtle" padding="sm" className="animate-slide-up" style={{ animationDelay: "0.035s" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Animation</div>
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Reduce visual effects and transitions across the site for weaker PCs. The countdown timer still updates normally.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reducedMotion}
              onClick={() => onReducedMotionChange(!reducedMotion)}
              className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                reducedMotion
                  ? "justify-end border-emerald-400/40 bg-emerald-500/20"
                  : "justify-start border-white/10 bg-white/[0.05]"
              }`}
            >
              <span className="block h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>
        </UiPanel>
      )}

      <UiPanel tone="default" className="animate-slide-up" style={{ animationDelay: "0.05s" }}>
        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1.5">Current Session</div>
        <div className="text-sm text-emerald-400 font-mono font-semibold drop-shadow-[0_0_6px_rgba(52,211,153,0.3)]">
          {connectedWalletAddress ? shortenAddress(connectedWalletAddress) : "Not connected"}
        </div>
      </UiPanel>
    </>
  );
}
