import type { Metadata } from "next";
import Link from "next/link";
import { getJackpotVisualTheme, type JackpotVisualKind } from "../lib/jackpotVisualTheme";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PUBLIC_SITE_URL = "https://playlore.xyz";

function getPublicSiteUrl() {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? PUBLIC_SITE_URL).trim();
  if (!configured.startsWith("http")) return PUBLIC_SITE_URL;
  const normalized = configured.replace(/\/+$/, "");
  return /localhost|127\.0\.0\.1/i.test(normalized) ? PUBLIC_SITE_URL : normalized;
}

function param(raw: string | string[] | undefined): string | null {
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

function resolveKind(raw: string | null): JackpotVisualKind {
  if (raw === "weekly") return "weekly";
  if (raw === "dual") return "dual";
  return "daily";
}

function sanitizeAmount(raw: string | null) {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > 24) return null;
  if (!/^[0-9][0-9,. ]*$/.test(value)) return null;
  return value;
}

function sanitizePositiveInt(raw: string | null, max: number) {
  const value = raw?.trim();
  if (!value || !/^[0-9]{1,10}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) return null;
  return String(parsed);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const kind = resolveKind(param(sp.kind));
  const theme = getJackpotVisualTheme(kind);
  const amount = sanitizeAmount(param(sp.amount));
  const tile = sanitizePositiveInt(param(sp.tile), 25);
  const epoch = sanitizePositiveInt(param(sp.epoch), 1_000_000_000);

  const label = theme.label;
  const title = amount ? `${label} Winner - ${amount} LINEA | LORE` : `${label} Winner | LORE`;
  const description = [
    `A ${label} just hit in LORE.`,
    amount ? `Reward: ${amount} LINEA.` : "Reward confirmed on-chain.",
    tile ? `Winning Tile #${tile}.` : null,
    epoch ? `Epoch #${epoch}.` : null,
    "Mine tiles, chase jackpots, and play LORE on Linea.",
  ]
    .filter(Boolean)
    .join(" ");

  const ogParams = new URLSearchParams();
  ogParams.set("kind", kind);
  if (amount) ogParams.set("amount", amount);
  if (tile) ogParams.set("tile", tile);
  if (epoch) ogParams.set("epoch", epoch);
  const publicSiteUrl = getPublicSiteUrl();
  const pagePath = `/jackpot-win?${ogParams.toString()}`;
  const pageUrl = `${publicSiteUrl}${pagePath}`;
  const ogUrl = `${publicSiteUrl}/api/jackpots/og?${ogParams.toString()}`;

  return {
    metadataBase: new URL(publicSiteUrl),
    title,
    description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: "website",
      images: [
        {
          url: ogUrl,
          width: 1200,
          height: 630,
          alt: amount ? `${label} Winner - ${amount} LINEA` : `${label} Winner`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function JackpotWinPage({ searchParams }: Props) {
  const sp = await searchParams;
  const kind = resolveKind(param(sp.kind));
  const theme = getJackpotVisualTheme(kind);
  const amount = sanitizeAmount(param(sp.amount));
  const tile = sanitizePositiveInt(param(sp.tile), 25);
  const epoch = sanitizePositiveInt(param(sp.epoch), 1_000_000_000);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05040b] px-4 py-10 text-white">
      <div
        className="absolute inset-0 scale-105 bg-cover bg-center opacity-75"
        style={{ backgroundImage: `url('${theme.ogArt}')` }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.48),rgba(0,0,0,0.84))]" />

      <div className={`relative w-full max-w-3xl overflow-hidden rounded-3xl border ${theme.banner.frame} bg-black/46 p-6 text-center shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-9`}>
        <p className={`text-[0.7rem] font-black uppercase tracking-[0.32em] ${theme.banner.accent}`}>
          LORE jackpot winner
        </p>
        <h1 className="lore-display mx-auto mt-3 max-w-2xl text-5xl font-black uppercase leading-[0.9] sm:text-7xl">
          {theme.winTitle}
        </h1>
        <div className={`lore-hud-number mt-6 text-4xl font-black leading-none sm:text-6xl ${theme.banner.accent}`}>
          {amount ? `${amount} LINEA` : "Reward confirmed"}
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {tile && <InfoPill label="Tile" value={`#${tile}`} />}
          {epoch && <InfoPill label="Epoch" value={`#${epoch}`} />}
          <InfoPill label="Mode" value={theme.label} />
        </div>

        <Link
          href="/"
          className={`mt-8 inline-flex min-h-12 items-center justify-center rounded-xl border px-7 text-sm font-black uppercase tracking-[0.16em] transition hover:brightness-110 ${theme.banner.button} ${theme.banner.buttonBorder}`}
        >
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
