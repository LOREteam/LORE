import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runDialogAccessibilityTests() {
  const dialogFocusTrapSource = readFileSync("app/hooks/useDialogFocusTrap.ts", "utf8");
  assert.match(
    dialogFocusTrapSource,
    /const isRenderedEnabledElement[\s\S]*window\.getComputedStyle\(element\)[\s\S]*getClientRects\(\)\.length > 0[\s\S]*!element\.hidden[\s\S]*style\.display !== "none"[\s\S]*style\.visibility !== "hidden"[\s\S]*style\.visibility !== "collapse"[\s\S]*!element\.hasAttribute\("disabled"\)[\s\S]*getAttribute\("aria-disabled"\) !== "true"[\s\S]*closest\("fieldset\[disabled\]"\)[\s\S]*isFocusableCandidate[\s\S]*closest\("\[aria-hidden='true'\]"\)[\s\S]*closest\("\[inert\]"\)/,
    "dialog focus traps must skip hidden, non-rendered, disabled, aria-disabled, disabled-fieldset, aria-hidden, and inert controls",
  );
  assert.match(
    dialogFocusTrapSource,
    /isFocusableCandidate[\s\S]*querySelector<HTMLElement>\(initialFocusSelector\)[\s\S]*isFocusableCandidate\(initialFocus\)/,
    "dialog focus traps must validate the requested initial focus target before focusing it",
  );
  assert.match(
    dialogFocusTrapSource,
    /!container\?\.contains\(active\)/,
    "dialog focus traps must recover when focus escapes the active dialog",
  );
  assert.match(
    dialogFocusTrapSource,
    /fallbackFocusTarget[\s\S]*querySelector<HTMLElement>\("\[role='dialog'\]"\)[\s\S]*fallbackFocusTarget\(\)\?\.focus\(\)/,
    "dialog focus traps must focus the dialog root when the trap is mounted on an overlay",
  );
  assert.match(
    dialogFocusTrapSource,
    /previousFocus\?\.isConnected[\s\S]*isRenderedEnabledElement\(previousFocus\)[\s\S]*previousFocus\.focus\(\)/,
    "dialog focus traps must only restore focus to an attached, visible, enabled element",
  );
  assert.match(
    dialogFocusTrapSource,
    /activeDialogScrollLocks[\s\S]*document\.body\.style\.overflow = "hidden"[\s\S]*unlockBodyScroll\(\)/,
    "dialog focus traps must lock and restore body scrolling while overlays are active",
  );
  assert.match(
    dialogFocusTrapSource,
    /const onEscapeRef = useRef\(onEscape\)[\s\S]*onEscapeRef\.current = onEscape[\s\S]*const escapeHandler = onEscapeRef\.current[\s\S]*escapeHandler\(\)/,
    "dialog focus traps must keep Escape handlers fresh without remounting the trap on callback identity changes",
  );
  assert.doesNotMatch(
    dialogFocusTrapSource,
    /\[active, containerRef, initialFocusSelector, onEscape\]/,
    "dialog focus traps must not refocus and restore scroll just because onEscape was recreated",
  );

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
