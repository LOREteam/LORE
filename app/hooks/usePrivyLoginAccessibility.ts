"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LOGIN_PENDING_TIMEOUT_MS = 20_000;
const LOGIN_FAILURE_MESSAGE = "Wallet login failed. Try again or reload the page.";
const PRIVY_READY_SLOW_MESSAGE = "Wallet login is still loading. Check blockers or reload the page.";

export const PRIVY_LOGIN_ACCESSIBLE_NAME = "Login or connect wallet";

export interface PrivyLoginUiState {
  busy: boolean;
  buttonText: string;
  disabled: boolean;
  error: string | null;
  modalOpen: boolean;
  statusAnnouncement: string;
}

export function formatPrivyLoginFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) {
    return "Wallet login timed out. Try again or reload the page.";
  }
  if (message.includes("rejected") || message.includes("denied") || message.includes("closed")) {
    return "Wallet login was cancelled.";
  }
  return LOGIN_FAILURE_MESSAGE;
}

export function derivePrivyLoginUiState(input: {
  authenticated: boolean;
  error: string | null;
  modalOpen: boolean;
  pending: boolean;
  ready: boolean;
}): PrivyLoginUiState {
  const { authenticated, error, modalOpen, pending, ready } = input;
  const busy = !authenticated && (!ready || pending || modalOpen);
  const disabled = authenticated || !ready || pending || modalOpen;
  const buttonText = modalOpen || pending
    ? "Connecting..."
    : ready
      ? "Login / Connect"
      : "Wallet Loading...";
  const statusAnnouncement = error
    ? error
    : authenticated
      ? "Wallet connected."
      : modalOpen
        ? "Wallet login dialog is open."
        : pending
          ? "Wallet login is opening."
          : ready
            ? "Wallet login is ready."
            : "Wallet login is loading.";

  return {
    busy,
    buttonText,
    disabled,
    error,
    modalOpen,
    statusAnnouncement,
  };
}

export function shouldRestorePrivyLoginFocus(wasOpen: boolean, isOpen: boolean): boolean {
  return wasOpen && !isOpen;
}

type LoginTrigger = HTMLButtonElement;
type FocusFallback = HTMLElement;

export function canRequestPrivyLogin(input: {
  authenticated: boolean;
  invocationPending: boolean;
  modalOpen: boolean;
  ready: boolean;
}): boolean {
  return input.ready && !input.authenticated && !input.modalOpen && !input.invocationPending;
}

export function selectPrivyLoginFocusDestination(
  trigger: LoginTrigger | null,
  fallback: FocusFallback | null,
  preferFallback: boolean,
): HTMLElement | null {
  if (preferFallback) return fallback?.isConnected ? fallback : null;
  if (trigger?.isConnected) return trigger;
  return fallback?.isConnected ? fallback : null;
}

export function usePrivyLoginAccessibility(input: {
  authenticated: boolean;
  login: () => unknown;
  modalOpen: boolean;
  ready: boolean;
}) {
  const { authenticated, login, modalOpen, ready } = input;
  const [pending, setPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [readySlow, setReadySlow] = useState(false);
  const mountedRef = useRef(false);
  const invocationPendingRef = useRef(false);
  const invocationSawModalRef = useRef(false);
  const modalWasOpenRef = useRef(false);
  const triggerRef = useRef<LoginTrigger | null>(null);
  const focusFallbackRef = useRef<FocusFallback | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const restoreFocus = useCallback((preferFallback = false) => {
    const trigger = triggerRef.current;
    const fallback = focusFallbackRef.current;
    window.requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      const destination = selectPrivyLoginFocusDestination(trigger, fallback, preferFallback);
      destination?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (ready) {
      setReadySlow(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      if (mountedRef.current) setReadySlow(true);
    }, LOGIN_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [ready]);

  useEffect(() => {
    if (modalOpen) {
      if (invocationPendingRef.current && triggerRef.current) {
        modalWasOpenRef.current = true;
        invocationSawModalRef.current = true;
        setPending(true);
      }
      return;
    }
    if (!shouldRestorePrivyLoginFocus(modalWasOpenRef.current, modalOpen)) return;
    modalWasOpenRef.current = false;
    invocationPendingRef.current = false;
    setPending(false);
    restoreFocus(authenticated);
  }, [authenticated, modalOpen, restoreFocus]);

  useEffect(() => {
    if (!authenticated) return;
    invocationPendingRef.current = false;
    setPending(false);
    setLoginError(null);
    if (!modalOpen && invocationSawModalRef.current) {
      restoreFocus(true);
    }
  }, [authenticated, modalOpen, restoreFocus]);

  useEffect(() => {
    if (!pending || authenticated || modalOpen) return;
    const timeoutId = window.setTimeout(() => {
      if (!mountedRef.current || authenticated || modalOpen) return;
      invocationPendingRef.current = false;
      setPending(false);
      setLoginError("Wallet login timed out. Try again or reload the page.");
      restoreFocus();
    }, LOGIN_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [authenticated, modalOpen, pending, restoreFocus]);

  const requestLogin = useCallback((trigger: LoginTrigger, focusFallback?: FocusFallback | null) => {
    if (!canRequestPrivyLogin({
      authenticated,
      invocationPending: invocationPendingRef.current,
      modalOpen,
      ready,
    })) return;
    invocationPendingRef.current = true;
    invocationSawModalRef.current = false;
    triggerRef.current = trigger;
    focusFallbackRef.current = focusFallback ?? null;
    setPending(true);
    setLoginError(null);

    try {
      const result = login();
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(result).catch((error: unknown) => {
          if (!mountedRef.current) return;
          invocationPendingRef.current = false;
          setPending(false);
          setLoginError(formatPrivyLoginFailure(error));
          restoreFocus();
        });
      }
    } catch (error) {
      invocationPendingRef.current = false;
      setPending(false);
      setLoginError(formatPrivyLoginFailure(error));
      restoreFocus();
    }
  }, [authenticated, login, modalOpen, ready, restoreFocus]);

  const error = loginError ?? (readySlow ? PRIVY_READY_SLOW_MESSAGE : null);
  const uiState = useMemo(
    () => derivePrivyLoginUiState({ authenticated, error, modalOpen, pending, ready }),
    [authenticated, error, modalOpen, pending, ready],
  );

  return {
    requestLogin,
    uiState,
  };
}
