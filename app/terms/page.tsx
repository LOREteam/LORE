import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Play - LORE",
  description: "Terms of Play for LORE - Linea Mining Game. Player responsibilities, risk, fees, and on-chain rules.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Play | LORE",
    description: "LORE player responsibilities, risk, fees, and on-chain rules.",
    url: "/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-gray-300">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-violet-400 transition-colors hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to LORE
        </Link>

        <header className="mb-10">
          <h1 className="text-3xl font-black tracking-tight">
            <span className="text-white">L</span>
            <span className="text-violet-400">ORE</span>
            <span className="ml-2 text-xl font-bold text-gray-500">Terms of Play</span>
          </h1>
          <p className="mt-2 text-sm text-gray-500">Last updated: July 2026</p>
        </header>

        <article className="space-y-6 text-[15px] leading-relaxed">
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-violet-400">Entertainment game</h2>
            <p>
              LORE is an on-chain entertainment game on Linea. It is not an investment product, savings account,
              yield strategy, or promise of profit. Play only with tokens you are comfortable risking.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-violet-400">On-chain rules</h2>
            <p>
              Bets, pools, claims, Safety Pool rebates, jackpot outcomes, protocol fees, and one-year unclaimed
              settlement paths are controlled by the deployed smart contract. Public UI screens explain the active
              rules, but the contract is the final source of truth for settled game state.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-violet-400">Risk and fees</h2>
            <p>
              Round results are probabilistic. A bet can lose, transaction fees are paid to the network, and failed or
              reverted transactions may still consume gas. Network congestion, RPC outages, wallet issues, or indexing
              delay can temporarily affect the site experience without changing final on-chain ownership.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-violet-400">Wallet responsibility</h2>
            <p>
              You control your wallet, approvals, signatures, and private keys. Keep a backup of any embedded wallet
              before moving significant value. LORE cannot restore a wallet, reverse a confirmed transaction, or recover
              assets sent to a wrong address.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-violet-400">Fair use</h2>
            <p>
              Do not attack, overload, automate abuse against, or try to bypass access controls in the app, APIs,
              wallets, indexer, or operator systems. We may limit access to protect the game, users, and infrastructure.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-violet-400">Availability</h2>
            <p>
              The website, RPC providers, monitoring, and indexer can be delayed or unavailable. The team may pause
              frontend access, maintenance tools, or off-chain services when needed to protect users or repair the
              system.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-violet-400">Contact</h2>
            <p>
              For questions about these terms, contact{" "}
              <a href="mailto:playlore88@gmail.com" className="text-violet-400 underline hover:text-violet-300">
                playlore88@gmail.com
              </a>
              .
            </p>
          </section>
        </article>

        <footer className="mt-14 border-t border-white/10 pt-8">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <span className="text-xl font-black">
              <span className="text-white">L</span>
              <span className="text-violet-400">ORE</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-widest">- mine the chain</span>
          </div>
          <p className="mt-2 text-xs text-gray-600">Built on Linea - Powered by Privy - Fully On-Chain</p>
        </footer>
      </div>
    </div>
  );
}
