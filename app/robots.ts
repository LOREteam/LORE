import type { MetadataRoute } from "next";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://playlore.xyz").trim().replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  const canIndex =
    process.env.NODE_ENV === "production" &&
    process.env.LORE_ALLOW_PUBLIC_INDEXING === "1" &&
    process.env.NEXT_PUBLIC_MAINTENANCE_MODE !== "1" &&
    siteUrl === "https://playlore.xyz" &&
    (process.env.VERCEL_ENV === undefined || process.env.VERCEL_ENV === "production");

  if (!canIndex) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      sitemap: undefined,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/faq", "/whitepaper", "/leaderboards", "/privacy", "/terms", "/api/jackpots/og"],
        disallow: ["/api/", "/admin", "/dev"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
