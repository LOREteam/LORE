"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let activeDialogScrollLocks = 0;
let previousBodyOverflow: string | null = null;

function lockBodyScroll() {
  if (activeDialogScrollLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeDialogScrollLocks += 1;
}

function unlockBodyScroll() {
  activeDialogScrollLocks = Math.max(0, activeDialogScrollLocks - 1);
  if (activeDialogScrollLocks === 0 && previousBodyOverflow !== null) {
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = null;
  }
}

export function useDialogFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
  initialFocusSelector?: string,
  externalRef?: RefObject<T | null>,
) {
  const internalRef = useRef<T>(null);
  const containerRef = externalRef ?? internalRef;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    lockBodyScroll();
    const isRenderedEnabledElement = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return element.getClientRects().length > 0 &&
        !element.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-disabled") !== "true" &&
        !element.closest("fieldset[disabled]");
    };
    const isFocusableCandidate = (element: HTMLElement) =>
      isRenderedEnabledElement(element) &&
      !element.closest("[aria-hidden='true']") &&
      !element.closest("[inert]");
    const focusable = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(isFocusableCandidate);
    const fallbackFocusTarget = () => {
      if (!container) return null;
      return container.matches("[role='dialog']")
        ? container
        : container.querySelector<HTMLElement>("[role='dialog']") ?? container;
    };
    const initialFocus = initialFocusSelector
      ? container?.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    (initialFocus && isFocusableCandidate(initialFocus)
      ? initialFocus
      : focusable()[0] ?? fallbackFocusTarget()
    )?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const escapeHandler = onEscapeRef.current;
      if (event.key === "Escape" && escapeHandler) {
        event.preventDefault();
        escapeHandler();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        fallbackFocusTarget()?.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container?.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !container?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (
        previousFocus?.isConnected &&
        isRenderedEnabledElement(previousFocus)
      ) {
        previousFocus.focus();
      }
      unlockBodyScroll();
    };
  }, [active, containerRef, initialFocusSelector]);

  return containerRef;
}
