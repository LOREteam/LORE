import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as pageTabPanelsModule from "../app/components/PageTabPanels.tsx";
import * as appShellStateModule from "../app/hooks/useAppShellState.ts";

const pageTabPanels = pageTabPanelsModule.default ?? pageTabPanelsModule;
const appShellState = appShellStateModule.default ?? appShellStateModule;
const PageTabPanels = pageTabPanels.PageTabPanels;

function renderPublicPanel(activeTab) {
  return renderToStaticMarkup(React.createElement(PageTabPanels, {
    activeTab,
    analyticsProps: {},
    hubProps: {},
    leaderboardsProps: { data: null, loading: false, error: null, refetch: () => {} },
    rebateProps: {},
  }));
}

function AppShellInitialTabProbe({ initialTab }) {
  const { activeTab } = appShellState.useAppShellState(initialTab);
  return React.createElement("span", { "data-active-tab": activeTab }, activeTab);
}

function readDirectRouteEntrypointBehavior() {
  const lorePageUrl = new URL("../app/LorePage.tsx", import.meta.url).href;
  const lineaOreClientUrl = new URL("../app/LineaOreClient.tsx", import.meta.url).href;
  const lineaOreClientRuntimeUrl = new URL(
    "../app/hooks/useLineaOreClientRuntime.ts",
    import.meta.url,
  ).href;
  const liveStateSharedUrl = new URL("../app/api/live-state/shared.ts", import.meta.url).href;
  const recentWinsDataUrl = new URL("../app/api/recent-wins/data.ts", import.meta.url).href;
  const componentUrls = Object.fromEntries(
    [
      "Sidebar",
      "Header",
      "MobileTabNav",
      "PageTabContent",
      "WalletShell",
      "OfflineBanner",
      "NoticeStack",
      "PageBackdrop",
      "FloatingActions",
    ].map((name) => [
      name,
      new URL(`../app/components/${name}.tsx`, import.meta.url).href,
    ]),
  );
  const pageUrls = Object.fromEntries(
    ["faq", "whitepaper", "leaderboards"].map((route) => [
      route,
      new URL(`../app/${route}/page.tsx`, import.meta.url).href,
    ]),
  );
  const script = [
    'const { mock } = await import("node:test");',
    'const React = (await import("react")).default;',
    'const { renderToStaticMarkup } = await import("react-dom/server");',
    "let networkCalls = 0;",
    "const runtimeInputs = [];",
    "globalThis.fetch = async () => { networkCalls += 1; throw new Error('direct-route behavior probe forbids network access'); };",
    `const lorePageUrl = ${JSON.stringify(lorePageUrl)};`,
    `const lineaOreClientUrl = ${JSON.stringify(lineaOreClientUrl)};`,
    `mock.module(${JSON.stringify(lineaOreClientRuntimeUrl)}, { namedExports: { useLineaOreClientRuntime: (input) => { runtimeInputs.push(input); return { uiHydrated: false, motionReady: false, reducedMotion: false, notices: [], dismissNotice() {}, activeTab: "analytics", handleTabChange() {}, realTotalStaked: "0", linePath: "", sidebarProps: {}, headerProps: {}, walletShellProps: {}, pageTabContentProps: {}, floatingActionsProps: {} }; } } });`,
    `const componentUrls = ${JSON.stringify(componentUrls)};`,
    "for (const [name, url] of Object.entries(componentUrls)) {",
    "  mock.module(url, { namedExports: { [name]: () => null } });",
    "}",
    'mock.module("next/dynamic", { defaultExport: () => () => null });',
    'const clientModule = await import(`${lineaOreClientUrl}?direct-route-runtime-probe`);',
    "const LineaOreClient = clientModule.default?.default ?? clientModule.default ?? clientModule;",
    'const clientMarkups = [renderToStaticMarkup(React.createElement(LineaOreClient)), renderToStaticMarkup(React.createElement(LineaOreClient, { initialTab: "whitepaper" }))];',
    'mock.module(lineaOreClientUrl, { defaultExport: ({ initialLiveState, initialRecentWins, initialTab }) => React.createElement("main", { "data-tab": initialTab, "data-live": String(initialLiveState), "data-wins": initialRecentWins.length }, initialTab) });',
    `mock.module(${JSON.stringify(liveStateSharedUrl)}, { namedExports: { buildStoredLiveStateBootstrap: () => null, getLiveStatePayloadWithSnapshotFallback: async () => null, loadLiveStateSnapshot: () => null } });`,
    `mock.module(${JSON.stringify(recentWinsDataUrl)}, { namedExports: { getRecentWinsPayloadForRender: async () => ({ wins: [] }), loadRecentWinsSnapshot: () => null, saveRecentWinsSnapshot() {} } });`,
    'const loreModule = await import(`${lorePageUrl}?direct-route-lore-probe`);',
    "const normalizedLoreModule = loreModule.default ?? loreModule;",
    'const loreMarkups = [renderToStaticMarkup(await normalizedLoreModule.LorePage()), renderToStaticMarkup(await normalizedLoreModule.LorePage({ initialTab: "faq" }))];',
    'mock.module(lorePageUrl, { namedExports: { LorePage: ({ initialTab = "hub" } = {}) => React.createElement("main", { "data-initial-tab": initialTab }, initialTab) } });',
    `const pageUrls = ${JSON.stringify(pageUrls)};`,
    "const pages = {};",
    "for (const [route, url] of Object.entries(pageUrls)) {",
    "  const pageModule = await import(url);",
    "  const page = typeof pageModule.default === 'function'",
    "    ? pageModule.default",
    "    : pageModule.default?.default ?? pageModule['module.exports']?.default;",
    "  if (typeof page !== 'function') throw new Error(`missing default page export for ${route}`);",
    "  pages[route] = renderToStaticMarkup(page());",
    "}",
    "console.log(JSON.stringify({ pages, networkCalls, loreMarkups, clientMarkups, runtimeInputs }));",
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
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env },
      maxBuffer: 512 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.signal !== null || result.status !== 0) {
    throw new Error(
      `direct-route entrypoint behavior probe failed: status=${result.status}, signal=${result.signal}\n${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

export function runDirectRouteSsrTests() {
  const routeCases = [
    ["/faq", "faq", /Quick Answers/],
    ["/whitepaper", "whitepaper", /White Paper/],
    ["/leaderboards", "leaderboards", /On-chain leaderboards/],
  ];

  const directRouteBehavior = readDirectRouteEntrypointBehavior();
  assert.deepEqual(
    {
      pages: directRouteBehavior.pages,
      networkCalls: directRouteBehavior.networkCalls,
    },
    {
      pages: {
        faq: '<main data-initial-tab="faq">faq</main>',
        whitepaper: '<main data-initial-tab="whitepaper">whitepaper</main>',
        leaderboards: '<main data-initial-tab="leaderboards">leaderboards</main>',
      },
      networkCalls: 0,
    },
    "direct route entrypoints must pass their requested tab to the shared server page without network access",
  );
  assert.deepEqual(
    directRouteBehavior.loreMarkups,
    [
      '<main data-tab="hub" data-live="null" data-wins="0">hub</main>',
      '<main data-tab="faq" data-live="null" data-wins="0">faq</main>',
    ],
    "server LorePage must default to hub and pass an explicit initial tab into the client shell",
  );
  assert.deepEqual(
    directRouteBehavior.clientMarkups.map((markup) => /<main aria-label="Analytics"/.test(markup)),
    [true, true],
    "client shell must render the active tab returned by runtime rather than its input prop directly",
  );
  assert.deepEqual(
    directRouteBehavior.runtimeInputs,
    [
      { initialLiveState: null, initialRecentWins: [], initialTab: "hub" },
      { initialLiveState: null, initialRecentWins: [], initialTab: "whitepaper" },
    ],
    "client shell must carry both its default and server-selected tabs into runtime state",
  );

  for (const [pathname, tab, expectedContent] of routeCases) {
    const savedTab = tab === "faq" ? "analytics" : "faq";
    assert.equal(
      appShellState.resolveRequestedAppShellTab({ pathname, hash: "#hub" }, savedTab),
      tab,
      `${pathname} must beat both a hash and local-storage tab during hydration`,
    );
    const markup = renderPublicPanel(tab);
    assert.match(markup, expectedContent, `${pathname} must server-render its requested public content`);
    assert.doesNotMatch(markup, /Loading panel\.\.\./, `${pathname} must not server-render the deferred-panel fallback`);
  }

  assert.deepEqual(
    routeCases.map(([, tab]) => renderToStaticMarkup(
      React.createElement(AppShellInitialTabProbe, { initialTab: tab }),
    )),
    [
      '<span data-active-tab="faq">faq</span>',
      '<span data-active-tab="whitepaper">whitepaper</span>',
      '<span data-active-tab="leaderboards">leaderboards</span>',
    ],
    "app shell SSR must use the server-selected tab before client effects run",
  );
}

if (process.argv[1]?.endsWith("test-business-direct-route-ssr.mjs")) {
  runDirectRouteSsrTests();
  console.log("direct-route-ssr-pass");
}
