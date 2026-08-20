import type { MetadataRoute } from "next";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://playlore.xyz").trim().replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  const isProduction =
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_MAINTENANCE_MODE !== "1" &&
    siteUrl === "https://playlore.xyz" &&
    process.env.VERCEL_ENV !== "preview";

  if (!isProduction) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      sitemap: undefined,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/jackpot-win", "/faq", "/whitepaper", "/leaderboards", "/privacy", "/terms", "/api/jackpots/og"],
        disallow: ["/api/", "/admin", "/dev"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
