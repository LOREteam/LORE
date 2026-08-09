"use client";

import {
  flattenErrorMessage,
  isEpochWaitTimeoutError,
  isInsufficientFundsError,
  isNetworkError,
  isSessionExpiredError,
  isWalletUnavailableError,
  isWrongNetworkError,
} from "./useMining.shared";
import { APP_CHAIN_NAME } from "../lib/constants";
import type { AutoMineDiagnosticsErrorKind } from "../lib/mining/autoMineDiagnostics";

function isPendingNonceBlockedError(message: string) {
  return (
    message.includes("pending transaction") ||
    message.includes("stuck tx") ||
    message.includes("stuck transaction") ||
    message.includes("nonce blocked") ||
    message.includes("clear or replace the stuck tx")
  );
}

export function getAutoMineUserMessage(error: unknown) {
  const flattenedMessage = flattenErrorMessage(error);
  const rawMessage = (flattenedMessage || String(error)).toLowerCase();
  const sessionExpired = isSessionExpiredError(error);
  const networkDown = isNetworkError(error);
  const walletUnavailable = isWalletUnavailableError(error);
  const wrongNetwork = isWrongNetworkError(error);
  const pendingNonceBlocked = isPendingNonceBlockedError(rawMessage);

  let userMessage: string;
  let diagnosticsErrorKind: AutoMineDiagnosticsErrorKind;
  if (sessionExpired) {
    diagnosticsErrorKind = "session-expired";
    userMessage = "Session expired. Log out, log in again, then reload this page - the bot will auto-resume.";
  } else if (isEpochWaitTimeoutError(error)) {
    diagnosticsErrorKind = "timeout";
    userMessage = "Auto-miner paused: previous epoch did not finish resolving in time. Retrying automatically...";
  } else if (pendingNonceBlocked) {
    diagnosticsErrorKind = "pending-nonce-blocked";
    userMessage = "Auto-miner paused: wallet has a stuck pending transaction. Open Settings and clear or replace it, then start the bot again.";
  } else if (networkDown) {
    diagnosticsErrorKind = "network";
    userMessage = "Auto-miner paused: RPC offline for too long. Retrying automatically...";
  } else if (wrongNetwork) {
    diagnosticsErrorKind = "wrong-network";
    userMessage = `Auto-miner stopped: wallet is on the wrong network. Switch to ${APP_CHAIN_NAME} and start again.`;
  } else if (rawMessage.includes("replacement transaction underpriced")) {
    diagnosticsErrorKind = "unknown";
    userMessage = "Stopped: replacement tx underpriced. Press START BOT again to continue.";
  } else if (isInsufficientFundsError(error) || rawMessage.includes("not enough eth for gas")) {
    diagnosticsErrorKind = "insufficient-funds";
    userMessage = "Auto-miner stopped: not enough ETH for gas in the Privy wallet.";
  } else if (rawMessage.includes("contract token mismatch")) {
    diagnosticsErrorKind = "unknown";
    userMessage = "Auto-miner stopped: configured token does not match the game contract.";
  } else if (rawMessage.includes("missing required epoch-bound betting support")) {
    diagnosticsErrorKind = "unknown";
    userMessage = "Auto-miner stopped: configured contract does not support protected V10 bets.";
  } else if (rawMessage.includes("epoch ended") || rawMessage.includes("epochclosing")) {
    diagnosticsErrorKind = "unknown";
    userMessage = "Round skipped (epoch ended). Press START BOT to continue.";
  } else if (rawMessage.includes("gas required exceeds") || rawMessage.includes("reverted")) {
    diagnosticsErrorKind = "unknown";
    userMessage = "Auto-miner stopped: transaction reverted on-chain. No bet was placed.";
  } else if (rawMessage.includes("timeout")) {
    diagnosticsErrorKind = "timeout";
    userMessage = "Auto-miner stopped: network timeout.";
  } else if (walletUnavailable) {
    diagnosticsErrorKind = "wallet-unavailable";
    userMessage = "Auto-miner paused: Privy wallet not ready. Retrying automatically...";
  } else {
    diagnosticsErrorKind = "unknown";
    userMessage = "Auto-miner stopped. Try again or export logs if the problem continues.";
  }

  return {
    diagnosticsErrorKind,
    rawMessage,
    sessionExpired,
    networkDown,
    walletUnavailable,
    pendingNonceBlocked,
    userMessage,
  };
}
