import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runPublicMetadataTests() {
  const rootLayoutSource = readFileSync("app/layout.tsx", "utf8");
  const robotsSource = readFileSync("app/robots.ts", "utf8");
  const sitemapSource = readFileSync("app/sitemap.ts", "utf8");
  assert.match(
    rootLayoutSource,
    /NEXT_PUBLIC_SITE_URL\s*\?\?\s*['"]https:\/\/playlore\.xyz['"]/,
    "root metadata must default to the canonical playlore.xyz origin",
  );
  assert.match(
    rootLayoutSource,
    /\.trim\(\)\.replace\(\/\\\/\+\$\/,\s*''\)/,
    "root metadata must trim and remove trailing slashes from the canonical origin",
  );
  assert.match(
    rootLayoutSource,
    /alternates:\s*{\s*canonical:\s*['"]\/['"]/,
    "root metadata must publish a canonical home URL",
  );
  assert.match(
    rootLayoutSource,
    /openGraph:[\s\S]*url:\s*['"]\/['"]/,
    "root OpenGraph metadata must publish the canonical home URL",
  );
  assert.match(
    robotsSource,
    /NEXT_PUBLIC_SITE_URL\s*\?\?\s*['"]https:\/\/playlore\.xyz['"]/,
    "robots and sitemap must default to the canonical playlore.xyz origin",
  );
  assert.match(
    robotsSource,
    /\.trim\(\)\.replace\(\/\\\/\+\$\/,\s*""\)/,
    "robots.txt must trim and remove trailing slashes from the canonical origin",
  );
  assert.match(
    sitemapSource,
    /NEXT_PUBLIC_SITE_URL\s*\?\?\s*"https:\/\/playlore\.xyz"/,
    "sitemap must default to the canonical playlore.xyz origin",
  );
  assert.match(
    sitemapSource,
    /\.trim\(\)\.replace\(\/\\\/\+\$\/,\s*""\)/,
    "sitemap must trim and remove trailing slashes from the canonical origin",
  );
  assert.match(
    sitemapSource,
    /\/jackpot-win[\s\S]*\/privacy[\s\S]*\/terms/,
    "sitemap must include public jackpot share, privacy, and terms routes",
  );
  assert.match(
    robotsSource,
    /\/privacy[\s\S]*\/terms/,
    "robots.txt must allow public privacy and terms routes in production",
  );
  const jackpotWinPageSource = readFileSync("app/jackpot-win/page.tsx", "utf8");
  const jackpotShareSource = readFileSync("app/lib/jackpotShareVerification.ts", "utf8");
  assert.match(
    jackpotWinPageSource,
    /https:\/\/playlore\.xyz/,
    "jackpot share preview page must default metadata to playlore.xyz",
  );
  assert.match(
    jackpotWinPageSource,
    /readVerifiedJackpotShare\(firstParam\(\(await searchParams\)\.tx\)\)[\s\S]*notFound\(\)/,
    "jackpot share page must reject an unknown transaction instead of rendering URL-supplied jackpot fields",
  );
  assert.match(jackpotShareSource, /selectVerifiedJackpotShare[\s\S]*events\.filter[\s\S]*rows\.some\(\(row\) => row\.epoch !== first\.epoch\)[\s\S]*amount: rows\.length === 1/,
    "jackpot share verification must bind epoch, visual mode, and amount to indexed events");
  assert.match(
    jackpotWinPageSource,
    /Play at playlore\.xyz/,
    "jackpot share preview page CTA must display playlore.xyz",
  );
}
