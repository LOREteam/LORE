import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRIVY_LOGIN_ACCESSIBLE_NAME,
  canRequestPrivyLogin,
  derivePrivyLoginUiState,
  formatPrivyLoginFailure,
  selectPrivyLoginFocusDestination,
  shouldRestorePrivyLoginFocus,
} from "../app/hooks/usePrivyLoginAccessibility";

const root = process.cwd();
const readSource = (path: string) => readFileSync(join(root, path), "utf8");

assert.equal(PRIVY_LOGIN_ACCESSIBLE_NAME, "Login or connect wallet");

const loading = derivePrivyLoginUiState({
  authenticated: false,
  error: null,
  modalOpen: false,
  pending: false,
  ready: false,
});
assert.deepEqual(
  { busy: loading.busy, disabled: loading.disabled, text: loading.buttonText, status: loading.statusAnnouncement },
  { busy: true, disabled: true, text: "Wallet Loading...", status: "Wallet login is loading." },
);

const ready = derivePrivyLoginUiState({
  authenticated: false,
  error: null,
  modalOpen: false,
  pending: false,
  ready: true,
});
assert.deepEqual(
  { busy: ready.busy, disabled: ready.disabled, text: ready.buttonText, status: ready.statusAnnouncement },
  { busy: false, disabled: false, text: "Login / Connect", status: "Wallet login is ready." },
);

const opening = derivePrivyLoginUiState({
  authenticated: false,
  error: null,
  modalOpen: false,
  pending: true,
  ready: true,
});
assert.equal(opening.disabled, true);
assert.equal(opening.statusAnnouncement, "Wallet login is opening.");

const open = derivePrivyLoginUiState({
  authenticated: false,
  error: null,
  modalOpen: true,
  pending: true,
  ready: true,
});
assert.equal(open.disabled, true);
assert.equal(open.statusAnnouncement, "Wallet login dialog is open.");

assert.equal(shouldRestorePrivyLoginFocus(false, false), false);
assert.equal(shouldRestorePrivyLoginFocus(false, true), false);
assert.equal(shouldRestorePrivyLoginFocus(true, true), false);
assert.equal(shouldRestorePrivyLoginFocus(true, false), true);
assert.equal(canRequestPrivyLogin({ authenticated: false, invocationPending: false, modalOpen: false, ready: true }), true);
assert.equal(canRequestPrivyLogin({ authenticated: false, invocationPending: true, modalOpen: false, ready: true }), false);
assert.equal(canRequestPrivyLogin({ authenticated: false, invocationPending: false, modalOpen: true, ready: true }), false);
assert.equal(canRequestPrivyLogin({ authenticated: true, invocationPending: false, modalOpen: false, ready: true }), false);
const connectedTrigger = { isConnected: true } as HTMLButtonElement;
const connectedFallback = { isConnected: true } as HTMLElement;
const disconnectedTrigger = { isConnected: false } as HTMLButtonElement;
assert.equal(selectPrivyLoginFocusDestination(connectedTrigger, connectedFallback, false), connectedTrigger);
assert.equal(selectPrivyLoginFocusDestination(disconnectedTrigger, connectedFallback, false), connectedFallback);
assert.equal(selectPrivyLoginFocusDestination(connectedTrigger, connectedFallback, true), connectedFallback);
assert.equal(formatPrivyLoginFailure(new Error("user denied request")), "Wallet login was cancelled.");
assert.equal(
  formatPrivyLoginFailure(new Error("request timeout")),
  "Wallet login timed out. Try again or reload the page.",
);

const hookSource = readSource("app/hooks/usePrivyLoginAccessibility.ts");
const headerSource = readSource("app/components/Header.tsx");
const modalStatusBridgeSource = readSource("app/components/PrivyModalStatusBridge.tsx");
const walletCardSource = readSource("app/components/header/HeaderWalletCard.tsx");
const adminSource = readSource("app/admin/AdminOpsClient.tsx");
const sdkTypes = readSource("node_modules/@privy-io/react-auth/dist/dts/index.d.ts");

assert.match(sdkTypes, /declare const useModalStatus:\s*\(\)\s*=>\s*\{\s*isOpen:\s*boolean;/s);
assert.match(sdkTypes, /export \{[^}]*\buseModalStatus\b[^}]*\};/s);
assert.doesNotMatch(hookSource, /@privy-io\/react-auth/);
assert.match(modalStatusBridgeSource, /useModalStatus\(\)/);
assert.match(modalStatusBridgeSource, /onChange\(isOpen\)/);
for (const source of [headerSource, adminSource]) {
  assert.match(source, /dynamic\(\(\) => import\([^)]*PrivyModalStatusBridge[^)]*\), \{ ssr: false \}\)/);
  assert.match(source, /ready:\s*\w+\s*&&\s*privyModalStatus\.ready/);
  assert.doesNotMatch(source, /useModalStatus/);
}
assert.match(hookSource, /invocationPendingRef\.current/);
assert.match(hookSource, /modalWasOpenRef\.current/);
assert.match(hookSource, /destination\?\.focus\(\{ preventScroll: true \}\)/);
assert.doesNotMatch(hookSource, /querySelector|privy-dialog|privy-modal|input\[type=["']email/i);
assert.doesNotMatch(modalStatusBridgeSource, /querySelector|privy-dialog|privy-modal|input\[type=["']email/i);

for (const source of [walletCardSource, adminSource]) {
  assert.match(source, /aria-label=\{PRIVY_LOGIN_ACCESSIBLE_NAME\}/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /aria-expanded=/);
  assert.match(source, /aria-describedby=/);
  assert.match(source, /event\.currentTarget/);
  assert.doesNotMatch(source, /querySelector|privy-dialog|privy-modal|input\[type=["']email/i);
}

assert.match(headerSource, /usePrivyLoginAccessibility/);
assert.doesNotMatch(headerSource, /\bonClick=\{login\}/);
assert.doesNotMatch(adminSource, /\bonClick=\{login\}/);
const compactWalletCardSource = walletCardSource.replace(/\s+/g, " ");
const compactAdminSource = adminSource.replace(/\s+/g, " ");
assert.match(compactWalletCardSource, /min-h-11 min-w-11[^>]*> Reload/);
assert.match(compactAdminSource, /min-h-11 min-w-11[^>]*> Reload/);

console.log(JSON.stringify({
  status: "pass",
  runtimeCases: 17,
  sdkModalStatusContract: true,
  lazyModalStatusBridge: true,
  duplicateInvocationGuard: true,
  appOwnedRecoveryTargetsAtLeast44Px: true,
  sdkInternalDomOverrides: false,
}));
