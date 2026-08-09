import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readSource = (path: string) => readFileSync(join(root, path), "utf8");

const confettiSource = readSource("app/components/Confetti.tsx");
const crystalParticlesSource = readSource("app/components/CrystalParticles.tsx");
const miningGridSource = readSource("app/components/MiningGrid.tsx");
const sidebarSource = readSource("app/components/Sidebar.tsx");
const dialogTrapSource = readSource("app/hooks/useDialogFocusTrap.ts");

for (const source of [confettiSource, crystalParticlesSource]) {
  assert.match(source, /useReducedMotion\(\)/);
  assert.match(source, /motionReady/);
  assert.match(source, /reducedMotion/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /observer\?\.disconnect\(\)/);
}

assert.match(confettiSource, /role="status"/);
assert.match(confettiSource, /aria-live="polite"/);
assert.match(confettiSource, /Your winning tile has been revealed\./);
assert.match(confettiSource, /motionReady && !reducedMotion/);
assert.match(miningGridSource, /setShowConfetti\(winningTileHasMyBet\)/);
assert.match(miningGridSource, /<Confetti active=\{showConfetti\}[^>]*reducedMotion=\{reducedMotion\}/);
assert.doesNotMatch(miningGridSource, /<Confetti active=\{!reducedMotion/);

assert.match(sidebarSource, /useDialogFocusTrap<HTMLElement>\(mobileOpen, onMobileClose\)/);
assert.match(sidebarSource, /ref=\{dialogRef\}/);
assert.match(sidebarSource, /role=\{mobileOpen \? "dialog" : undefined\}/);
assert.match(sidebarSource, /aria-modal=\{mobileOpen \? "true" : undefined\}/);
assert.match(sidebarSource, /aria-labelledby=\{mobileOpen \? "lore-sidebar-title" : undefined\}/);
assert.match(sidebarSource, /id="lore-sidebar-title"/);
assert.match(sidebarSource, /tabIndex=\{-1\}[\s\S]*aria-hidden="true"[\s\S]*onClick=\{onMobileClose\}/);

assert.match(dialogTrapSource, /event\.key === "Escape"/);
assert.match(dialogTrapSource, /event\.key !== "Tab"/);
assert.match(dialogTrapSource, /previousFocus\?\.isConnected/);
assert.match(dialogTrapSource, /previousFocus\.focus\(\)/);

console.log(JSON.stringify({
  status: "pass",
  motionCanvases: 2,
  canvasFallbackAnnouncement: true,
  mobileDialogSemantics: true,
  escapeTrapAndFocusReturn: true,
}));
