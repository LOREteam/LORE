import type { Metadata } from "next";
import { LorePage } from "../LorePage";

export const metadata: Metadata = {
  title: "FAQ | LORE",
  description: "LORE help for wallets, backups, funding, bets, rewards, and Linea gameplay.",
  alternates: { canonical: "/faq" },
  openGraph: { title: "LORE FAQ", url: "/faq" },
};

export default function FaqPage() {
  return <LorePage initialTab="faq" />;
}
