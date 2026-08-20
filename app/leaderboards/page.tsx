import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leaderboards | LORE",
  description: "Explore LORE's public on-chain game leaderboards on Linea.",
  alternates: { canonical: "/leaderboards" },
  openGraph: { title: "LORE Leaderboards", url: "/leaderboards" },
};

export { default } from "../page";
