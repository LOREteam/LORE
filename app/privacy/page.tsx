import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — LORE",
  description: "Privacy Policy for LORE — Linea Mining Game. How we handle wallet and blockchain data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#060612] text-gray-300">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors mb-8"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          <p className="mt-2 text-sm text-gray-500">Last updated: February 2025</p>
        </header>

        <article className="space-y-6 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">We don’t collect personal data to play</h2>
            <p>
              You sign in with a connected crypto wallet only. We do not ask for your email, name, or password to use the game.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Data on the blockchain</h2>
            <p>
              Your wallet address, bets, and game results are recorded on the public blockchain (Linea) and are publicly visible there.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Local storage</h2>
            <p>
              We store only technical data in your browser (e.g. cached stats and display preferences) to make the site work and load faster.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Third‑party services</h2>
            <p>
              We use Privy (wallet sign‑in), Firebase (game data storage), and hosting providers. Each has its own privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">We don’t sell your data</h2>
            <p>
              We do not sell or share your wallet or usage data with third parties for advertising or other commercial use.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Changes</h2>
            <p>
              We may update this policy from time to time. The current version will always be on this page. Continued use of the site after changes means you accept the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-violet-400 font-bold text-sm uppercase tracking-wider mb-2">Contact</h2>
            <p>
              For privacy-related questions, contact us via the channels listed on the main site (e.g. Telegram or support link).
            </p>
          </section>
        </article>

        <footer className="mt-14 pt-8 border-t border-white/10">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <span className="text-xl font-black">
              <span className="text-white">L</span>
              <span className="text-violet-400">ORE</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-widest">— mine the chain</span>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Built on Linea · Powered by Privy · Fully On-Chain
          </p>
        </footer>
      </div>
    </div>
  );
}
