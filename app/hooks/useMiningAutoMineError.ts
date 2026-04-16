"use client";

import { firstErrorLine, isInsufficientFundsError, isNetworkError, isSessionExpiredError } from "./useMining.shared";
import type { AutoMineDiagnosticsErrorKind } from "../lib/mining/autoMineDiagnostics";

function isWalletUnavailableError(message: string) {
  return (
    message.includes("public client not ready") ||
    message.includes("public client unavailable") ||
    message.includes("wallet not ready") ||
    message.includes("wallet not found") ||
    message.includes("embedded wallet not found")
  );
}

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
  const rawMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const sessionExpired = isSessionExpiredError(error);
  const networkDown = isNetworkError(error);
  const walletUnavailable = isWalletUnavailableError(rawMessage);
  const pendingNonceBlocked = isPendingNonceBlockedError(rawMessage);

  let userMessage: string;
  let diagnosticsErrorKind: AutoMineDiagnosticsErrorKind;
  if (sessionExpired) {
    diagnosticsErrorKind = "session-expired";
    userMessage = "Session expired. Log out, log in again, then reload this page - the bot will auto-resume.";
  } else if (pendingNonceBlocked) {
    diagnosticsErrorKind = "pending-nonce-blocked";
    userMessage = "Auto-miner paused: wallet has a stuck pending transaction. Open Settings and clear or replace it, then start the bot again.";
  } else if (networkDown) {
    diagnosticsErrorKind = "network";
    userMessage = "Auto-miner paused: RPC offline for too long. Retrying automatically...";
  } else if (rawMessage.includes("replacement transaction underpriced")) {
    diagnosticsErrorKind = "unknown";
    userMessage = "Stopped: replacement tx underpriced. Press START BOT again to continue.";
  } else if (isInsufficientFundsError(error) || rawMessage.includes("not enough eth for gas")) {
    diagnosticsErrorKind = "insufficient-funds";
    userMessage = `Auto-miner stopped: ${firstErrorLine(error)}`;
  } else if (rawMessage.includes("contract token mismatch")) {
    diagnosticsErrorKind = "unknown";
    userMessage = `Auto-miner stopped: ${firstErrorLine(error)}`;
  } else if (rawMessage.includes("epoch ended")) {
    diagnosticsErrorKind = "unknown";
    userMessage = "Round skipped (epoch ended). Press START BOT to continue.";
  } else if (rawMessage.includes("gas required exceeds") || rawMessage.includes("reverted")) {
    diagnosticsErrorKind = "unknown";
    userMessage = `Auto-miner stopped: ${firstErrorLine(error)}`;
  } else if (rawMessage.includes("timeout")) {
    diagnosticsErrorKind = "timeout";
    userMessage = "Auto-miner stopped: network timeout.";
  } else if (walletUnavailable) {
    diagnosticsErrorKind = "wallet-unavailable";
    userMessage = "Auto-miner paused: Privy wallet not ready. Retrying automatically...";
  } else {
    diagnosticsErrorKind = "unknown";
    userMessage = "Auto-miner error: " + (error instanceof Error ? error.message : String(error));
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
