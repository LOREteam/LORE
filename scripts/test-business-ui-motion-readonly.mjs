import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runUiMotionAndReadOnlyTests() {
  const proxySource = readFileSync("proxy.ts", "utf8");
  assert.match(proxySource, /export function proxy\(request: NextRequest\)/, "Next.js 16 security headers must use the root Proxy convention");
  assert.match(
    proxySource,
    /Content-Security-Policy[\s\S]*X-Frame-Options[\s\S]*X-Permitted-Cross-Domain-Policies[\s\S]*Permissions-Policy/,
    "root Proxy must enforce the security header set",
  );

  const layoutSource = readFileSync("app/layout.tsx", "utf8");
  assert.match(layoutSource, /<script nonce=\{nonce\} src="\/early-runtime\.js" suppressHydrationWarning \/>/, "early runtime script nonce must suppress browser-hidden nonce hydration noise");

  const reducedMotionSource = readFileSync("app/hooks/useReducedMotion.ts", "utf8");
  assert.match(
    reducedMotionSource,
    /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/,
    "reduced-motion state must fall back to the operating-system preference",
  );
  assert.match(
    reducedMotionSource,
    /media\.addEventListener\("change", handleChange\)/,
    "reduced-motion state must follow operating-system preference changes until the user overrides it",
  );
  assert.match(
    reducedMotionSource,
    /if \(stored !== null\) localStorage\.removeItem\(STORAGE_KEY\)/,
    "reduced-motion preference restore must clear invalid localStorage values",
  );

  const pageBackdropSource = readFileSync("app/components/PageBackdrop.tsx", "utf8");
  assert.match(
    pageBackdropSource,
    /\{motionReady && !reducedMotion && <CrystalParticles \/>}/,
    "decorative background particle animation must not render until motion preference is known and reduced motion is off",
  );

  const maintenanceOverlaySource = readFileSync("app/components/MaintenanceOverlay.tsx", "utf8");
  assert.match(
    maintenanceOverlaySource,
    /useReducedMotion[\s\S]*const \{ reducedMotion \} = useReducedMotion\(\)[\s\S]*reducedMotion \? "" : "animate-\[orb-drift-1_12s_ease-in-out_infinite\]"[\s\S]*reducedMotion \? "" : "animate-float"[\s\S]*reducedMotion \? "" : "animate-ping"/,
    "maintenance overlay decorative animations must respect reduced-motion preference",
  );

  const whitePaperMotionSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  assert.match(
    whitePaperMotionSource,
    /useReducedMotion[\s\S]*const \{ reducedMotion, motionReady \} = useReducedMotion\(\)[\s\S]*\{motionReady && !reducedMotion && <FloatingParticles \/>}/,
    "White Paper decorative particles must not render until motion preference is known and reduced motion is off",
  );
  assert.match(
    whitePaperMotionSource,
    /function FloatingParticles[\s\S]*aria-hidden="true"[\s\S]*pointer-events-none/,
    "White Paper decorative particles must stay hidden from assistive technology",
  );

  const globalsSource = readFileSync("app/globals.css", "utf8");
  assert.match(
    globalsSource,
    /html\[data-motion="reduced"\] \*[\s\S]*animation-duration: 0\.001ms !important;[\s\S]*animation-delay: 0ms !important;[\s\S]*transition-duration: 0s !important;[\s\S]*transition-delay: 0s !important;/,
    "global reduced-motion mode must suppress both animations and transitions without per-component class rewrites",
  );

  const smokeBrowserSource = readFileSync("scripts/smoke-browser.mjs", "utf8");
  assert.match(smokeBrowserSource, /SMOKE_EXPECT_READ_ONLY/, "browser smoke must support an explicit read-only maintenance mode check");
  assert.match(smokeBrowserSource, /verifyReadOnlyMode/, "browser smoke must verify the read-only betting UI when requested");
  assert.match(
    smokeBrowserSource,
    /SKIP auto-miner persistence step in read-only smoke/,
    "browser smoke must skip input-mutating auto-miner checks in read-only mode",
  );

  const lineaOreClientRuntimeSource = readFileSync("app/hooks/useLineaOreClientRuntime.ts", "utf8");
  assert.match(lineaOreClientRuntimeSource, /getConfiguredReadOnlyMode/, "client runtime must read the public read-only mode flag");
  assert.match(lineaOreClientRuntimeSource, /readOnlyReason/, "client runtime must expose a user-facing read-only reason");
}
