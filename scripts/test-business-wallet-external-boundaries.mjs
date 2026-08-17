import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runWalletExternalBoundaryTests() {
  const testnetRevertSource = readFileSync("scripts/run-testnet-revert-check.ts", "utf8");
  assert.match(
    testnetRevertSource,
    /Refusing to broadcast without \$\{CONFIRMATION_FLAG\}/,
    "testnet revert check must require explicit broadcast confirmation",
  );
  assert.match(
    testnetRevertSource,
    /chain\.id !== TESTNET_CHAIN_ID[\s\S]*Refusing non-testnet revert check/,
    "testnet revert check must refuse any non-Sepolia chain",
  );
  assert.match(
    testnetRevertSource,
    /simulateContract[\s\S]*invalidreceiver[\s\S]*writeContract[\s\S]*receipt\.status !== "reverted"/,
    "testnet revert check must simulate first and require a reverted receipt",
  );
  assert.match(
    testnetRevertSource,
    /import \{ redactProofText \} from "\.\/redact-proof-output\.mjs"[\s\S]*function describeRevertCheckError\(error: unknown\)[\s\S]*redactProofText\(/,
    "testnet revert check fatal errors must use the shared proof redactor",
  );
  assert.match(
    testnetRevertSource,
    /MAX_REVERT_CHECK_ERROR_CHARS[\s\S]*<truncated>[\s\S]*console\.error\(describeRevertCheckError\(error\)\)/,
    "testnet revert check fatal errors must be compact and bounded",
  );

  const privyWalletSource = readFileSync("app/hooks/usePrivyWallet.ts", "utf8");
  const externalWalletProviderContextSource = readFileSync("app/lib/externalWalletProviderContext.ts", "utf8");
  assert.match(
    privyWalletSource,
    /import \{ log \} from "\.\.\/lib\/logger";[\s\S]*log\.warn\("PrivyWallet"/,
    "Privy wallet warnings must use the shared redacted support logger",
  );
  assert.doesNotMatch(
    privyWalletSource,
    /console\.warn\(/,
    "Privy wallet warnings must not bypass support-log redaction through direct console.warn",
  );
  assert.match(
    privyWalletSource,
    /withTimeout\([\s\S]*externalWallet\.switchChain\(APP_CHAIN_ID\)[\s\S]*EXTERNAL_WALLET_NETWORK_TIMEOUT_MS/,
    "external wallet network switching must not leave transfer actions pending indefinitely",
  );
  assert.match(
    privyWalletSource,
    /isUserRejection\(switchErr\)\) throw switchErr;[\s\S]*switchErr\.name === "TimeoutError"[\s\S]*Network switch timed out/,
    "external wallet switch rejection or timeout must not trigger a duplicate fallback prompt",
  );
  assert.match(
    privyWalletSource,
    /method: "eth_accounts"[\s\S]*setProviderExternalWalletAddress\(providerAccount\)[\s\S]*from: providerAccount/,
    "external transfers must use the account currently selected in the provider instead of a stale Privy wallet-list address",
  );
  assert.match(
    privyWalletSource,
    /assertExternalWalletProviderContext\([\s\S]*expectedChainId: APP_CHAIN_ID[\s\S]*submitExternalTransaction[\s\S]*expectedActor: providerAccount[\s\S]*method: "eth_sendTransaction"[\s\S]*isSafeExternalWalletProviderContextError/,
    "external transfers must revalidate chain and selected actor directly before the wallet send sink and only safely abandon proven pre-send mismatches",
  );
  assert.match(
    privyWalletSource,
    /accountsChanged[\s\S]*setProviderExternalWalletAddress\(getProviderSelectedAddress\(accounts\)\)/,
    "wallet settings must refresh the displayed external address after an injected-wallet account change",
  );
  assert.match(
    externalWalletProviderContextSource,
    /requestProviderWithTimeout[\s\S]*Promise\.race[\s\S]*setTimeout[\s\S]*request timed out/,
    "external wallet context verification must keep its shared bounded provider request path",
  );
}
