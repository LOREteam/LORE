import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function readRobotsForEnvironment(overrides) {
  const env = { ...process.env, TSX_DISABLE_CACHE: "1", ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  const robotsModuleUrl = new URL("../app/robots.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", `import * as robotsModule from ${JSON.stringify(robotsModuleUrl)}; const robots = typeof robotsModule.default === "function" ? robotsModule.default : robotsModule.default?.default; console.log(JSON.stringify(robots()));`],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, `robots environment probe failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

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
    /\/privacy[\s\S]*\/terms/,
    "sitemap must include public privacy and terms routes",
  );
  assert.match(
    robotsSource,
    /\/privacy[\s\S]*\/terms/,
    "robots.txt must allow public privacy and terms routes in production",
  );
  for (const [route, title] of [
    ["faq", "FAQ | LORE"],
    ["whitepaper", "White Paper | LORE"],
    ["leaderboards", "Leaderboards | LORE"],
  ]) {
    const routeSource = readFileSync(`app/${route}/page.tsx`, "utf8");
    assert.match(routeSource, new RegExp(`title: [\"']${title.replace("|", "\\\\|")}[\"']`));
    assert.match(routeSource, new RegExp(`canonical: [\"']/${route}[\"']`));
  }
  for (const [sourceName, source] of [
    ["root metadata", rootLayoutSource],
    ["robots.txt", robotsSource],
  ]) {
    assert.match(
      source,
      /process\.env\.NODE_ENV === "production"[\s\S]*process\.env\.LORE_ALLOW_PUBLIC_INDEXING === "1"[\s\S]*process\.env\.NEXT_PUBLIC_MAINTENANCE_MODE !== "1"[\s\S]*siteUrl === "https:\/\/playlore\.xyz"[\s\S]*process\.env\.VERCEL_ENV === undefined \|\| process\.env\.VERCEL_ENV === "production"/,
      `${sourceName} must require an explicit production indexing admission`,
    );
  }
  assert.match(
    rootLayoutSource,
    /robots: canIndex \? undefined : \{ index: false, follow: false \}/,
    "metadata must be noindex until production indexing is explicitly admitted",
  );
  assert.match(
    robotsSource,
    /if \(!canIndex\)[\s\S]*disallow: "\/"/,
    "robots.txt must disallow crawling until production indexing is explicitly admitted",
  );
  const environmentCases = [
    [{ NODE_ENV: "development", LORE_ALLOW_PUBLIC_INDEXING: "1", NEXT_PUBLIC_SITE_URL: "https://playlore.xyz", VERCEL_ENV: undefined }, false],
    [{ NODE_ENV: "production", LORE_ALLOW_PUBLIC_INDEXING: undefined, NEXT_PUBLIC_SITE_URL: "https://playlore.xyz", VERCEL_ENV: "production" }, false],
    [{ NODE_ENV: "production", LORE_ALLOW_PUBLIC_INDEXING: "1", NEXT_PUBLIC_SITE_URL: "https://playlore.xyz", NEXT_PUBLIC_MAINTENANCE_MODE: "1", VERCEL_ENV: "production" }, false],
    [{ NODE_ENV: "production", LORE_ALLOW_PUBLIC_INDEXING: "1", NEXT_PUBLIC_SITE_URL: "https://playlore.xyz", NEXT_PUBLIC_MAINTENANCE_MODE: undefined, VERCEL_ENV: "production" }, true],
    [{ NODE_ENV: "production", LORE_ALLOW_PUBLIC_INDEXING: "1", NEXT_PUBLIC_SITE_URL: "https://playlore.xyz", VERCEL_ENV: "preview" }, false],
  ];
  for (const [environment, expectedIndexing] of environmentCases) {
    const robotRules = readRobotsForEnvironment(environment).rules;
    const isIndexing = robotRules.some((rule) => Array.isArray(rule.allow) && rule.allow.includes("/"));
    assert.equal(isIndexing, expectedIndexing, `robots indexing admission must be ${expectedIndexing} for ${JSON.stringify(environment)}`);
  }
  for (const [route, title] of [
    ["privacy", "Privacy Policy | LORE"],
    ["terms", "Terms of Play | LORE"],
  ]) {
    const routeSource = readFileSync(`app/${route}/page.tsx`, "utf8");
    assert.match(routeSource, new RegExp(`canonical: ["']/${route}["']`));
    assert.match(routeSource, new RegExp(`openGraph:[\\s\\S]*title: ["']${title.replace("|", "\\\\|")}["'][\\s\\S]*url: ["']/${route}["'][\\s\\S]*type: ["']website["'][\\s\\S]*images: \\[`));
    assert.match(routeSource, new RegExp(`twitter:[\\s\\S]*card: ["']summary_large_image["'][\\s\\S]*title: ["']${title.replace("|", "\\\\|")}["'][\\s\\S]*images: \\[`));
  }
  const jackpotWinPageSource = readFileSync("app/jackpot-win/page.tsx", "utf8");
  const jackpotShareSource = readFileSync("app/lib/jackpotShareVerification.ts", "utf8");
  assert.match(
    jackpotWinPageSource,
    /https:\/\/playlore\.xyz/,
    "jackpot share preview page must default metadata to playlore.xyz",
  );
  assert.match(
    jackpotWinPageSource,
    /async function readShare[\s\S]*readVerifiedJackpotShare\(firstParam\(params\.event\) \?\? firstParam\(params\.tx\)\)[\s\S]*const share = await readShare\(searchParams\);[\s\S]*if \(!share\) notFound\(\)/,
    "jackpot share page must verify event or legacy tx identity before rendering, then reject unknown shares",
  );
  assert.match(jackpotShareSource, /selectVerifiedJackpotShare[\s\S]*getCanonicalEventIdentity[\s\S]*matches\.length !== 1\) return null[\s\S]*if \(!row\.epoch\) return null[\s\S]*resolveJackpotVisualKind[\s\S]*amount: row\.amount\.trim\(\) \? row\.amount : null/,
    "jackpot share verification must require one canonical finalized event before deriving public fields");
  assert.match(
    jackpotWinPageSource,
    /Play at playlore\.xyz/,
    "jackpot share preview page CTA must display playlore.xyz",
  );
}
