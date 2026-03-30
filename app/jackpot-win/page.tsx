import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function param(raw: string | string[] | undefined): string | null {
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

function resolveKind(raw: string | null): "daily" | "weekly" | "dual" {
  if (raw === "weekly") return "weekly";
  if (raw === "dual") return "dual";
  return "daily";
}

function kindLabel(kind: "daily" | "weekly" | "dual"): string {
  if (kind === "weekly") return "Weekly Jackpot";
  if (kind === "dual") return "Double Jackpot";
  return "Daily Jackpot";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const kind = resolveKind(param(sp.kind));
  const amount = param(sp.amount) || "0.00";
  const tile = param(sp.tile);
  const epoch = param(sp.epoch);
  const winner = param(sp.winner);

  const label = kindLabel(kind);
  const title = `${label} Winner - ${amount} LINEA | LORE`;
  const description = [
    `${label} hit!`,
    `Reward: ${amount} LINEA.`,
    tile ? `Winning Tile #${tile}.` : null,
    epoch ? `Epoch #${epoch}.` : null,
    "Play LORE - the Linea mining game.",
  ]
    .filter(Boolean)
    .join(" ");

  const ogParams = new URLSearchParams();
  ogParams.set("kind", kind);
  ogParams.set("amount", amount);
  if (tile) ogParams.set("tile", tile);
  if (epoch) ogParams.set("epoch", epoch);
  if (winner) ogParams.set("winner", winner);
  const ogUrl = `/api/jackpots/og?${ogParams.toString()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: ogUrl,
          width: 1200,
          height: 630,
          alt: `${label} Winner - ${amount} LINEA`,
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
  const headerList = await headers();
  const ua = headerList.get("user-agent") ?? "";
  const isCrawler =
    /twitterbot|facebookexternalhit|linkedinbot|slackbot|discordbot|telegrambot|whatsapp/i.test(
      ua,
    );

  if (!isCrawler) {
    redirect("/");
  }

  const kind = resolveKind(param(sp.kind));
  const amount = param(sp.amount) || "0.00";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#060612] text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-wider">{kindLabel(kind)} Winner</h1>
        <p className="mt-4 text-2xl text-violet-300">{amount} LINEA</p>
        <p className="mt-6 text-sm text-white/50">Redirecting to LORE...</p>
      </div>
    </main>
  );
}
