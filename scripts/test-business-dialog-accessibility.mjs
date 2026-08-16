import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as dialogFocusTrapModule from "../app/hooks/useDialogFocusTrap.ts";

const dialogFocusTrap = dialogFocusTrapModule.default ?? dialogFocusTrapModule;

export function runDialogAccessibilityTests() {
  const dialogFocusTrapSource = readFileSync("app/hooks/useDialogFocusTrap.ts", "utf8");
  assert.match(
    dialogFocusTrapSource,
    /return activateDialogFocusTrap\(\{[\s\S]*getEscapeHandler: \(\) => onEscapeRef\.current/,
    "the React hook must delegate focus behavior to the executable dialog runtime with a fresh Escape callback",
  );

  const listeners = new Set();
  const documentRef = {
    activeElement: null,
    body: { style: { overflow: "auto" } },
    addEventListener(type, listener) {
      assert.equal(type, "keydown");
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, "keydown");
      listeners.delete(listener);
    },
  };
  const dispatchKey = (key, shiftKey = false) => {
    let prevented = false;
    const event = { key, shiftKey, preventDefault: () => { prevented = true; } };
    for (const listener of [...listeners]) listener(event);
    return prevented;
  };
  const createElement = ({
    rectCount = 1,
    hidden = false,
    display = "block",
    visibility = "visible",
    disabled = false,
    ariaDisabled = false,
    disabledFieldset = false,
    ariaHidden = false,
    inert = false,
    roleDialog = false,
  } = {}) => {
    const element = {
      hidden,
      isConnected: true,
      focusCount: 0,
      computedStyle: { display, visibility },
      getClientRects: () => Array.from({ length: rectCount }, () => ({})),
      hasAttribute: (name) => name === "disabled" && disabled,
      getAttribute: (name) => name === "aria-disabled" && ariaDisabled ? "true" : null,
      closest: (selector) => {
        if (selector === "fieldset[disabled]" && disabledFieldset) return {};
        if (selector === "[aria-hidden='true']" && ariaHidden) return {};
        if (selector === "[inert]" && inert) return {};
        return null;
      },
      matches: (selector) => selector === "[role='dialog']" && roleDialog,
      querySelector: () => null,
      querySelectorAll: () => [],
      contains: (candidate) => candidate === element,
      focus() {
        element.focusCount += 1;
        documentRef.activeElement = element;
      },
    };
    return element;
  };
  const getComputedStyleForElement = (element) => element.computedStyle;

  assert.equal(dialogFocusTrap.isDialogFocusableCandidate(createElement(), getComputedStyleForElement), true);
  for (const rejected of [
    createElement({ rectCount: 0 }),
    createElement({ hidden: true }),
    createElement({ display: "none" }),
    createElement({ visibility: "hidden" }),
    createElement({ visibility: "collapse" }),
    createElement({ disabled: true }),
    createElement({ ariaDisabled: true }),
    createElement({ disabledFieldset: true }),
    createElement({ ariaHidden: true }),
    createElement({ inert: true }),
  ]) {
    assert.equal(
      dialogFocusTrap.isDialogFocusableCandidate(rejected, getComputedStyleForElement),
      false,
      "non-rendered, disabled, aria-hidden, and inert candidates must be excluded",
    );
  }

  const previousFocus = createElement();
  const hiddenPreferred = createElement({ hidden: true });
  const first = createElement();
  const last = createElement();
  const container = createElement({ roleDialog: true });
  container.querySelector = (selector) => selector === "#preferred" ? hiddenPreferred : null;
  container.querySelectorAll = () => [hiddenPreferred, first, last];
  container.contains = (candidate) => candidate === container || candidate === hiddenPreferred || candidate === first || candidate === last;
  let oldEscapeCalls = 0;
  let newEscapeCalls = 0;
  let escapeHandler = () => { oldEscapeCalls += 1; };
  const cleanup = dialogFocusTrap.activateDialogFocusTrap({
    container,
    previousFocus,
    initialFocusSelector: "#preferred",
    getEscapeHandler: () => escapeHandler,
    documentRef,
    getComputedStyleForElement,
  });
  assert.equal(first.focusCount, 1, "invalid initial focus must fall back to the first eligible control");
  assert.equal(documentRef.body.style.overflow, "hidden");
  escapeHandler = () => { newEscapeCalls += 1; };
  assert.equal(dispatchKey("Escape"), true);
  assert.equal(oldEscapeCalls, 0, "the trap must not retain a stale Escape handler");
  assert.equal(newEscapeCalls, 1);
  documentRef.activeElement = last;
  assert.equal(dispatchKey("Tab"), true);
  assert.equal(first.focusCount, 2, "forward Tab from the last item must wrap to the first");
  documentRef.activeElement = first;
  assert.equal(dispatchKey("Tab", true), true);
  assert.equal(last.focusCount, 1, "reverse Tab from the first item must wrap to the last");
  documentRef.activeElement = createElement();
  assert.equal(dispatchKey("Tab"), true);
  assert.equal(first.focusCount, 3, "escaped focus must recover to the first eligible control");
  cleanup();
  assert.equal(previousFocus.focusCount, 1, "cleanup must restore an attached rendered prior focus target");
  assert.equal(documentRef.body.style.overflow, "auto");
  assert.equal(listeners.size, 0);

  const fallbackDialog = createElement({ roleDialog: true });
  const overlay = createElement();
  overlay.querySelector = (selector) => selector === "[role='dialog']" ? fallbackDialog : null;
  const disconnectedPrevious = createElement();
  disconnectedPrevious.isConnected = false;
  const cleanupFallback = dialogFocusTrap.activateDialogFocusTrap({
    container: overlay,
    previousFocus: disconnectedPrevious,
    getEscapeHandler: () => undefined,
    documentRef,
    getComputedStyleForElement,
  });
  assert.equal(fallbackDialog.focusCount, 1, "an overlay-mounted trap must focus its dialog root when no control is eligible");
  cleanupFallback();
  assert.equal(disconnectedPrevious.focusCount, 0, "cleanup must not focus a disconnected prior target");

  const cleanupOuter = dialogFocusTrap.activateDialogFocusTrap({
    container,
    previousFocus: null,
    getEscapeHandler: () => undefined,
    documentRef,
    getComputedStyleForElement,
  });
  const cleanupInner = dialogFocusTrap.activateDialogFocusTrap({
    container,
    previousFocus: null,
    getEscapeHandler: () => undefined,
    documentRef,
    getComputedStyleForElement,
  });
  cleanupOuter();
  assert.equal(documentRef.body.style.overflow, "hidden", "one active nested dialog must retain the scroll lock");
  cleanupInner();
  assert.equal(documentRef.body.style.overflow, "auto", "the final nested cleanup must restore body scrolling");

  const chatProfileFocusSource = readFileSync("app/components/chat/ChatProfileModal.tsx", "utf8");
  assert.match(
    chatProfileFocusSource,
    /useDialogFocusTrap<HTMLDivElement>\(true, onClose, "#profile-name"\)/,
    "chat profile must use the shared focus trap while preserving its initial name-field focus",
  );
  assert.match(
    chatProfileFocusSource,
    /aria-labelledby=\{titleId\}[\s\S]*aria-describedby=\{descriptionId\}[\s\S]*<p id=\{descriptionId\} className="sr-only">/,
    "chat profile dialog must expose a stable accessible description without visible UI copy",
  );

  const jackpotBannerSource = readFileSync("app/components/JackpotBanner.tsx", "utf8");
  assert.match(
    jackpotBannerSource,
    /useDialogFocusTrap\(isModalOpen, handleClose, undefined, overlayRef\)/,
    "jackpot modal must use the shared focus trap while preserving background inerting",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /document\.addEventListener\("keydown"/,
    "jackpot modal must not maintain a second dialog keyboard trap",
  );
  assert.match(
    chatProfileFocusSource,
    /aria-label="Close"[\s\S]*title="Close"/,
    "chat profile close button must expose a standard accessible and hover label",
  );
  assert.doesNotMatch(
    chatProfileFocusSource,
    /document\.addEventListener\("keydown"/,
    "chat profile must not maintain a second dialog keyboard trap",
  );
}
