import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

export function runDirectRouteSsrTests() {
  const routeCases = [
    ["/faq", "faq", "app/faq/page.tsx", /<LorePage initialTab="faq" \/>/, /Quick Answers/],
    ["/whitepaper", "whitepaper", "app/whitepaper/page.tsx", /<LorePage initialTab="whitepaper" \/>/, /White Paper/],
    ["/leaderboards", "leaderboards", "app/leaderboards/page.tsx", /<LorePage initialTab="leaderboards" \/>/, /On-chain leaderboards/],
  ];

  for (const [pathname, tab, routeFile, routeMarkup, expectedContent] of routeCases) {
    const savedTab = tab === "faq" ? "analytics" : "faq";
    assert.equal(
      appShellState.resolveRequestedAppShellTab({ pathname, hash: "#hub" }, savedTab),
      tab,
      `${pathname} must beat both a hash and local-storage tab during hydration`,
    );
    assert.match(readFileSync(routeFile, "utf8"), routeMarkup, `${pathname} must pass its tab to the server page`);

    const markup = renderPublicPanel(tab);
    assert.match(markup, expectedContent, `${pathname} must server-render its requested public content`);
    assert.doesNotMatch(markup, /Loading panel\.\.\./, `${pathname} must not server-render the deferred-panel fallback`);
  }

  const serverPageSource = readFileSync("app/LorePage.tsx", "utf8");
  const clientSource = readFileSync("app/LineaOreClient.tsx", "utf8");
  const shellSource = readFileSync("app/hooks/useAppShellState.ts", "utf8");
  assert.match(serverPageSource, /export async function LorePage\(\{ initialTab = "hub" \}/, "server page must accept an explicit initial tab");
  assert.match(serverPageSource, /<LineaOreClient[\s\S]*initialTab=\{initialTab\}/, "server page must pass the requested tab into the client shell's first render");
  assert.match(clientSource, /initialTab = "hub"[\s\S]*useLineaOreClientRuntime\([\s\S]*initialTab/, "client shell must carry the server-selected tab into runtime state");
  assert.match(shellSource, /useState<TabId>\(initialTab\)/, "app shell must use the server-selected tab before layout effects run");
}

if (process.argv[1]?.endsWith("test-business-direct-route-ssr.mjs")) {
  runDirectRouteSsrTests();
  console.log("direct-route-ssr-pass");
}