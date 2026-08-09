import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy - LORE",
  description: "Privacy Policy for LORE - Linea Mining Game. How we handle wallet, email, and blockchain data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-gray-300">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-violet-400 transition-colors hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to LORE
        </Link>

        <header className="mb-10">
          <h1 className="text-3xl font-black tracking-tight">
            <span className="text-white">L</span>
            <span className="text-violet-400">ORE</span>
            <span className="text-gray-500 font-bold text-xl ml-2">Privacy Policy</span>
          </h1>
          <p className="mt-2 text-sm text-gray-500">Last updated: July 2026</p>
        </header>

        <article className="space-y-6 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Wallet-first sign-in</h2>
            <p>
              You can use LORE with a crypto wallet. If you choose an email login or embedded wallet flow, Privy
              processes the information needed to authenticate you and operate that wallet experience.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Data on the blockchain</h2>
            <p>
              Your wallet address, bets, claims, transfers, and game results are recorded on the public Linea
              blockchain and are publicly visible there.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Local storage</h2>
            <p>
              We store technical data in your browser, such as cached stats, UI preferences, wallet state, and
              recovery markers, to make the site work reliably and load faster.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Third-party services</h2>
            <p>
              We use Privy for authentication and embedded wallets, blockchain RPC providers for chain reads, hosting
              infrastructure, and rate-limiting or monitoring services. These providers process data according to their
              own policies.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">No advertising sale</h2>
            <p>
              We do not sell your wallet, email, or usage data to third parties for advertising. We may use operational
              data to secure the app, prevent abuse, debug failures, and improve reliability.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Changes</h2>
            <p>
              We may update this policy from time to time. The current version will always be on this page. Continued
              use of the site after changes means you accept the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Contact</h2>
            <p>
              For privacy-related questions, contact us at{" "}
              <a href="mailto:playlore88@gmail.com" className="text-violet-400 hover:text-violet-300 underline">
                playlore88@gmail.com
              </a>
              .
            </p>
          </section>
        </article>

        <footer className="mt-14 pt-8 border-t border-white/10">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <span className="text-xl font-black">
              <span className="text-white">L</span>
              <span className="text-violet-400">ORE</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-widest">- mine the chain</span>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Built on Linea - Powered by Privy - Fully On-Chain
          </p>
        </footer>
      </div>
    </div>
  );
}
