import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as reducedMotionModule from "../app/lib/reducedMotionRuntime.ts";
import * as whitePaperModule from "../app/components/WhitePaper.tsx";

const reducedMotionRuntime = reducedMotionModule.default ?? reducedMotionModule;
const whitePaper = whitePaperModule.default ?? whitePaperModule;
const WhitePaper = whitePaper.WhitePaper;

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

  const storage = new Map();
  const removed = [];
  const media = {
    matches: true,
    listeners: new Set(),
    addEventListener(type, listener) {
      assert.equal(type, "change");
      this.listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, "change");
      this.listeners.delete(listener);
    },
  };
  const storageAdapter = {
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => {
      removed.push(key);
      storage.delete(key);
    },
  };
  assert.deepEqual(
    reducedMotionRuntime.readReducedMotionPreference({ storage: storageAdapter, media }),
    { explicit: false, reduced: true },
    "the operating-system preference must apply when storage has no override",
  );
  storage.set(reducedMotionRuntime.REDUCED_MOTION_STORAGE_KEY, "true");
  assert.deepEqual(reducedMotionRuntime.readReducedMotionPreference({ storage: storageAdapter, media }), { explicit: true, reduced: true });
  storage.set(reducedMotionRuntime.REDUCED_MOTION_STORAGE_KEY, "false");
  assert.deepEqual(reducedMotionRuntime.readReducedMotionPreference({ storage: storageAdapter, media }), { explicit: true, reduced: false });
  storage.set(reducedMotionRuntime.REDUCED_MOTION_STORAGE_KEY, "invalid");
  assert.deepEqual(reducedMotionRuntime.readReducedMotionPreference({ storage: storageAdapter, media }), { explicit: false, reduced: true });
  assert.deepEqual(removed, [reducedMotionRuntime.REDUCED_MOTION_STORAGE_KEY], "invalid override values must be removed exactly");
  assert.deepEqual(
    reducedMotionRuntime.readReducedMotionPreference({
      storage: { getItem: () => { throw new Error("storage unavailable"); }, removeItem: () => { throw new Error("unreachable"); } },
      media: { matches: false },
    }),
    { explicit: false, reduced: false },
    "storage errors must fail closed to the available system preference",
  );
  let explicit = false;
  const observed = [];
  const unsubscribe = reducedMotionRuntime.subscribeToSystemReducedMotion(media, () => explicit, (value) => observed.push(value));
  for (const listener of media.listeners) listener({ matches: false });
  explicit = true;
  for (const listener of media.listeners) listener({ matches: true });
  assert.deepEqual(observed, [false], "system changes must stop affecting the state after an explicit override");
  unsubscribe();
  assert.equal(media.listeners.size, 0, "media-query listeners must be removed on cleanup");

  const preferenceListeners = new Set();
  const preferenceTarget = {
    addEventListener(type, listener) {
      assert.equal(type, reducedMotionRuntime.REDUCED_MOTION_CHANGE_EVENT);
      preferenceListeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, reducedMotionRuntime.REDUCED_MOTION_CHANGE_EVENT);
      preferenceListeners.delete(listener);
    },
  };
  const synchronizedPreferences = [];
  const unsubscribePreference = reducedMotionRuntime.subscribeToReducedMotionPreference(
    preferenceTarget,
    (reduced) => synchronizedPreferences.push(reduced),
  );
  for (const listener of preferenceListeners) listener({ detail: true });
  for (const listener of preferenceListeners) listener({ detail: "true" });
  assert.deepEqual(synchronizedPreferences, [true], "same-tab preference changes must accept only boolean values");
  unsubscribePreference();
  for (const listener of preferenceListeners) listener({ detail: false });
  assert.deepEqual(synchronizedPreferences, [true], "preference listeners must be removed on cleanup");

  assert.equal(reducedMotionRuntime.shouldRenderMotionDecorations(false, false), false);
  assert.equal(reducedMotionRuntime.shouldRenderMotionDecorations(true, true), false);
  assert.equal(reducedMotionRuntime.shouldRenderMotionDecorations(true, false), true);
  assert.equal(reducedMotionRuntime.motionClass(true, "animate-ping"), "");
  assert.equal(reducedMotionRuntime.motionClass(false, "animate-ping"), "animate-ping");

  const whitePaperMotionSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  const whitePaperSsrMarkup = renderToStaticMarkup(React.createElement(WhitePaper));
  assert.doesNotMatch(
    whitePaperSsrMarkup,
    /animation:float /,
    "White Paper decorative particles must not render before the client knows the motion preference",
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
