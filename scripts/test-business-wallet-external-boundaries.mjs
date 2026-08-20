import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as externalWalletProviderContextModule from "../app/lib/externalWalletProviderContext.ts";

const externalWalletProviderContext =
  externalWalletProviderContextModule.default ?? externalWalletProviderContextModule;
const PROVIDER_ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const PROVIDER_ACCOUNT_B = "0x2222222222222222222222222222222222222222";

function fakeEip1193Provider(responses) {
  return {
    async request({ method }) {
      const response = responses[method];
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

async function assertSafeProviderContextMismatch(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(
      externalWalletProviderContext.isSafeExternalWalletProviderContextError(error),
      "only typed, proven provider context mismatches may safely abandon before submission",
    );
    assert.equal(error.code, code);
    return true;
  });
}

async function runExternalWalletProviderContextTests() {
  const validProvider = fakeEip1193Provider({
    eth_chainId: "0x1",
    eth_accounts: [PROVIDER_ACCOUNT_A],
  });
  assert.equal(
    await externalWalletProviderContext.assertExternalWalletProviderContext({
      provider: validProvider,
      expectedChainId: 1,
      expectedActor: PROVIDER_ACCOUNT_A,
    }),
    PROVIDER_ACCOUNT_A,
    "a valid provider chain and selected account must be accepted",
  );

  await assertSafeProviderContextMismatch(
    externalWalletProviderContext.assertExternalWalletProviderContext({
      provider: fakeEip1193Provider({
        eth_chainId: "0x2",
        eth_accounts: [PROVIDER_ACCOUNT_A],
      }),
      expectedChainId: 1,
      expectedActor: PROVIDER_ACCOUNT_A,
    }),
    "wallet_transfer_intent_external_chain_changed",
  );
  await assertSafeProviderContextMismatch(
    externalWalletProviderContext.assertExternalWalletProviderContext({
      provider: fakeEip1193Provider({
        eth_chainId: "0x1",
        eth_accounts: [PROVIDER_ACCOUNT_B],
      }),
      expectedChainId: 1,
      expectedActor: PROVIDER_ACCOUNT_A,
    }),
    "wallet_transfer_intent_actor_changed",
  );

  await assert.rejects(
    externalWalletProviderContext.assertExternalWalletProviderContext({
      provider: fakeEip1193Provider({
        eth_chainId: "not-a-chain-id",
        eth_accounts: [PROVIDER_ACCOUNT_A],
      }),
      expectedChainId: 1,
      expectedActor: PROVIDER_ACCOUNT_A,
    }),
    (error) => {
      assert.equal(
        externalWalletProviderContext.isSafeExternalWalletProviderContextError(error),
        false,
        "malformed provider replies must remain ordinary errors and preserve the intent lease",
      );
      assert.match(error.message, /invalid chain ID/);
      return true;
    },
  );

  const hungProvider = {
    request({ method }) {
      if (method === "eth_chainId") return Promise.resolve("0x1");
      return new Promise(() => {});
    },
  };
  await assert.rejects(
    externalWalletProviderContext.assertExternalWalletProviderContext({
      provider: hungProvider,
      expectedChainId: 1,
      timeoutMs: 10,
    }),
    (error) => {
      assert.equal(
        externalWalletProviderContext.isSafeExternalWalletProviderContextError(error),
        false,
        "provider timeouts must not be treated as proven safe-abandon mismatches",
      );
      assert.match(error.message, /eth_accounts request timed out/);
      return true;
    },
  );
}

await runExternalWalletProviderContextTests();

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
}
