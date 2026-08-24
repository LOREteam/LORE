import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as jackpotShareVerificationModule from "../app/lib/jackpotShareVerification.ts";
import * as privacyPageModule from "../app/privacy/page.tsx";
import * as termsPageModule from "../app/terms/page.tsx";

const { selectVerifiedJackpotShare } = jackpotShareVerificationModule.default ?? jackpotShareVerificationModule;

const privacyMetadata = privacyPageModule.metadata
  ?? privacyPageModule.default?.metadata
  ?? privacyPageModule["module.exports"]?.metadata;
const termsMetadata = termsPageModule.metadata
  ?? termsPageModule.default?.metadata
  ?? termsPageModule["module.exports"]?.metadata;

function readMetadataRouteForEnvironment(relativeModulePath, overrides) {
  const env = { ...process.env, TSX_DISABLE_CACHE: "1", ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  const metadataModuleUrl = new URL(relativeModulePath, import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", `import * as metadataModule from ${JSON.stringify(metadataModuleUrl)}; const metadataRoute = typeof metadataModule.default === "function" ? metadataModule.default : metadataModule.default?.default; console.log(JSON.stringify(metadataRoute()));`],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, `${relativeModulePath} environment probe failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function readRobotsForEnvironment(overrides) {
  return readMetadataRouteForEnvironment("../app/robots.ts", overrides);
}

function readSitemapForEnvironment(overrides) {
  return readMetadataRouteForEnvironment("../app/sitemap.ts", overrides)
    .map(({ lastModified: _lastModified, ...entry }) => entry);
}

function readRootMetadataForEnvironment(overrides) {
  const env = { ...process.env, TSX_DISABLE_CACHE: "1", ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }

  const layoutModuleUrl = new URL("../app/layout.tsx", import.meta.url).href;
  const dependencyUrls = {
    globalStyles: new URL("../app/globals.css", import.meta.url).href,
    installBigIntJson: new URL("../app/lib/installBigIntJson.ts", import.meta.url).href,
    providers: new URL("../app/providers.tsx", import.meta.url).href,
    errorCatcher: new URL("../app/components/ErrorCatcher.tsx", import.meta.url).href,
    maintenanceGate: new URL("../app/components/MaintenanceGate.tsx", import.meta.url).href,
    webVitals: new URL("../app/components/WebVitalsTelemetry.tsx", import.meta.url).href,
    productionRuntime: new URL("../config/productionRuntime.ts", import.meta.url).href,
  };
  const script = [
    'const { mock } = await import("node:test");',
    `const dependencyUrls = ${JSON.stringify(dependencyUrls)};`,
    'mock.module("next/font/local", { defaultExport: () => ({ variable: "font-var" }) });',
    'mock.module("next/headers", { namedExports: { headers: async () => new Headers() } });',
    "mock.module(dependencyUrls.globalStyles, { namedExports: {} });",
    "mock.module(dependencyUrls.installBigIntJson, { namedExports: {} });",
    "mock.module(dependencyUrls.providers, { defaultExport: () => null });",
    "mock.module(dependencyUrls.errorCatcher, { namedExports: { ErrorCatcher: () => null } });",
    "mock.module(dependencyUrls.maintenanceGate, { namedExports: { MaintenanceGate: ({ children }) => children } });",
    "mock.module(dependencyUrls.webVitals, { namedExports: { WebVitalsTelemetry: () => null } });",
    "mock.module(dependencyUrls.productionRuntime, { namedExports: { assertProductionRuntimeConfig: () => {} } });",
    `const layoutModule = await import(${JSON.stringify(layoutModuleUrl)});`,
    "const metadata = layoutModule.metadata ?? layoutModule.default?.metadata ?? layoutModule['module.exports']?.metadata;",
    "console.log(JSON.stringify({",
    "  metadataBase: metadata?.metadataBase?.toString(),",
    "  canonical: metadata?.alternates?.canonical,",
    "  openGraphUrl: metadata?.openGraph?.url,",
    "  robots: metadata?.robots ?? null,",
    "}));",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
    {
      encoding: "utf8",
      env,
      maxBuffer: 512 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, `root metadata environment probe failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function readPublicPageMetadataBehavior() {
  const lorePageUrl = new URL("../app/LorePage.tsx", import.meta.url).href;
  const jackpotShareUrl = new URL("../app/api/_lib/jackpotShare.ts", import.meta.url).href;
  const pageUrls = Object.fromEntries(
    ["faq", "whitepaper", "leaderboards"].map((route) => [
      route,
      new URL(`../app/${route}/page.tsx`, import.meta.url).href,
    ]),
  );
  const jackpotPageUrl = new URL("../app/jackpot-win/page.tsx", import.meta.url).href;
  const txHash = `0x${"1".repeat(64)}`;
  const eventId = `${txHash}:2`;
  const script = [
    'const { mock } = await import("node:test");',
    'const { renderToStaticMarkup } = await import("react-dom/server");',
    "const calls = [];",
    "let networkCalls = 0;",
    "globalThis.fetch = async () => { networkCalls += 1; throw new Error('metadata behavior probe forbids network access'); };",
    `const txHash = ${JSON.stringify(txHash)};`,
    `const eventId = ${JSON.stringify(eventId)};`,
    `const verifiedShare = ${JSON.stringify({
      eventId,
      txHash,
      logIndex: "2",
      epoch: "9",
      kind: "daily",
      amount: "12.5",
    })};`,
    `mock.module(${JSON.stringify(lorePageUrl)}, { namedExports: { LorePage: () => null } });`,
    `mock.module(${JSON.stringify(jackpotShareUrl)}, { namedExports: { readVerifiedJackpotShare: async (value) => { calls.push(value); return value === eventId || value === txHash ? verifiedShare : null; } } });`,
    `const pageUrls = ${JSON.stringify(pageUrls)};`,
    "const pages = {};",
    "for (const [route, url] of Object.entries(pageUrls)) {",
    "  const pageModule = await import(url);",
    "  const metadata = pageModule.metadata ?? pageModule.default?.metadata ?? pageModule['module.exports']?.metadata;",
    "  pages[route] = { title: metadata?.title, canonical: metadata?.alternates?.canonical };",
    "}",
    `const jackpotModule = await import(${JSON.stringify(jackpotPageUrl)});`,
    "const generateMetadata = jackpotModule.generateMetadata ?? jackpotModule.default?.generateMetadata ?? jackpotModule['module.exports']?.generateMetadata;",
    "const eventMetadata = await generateMetadata({ searchParams: Promise.resolve({ event: [eventId], tx: txHash }) });",
    "const legacyMetadata = await generateMetadata({ searchParams: Promise.resolve({ tx: txHash }) });",
    "const missingMetadata = await generateMetadata({ searchParams: Promise.resolve({ event: 'missing-event' }) });",
    "const jackpotPage = typeof jackpotModule.default === 'function' ? jackpotModule.default : jackpotModule.default?.default ?? jackpotModule['module.exports']?.default;",
    "const renderedEventPage = renderToStaticMarkup(await jackpotPage({ searchParams: Promise.resolve({ event: eventId }) }));",
    "let missingPageRejected = false;",
    "try { await jackpotPage({ searchParams: Promise.resolve({ event: 'missing-page' }) }); } catch (error) { missingPageRejected = /404|not.?found/i.test(String(error?.digest ?? error?.message ?? error)); }",
    "console.log(JSON.stringify({",
    "  pages,",
    "  networkCalls,",
    "  jackpot: {",
    "    calls,",
    "    event: {",
    "      metadataBase: eventMetadata.metadataBase?.toString(),",
    "      canonical: eventMetadata.alternates?.canonical,",
    "      openGraphUrl: eventMetadata.openGraph?.url,",
    "      imageUrl: eventMetadata.openGraph?.images?.[0]?.url,",
    "    },",
    "    legacyCanonical: legacyMetadata.alternates?.canonical,",
    "    missing: missingMetadata,",
    "    renderedEventPage,",
    "    missingPageRejected,",
    "  },",
    "}));",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-test-module-mocks", "--import", "tsx", "--input-type=module", "--eval", script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_SITE_URL: "https://attacker.invalid///",
        TSX_DISABLE_CACHE: "1",
      },
      maxBuffer: 512 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, `public page metadata behavior probe failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function expectedSitemap(origin) {
  return [
    { url: origin, changeFrequency: "daily", priority: 1 },
    { url: `${origin}/faq`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/whitepaper`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/leaderboards`, changeFrequency: "daily", priority: 0.7 },
    { url: `${origin}/privacy`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${origin}/terms`, changeFrequency: "monthly", priority: 0.4 },
  ];
}

export function runPublicMetadataTests() {
  const nonIndexingEnvironment = {
    NODE_ENV: "development",
    LORE_ALLOW_PUBLIC_INDEXING: undefined,
    NEXT_PUBLIC_SITE_URL: undefined,
    NEXT_PUBLIC_MAINTENANCE_MODE: undefined,
    VERCEL_ENV: undefined,
  };
  const productionEnvironment = {
    NODE_ENV: "production",
    LORE_ALLOW_PUBLIC_INDEXING: "1",
    NEXT_PUBLIC_SITE_URL: undefined,
    NEXT_PUBLIC_MAINTENANCE_MODE: undefined,
    VERCEL_ENV: undefined,
  };
  const deniedEnvironments = [
    { ...productionEnvironment, NODE_ENV: "development" },
    { ...productionEnvironment, LORE_ALLOW_PUBLIC_INDEXING: undefined, VERCEL_ENV: "production" },
    { ...productionEnvironment, NEXT_PUBLIC_MAINTENANCE_MODE: "1", VERCEL_ENV: "production" },
    { ...productionEnvironment, VERCEL_ENV: "preview" },
    {
      ...productionEnvironment,
      NEXT_PUBLIC_SITE_URL: "https://preview.playlore.xyz",
      VERCEL_ENV: "production",
    },
  ];
  const publicPageMetadata = readPublicPageMetadataBehavior();
  const defaultRootMetadata = readRootMetadataForEnvironment(nonIndexingEnvironment);
  const configuredRootMetadata = readRootMetadataForEnvironment({
    ...nonIndexingEnvironment,
    NEXT_PUBLIC_SITE_URL: "  https://example.test/base///  ",
  });
  assert.equal(
    defaultRootMetadata.metadataBase,
    "https://playlore.xyz/",
    "root metadata must default to the canonical playlore.xyz origin",
  );
  assert.equal(
    configuredRootMetadata.metadataBase,
    "https://example.test/base",
    "root metadata must trim and remove trailing slashes from the configured origin",
  );
  assert.equal(
    defaultRootMetadata.canonical,
    "/",
    "root metadata must publish a canonical home URL",
  );
  assert.equal(
    defaultRootMetadata.openGraphUrl,
    "/",
    "root OpenGraph metadata must publish the canonical home URL",
  );
  assert.deepEqual(
    {
      admitted: readRootMetadataForEnvironment(productionEnvironment).robots,
      denied: deniedEnvironments.map((environment) => readRootMetadataForEnvironment(environment).robots),
    },
    {
      admitted: null,
      denied: deniedEnvironments.map(() => ({ index: false, follow: false })),
    },
    "root metadata indexing must require complete production admission and otherwise fail closed",
  );
  assert.deepEqual(
    readSitemapForEnvironment({ NEXT_PUBLIC_SITE_URL: undefined }),
    expectedSitemap("https://playlore.xyz"),
    "sitemap must publish the exact public route policy on the canonical default origin",
  );
  assert.deepEqual(
    readSitemapForEnvironment({ NEXT_PUBLIC_SITE_URL: "  https://example.test/base///  " }),
    expectedSitemap("https://example.test/base"),
    "sitemap must trim and remove trailing slashes from a configured origin",
  );
  assert.deepEqual(publicPageMetadata.pages, {
    faq: { title: "FAQ | LORE", canonical: "/faq" },
    whitepaper: { title: "White Paper | LORE", canonical: "/whitepaper" },
    leaderboards: { title: "Leaderboards | LORE", canonical: "/leaderboards" },
  });
  const expectedProductionRobots = {
    rules: [{
      userAgent: "*",
      allow: ["/", "/faq", "/whitepaper", "/leaderboards", "/privacy", "/terms", "/api/jackpots/og"],
      disallow: ["/api/", "/admin", "/dev"],
    }],
    sitemap: "https://playlore.xyz/sitemap.xml",
    host: "https://playlore.xyz",
  };
  assert.deepEqual(
    readRobotsForEnvironment(productionEnvironment),
    expectedProductionRobots,
    "robots.txt must admit the complete canonical production policy with the default origin",
  );
  assert.deepEqual(
    readRobotsForEnvironment({ ...productionEnvironment, VERCEL_ENV: "production" }),
    expectedProductionRobots,
    "robots.txt must admit the canonical policy on the Vercel production environment",
  );
  assert.deepEqual(
    readRobotsForEnvironment({
      ...productionEnvironment,
      NEXT_PUBLIC_SITE_URL: "  https://playlore.xyz///  ",
    }),
    expectedProductionRobots,
    "robots.txt must trim and remove trailing slashes from the canonical production origin",
  );

  for (const environment of deniedEnvironments) {
    assert.deepEqual(
      readRobotsForEnvironment(environment),
      { rules: [{ userAgent: "*", disallow: "/" }] },
      `robots indexing admission must fail closed for ${JSON.stringify(environment)}`,
    );
  }
  for (const [route, metadata, title, description] of [
    ["privacy", privacyMetadata, "Privacy Policy | LORE", "How LORE handles wallet, email, and blockchain data."],
    ["terms", termsMetadata, "Terms of Play | LORE", "LORE player responsibilities, risk, fees, and on-chain rules."],
  ]) {
    assert.equal(metadata?.alternates?.canonical, `/${route}`);
    assert.deepEqual(metadata?.openGraph, {
      title,
      description,
      url: `/${route}`,
      type: "website",
      images: ["/opengraph-image"],
    });
    assert.deepEqual(metadata?.twitter, {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    });
  }
  const expectedTxHash = `0x${"1".repeat(64)}`;
  const expectedEventId = `${expectedTxHash}:2`;
  const jackpotEventUrl = `https://playlore.xyz/jackpot-win?event=${encodeURIComponent(expectedEventId)}`;
  assert.deepEqual(publicPageMetadata.jackpot.calls, [
    expectedEventId,
    expectedTxHash,
    "missing-event",
    expectedEventId,
    "missing-page",
  ]);
  assert.deepEqual(publicPageMetadata.jackpot.event, {
    metadataBase: "https://playlore.xyz/",
    canonical: jackpotEventUrl,
    openGraphUrl: jackpotEventUrl,
    imageUrl: `https://playlore.xyz/api/jackpots/og?event=${encodeURIComponent(expectedEventId)}`,
  });
  assert.equal(publicPageMetadata.jackpot.legacyCanonical, jackpotEventUrl);
  assert.deepEqual(publicPageMetadata.jackpot.missing, {
    title: "Jackpot event not found | LORE",
    robots: { index: false, follow: false },
  });
  assert.equal(publicPageMetadata.jackpot.missingPageRejected, true);
  assert.equal(publicPageMetadata.networkCalls, 0);
  const canonicalShareRow = {
    epoch: "9",
    kind: "daily",
    amount: "12.5",
    txHash: expectedTxHash,
    blockNumber: "100",
    eventId: expectedEventId,
    logIndex: "2",
    blockHash: `0x${"a".repeat(64)}`,
    finalizedAtBlock: "101",
  };
  const expectedVerifiedShare = {
    eventId: expectedEventId,
    txHash: expectedTxHash,
    logIndex: "2",
    epoch: "9",
    kind: "daily",
    amount: "12.5",
  };
  assert.deepEqual(
    {
      canonical: selectVerifiedJackpotShare([canonicalShareRow], expectedEventId),
      duplicate: selectVerifiedJackpotShare([canonicalShareRow, { ...canonicalShareRow }], expectedEventId),
      identityMismatch: selectVerifiedJackpotShare([{ ...canonicalShareRow, logIndex: "3" }], expectedEventId),
      invalidBlockHash: selectVerifiedJackpotShare(
        [{ ...canonicalShareRow, blockHash: "0xnot-a-block-hash" }],
        expectedEventId,
      ),
      unfinalized: selectVerifiedJackpotShare(
        [{ ...canonicalShareRow, finalizedAtBlock: "99" }],
        expectedEventId,
      ),
      missingEpoch: selectVerifiedJackpotShare([{ ...canonicalShareRow, epoch: "" }], expectedEventId),
      emptyAmount: selectVerifiedJackpotShare([{ ...canonicalShareRow, amount: "   " }], expectedEventId),
    },
    {
      canonical: expectedVerifiedShare,
      duplicate: null,
      identityMismatch: null,
      invalidBlockHash: null,
      unfinalized: null,
      missingEpoch: null,
      emptyAmount: { ...expectedVerifiedShare, amount: null },
    },
    "jackpot shares must derive public fields from exactly one canonical finalized event",
  );
  assert.match(
    publicPageMetadata.jackpot.renderedEventPage,
    /<a\b[^>]*href="\/"[^>]*>Play at playlore\.xyz<\/a>/,
    "jackpot share preview page CTA must render playlore.xyz as the home link",
  );
}
