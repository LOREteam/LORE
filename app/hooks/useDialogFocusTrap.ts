"use client";

import { useEffect, useRef, type RefObject } from "react";

export const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let activeDialogScrollLocks = 0;
let previousBodyOverflow: string | null = null;

function lockBodyScroll(documentRef: Document) {
  if (activeDialogScrollLocks === 0) {
    previousBodyOverflow = documentRef.body.style.overflow;
    documentRef.body.style.overflow = "hidden";
  }
  activeDialogScrollLocks += 1;
}

function unlockBodyScroll(documentRef: Document) {
  activeDialogScrollLocks = Math.max(0, activeDialogScrollLocks - 1);
  if (activeDialogScrollLocks === 0 && previousBodyOverflow !== null) {
    documentRef.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = null;
  }
}

export function isRenderedEnabledDialogElement(
  element: HTMLElement,
  getComputedStyleForElement: (element: Element) => CSSStyleDeclaration = (candidate) => window.getComputedStyle(candidate),
) {
  const style = getComputedStyleForElement(element);
  return element.getClientRects().length > 0 &&
    !element.hidden &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true" &&
    !element.closest("fieldset[disabled]");
}

export function isDialogFocusableCandidate(
  element: HTMLElement,
  getComputedStyleForElement: (element: Element) => CSSStyleDeclaration = (candidate) => window.getComputedStyle(candidate),
) {
  return isRenderedEnabledDialogElement(element, getComputedStyleForElement) &&
    !element.closest("[aria-hidden='true']") &&
    !element.closest("[inert]");
}

export type DialogFocusTrapRuntimeOptions = {
  container: HTMLElement | null;
  previousFocus: HTMLElement | null;
  initialFocusSelector?: string;
  getEscapeHandler: () => (() => void) | undefined;
  documentRef?: Document;
  getComputedStyleForElement?: (element: Element) => CSSStyleDeclaration;
};

export function activateDialogFocusTrap({
  container,
  previousFocus,
  initialFocusSelector,
  getEscapeHandler,
  documentRef = document,
  getComputedStyleForElement = (element) => window.getComputedStyle(element),
}: DialogFocusTrapRuntimeOptions) {
  lockBodyScroll(documentRef);
  const focusable = () =>
    Array.from(container?.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR) ?? [])
      .filter((element) => isDialogFocusableCandidate(element, getComputedStyleForElement));
  const fallbackFocusTarget = () => {
    if (!container) return null;
    return container.matches("[role='dialog']")
      ? container
      : container.querySelector<HTMLElement>("[role='dialog']") ?? container;
  };
  const initialFocus = initialFocusSelector
    ? container?.querySelector<HTMLElement>(initialFocusSelector)
    : null;
  (initialFocus && isDialogFocusableCandidate(initialFocus, getComputedStyleForElement)
    ? initialFocus
    : focusable()[0] ?? fallbackFocusTarget()
  )?.focus();

  const handleKeyDown = (event: KeyboardEvent) => {
    const escapeHandler = getEscapeHandler();
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
    const activeElement = documentRef.activeElement;
    if (event.shiftKey && (activeElement === first || !container?.contains(activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (activeElement === last || !container?.contains(activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  documentRef.addEventListener("keydown", handleKeyDown);
  return () => {
    documentRef.removeEventListener("keydown", handleKeyDown);
    if (
      previousFocus?.isConnected &&
      isRenderedEnabledDialogElement(previousFocus, getComputedStyleForElement)
    ) {
      previousFocus.focus();
    }
    unlockBodyScroll(documentRef);
  };
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
    return activateDialogFocusTrap({
      container,
      previousFocus,
      initialFocusSelector,
      getEscapeHandler: () => onEscapeRef.current,
    });
  }, [active, containerRef, initialFocusSelector]);

  return containerRef;
}
