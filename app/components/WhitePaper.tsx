"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "../lib/cn";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

/* ═══════════════════════════════════════════
   LORE White Paper – fully animated, single-page
   ═══════════════════════════════════════════ */

const CONTRACT = "0xa230...7d36";
const TOKEN = "0x6F17...F180";

export const WhitePaper = React.memo(function WhitePaper() {
  return (
    <div className="flex-1 overflow-y-auto pb-24 animate-fade-in">
      <div className="max-w-3xl mx-auto px-4 md:px-8">
        <Hero />
        <Divider />

        {/* ═══ LORE PROLOGUE ═══ */}
        <section className="relative py-8 mb-4 overflow-hidden animate-fade-in">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/[0.03] to-transparent rounded-2xl" />
          <div className="absolute inset-0 lore-hex-pattern opacity-[0.02]" />
          <div className="relative z-10 px-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] lore-text-shimmer">Prologue – The Crystal Lattice</span>
            </div>
            <div className="float-left w-44 h-36 shrink-0 mr-4 mb-3 rounded-xl border border-violet-500/20 lore-avatar-glow overflow-hidden">
              <Image
                src="/kael-hero.png"
                alt="KAEL – The First Miner"
                width={176}
                height={144}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
              <p>
                Deep beneath the <Accent>Linea blockchain</Accent> lies the <B>Crystal Lattice</B> – an infinite network
                of crystalline veins pulsing with raw ORE energy. Formed when the genesis block was forged, the Lattice is
                a living grid that breathes with each new transaction, its veins shifting and realigning in patterns no algorithm
                can predict.
              </p>
              <p>
                Legend speaks of <span className="text-violet-300 font-semibold">KAEL</span> – the First Miner – who discovered
                the Lattice while tracing the deepest roots of the chain. When KAEL touched the first crystal node, the ORE
                responded – and merged with the miner. Part digital, part ethereal, KAEL became the guardian of the veins,
                a spectral figure whose crystal pickaxe still resonates through every epoch.
              </p>
            </div>
            <div className="clear-left space-y-3 text-sm text-gray-400 leading-relaxed pt-1">
              <p>
                Every epoch, the Lattice shifts. 25 nodes flicker in the darkness – fragments of the grid, each hiding
                a potential vein of concentrated ORE. One of them glows brighter than the rest: the <B>resonant node</B>.
                Miners who stake their claim on that node share the epoch&apos;s harvest. The rest sharpen their instinct
                for the next shift.
              </p>
              <blockquote className="text-xs text-gray-500 italic border-l-2 border-violet-500/20 pl-4 py-2 my-4">
                &quot;The chain remembers every miner. The Lattice rewards the bold. I was the first to hear its hum – but I will not be the last. Place your stake. Trust your instinct. The ORE awaits.&quot;
                <cite className="block mt-2 text-violet-400/60 font-medium tracking-wider text-[10px] not-italic">– KAEL</cite>
              </blockquote>
            </div>
          </div>
        </section>

        <Divider />
        <Section id="intro" badge="01" title="Introduction" icon={IntroIcon} delay={0}>
          <P>
            <B>LORE</B> (Linea + ORE) is a fully on-chain prediction mining game deployed on <Accent>Linea</Accent>.
            Players place bets on a 5×5 grid of &quot;mine blocks.&quot; Each round (epoch), one winning tile is randomly selected
            by the smart contract. If your bet is on the winning tile – you take a proportional share of the entire round&apos;s reward pool.
          </P>
          <P>
            On top of the base reward, <Accent>LORE V6</Accent> introduces a <B>dual jackpot system</B>: a <Accent>Daily Jackpot</Accent> (2%) and a <Accent>Weekly Jackpot</Accent> (3%).
            Every round, a portion of the pool accrues into these jackpot reserves. Once per day and once per week, one lucky round
            triggers the jackpot – and the <B>entire accumulated jackpot pool</B> is added to that round&apos;s winners.
          </P>
          <P>
            Every bet, every payout, every jackpot trigger, and every winner selection is verifiable on-chain.
            No off-chain randomness, no hidden admin functions – pure decentralized gaming with escalating tension.
          </P>
          <InfoBox emoji="🎲" title="How Randomness Is Generated">
            Winning tile uses only on-chain entropy:
            <Code>keccak256(prevrandao, blockhash(n-1), epoch, totalPoolWithRollover, dailyPool, weeklyPool) % 25 + 1</Code>.
            <br /><br />
            Daily and weekly jackpots use separate random checks:
            <Code>keccak256(prevrandao, &quot;daily/weekly&quot;, epoch, lastCheck, block.timestamp)</Code>,
            then compare randomness against elapsed time in the current day/week window.
          </InfoBox>
          <InfoBox emoji="⛏" title="Core Idea">
            Place your LINEA tokens on tiles you believe will win. The more you stake on a winning tile – the bigger your share of the prize pool.
            And if you&apos;re in the right round at the right time, you might take home the <Accent>jackpot</Accent> too.
          </InfoBox>
        </Section>

        <Divider />

        <Section id="how" badge="02" title="How It Works" icon={GearIcon} delay={0.05}>
          <Timeline items={[
            { step: "1", title: "Epoch Starts", desc: "A new round begins with a fresh 5×5 grid. The countdown timer starts." },
            { step: "2", title: "Place Bets", desc: "Select one or more tiles and stake LINEA tokens. Each tile accumulates its own pool from all players." },
            { step: "3", title: "Epoch Ends", desc: "When the timer reaches zero, no more bets are accepted. The smart contract resolves the epoch." },
            { step: "4", title: "Winner Revealed", desc: "The contract computes the winning tile from on-chain entropy (prevrandao + previous block hash + epoch/pool state) and maps it to 1–25." },
            { step: "5", title: "Fees Split", desc: "The pool is split: 92% to winners, 2% to daily jackpot, 3% to weekly jackpot, 2% protocol fee (half to treasury, half to player rebates), 1% burn." },
            { step: "6", title: "Jackpot Check", desc: "If there is at least one winner, the contract runs daily/weekly random checks using prevrandao + time window variables. On trigger, the full jackpot pool is added to this epoch." },
            { step: "7", title: "Claim Rewards", desc: "Winners claim their share via the Reward Scanner. If no one hit the winning tile – the base reward rolls into the next round, and jackpot pools keep growing." },
          ]} />
        </Section>

        <Divider />

        <Section id="tokenomics" badge="03" title="Tokenomics & Fee Split" icon={TokenIcon} delay={0.1}>
          <P>
            LORE uses the <Accent>LINEA token</Accent> for all in-game operations.
            Every round&apos;s total pool (all bets + rollover from previous no-winner rounds) is split as follows:
          </P>
          <Grid2>
            <StatCard label="Winners" value="92%" sub="base reward to winning-tile holders" color="emerald" />
            <StatCard label="Daily Jackpot" value="2%" sub="accrues every round, triggers once/day" color="amber" />
            <StatCard label="Weekly Jackpot" value="3%" sub="accrues every round, triggers once/week" color="sky" />
            <StatCard label="Protocol + Burn" value="3%" sub="2% protocol fee (1% treasury, 1% rebates), 1% burn" color="violet" />
          </Grid2>
          <InfoBox emoji="🎰" title="Dual Jackpot System">
            Every round, 2% feeds the <Accent>Daily Jackpot</Accent> pool and 3% feeds the <Accent>Weekly Jackpot</Accent> pool.
            These pools accumulate across all rounds until a jackpot triggers.
            <br /><br />
            <B>Daily Jackpot</B> – once per calendar day (UTC), one random resolved round with a winner triggers the daily jackpot.
            The <B>entire accumulated daily pool</B> is added to that round&apos;s reward, on top of the normal 92%.
            <br /><br />
            <B>Weekly Jackpot</B> – once per calendar week (Monday 00:00 UTC to Sunday 23:59 UTC), one random round triggers the weekly jackpot.
            Same logic: the entire weekly pool goes to that round&apos;s winning-tile holders.
            <br /><br />
            If nobody bet on the winning tile in a round, the base reward (92%) goes back into the <Accent>rollover pool</Accent>, and jackpot pools keep growing – no jackpot can trigger without a real winner.
            This means jackpots can only get <B>bigger</B> over time.
          </InfoBox>
          <InfoBox emoji="🔥" title="Burn & Rebate Fee">
            1% of every round is permanently burned (sent to <Code>0x...dEaD</Code>), reducing supply forever.
            2% goes to protocol accounting: half to treasury and half to a participation rebate pool distributed in LINEA to players who bet in that round.
          </InfoBox>
          <P>
            No one can print new tokens, freeze transfers, or blacklist your wallet – the token is simple and predictable.
            When you play, you only grant the game permission to spend; your tokens stay in your wallet until you actually
            place a bet. The contract takes exactly that amount – nothing more, and nothing in advance.
          </P>
        </Section>

        <Divider />

        <Section id="grid" badge="04" title="The Mining Grid" icon={GridIcon} delay={0.15}>
          <P>
            The grid is a 5×5 matrix of 25 &quot;mine tiles,&quot; numbered <Code>#1</Code> through <Code>#25</Code>.
            Each tile displays:
          </P>
          <ul className="space-y-2 mb-6 ml-1">
            <Li emoji="🟢">The total LINEA staked by all players on that tile</Li>
            <Li emoji="👥">The number of unique players who bet on it</Li>
            <Li emoji="💚">A green border if YOU have placed a bet on it</Li>
            <Li emoji="💜">A purple glow if the tile is currently selected (pending bet)</Li>
          </ul>
          <p className="text-[10px] text-gray-500 mb-2">The diagram below shows all five states; selected, round winner, and your win tiles use a subtle pulse.</p>
          <MiniGrid />
        </Section>

        <Divider />

        <Section id="autominer" badge="05" title="Auto-Miner Bot" icon={BotIcon} delay={0.2}>
          <P>
            The built-in <B>Auto-Miner</B> lets you fully automate your betting strategy.
            Configure it once and let it run for hundreds of rounds:
          </P>
          <Grid2>
            <FeatureCard icon="⚡" title="Bet Size" desc="Set LINEA tokens per tile per round" />
            <FeatureCard icon="🎯" title="Targets" desc="Number of random tiles per round (1–25)" />
            <FeatureCard icon="🔄" title="Cycles" desc="Total rounds to auto-bet (1–∞)" />
            <FeatureCard icon="💾" title="Persistence" desc="Survives page reload via localStorage" />
          </Grid2>
          <InfoBox emoji="🤖" title="How the Bot Works">
            On each cycle, the bot randomly selects N tiles, places batch bets via Privy&apos;s
            embedded wallet (no popups), waits for the next epoch, and repeats. All settings are persisted and
            the session resumes automatically after a page refresh.
          </InfoBox>
          <P>
            The bot checks your LINEA balance before every round and stops gracefully if funds run low.
            A balance warning appears in the panel when <Code>Total Required &gt; Balance</Code>.
          </P>
        </Section>

        <Divider />

        <Section id="rebate" badge="06" title="Participation Rebate" icon={RefIcon} delay={0.25}>
          <P>
            LORE V6 uses an on-chain <Accent>participation rebate</Accent> instead of referrals. A portion of every epoch is reserved
            for players who actually spent gas and placed bets in that round.
          </P>
          <Grid2>
            <FeatureCard icon="⛏" title="Bet To Earn" desc="Every player who bets in an epoch becomes eligible for that epoch's rebate share." />
            <FeatureCard icon="📊" title="Volume Based" desc="The rebate is split proportionally to your total LINEA volume in that epoch." />
            <FeatureCard icon="💰" title="1% Rebate Pool" desc="Half of the 2% protocol fee is reserved for players instead of referrals." />
            <FeatureCard icon="🏦" title="Claim Anytime" desc="Rebates accumulate in the contract and can be claimed later in batches." />
          </Grid2>
          <InfoBox emoji="🤝" title="How Participation Rebate Works">
            Each round, 2% of the pool goes to protocol accounting. Half of that stays with treasury, and the other half
            becomes the epoch rebate pool. After the epoch resolves, every player can claim their LINEA rebate in
            proportion to how much they personally staked in that round.
          </InfoBox>
          <P>
            To collect it, go to the <Accent>Rebate</Accent> tab. The UI shows your pending rebate, claimable epochs, and recent
            rounds where you earned a LINEA bonus back from protocol fees.
          </P>
        </Section>

        <Divider />

        <Section id="privy" badge="07" title="Privy Embedded Wallet" icon={WalletIcon} delay={0.3}>
          <P>
            LORE uses <Accent>Privy</Accent> for authentication and an embedded wallet for popup-free transactions.
            To place bets you need both <Accent>LINEA tokens</Accent> (for stakes) and <Accent>ETH</Accent> on the Privy wallet (for gas) – deposit both to get started.
          </P>
          <P>This means:</P>
          <ul className="space-y-2 mb-6 ml-1">
            <Li emoji="🔐">Login with email, social, or existing wallet</Li>
            <Li emoji="👻">No external wallet popups during auto-mining – the embedded wallet signs in the background</Li>
            <Li emoji="⛽">Gas is paid from the embedded wallet&apos;s ETH balance – top up ETH to pay for transaction fees</Li>
            <Li emoji="🔑">You can export your private key at any time</Li>
            <Li emoji="🔄">Switch between embedded and external wallets</Li>
            <Li emoji="💸">Withdraw LINEA tokens to your connected wallet (the one you use for deposits)</Li>
          </ul>
          <InfoBox emoji="🛡" title="Security Model">
            The embedded wallet&apos;s private key is encrypted and managed by Privy&apos;s infrastructure.
            Only you can sign transactions. The game contract never has custody of your tokens beyond
            the approved allowance. You can revoke approval at any time.
          </InfoBox>
        </Section>

        <Divider />

        <Section id="contract" badge="08" title="Smart Contracts" icon={ContractIcon} delay={0.35}>
          <P>
            LORE is currently served by the live V6 deployment on <Accent>Linea</Accent>:
          </P>
          <div className="space-y-3 mb-6">
            <ContractCard
              name="Game Contract (LineaOreV6 live)"
              address={CONTRACT}
              functions={["placeBet()", "placeBatchBets()", "claimReward()", "resolveEpoch()", "claimEpochRebate()", "claimEpochsRebate()", "getJackpotInfo()", "getRebateSummary()"]}
            />
            <ContractCard
              name="LINEA Token"
              address={TOKEN}
              functions={["approve()", "transfer()", "balanceOf()", "allowance()"]}
            />
          </div>
          <P>
            Key contract features:
          </P>
          <ul className="space-y-2 mb-6 ml-1">
            <Li emoji="🎲">Verifiable winner randomness: <Code>keccak256(prevrandao, blockhash(n-1), epoch, totalPoolWithRollover, dailyPool, weeklyPool) % 25 + 1</Code></Li>
            <Li emoji="🔒">No admin withdrawal functions – funds are only claimable by winners via <Code>claimReward()</Code></Li>
            <Li emoji="📊"><Code>getTileData()</Code> returns all 25 tiles&apos; stake totals in one call; per-tile player counts are derived off-chain from bet events</Li>
            <Li emoji="⏰">Epoch end times enforced on-chain – no bets after the deadline</Li>
            <Li emoji="🎰">Daily/weekly jackpot trigger uses on-chain hazard checks with <Code>keccak256(prevrandao, &quot;daily/weekly&quot;, epoch, lastCheck, block.timestamp)</Code></Li>
            <Li emoji="♻️">Rollover: if nobody hit the winning tile, the 92% base reward flows into the <Code>rolloverPool</Code>, inflating the next round</Li>
            <Li emoji="🛡">ReentrancyGuard on all state-changing functions; SafeERC20 for all token transfers</Li>
            <Li emoji="📅">Weekly jackpot uses Monday-based weeks (Monday 00:00 UTC start) via <Code>MONDAY_OFFSET</Code></Li>
          </ul>
          <InfoBox emoji="🔍" title="Provable Randomness (Winner + Jackpots)">
            The winner tile and jackpot trigger checks are computed inside the smart contract at resolve time using only on-chain data.
            The winner tile hash mixes <Code>block.prevrandao</Code>, previous block hash, epoch id, and live pool state.
            Daily and weekly jackpots use separate random checks against elapsed time windows (<Code>elapsed / remaining</Code> hazard model),
            so they are not fixed by round count and cannot be manually forced by UI or backend.
          </InfoBox>
        </Section>

        <Divider />

        <Section id="reward" badge="09" title="Reward Calculation" icon={CalcIcon} delay={0.4}>
          <P>
            When you bet on the winning tile, your reward is calculated as:
          </P>
          <FormulaBlock />
          <P>
            The <Accent>rewardPool</Accent> = 92% of the total pool (all bets + rollover from previous no-winner rounds).
            If a jackpot triggers on your round, the entire accumulated jackpot pool is <B>added on top</B>.
          </P>
          <P>
            Example: the pool is <Accent>100 LINEA</Accent>, you bet <Accent>10 LINEA</Accent> on the winning tile,
            and the total staked on that tile is <Accent>40 LINEA</Accent>. Base reward: <Code>92 × 10 / 40 = 23 LINEA</Code>.
            If the daily jackpot of <Accent>50 LINEA</Accent> triggers on this round, you also get <Code>50 × 10 / 40 = 12.5 LINEA</Code> extra – total <B>35.5 LINEA</B>.
          </P>
          <InfoBox emoji="📈" title="Strategy Tips">
            With 25 tiles and uniform betting, each tile has a ~4% chance of winning.
            Strategic players can analyze tile distribution (via Analytics) and concentrate
            bets on underpopulated tiles for better odds and higher payouts.
            The jackpot adds an extra layer: every winning round has a chance to also trigger the jackpot.
            Play consistently – the more rounds you win, the higher your chance of being in a jackpot round.
          </InfoBox>
        </Section>

        <Divider />

        <Section id="analytics" badge="10" title="Analytics Module" icon={ChartIcon} delay={0.45}>
          <P>
            The <B>Analytics</B> tab shows the last 40 rounds (recent history):
          </P>
          <ul className="space-y-2 mb-6 ml-1">
            <Li emoji="📋">Round ID, status (Done / Pending), and winning tile number</Li>
            <Li emoji="💰">Total pool size for each round</Li>
            <Li emoji="⭐">Personal win indicator – see which rounds YOU won</Li>
            <Li emoji="📊">Last 40 rounds are loaded automatically</Li>
          </ul>
          <P>
            Use this data to identify patterns, track your win rate, and optimize your strategy.
          </P>
        </Section>

        <Divider />

        <Section id="infrastructure" badge="11" title="Linea Infrastructure" icon={InfraIcon} delay={0.5}>
          <P>
            LORE is deployed on <Accent>Linea</Accent> – one of the highest-performance Ethereum L2 networks.
            In February 2026, Linea&apos;s sequencer achieved <B>100+ mGas/s sustained throughput</B> with peaks of <B>218 mGas/s</B>,
            positioning it among the fastest institutional-grade L2 sequencers in the ecosystem.
          </P>
          <Grid2>
            <StatCard label="Block Time" value="2s" sub="near-instant bet confirmation" color="violet" />
            <StatCard label="Throughput" value="100+ mGas/s" sub="sustained sequencer capacity" color="emerald" />
            <StatCard label="Peak TPS" value="456" sub="simple transfers per second" color="amber" />
            <StatCard label="ERC-20 TPS" value="306" sub="token operations per second" color="sky" />
          </Grid2>
          <P>
            What this means for LORE players:
          </P>
          <ul className="space-y-2 mb-6 ml-1">
            <Li emoji="⚡">Bets land in the next block – typically under 2 seconds</Li>
            <Li emoji="🛡">Batch bets (<Code>placeBatchBets</Code>) settle reliably even under network load</Li>
            <Li emoji="💸">Gas costs remain low thanks to proof aggregation and data compression (up to 90% cheaper finalization vs. earlier versions)</Li>
            <Li emoji="🔒">Phylax Credible Layer integration (Jan 2026) adds proactive exploit prevention at the sequencer level</Li>
          </ul>
          <InfoBox emoji="🏗" title="Fusaka Alignment">
            Since December 2025, Linea runs the Fusaka upgrade – full parity with Ethereum&apos;s latest EVM, including <Code>PUSH0</Code> and <Code>MCOPY</Code> opcodes.
            Combined with PeerDAS (EIP-7594) for higher blob throughput, L2 transaction costs will continue to decrease throughout 2026.
          </InfoBox>
        </Section>

        <Divider />

        <Section id="roadmap" badge="12" title="Roadmap" icon={RoadmapIcon} delay={0.55}>
          <RoadmapTimeline />
        </Section>

        <Divider />

        <Section id="tech" badge="13" title="Tech Stack" icon={CodeIcon} delay={0.6}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <TechBadge name="Next.js 15" color="white" />
            <TechBadge name="React 19" color="sky" />
            <TechBadge name="TypeScript" color="blue" />
            <TechBadge name="Tailwind CSS" color="cyan" />
            <TechBadge name="Wagmi v2" color="violet" />
            <TechBadge name="Viem" color="emerald" />
            <TechBadge name="Privy SDK" color="purple" />
            <TechBadge name="Solidity" color="amber" />
            <TechBadge name="Linea" color="indigo" />
          </div>
        </Section>

        <Footer />
      </div>
    </div>
  );
});

/* ════════════════ Sub-components ════════════════ */

function Hero() {
  return (
    <div className="relative pt-5 pb-5 text-center overflow-hidden">
      <FloatingParticles />
      <div className="relative z-10">
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 mb-6 animate-slide-up ${uiTokens.focusRing}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-[10px] font-bold text-violet-400 uppercase tracking-widest">Official Documentation</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-black mb-3 animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <span className="text-white">L</span>
          <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">ORE</span>
          <span className="text-gray-500 font-medium text-2xl sm:text-3xl ml-3">White Paper</span>
        </h1>

        <p className="text-gray-400 text-sm max-w-lg mx-auto leading-relaxed animate-slide-up" style={{ animationDelay: "0.15s" }}>
          A fully on-chain prediction mining game on Linea.
          Mine tiles, win pools, earn rewards – all transparent, all verifiable.
        </p>

        <div className="flex items-center justify-center gap-6 mt-6 animate-slide-up" style={{ animationDelay: "0.2s" }}>
          <Stat label="Network" value="Linea" />
          <div className="w-px h-8 bg-white/10" />
          <Stat label="Grid" value="5 × 5" />
          <div className="w-px h-8 bg-white/10" />
          <Stat label="Winners" value="92%" sub="+ jackpot bonuses" />
        </div>
      </div>
    </div>
  );
}

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-violet-400/30"
          style={{
            left: `${8 + (i * 7.5) % 90}%`,
            top: `${10 + (i * 13) % 80}%`,
            animation: `float ${3 + (i % 4)}s ease-in-out infinite`,
            animationDelay: `${i * 0.3}s`,
          }}
        />
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">{label}</div>
      <div className="text-sm font-black text-white">{value}</div>
      {sub ? <div className="text-[9px] text-gray-500 mt-0.5 max-w-[120px] mx-auto">{sub}</div> : null}
    </div>
  );
}

function Divider() {
  return <div className="my-8 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />;
}

function Section({ id, badge, title, icon: Icon, delay, children }: {
  id: string; badge: string; title: string; icon: React.FC; delay: number; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      id={id}
      ref={ref}
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
      style={{ transitionDelay: `${delay}s` }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-10 h-10 ${uiTokens.radius.sm} bg-violet-500/10 border border-violet-500/25 flex items-center justify-center shrink-0`}>
          <Icon />
        </div>
        <div>
          <div className="text-[9px] font-bold text-violet-500/60 uppercase tracking-widest">{badge}</div>
          <h2 className="text-xl font-black text-white">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-400 text-sm leading-relaxed mb-4">{children}</p>;
}
function B({ children }: { children: React.ReactNode }) {
  return <span className="text-white font-bold">{children}</span>;
}
function Accent({ children }: { children: React.ReactNode }) {
  return <span className="text-violet-400 font-semibold">{children}</span>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 text-xs font-mono border border-violet-500/20">{children}</code>;
}

function Li({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-gray-400">
      <span className="flex w-7 shrink-0 justify-center text-base leading-5">{emoji}</span>
      <span className="flex-1 min-w-0 leading-relaxed">{children}</span>
    </li>
  );
}

function InfoBox({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <UiPanel
      tone="accent"
      className="relative my-6 bg-gradient-to-br from-violet-500/[0.07] to-indigo-500/[0.04] border-violet-500/20 overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full blur-2xl pointer-events-none" />
      <div className="flex items-center gap-2 mb-2 relative">
        <span className="text-lg">{emoji}</span>
        <span className="text-xs font-bold text-violet-300 uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed relative">{children}</p>
    </UiPanel>
  );
}

function Timeline({ items }: { items: { step: string; title: string; desc: string }[] }) {
  return (
    <div className="relative ml-4 border-l border-violet-500/20 pl-6 space-y-6 mb-4">
      {items.map((item, i) => (
        <div key={i} className="relative">
          <div className="absolute -left-[1.85rem] top-0.5 w-3.5 h-3.5 rounded-full bg-[#0d0d1a] border-2 border-violet-500/50 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          </div>
          <div className="text-[9px] font-bold text-violet-500/60 uppercase tracking-widest mb-0.5">Step {item.step}</div>
          <h3 className="text-sm font-bold text-white mb-1">{item.title}</h3>
          <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
        </div>
      ))}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 mb-6">{children}</div>;
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    violet: "border-violet-500/25 bg-violet-500/[0.06] text-violet-400",
    emerald: "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-400",
    amber: "border-amber-500/25 bg-amber-500/[0.06] text-amber-400",
    sky: "border-sky-500/25 bg-sky-500/[0.06] text-sky-400",
  };
  return (
    <div className={cn(`p-3 border ${colors[color]}`, uiTokens.radius.sm)}>
      <div className="text-[8px] font-bold uppercase tracking-widest opacity-60 mb-1">{label}</div>
      <div className="text-xl font-black">{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <UiPanel tone="default" padding="sm" className="hover:border-violet-500/30 transition-colors">
      <div className="text-lg mb-1">{icon}</div>
      <div className="text-xs font-bold text-white mb-0.5">{title}</div>
      <div className="text-[10px] text-gray-500">{desc}</div>
    </UiPanel>
  );
}

function ContractCard({ name, address, functions }: { name: string; address: string; functions: string[] }) {
  return (
    <UiPanel tone="default">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-white uppercase tracking-wider">{name}</span>
        <span className="text-[10px] font-mono text-violet-400/60">{address}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {functions.map((fn) => (
          <span key={fn} className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-violet-500/8 text-violet-300/70 border border-violet-500/15">
            {fn}
          </span>
        ))}
      </div>
    </UiPanel>
  );
}

function MiniGrid() {
  const selected = 0;
  const myBetOnly = [3, 19];
  const roundWin = 12;
  const myWin = 7;
  return (
    <div className="space-y-4 my-6">
      <div className="grid grid-cols-5 gap-1.5 max-w-[14rem] mx-auto">
        {Array.from({ length: 25 }).map((_, i) => {
          const isSelected = i === selected;
          const isMyBetOnly = myBetOnly.includes(i);
          const isRoundWin = i === roundWin;
          const isMyWin = i === myWin;
          const tileNum = i + 1;
          let boxClass = "bg-[#0f0f1e] border border-violet-500/10 text-gray-500";
          if (isMyWin) {
            boxClass = "bg-sky-500/15 border border-sky-400/50 text-sky-300 shadow-[0_0_12px_rgba(14,165,233,0.25)] animate-pulse";
          } else if (isRoundWin) {
            boxClass = "bg-amber-500/15 border border-amber-400/50 text-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.2)] animate-pulse";
          } else if (isMyBetOnly) {
            boxClass = "bg-emerald-500/10 border border-emerald-500/40 text-emerald-400";
          } else if (isSelected) {
            boxClass = "bg-violet-500/15 border border-violet-500/60 text-violet-300 shadow-[0_0_16px_rgba(139,92,246,0.3)] animate-pulse";
          }
          return (
            <div
              key={i}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center text-[8px] font-bold transition-all duration-300 ${boxClass}`}
            >
              {isMyWin || isRoundWin ? (
                <span className="text-[10px] drop-shadow-sm">★</span>
              ) : (
                <span>#{tileNum}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[9px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border border-violet-500/40 bg-[#0f0f1e]" /> No bet</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border border-violet-500/60 bg-violet-500/15 animate-pulse" /> Selected</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border border-emerald-500/40 bg-emerald-500/10" /> Your bet</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border border-amber-400/50 bg-amber-500/15" /> ROUND WIN</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border border-sky-400/50 bg-sky-500/15" /> YOUR WIN</span>
      </div>
    </div>
  );
}

function FormulaBlock() {
  return (
    <UiPanel
      tone="accent"
      className="my-6 p-5 bg-gradient-to-r from-violet-500/[0.06] via-indigo-500/[0.08] to-violet-500/[0.06] border-violet-500/20 text-center"
    >
      <div className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-3">Reward Formula</div>
      <div className="text-lg sm:text-xl font-mono font-black text-white">
        <span className="text-violet-400">reward</span>
        <span className="text-gray-600 mx-2">=</span>
        <span className="text-emerald-400">rewardPool</span>
        <span className="text-gray-600 mx-1">×</span>
        <span className="inline-block align-middle">
          <span className="block text-center text-sky-400 border-b border-gray-600 px-2 pb-0.5 text-base">yourBet</span>
          <span className="block text-center text-amber-400 pt-0.5 text-base">tileTotal</span>
        </span>
      </div>
      <div className="text-[10px] text-gray-500 mt-3">rewardPool = 92% of totalPool + dailyJackpot (if triggered) + weeklyJackpot (if triggered)</div>
    </UiPanel>
  );
}

function RoadmapTimeline() {
  const phases = [
    { phase: "Phase 1", status: "live", title: "Core Game", items: ["5×5 mining grid", "Manual betting", "Reward claiming", "Analytics module"] },
    { phase: "Phase 2", status: "live", title: "Auto-Miner & Rebates", items: ["Automated betting bot", "Privy embedded wallet", "Participation rebate system", "Session persistence"] },
    { phase: "Phase 3", status: "live", title: "Jackpots & Leaderboards", items: ["Daily Jackpot (2%)", "Weekly Jackpot (3%)", "Rollover pool", "Leaderboard system", "Achievements"] },
    { phase: "Phase 4", status: "next", title: "Growth & Features", items: ["Dynamic epoch durations", "Mobile-optimized UI", "Public API for stats", "Token?"] },
  ];

  return (
    <div className="space-y-4 mb-4">
      {phases.map((p) => (
        <UiPanel key={p.phase} className={`transition-all ${
          p.status === "live"
            ? "bg-emerald-500/[0.05] border-emerald-500/25"
            : p.status === "next"
              ? "bg-amber-500/[0.05] border-amber-500/25"
              : "bg-white/[0.02] border-white/[0.06]"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
              p.status === "live"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                : p.status === "next"
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/25"
                  : "bg-white/5 text-gray-500 border border-white/10"
            }`}>
              {p.status === "live" ? "✓ Live" : p.status === "next" ? "→ Next" : "◇ Planned"}
            </span>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{p.phase}</span>
          </div>
          <h3 className="text-sm font-bold text-white mb-2">{p.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            {p.items.map((item) => (
              <span key={item} className="px-2 py-0.5 rounded text-[10px] font-medium text-gray-400 bg-white/[0.04] border border-white/[0.06]">
                {item}
              </span>
            ))}
          </div>
        </UiPanel>
      ))}
    </div>
  );
}

function TechBadge({ name, color }: { name: string; color: string }) {
  const colors: Record<string, string> = {
    white: "text-white border-white/20 bg-white/[0.04]",
    sky: "text-sky-400 border-sky-500/20 bg-sky-500/[0.04]",
    blue: "text-blue-400 border-blue-500/20 bg-blue-500/[0.04]",
    cyan: "text-cyan-400 border-cyan-500/20 bg-cyan-500/[0.04]",
    violet: "text-violet-400 border-violet-500/20 bg-violet-500/[0.04]",
    emerald: "text-emerald-400 border-emerald-500/20 bg-emerald-500/[0.04]",
    purple: "text-purple-400 border-purple-500/20 bg-purple-500/[0.04]",
    amber: "text-amber-400 border-amber-500/20 bg-amber-500/[0.04]",
    indigo: "text-indigo-400 border-indigo-500/20 bg-indigo-500/[0.04]",
  };
  return (
    <div className={cn(`px-3 py-2 border text-xs font-bold text-center ${colors[color] ?? colors.white}`, uiTokens.radius.sm)}>
      {name}
    </div>
  );
}

function Footer() {
  return (
    <div className="mt-12 mb-8 text-center">
      <div className="inline-flex items-center gap-2 mb-3">
        <span className="text-xl font-black">
          <span className="text-white">L</span><span className="text-violet-400">ORE</span>
        </span>
        <span className="text-[8px] text-gray-600 font-bold uppercase tracking-widest">– mine the chain</span>
      </div>
      <p className="text-[10px] text-gray-600">
        Built on Linea · Powered by Privy · Fully On-Chain
      </p>
      <p className="text-[9px] text-gray-700 mt-1">
        This document is for informational purposes. Not financial advice. Play responsibly.
      </p>
      <p className="text-[9px] text-gray-600 mt-2">
        <a href="/privacy" className="text-violet-400/80 hover:text-violet-400 underline">Privacy Policy</a>
      </p>
    </div>
  );
}

/* ════════════════ SVG Icons ════════════════ */

function IntroIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" /></svg>;
}
function GearIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function TokenIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>;
}
function GridIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>;
}
function BotIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" /></svg>;
}
function RefIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>;
}
function WalletIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 110-6h.75A2.25 2.25 0 0118 6v.75m-3-3.75H6.75A2.25 2.25 0 004.5 6v12.75A2.25 2.25 0 006.75 21h10.5A2.25 2.25 0 0019.5 18.75V18m1.5-6v-1.5m0 1.5v1.5m0-1.5h-6" /></svg>;
}
function ContractIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" /></svg>;
}
function CalcIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V13.5zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V18zm2.498-6.75h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V13.5zm0 2.25h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V18zm2.504-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V18zm2.498-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zM8.25 6h7.5v2.25h-7.5V6zM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0012 2.25z" /></svg>;
}
function ChartIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>;
}
function InfraIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" /></svg>;
}
function RoadmapIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>;
}
function CodeIcon() {
  return <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>;
}
