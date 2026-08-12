import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runTutorialAndPublicCopyTests() {
  const whitePaperSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  const faqSource = readFileSync("app/components/FAQ.tsx", "utf8");
  const homePageSource = readFileSync("app/page.tsx", "utf8");
  const firstVisitTutorialSource = readFileSync("app/components/FirstVisitTutorial.tsx", "utf8");
  assert.match(
    firstVisitTutorialSource,
    /aria-labelledby=\{titleId\}[\s\S]*aria-describedby=\{`\$\{stepTitleId\} \$\{descriptionId\}`\}/,
    "first-visit tutorial dialog must expose a stable dialog name and the current step title/body to assistive technology",
  );
  assert.match(
    firstVisitTutorialSource,
    /<h2 id=\{titleId\} className="sr-only">First visit tutorial<\/h2>[\s\S]*<h3 id=\{stepTitleId\}[\s\S]*<p id=\{descriptionId\}/,
    "first-visit tutorial stable title, step title, and body ids must stay wired to the dialog",
  );
  assert.doesNotMatch(
    firstVisitTutorialSource,
    /aria-label="First visit tutorial"/,
    "first-visit tutorial must not fall back to a generic dialog label",
  );
  assert.match(
    firstVisitTutorialSource,
    /role="progressbar"[\s\S]*aria-label="Tutorial progress"[\s\S]*aria-valuemin=\{1\}[\s\S]*aria-valuemax=\{TUTORIAL_STEPS\.length\}[\s\S]*aria-valuenow=\{stepIndex \+ 1\}/,
    "first-visit tutorial progress must expose the current step to assistive technology",
  );
  assert.match(
    firstVisitTutorialSource,
    /function readTutorialDismissed\(\): boolean[\s\S]*dismissed === "1"[\s\S]*dismissed === "true"[\s\S]*setItem\(FIRST_VISIT_TUTORIAL_KEY, "1"\)[\s\S]*removeItem\(FIRST_VISIT_TUTORIAL_KEY\)/,
    "first-visit tutorial must normalize legacy dismissed state and clear invalid localStorage values",
  );
  assert.match(
    homePageSource,
    /Promise\.all\(\[\s*getInitialLiveState\(\),\s*getInitialRecentWins\(\),?\s*\]\)/,
    "homepage SSR must load independent live-state and recent-wins bootstrap data concurrently",
  );
  assert.match(
    homePageSource,
    /MAX_TIMER_DELAY_MS = 2_147_483_647[\s\S]*function withTimeout<T>\(promise: Promise<T>, timeoutMs: number\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs <= 0[\s\S]*timeoutMs > MAX_TIMER_DELAY_MS[\s\S]*return Promise\.resolve\(null\)/,
    "homepage SSR timeout helper must fail closed on fractional, unsafe, or oversized timer delays",
  );
  assert.doesNotMatch(whitePaperSource, /Claim Anytime/, "White Paper must not promise perpetual claims");
  assert.doesNotMatch(
    whitePaperSource,
    /title="Cycles"[\s\S]{0,220}(?:1(?:\u2013|-)\u221e|infinite|unlimited)/i,
    "White Paper must not imply unlimited Auto-Miner cycles",
  );
  assert.match(
    whitePaperSource,
    /Total rounds to auto-bet \(1-5000\)/,
    "White Paper Auto-Miner cycle copy must match the runtime 5000-cycle cap",
  );
  assert.doesNotMatch(
    `${whitePaperSource}\n${faqSource}`,
    /(?:tested on|During) Sepolia\b/,
    "player-facing docs must name Linea Sepolia instead of generic Sepolia",
  );
  assert.match(
    faqSource,
    /<button[\s\S]{0,120}type="button"[\s\S]{0,160}aria-expanded=\{isOpen\}[\s\S]*aria-controls=\{panelId\}/,
    "FAQ accordion buttons must remain non-submit controls with expanded/panel wiring",
  );
  assert.match(
    whitePaperSource,
    /CONTRACT_ADDRESS[\s\S]*shortenAddress\(CONTRACT_ADDRESS\)/,
    "White Paper must display the configured game contract instead of a stale literal address",
  );
  assert.match(
    whitePaperSource,
    /LINEA_TOKEN_ADDRESS[\s\S]*shortenAddress\(LINEA_TOKEN_ADDRESS\)/,
    "White Paper must display the configured LINEA token instead of a stale literal address",
  );
}
