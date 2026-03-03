"use client";

import React, { useState } from "react";
import { shortenAddress } from "../lib/utils";
import { processingQuotes, loadingQuotes } from "../lib/loreTexts";
import { LoreText } from "./LoreText";
import { cn } from "../lib/cn";
import { UiButton } from "./ui/UiButton";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

interface ReferralPanelProps {
  address?: string;
  referralLink: string | null;
  referralInfo: {
    referrer: string | null;
    code: string | null;
    pendingEarnings: string;
    pendingEarningsWei: bigint;
    totalEarnings: string;
    referredUsers: number;
  } | null;
  isRegistering: boolean;
  isClaiming: boolean;
  isSettingReferrer: boolean;
  onRegisterCode: () => Promise<void>;
  onClaimEarnings: () => Promise<void>;
  onCopyLink: () => Promise<void>;
}

export const ReferralPanel = React.memo(function ReferralPanel({
  address,
  referralLink,
  referralInfo,
  isRegistering,
  isClaiming,
  isSettingReferrer,
  onRegisterCode,
  onClaimEarnings,
  onCopyLink,
}: ReferralPanelProps) {
  const [copied, setCopied] = useState(false);
  const hasCode = !!referralInfo?.code;
  const hasPending = referralInfo?.pendingEarningsWei != null && referralInfo.pendingEarningsWei > BigInt(0);

  const handleCopy = async () => {
    await onCopyLink();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto pb-12 animate-fade-in">
      <div className="max-w-2xl mx-auto px-4 md:px-8 pt-6">
        {/* Header */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 mb-4 animate-slide-up">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-synced-pulse" />
            <span className="text-[10px] font-bold text-violet-400 uppercase tracking-widest">Referral Program</span>
          </div>
          <h1 className="text-2xl font-black text-white mb-2 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            Invite Friends, Earn Rewards
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed animate-slide-up" style={{ animationDelay: "0.1s" }}>
            Share your referral code and earn <span className="text-violet-400 font-bold">1%</span> of every bet your referrals place.
            Half of the 2% dev fee goes to referrers – accumulated automatically, claimed whenever you want.
          </p>
        </div>

        {/* How it works */}
        <UiPanel
          tone="default"
          className="mb-4 animate-slide-up"
          style={{ animationDelay: "0.15s" }}
        >
          <h2 className={`${uiTokens.sectionLabel} text-white mb-3`}>How it works</h2>
          <div className="space-y-3">
            <Step n="1" title="Register your code" desc="Click the button below to generate a unique referral code on-chain. One code per wallet." />
            <Step n="2" title="Share the link" desc="Copy your referral link and send it to friends. The link contains your code, not your address." />
            <Step n="3" title="They connect & play" desc="When someone opens your link and connects their wallet, your code is set as their referrer on-chain." />
            <Step n="4" title="Earnings accumulate" desc="Every round, 1% of the pool is split among referrers proportionally to their referrals' bets." />
            <Step n="5" title="Claim anytime" desc="Your earnings accumulate in the contract. Click Claim to withdraw whenever you want." />
          </div>
        </UiPanel>

        {!address ? (
          <UiPanel
            tone="default"
            className="mb-4 animate-slide-up"
            style={{ animationDelay: "0.2s" }}
          >
            <p className="text-sm text-gray-500 text-center py-4">Connect your wallet to get started.</p>
          </UiPanel>
        ) : !hasCode ? (
          /* No code yet – register */
          <UiPanel
            tone="default"
            className="mb-4 animate-slide-up"
            style={{ animationDelay: "0.2s" }}
          >
            <h2 className={`${uiTokens.sectionLabel} text-white mb-2`}>Step 1: Register Your Code</h2>
            <p className="text-[11px] text-gray-500 mb-3">
              Generate a unique referral code linked to your wallet. This is a one-time on-chain transaction.
            </p>
            <UiButton
              onClick={onRegisterCode}
              loading={isRegistering}
              variant="primary"
              size="md"
              uppercase
              className="px-5 text-xs"
            >
              {isRegistering ? <LoreText items={processingQuotes} /> : "Generate Referral Code"}
            </UiButton>
          </UiPanel>
        ) : (
          /* Has code – show link + stats */
          <>
            <UiPanel
              tone="default"
              className="mb-4 animate-slide-up"
              style={{ animationDelay: "0.2s" }}
            >
              <h2 className={`${uiTokens.sectionLabel} text-white mb-1`}>Your Referral Code</h2>
              <div className="text-lg font-black text-violet-400 font-mono mb-3 tracking-widest">{referralInfo!.code!.toUpperCase()}</div>
              <h2 className={`${uiTokens.sectionLabel} text-white mb-2`}>Your Referral Link</h2>
              <div className="flex gap-2">
                <div className="flex-1 bg-[#0a0a16] px-3 py-2.5 rounded-lg border border-violet-500/15 text-xs text-gray-300 font-mono truncate">
                  {referralLink ?? "Loading..."}
                </div>
                <UiButton
                  onClick={handleCopy}
                  disabled={!referralLink}
                  variant="primary"
                  size="md"
                  uppercase
                  className="px-4 text-xs"
                >
                  {copied ? "Copied!" : "Copy"}
                </UiButton>
              </div>
            </UiPanel>

            {/* Earnings + Claim */}
            <UiPanel
              tone="success"
              className="mb-4 animate-slide-up"
              style={{ animationDelay: "0.25s" }}
            >
              <h2 className={`${uiTokens.sectionLabel} text-white mb-3`}>Earnings</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-[8px] font-bold uppercase tracking-widest text-gray-600 mb-0.5">Pending (claimable)</div>
                  <div className="text-xl font-black text-emerald-400">{parseFloat(referralInfo!.pendingEarnings).toFixed(4)} LINEA</div>
                </div>
                <div>
                  <div className="text-[8px] font-bold uppercase tracking-widest text-gray-600 mb-0.5">Total earned (all time)</div>
                  <div className="text-xl font-black text-violet-400">{parseFloat(referralInfo!.totalEarnings).toFixed(4)} LINEA</div>
                </div>
              </div>
              <UiButton
                onClick={onClaimEarnings}
                loading={isClaiming}
                disabled={!hasPending}
                variant="success"
                size="md"
                uppercase
                fullWidth
                className="text-xs"
              >
                {isClaiming ? "Claiming..." : hasPending ? "Claim Earnings" : "Nothing to claim"}
              </UiButton>
            </UiPanel>
          </>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-4 animate-slide-up" style={{ animationDelay: "0.3s" }}>
          <StatBox label="Referred Users" value={referralInfo?.referredUsers?.toString() ?? "0"} accent="violet" />
          <StatBox
            label="Your Referrer"
            value={referralInfo?.referrer ? shortenAddress(referralInfo.referrer) : "None"}
            accent="sky"
          />
        </div>

        {isSettingReferrer && (
          <div className={`flex items-center gap-2 px-3 py-2 ${uiTokens.radius.sm} bg-sky-500/10 border border-sky-500/25 text-sky-400 text-xs font-bold uppercase tracking-wider mb-4 animate-slide-up`}>
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <LoreText items={loadingQuotes} />
          </div>
        )}

        {/* FAQ */}
        <UiPanel
          tone="default"
          className="animate-slide-up"
          style={{ animationDelay: "0.35s" }}
        >
          <h2 className={`${uiTokens.sectionLabel} text-white mb-3`}>FAQ</h2>
          <div className="space-y-3">
            <Faq q="How much do I earn?" a="You earn a share of 1% of the total pool each round, proportional to how much your referrals bet." />
            <Faq q="When can I claim?" a="Anytime. Earnings accumulate in the contract and you withdraw whenever you want." />
            <Faq q="Is my address visible in the link?" a="No. The link contains only a short hex code. Your wallet address stays private." />
            <Faq q="Can I change my referrer?" a="No. Referrer is set once per wallet and stored permanently on-chain." />
            <Faq q="Does it work with both Privy and external wallets?" a="Yes. The referrer is bound to whatever wallet address you use when connecting via the link." />
          </div>
        </UiPanel>
      </div>
    </div>
  );
});

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-6 h-6 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0 mt-0.5`}>
        <span className="text-[10px] font-black text-violet-400">{n}</span>
      </div>
      <div>
        <div className="text-xs font-bold text-white">{title}</div>
        <div className="text-[11px] text-gray-500 leading-relaxed">{desc}</div>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    violet: "border-violet-500/25 text-violet-400 bg-violet-500/[0.04]",
    emerald: "border-emerald-500/25 text-emerald-400 bg-emerald-500/[0.04]",
    sky: "border-sky-500/25 text-sky-400 bg-sky-500/[0.04]",
  };
  return (
    <div className={cn("p-3 border", uiTokens.radius.md, colors[accent])}>
      <div className="text-[8px] font-bold uppercase tracking-widest text-gray-600 mb-1">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="text-xs font-bold text-gray-300 mb-0.5">{q}</div>
      <div className="text-[11px] text-gray-500 leading-relaxed">{a}</div>
    </div>
  );
}
