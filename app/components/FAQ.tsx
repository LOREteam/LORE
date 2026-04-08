"use client";

import React, { useState, useCallback } from "react";
import { APP_CHAIN_NAME } from "../lib/constants";
import { cn } from "../lib/cn";
import { UiButton } from "./ui/UiButton";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

interface FAQItem {
  q: string;
  a: string | string[];
  category: string;
}

const faqData: FAQItem[] = [
  // ── Getting Started ──
  {
    category: "Getting Started",
    q: "I just opened the site. What do I do first?",
    a: [
      "1. Click 'Login / Connect' in the top-right – you can use email, Google, or an existing wallet.",
      "2. Go to Settings and create an embedded (Privy) wallet if it wasn't created automatically.",
      "3. Send some ETH to your Privy address for gas, and LINEA tokens for betting.",
      "4. You're ready – click any tile on the grid and place your first bet!",
    ],
  },
  {
    category: "Getting Started",
    q: "Where do I get LINEA tokens and ETH for gas?",
    a: [
      `LINEA tokens: get them from a bridge, faucet, or DEX that supports ${APP_CHAIN_NAME}.`,
      `ETH for gas: fund your wallet on ${APP_CHAIN_NAME}. You only need a tiny amount – each bet costs fractions of a cent in gas.`,
    ],
  },
  {
    category: "Getting Started",
    q: "Do I need MetaMask or any extension?",
    a: "No. The site creates an embedded wallet via Privy – it works in any browser with zero extensions. But if you already have MetaMask or another wallet, you can connect it too.",
  },
  {
    category: "Getting Started",
    q: "I see two addresses – which one is mine?",
    a: [
      "The 'Privy' address is your embedded wallet – this is the one that places bets and pays gas. Send ETH and LINEA here.",
      "If you also connected MetaMask/WalletConnect, that's your external wallet. You can use it to deposit/withdraw tokens to/from the Privy wallet via Settings.",
    ],
  },
  {
    category: "Getting Started",
    q: "How fast are transactions on Linea?",
    a: [
      "Very fast. Linea blocks are produced every 2 seconds with 100+ mGas/s sequencer throughput (up to 306 TPS for token transfers).",
      "Your bet typically confirms in the next block – under 2 seconds. Gas costs are extremely low thanks to proof aggregation and data compression on the L2.",
    ],
  },

  // ── Jackpots ──
  {
    category: "Jackpots",
    q: "How do the Daily and Weekly Jackpots work?",
    a: [
      "Every round, 2% of the pool accrues into the Daily Jackpot and 3% into the Weekly Jackpot. These pools grow with every single round.",
      "Once per calendar day (UTC), one random resolved round triggers the daily jackpot – the ENTIRE accumulated daily pool is added to that round's winners on top of the normal 92% reward.",
      "Once per calendar week (Monday–Sunday UTC), one random round triggers the weekly jackpot – same logic, but the weekly pool is typically much larger.",
    ],
  },
  {
    category: "Jackpots",
    q: "When exactly does a jackpot trigger?",
    a: [
      "The contract checks for a jackpot trigger only when a round is resolved AND someone actually bet on the winning tile (there is a real winner).",
      "The probability of triggering is based on how much time is left in the day (or week). Early in the day the chance is low; as the day progresses, the chance increases. By the last round of the day, it's almost guaranteed.",
      "If no round triggers the jackpot today, it simply carries over to tomorrow – the pool keeps growing.",
    ],
  },
  {
    category: "Jackpots",
    q: "Can a jackpot trigger on a round where nobody hit the winning tile?",
    a: "No. Jackpots only trigger when there is at least one winner on the tile. If nobody bet on the winning tile, the base reward (92%) goes into the rollover pool, and the jackpot pools remain untouched – they keep growing for the next eligible round.",
  },
  {
    category: "Jackpots",
    q: "Can both daily and weekly jackpots trigger on the same round?",
    a: "Yes! If conditions are met for both, a single round can award both the daily and weekly jackpot at once. This would be a massive payout for that round's winners.",
  },
  {
    category: "Jackpots",
    q: "Is the jackpot randomness fair?",
    a: [
      "Yes. The trigger uses block.prevrandao – the Ethereum consensus-level randomness beacon. It's not controllable by miners, the team, or any single party.",
      "The probability formula ensures one trigger per day/week on average, with higher chances as the day/week progresses, so jackpots can never 'skip' indefinitely.",
    ],
  },
  {
    category: "Jackpots",
    q: "What is the rollover pool?",
    a: [
      "When nobody bets on the winning tile in a round, the 92% base reward doesn't disappear – it flows into the rollover pool.",
      "The rollover pool is added to the NEXT round's total pool, making it bigger. This cascading effect means that after several no-winner rounds, the pool can become very large.",
      "Note: the rollover only carries the base reward. The 2% daily and 3% weekly jackpot accruals still happen normally – they go to the jackpot pools regardless of whether someone won.",
    ],
  },

  // ── Betting & Strategy ──
  {
    category: "Betting & Strategy",
    q: "Is there a minimum or maximum bet?",
    a: "Minimum bet is 1 LINEA per tile. There's no hard maximum – bet as much as you want, but keep in mind that a large bet on a single tile only pays off if that tile wins.",
  },
  {
    category: "Betting & Strategy",
    q: "Should I bet on one tile or spread across many?",
    a: [
      "One tile = high risk, high reward. If it wins, you keep a bigger share because fewer tokens compete on that tile.",
      "Many tiles = lower risk, lower reward per tile. You're more likely to hit the winner but your payout is split.",
      "On the mining grid (Hub), each tile shows how much is staked and how many players bet on it – tiles with fewer bets from others give better odds if they win.",
    ],
  },
  {
    category: "Betting & Strategy",
    q: "Can I cancel or change a bet after placing it?",
    a: "No. Once a bet is on-chain, it's final. Double-check the tile and amount before clicking.",
  },
  {
    category: "Betting & Strategy",
    q: "What happens to my bet if no one bets on the winning tile?",
    a: [
      "The 92% base reward rolls over to the next epoch, making the next round's pool bigger. The jackpot accruals (2% + 3%) still go to the jackpot pools as normal.",
      "Your losing bet is already part of the pool – it feeds winners, jackpots, and rollover. Eventually someone will hit the winning tile and collect.",
    ],
  },
  {
    category: "Betting & Strategy",
    q: "Does the Auto-Miner give better odds than manual play?",
    a: "No. Auto-Miner picks tiles randomly – it doesn't have any edge. Its advantage is convenience: set it up, walk away, and it plays hundreds of rounds for you without clicking. More rounds = more chances to be in a jackpot round.",
  },
  {
    category: "Betting & Strategy",
    q: "What's the fee breakdown on each round?",
    a: [
      "92% – base reward for winners (+ rollover + jackpot if triggered)",
      "2% – accrues to the Daily Jackpot pool",
      "3% – accrues to the Weekly Jackpot pool",
      "2% – protocol fee: half to treasury, half to participation rebates",
      "1% – permanently burned (sent to 0x...dEaD)",
    ],
  },

  // ── Troubleshooting ──
  {
    category: "Troubleshooting",
    q: "My bet transaction failed. What happened?",
    a: [
      "Common reasons: not enough ETH for gas, not enough LINEA tokens, or the epoch ended between your click and the transaction landing on-chain.",
      "Fix: make sure your Privy wallet has ETH (for gas) and LINEA (for the bet). Bet earlier in the epoch – don't wait until the last 2–3 seconds.",
    ],
  },
  {
    category: "Troubleshooting",
    q: "The timer says 00:00 but nothing is happening.",
    a: "The epoch is waiting to be resolved. This happens automatically within a few seconds – the site and a keeper bot both try to resolve it. If it takes longer than 10s, try refreshing the page.",
  },
  {
    category: "Troubleshooting",
    q: "I won but my balance didn't change.",
    a: "Rewards are not auto-deposited – you need to claim them. Check the Reward Scanner in the sidebar (or under the grid on mobile). It shows unclaimed wins. Click 'Claim' or 'Claim All'.",
  },
  {
    category: "Troubleshooting",
    q: "Auto-Miner stopped mid-run. Why?",
    a: [
      "Usually: insufficient balance. The bot checks your token balance before each round and stops if you can't cover the next bet.",
      "Less common: a session timeout (Privy tokens expired). Refresh the page – Auto-Miner remembers its settings and you can restart where it left off.",
    ],
  },
  {
    category: "Troubleshooting",
    q: "I see 'execution reverted' errors in the console.",
    a: "This is usually harmless – it means someone else (the keeper bot) resolved the epoch a split second before your browser tried. The site handles this silently. Your bets are not affected.",
  },
  {
    category: "Troubleshooting",
    q: "The site is slow or tiles aren't updating.",
    a: "The game polls the blockchain every ~1 second. If Linea RPC is congested, updates may lag. Try: hard refresh (Ctrl+Shift+R), switch to a different RPC endpoint if you're self-hosting, or just wait a few seconds.",
  },
  {
    category: "Troubleshooting",
    q: "Where is Export Logs?",
    a: "Export Logs is in Wallet Settings. When logged in, click Settings in the wallet area (top-right) → the Export Logs button is in the header of the modal, next to Close. It downloads a text file with session logs (useful for debugging or when contacting support).",
  },

  // ── Wallet & Security ──
  {
    category: "Wallet & Security",
    q: "Can I export my private key?",
    a: "Yes. Go to Settings → your Privy wallet has an 'Export Private Key' option. Store it safely – anyone with this key can control your funds.",
  },
  {
    category: "Wallet & Security",
    q: "What if I lose access to my account?",
    a: "If you logged in via email or social, you can recover by logging in again the same way. Your embedded wallet is tied to your Privy account, not your browser. If you exported your private key, you can always import it into MetaMask.",
  },
  {
    category: "Wallet & Security",
    q: "Is there an approval / allowance risk?",
    a: "The site asks you to approve the game contract to spend LINEA tokens. You can revoke this approval at any time via Settings or any on-chain tool like Revoke.cash. The contract cannot withdraw more than you approved.",
  },
  {
    category: "Wallet & Security",
    q: "Can the developer rug-pull the prize pool?",
    a: "No. The contract has no admin withdrawal function. Funds can only go to winners (via claimReward), to the jackpot pools (automatically), or roll over to the next epoch. The contract code is verifiable on-chain.",
  },
  {
    category: "Wallet & Security",
    q: "Are the jackpot pools safe? Can they be drained?",
    a: [
      "The jackpot pools are stored as state variables inside the smart contract. There is no function to withdraw them manually – they can only be awarded to winners when a jackpot triggers on-chain.",
      "The contract uses ReentrancyGuard and SafeERC20 for all transfers. No one – not even the owner – can drain the jackpot pools.",
    ],
  },

  // ── Chat & Social ──
  {
    category: "Chat & Social",
    q: "How do I set my chat name and avatar?",
    a: "Open the chat widget (bottom-right corner), click the gear icon. You can set a custom name and upload an avatar. Your profile is linked to your wallet and synced to chat profile storage, so it restores even after local cache clear.",
  },
  {
    category: "Chat & Social",
    q: "Is the chat on-chain?",
    a: "No. Chat is powered by Firebase for speed and free messaging. It's separate from the game logic. Your bets and rewards are always on-chain – chat is just social.",
  },
  {
    category: "Chat & Social",
    q: "How do leaderboard names work?",
    a: "The leaderboard checks if you've set a chat nickname on the site. If yes, it shows your name with a '(site)' label and your shortened address. Otherwise it just shows the address.",
  },
];

const categories = [...new Set(faqData.map((f) => f.category))];

const categoryIcons: Record<string, string> = {
  "Getting Started": "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z",
  "Jackpots": "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "Betting & Strategy": "M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605",
  "Troubleshooting": "M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l5.653-4.655m5.976-5.976l4.655-5.653a2.548 2.548 0 113.586 3.586l-5.653 4.655M3 3l18 18",
  "Wallet & Security": "M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z",
  "Chat & Social": "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155",
};

export const FAQ = React.memo(function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]);

  const toggle = useCallback((i: number) => {
    setOpenIdx((prev) => (prev === i ? null : i));
  }, []);

  const filteredFaq = faqData.filter((f) => f.category === activeCategory);

  return (
    <div className="flex-1 overflow-y-auto pb-24 animate-fade-in">
      <div className="max-w-3xl mx-auto px-4 md:px-8">
        {/* Hero */}
        <div className="relative py-5 text-center">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/[0.04] to-transparent rounded-2xl" />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-synced-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400">Quick Answers</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-[0.12em] animate-text-glow">
              <span className="text-white">F</span><span className="text-violet-400">AQ</span>
            </h1>
            <p className="mt-3 text-sm text-gray-500 max-w-md mx-auto">
              Practical answers to real questions. For the full mechanics and lore, see the White Paper.
            </p>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {categories.map((cat) => (
            <UiButton
              key={cat}
              onClick={() => { setActiveCategory(cat); setOpenIdx(null); }}
              variant={activeCategory === cat ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold",
                activeCategory === cat
                  ? "text-violet-300 border-violet-500/30 shadow-sm shadow-violet-500/10"
                  : "text-gray-500 border-white/[0.06] hover:text-gray-300 hover:bg-white/[0.04]",
              )}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={categoryIcons[cat] || categoryIcons["Getting Started"]} />
              </svg>
              {cat}
            </UiButton>
          ))}
        </div>

        {/* Questions */}
        <div className="space-y-2">
          {filteredFaq.map((item, i) => {
            const isOpen = openIdx === i;
            const panelId = `faq-panel-${activeCategory}-${i}`;
            return (
              <UiPanel
                key={`${activeCategory}-${i}`}
                tone="subtle"
                padding="sm"
                className={cn(`transition-all duration-300 ${
                  isOpen
                    ? "bg-violet-500/[0.06] border-violet-500/20 shadow-lg shadow-violet-500/[0.04]"
                    : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                }`)}
              >
                <button
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={`w-full flex items-center gap-3 px-5 py-4 text-left ${uiTokens.focusRing} ${uiTokens.radius.sm}`}
                >
                  <svg
                    className={`w-4 h-4 shrink-0 transition-transform duration-300 ${
                      isOpen ? "rotate-45 text-violet-400" : "text-gray-400"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span className={`text-sm font-semibold ${isOpen ? "text-violet-300" : "text-gray-300"}`}>
                    {item.q}
                  </span>
                </button>

                <div
                  id={panelId}
                  role="region"
                  aria-hidden={!isOpen}
                  className={`overflow-hidden transition-all duration-300 ${
                    isOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="px-5 pb-5 pl-12">
                    {Array.isArray(item.a) ? (
                      <div className="space-y-2">
                        {item.a.map((line, j) => (
                          <p key={`${activeCategory}-${i}-${j}`} className="text-sm text-gray-400 leading-relaxed">{line}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 leading-relaxed">{item.a}</p>
                    )}
                  </div>
                </div>
              </UiPanel>
            );
          })}
        </div>
      </div>
    </div>
  );
});
