import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function runTutorialAndPublicCopyTests() {
  const homePageSource = readFileSync("app/page.tsx", "utf8");
  const firstVisitTutorialSource = readFileSync("app/components/FirstVisitTutorial.tsx", "utf8");
  const faqSource = readFileSync("app/components/FAQ.tsx", "utf8");
  const backupGateSource = readFileSync("app/components/BackupGate.tsx", "utf8");
  const whitePaperSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  assert.match(
    faqSource,
    /Sign in with email or connect an existing external wallet[\s\S]*After email sign-in, the embedded Privy wallet is normally created automatically[\s\S]*Wallet Settings and create it there[\s\S]*Export and safely back up its private key/,
    "FAQ must describe the real email/external-wallet entry path, normal embedded-wallet creation, Settings fallback, and private-key backup",
  );
  assert.match(
    faqSource,
    /same enabled method that created it \(email or your external wallet\)[\s\S]*not an independent recovery guarantee[\s\S]*private key/,
    "FAQ recovery copy must bind normal restoration to the same enabled method and retain private-key recovery guidance",
  );
  assert.doesNotMatch(faqSource, /email, Google, or an existing wallet|same email or social account/, "FAQ must not promise unsupported Google or social recovery");
  assert.match(
    firstVisitTutorialSource,
    /After email sign-in, Privy normally creates the embedded wallet[\s\S]*Wallet Settings[\s\S]*private-key backup[\s\S]*same enabled method/,
    "tutorial must match the email creation, Settings fallback, same-method restoration, and backup model",
  );
  assert.doesNotMatch(firstVisitTutorialSource, /Sign in with the same account to restore normal access/, "tutorial must not imply every account method restores the embedded wallet");
  assert.match(
    backupGateSource,
    /same enabled method that created it \(email or your external wallet\)[\s\S]*private-key backup is your independent recovery route/,
    "backup gate must distinguish same-method access from independent private-key recovery",
  );
  assert.doesNotMatch(backupGateSource, /same email or social login/, "backup gate must not promise social-login recovery");
  assert.match(
    whitePaperSource,
    /Login with email or an existing external wallet[\s\S]*Email sign-in normally creates the embedded wallet[\s\S]*Wallet Settings[\s\S]*same enabled method[\s\S]*private key/,
    "White Paper must match the documented entry, Settings fallback, restoration, and backup model",
  );
  assert.doesNotMatch(whitePaperSource, /Login with email, social, or existing wallet/, "White Paper must not advertise unsupported social login");
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
  const presentation = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/test-public-copy-presentation.tsx"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(presentation.error, undefined, `public-copy presentation fixture failed to launch: ${presentation.error?.message ?? "unknown error"}`);
  assert.equal(presentation.signal, null, `public-copy presentation fixture was terminated by ${presentation.signal ?? "an unknown signal"}`);
  assert.equal(presentation.status, 0, `public-copy presentation fixture failed:\n${presentation.stderr || presentation.stdout}`);
}
