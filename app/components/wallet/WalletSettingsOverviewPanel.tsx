"use client";

import React from "react";
import { getAddress } from "viem";
import type { SoundName } from "../../hooks/useSound";
import { SOUND_LABELS } from "../../hooks/useSound";
import { shortenAddress } from "../../lib/utils";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";

interface WalletSettingsOverviewPanelProps {
  connectedWalletAddress?: string | null;
  embeddedWalletAddress?: string | null;
  connectedResolverRewards: string;
  connectedResolverRewardsWei: bigint;
  embeddedResolverRewards: string;
  embeddedResolverRewardsWei: bigint;
  isClaimingConnectedResolverRewards: boolean;
  isClaimingEmbeddedResolverRewards: boolean;
  onClaimConnectedResolverRewards: () => void;
  onClaimEmbeddedResolverRewards: () => void;
  soundSettings?: Partial<Record<SoundName, boolean>>;
  onSoundSettingChange?: (name: SoundName, enabled: boolean) => void;
  reducedMotion: boolean;
  onReducedMotionChange?: (enabled: boolean) => void;
}

export function WalletSettingsOverviewPanel({
  connectedWalletAddress,
  embeddedWalletAddress,
  connectedResolverRewards,
  connectedResolverRewardsWei,
  embeddedResolverRewards,
  embeddedResolverRewardsWei,
  isClaimingConnectedResolverRewards,
  isClaimingEmbeddedResolverRewards,
  onClaimConnectedResolverRewards,
  onClaimEmbeddedResolverRewards,
  soundSettings,
  onSoundSettingChange,
  reducedMotion,
  onReducedMotionChange,
}: WalletSettingsOverviewPanelProps) {
  const normalizeWalletAddress = (address: string | null | undefined) => {
    if (!address) return null;
    try {
      return getAddress(address).toLowerCase();
    } catch {
      return null;
    }
  };
  const normalizedConnectedWallet = normalizeWalletAddress(connectedWalletAddress);
  const normalizedEmbeddedWallet = normalizeWalletAddress(embeddedWalletAddress);
  const animationEnabled = !reducedMotion;
  const showConnectedResolverRow = Boolean(connectedWalletAddress);
  const showEmbeddedResolverRow =
    Boolean(embeddedWalletAddress) &&
    normalizedEmbeddedWallet !== null &&
    normalizedEmbeddedWallet !== normalizedConnectedWallet;
  const connectedResolverClaimLabel = isClaimingConnectedResolverRewards
    ? "Claiming connected wallet resolver rewards"
    : connectedResolverRewardsWei <= 0n
      ? "No connected wallet resolver rewards to claim"
      : `Claim ${connectedResolverRewards} LINEA resolver rewards from connected wallet`;
  const embeddedResolverClaimLabel = isClaimingEmbeddedResolverRewards
    ? "Claiming Privy wallet resolver rewards"
    : embeddedResolverRewardsWei <= 0n
      ? "No Privy wallet resolver rewards to claim"
      : `Claim ${embeddedResolverRewards} LINEA resolver rewards from Privy wallet`;

  return (
    <>
      {(showConnectedResolverRow || showEmbeddedResolverRow) && (
        <UiPanel tone="subtle" padding="sm" className="animate-slide-up" style={{ animationDelay: "0.01s" }}>
          {(isClaimingConnectedResolverRewards || isClaimingEmbeddedResolverRewards) && (
            <span className="sr-only" role="status" aria-live="polite">
              {isClaimingConnectedResolverRewards ? connectedResolverClaimLabel : embeddedResolverClaimLabel}
            </span>
          )}
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">Resolver Rewards</span>
            <span className="text-[8px] text-gray-400">claimable LINEA</span>
          </div>
          <div className="space-y-2">
            {showConnectedResolverRow && connectedWalletAddress && (
              <div className="rounded-lg border border-white/6 bg-black/15 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] text-gray-300 font-semibold">Connected wallet</div>
                    <div className="text-[10px] text-gray-500 truncate">{shortenAddress(connectedWalletAddress)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-emerald-400">{connectedResolverRewards} LINEA</div>
                    <div className="text-[10px] text-gray-500">pending</div>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <UiButton
                    variant="success"
                    size="xs"
                    uppercase
                    loading={isClaimingConnectedResolverRewards}
                    disabled={connectedResolverRewardsWei <= 0n}
                    aria-label={connectedResolverClaimLabel}
                    title={connectedResolverClaimLabel}
                    onClick={onClaimConnectedResolverRewards}
                  >
                    Claim Connected
                  </UiButton>
                </div>
              </div>
            )}

            {showEmbeddedResolverRow && embeddedWalletAddress && (
              <div className="rounded-lg border border-white/6 bg-black/15 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] text-gray-300 font-semibold">Privy wallet</div>
                    <div className="text-[10px] text-gray-500 truncate">{shortenAddress(embeddedWalletAddress)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-emerald-400">{embeddedResolverRewards} LINEA</div>
                    <div className="text-[10px] text-gray-500">pending</div>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <UiButton
                    variant="success"
                    size="xs"
                    uppercase
                    loading={isClaimingEmbeddedResolverRewards}
                    disabled={embeddedResolverRewardsWei <= 0n}
                    aria-label={embeddedResolverClaimLabel}
                    title={embeddedResolverClaimLabel}
                    onClick={onClaimEmbeddedResolverRewards}
                  >
                    Claim Privy
                  </UiButton>
                </div>
              </div>
            )}
          </div>
        </UiPanel>
      )}

      {soundSettings && onSoundSettingChange && (
        <UiPanel tone="subtle" padding="sm" className="animate-slide-up" style={{ animationDelay: "0.02s" }}>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">Sound</span>
            <span className="text-[8px] text-gray-400">when unmuted</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
            {(["bet", "autoBet", "reveal", "win", "myWin", "tick"] as SoundName[]).map((name) => (
              <label
                key={name}
                className="flex items-center gap-2 py-1 rounded cursor-pointer hover:bg-white/3 transition-colors group"
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
                Full visual effects, particles, winner highlights, and transitions across the site.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={animationEnabled}
              aria-label={animationEnabled ? "Disable animation effects" : "Enable animation effects"}
              onClick={() => onReducedMotionChange(animationEnabled)}
              className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                animationEnabled
                  ? "justify-end border-emerald-400/40 bg-emerald-500/20"
                  : "justify-start border-white/10 bg-white/5"
              }`}
            >
              <span className="block h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>
        </UiPanel>
      )}
    </>
  );
}
