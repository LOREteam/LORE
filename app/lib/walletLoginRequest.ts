export const WALLET_LOGIN_REQUEST_EVENT = "lore:request-wallet-login";

/**
 * Lets a guest CTA ask the single Privy owner in the header to open login.
 * No wallet creation, signature, or transaction is performed by this event.
 */
export function requestWalletLogin() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WALLET_LOGIN_REQUEST_EVENT));
}
