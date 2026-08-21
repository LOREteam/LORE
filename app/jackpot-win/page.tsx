import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readVerifiedJackpotShare } from "../api/_lib/jackpotShare";
import { getJackpotVisualTheme } from "../lib/jackpotVisualTheme";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PUBLIC_SITE_URL = "https://playlore.xyz";

function getPublicSiteUrl() {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? PUBLIC_SITE_URL).trim().replace(/\/+$/, "");
  return configured === PUBLIC_SITE_URL ? configured : PUBLIC_SITE_URL;
}

function firstParam(raw: string | string[] | undefined): string | null {
  return Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
}

async function readShare(searchParams: Props["searchParams"]) {
  const params = await searchParams;
  return await readVerifiedJackpotShare(firstParam(params.event) ?? firstParam(params.tx));
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const share = await readShare(searchParams);
  if (!share) return { title: "Jackpot event not found | LORE", robots: { index: false, follow: false } };

  const theme = getJackpotVisualTheme(share.kind);
  const label = theme.label;
  const title = share.amount ? `${label} Winner - ${share.amount} LINEA | LORE` : `${label} Winner | LORE`;
  const description = `${label} event verified on-chain for epoch #${share.epoch}.`;
  const publicSiteUrl = getPublicSiteUrl();
  const params = new URLSearchParams({ event: share.eventId });
  const pageUrl = `${publicSiteUrl}/jackpot-win?${params.toString()}`;
  const ogUrl = `${publicSiteUrl}/api/jackpots/og?${params.toString()}`;

  return {
    metadataBase: new URL(publicSiteUrl),
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: "website",
      images: [{ url: ogUrl, width: 1200, height: 630, alt: `${label} verified event` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogUrl] },
  };
}

export default async function JackpotWinPage({ searchParams }: Props) {
  const share = await readShare(searchParams);
  if (!share) notFound();

  const theme = getJackpotVisualTheme(share.kind);
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05040b] px-4 py-10 text-white">
      <div className="absolute inset-0 scale-105 bg-cover bg-center opacity-75" style={{ backgroundImage: `url('${theme.ogArt}')` }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.48),rgba(0,0,0,0.84))]" />
      <div className={`relative w-full max-w-3xl overflow-hidden rounded-3xl border ${theme.banner.frame} bg-black/46 p-6 text-center shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-9`}>
        <p className={`text-[0.7rem] font-black uppercase tracking-[0.32em] ${theme.banner.accent}`}>LORE verified jackpot event</p>
        <h1 className="lore-display mx-auto mt-3 max-w-2xl text-5xl font-black uppercase leading-[0.9] sm:text-7xl">{theme.winTitle}</h1>
        <div className={`lore-hud-number mt-6 text-4xl font-black leading-none sm:text-6xl ${theme.banner.accent}`}>
          {share.amount ? `${share.amount} LINEA` : "Reward confirmed"}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <InfoPill label="Epoch" value={`#${share.epoch}`} />
          <InfoPill label="Mode" value={theme.label} />
        </div>
        <p className="mx-auto mt-4 max-w-xl break-all text-xs leading-relaxed text-white/65">Verified event: {share.eventId}</p>
        <Link href="/" className={`mt-8 inline-flex min-h-12 items-center justify-center rounded-xl border px-7 text-sm font-black uppercase tracking-[0.16em] transition hover:brightness-110 ${theme.banner.button} ${theme.banner.buttonBorder}`}>
          Play at playlore.xyz
        </Link>
      </div>
    </main>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/12 bg-black/34 px-4 py-2">
      <span className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-white/45">{label} </span>
      <span className="lore-hud-number text-sm font-black text-white/86">{value}</span>
    </div>
  );
}
