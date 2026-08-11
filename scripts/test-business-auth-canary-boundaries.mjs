import assert from "node:assert/strict";
import * as adminAuthModule from "../app/lib/adminAuth.ts";
import * as chatAuthModule from "../app/lib/chatAuth.ts";
import * as trustedAuthOriginModule from "../app/api/_lib/trustedAuthOrigin.ts";
import * as estimateGasRetryModule from "./lib/estimate-gas-retry.ts";
import * as canaryContractErrorModule from "./lib/canary-contract-error.ts";

function withTemporaryEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function runAuthAndCanaryBoundaryTests() {
  const authProofFields = {
    address: "0x1111111111111111111111111111111111111111",
    uri: "https://playlore.xyz/chat",
    chainId: 59141,
    nonce: "a".repeat(32),
    issuedAt: "2026-07-27T12:00:00.000Z",
  };
  const chatAuth = chatAuthModule.default ?? chatAuthModule;
  const canonicalChatProof = chatAuth.buildChatAuthMessage(authProofFields);
  assert.deepEqual(chatAuth.parseChatAuthMessage(canonicalChatProof), authProofFields);
  assert.equal(chatAuth.parseChatAuthMessage(`${canonicalChatProof}\nUnexpected: altered`), null);
  assert.equal(
    chatAuth.parseChatAuthMessage(chatAuth.buildChatAuthMessage({
      ...authProofFields,
      issuedAt: "July 27, 2026 12:00:00 GMT",
    })),
    null,
  );
  for (const chainId of ["059141", "59141.0", "5e4", "0xE705", "9007199254740992"]) {
    assert.equal(chatAuth.parseChatAuthMessage(canonicalChatProof.replace("Chain ID: 59141", `Chain ID: ${chainId}`)), null);
  }
  for (const nonce of ["A".repeat(32), "a".repeat(31), "g".repeat(32)]) {
    assert.equal(chatAuth.parseChatAuthMessage(canonicalChatProof.replace(`Nonce: ${authProofFields.nonce}`, `Nonce: ${nonce}`)), null);
  }
  assert.equal(chatAuth.isChatAuthIssuedAtValid(authProofFields.issuedAt, Number.NaN), false);
  const authProofIssuedAtMs = Date.parse(authProofFields.issuedAt);
  assert.equal(chatAuth.getChatAuthProofTtlMs(authProofFields.issuedAt, authProofIssuedAtMs + 60_000, 300_000), 240_000);
  assert.equal(chatAuth.getChatAuthProofTtlMs("July 27, 2026 12:00:00 GMT", authProofIssuedAtMs + 60_000, 300_000), null);

  const adminAuth = adminAuthModule.default ?? adminAuthModule;
  const canonicalAdminProof = adminAuth.buildAdminAuthMessage(authProofFields);
  assert.deepEqual(adminAuth.parseAdminAuthMessage(canonicalAdminProof), authProofFields);
  assert.equal(adminAuth.parseAdminAuthMessage(`${canonicalAdminProof}\nUnexpected: altered`), null);
  assert.equal(
    adminAuth.parseAdminAuthMessage(adminAuth.buildAdminAuthMessage({
      ...authProofFields,
      issuedAt: "July 27, 2026 12:00:00 GMT",
    })),
    null,
  );
  for (const chainId of ["059141", "59141.0", "5e4", "0xE705", "9007199254740992"]) {
    assert.equal(adminAuth.parseAdminAuthMessage(canonicalAdminProof.replace("Chain ID: 59141", `Chain ID: ${chainId}`)), null);
  }
  for (const nonce of ["A".repeat(32), "a".repeat(31), "g".repeat(32)]) {
    assert.equal(adminAuth.parseAdminAuthMessage(canonicalAdminProof.replace(`Nonce: ${authProofFields.nonce}`, `Nonce: ${nonce}`)), null);
  }
  assert.equal(adminAuth.isAdminAuthIssuedAtValid(authProofFields.issuedAt, Number.POSITIVE_INFINITY), false);
  assert.equal(adminAuth.getAdminAuthProofTtlMs(authProofFields.issuedAt, authProofIssuedAtMs + 120_000, 300_000), 180_000);
  assert.equal(adminAuth.getAdminAuthProofTtlMs(authProofFields.issuedAt, Number.POSITIVE_INFINITY, 300_000), null);

  const trustedAuthOrigin = trustedAuthOriginModule.default ?? trustedAuthOriginModule;
  assert.equal(trustedAuthOrigin.getTrustedAuthOrigin("http://attacker.invalid/api/chat/auth", "production"), "https://playlore.xyz");
  assert.equal(trustedAuthOrigin.getTrustedAuthOrigin("http://localhost:3000/api/chat/auth", "development"), "http://localhost:3000");
  for (const origin of [
    "http://not-secure.invalid",
    "https://playlore.xyz/login",
    "https://playlore.xyz?next=/admin",
    "https://user:pass@playlore.xyz",
    "https://localhost:3000",
    "https://intranet",
    "https://192.168.1.20",
    "https://10.0.0.5",
    "https://172.16.0.5",
    "https://100.64.0.5",
    "https://wallet.local",
    "https://preview.test",
    "https://198.51.100.10",
    "https://[fd00::1]",
    "https://[fe80::1]",
    "https://[2001:db8::1]",
  ]) {
    assert.equal(
      withTemporaryEnv({ NEXT_PUBLIC_SITE_URL: origin }, () =>
        trustedAuthOrigin.getTrustedAuthOrigin("https://playlore.xyz/api/chat/auth", "production"),
      ),
      null,
    );
  }
  assert.equal(trustedAuthOrigin.isTrustedAuthUri("https://playlore.xyz/chat", "https://playlore.xyz", "/chat"), true);
  for (const unsafeAuthUri of [
    "https://playlore.xyz/admin",
    "https://playlore.xyz/chat?next=/admin",
    "https://playlore.xyz/chat#proof",
    "https://user:pass@playlore.xyz/chat",
  ]) {
    assert.equal(trustedAuthOrigin.isTrustedAuthUri(unsafeAuthUri, "https://playlore.xyz", "/chat"), false);
  }
  assert.equal(trustedAuthOrigin.isTrustedAuthUri("https://playlore.xyz/chat", "https://playlore.xyz", "/admin"), false);

  const canaryContractError = canaryContractErrorModule.default ?? canaryContractErrorModule;
  assert.deepEqual(
    canaryContractError.classifyCanaryContractError({ cause: { data: { errorName: "EpochClosing" } } }),
    { kind: "late-bet", message: "contract custom error EpochClosing" },
  );
  assert.deepEqual(
    canaryContractError.classifyCanaryContractError({ cause: { cause: { data: { errorName: "ERC20InsufficientBalance" } } } }),
    { kind: "insufficient-balance", message: "contract custom error ERC20InsufficientBalance" },
  );
  assert.deepEqual(
    canaryContractError.classifyCanaryContractError({ data: { errorName: "InvalidTileMask" } }),
    { kind: "contract-revert", message: "contract custom error InvalidTileMask" },
  );
  assert.equal(canaryContractError.classifyCanaryContractError({ data: { errorName: "UnknownError" } }), null);

  const estimateGasWithMethodRetry = estimateGasRetryModule.estimateGasWithMethodRetry
    ?? estimateGasRetryModule.default?.estimateGasWithMethodRetry;
  assert.equal(typeof estimateGasWithMethodRetry, "function");
  let estimateAttempts = 0;
  const estimateWaits = [];
  const recoveredEstimate = await estimateGasWithMethodRetry(
    async () => {
      estimateAttempts += 1;
      if (estimateAttempts < 3) throw new Error('Method "eth_estimateGas" is not supported.');
      return 123n;
    },
    async (ms) => estimateWaits.push(ms),
  );
  assert.deepEqual(recoveredEstimate, { value: 123n, retryCount: 2 });
  assert.deepEqual(estimateWaits, [500, 1_000]);
  await assert.rejects(
    () => estimateGasWithMethodRetry(
      async () => { throw new Error("execution reverted"); },
      async () => { throw new Error("must not retry a contract revert"); },
    ),
    /execution reverted/,
  );
}
