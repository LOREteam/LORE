import type { Metadata } from "next";
import { LorePage } from "../LorePage";

export const metadata: Metadata = {
  title: "White Paper | LORE",
  description: "LORE game rules, rewards, wallet model, and on-chain gameplay on Linea.",
  alternates: { canonical: "/whitepaper" },
  openGraph: { title: "LORE White Paper", url: "/whitepaper" },
};

export default function WhitePaperPage() {
  return <LorePage initialTab="whitepaper" />;
}
