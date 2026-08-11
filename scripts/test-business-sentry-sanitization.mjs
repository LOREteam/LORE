import assert from "node:assert/strict";
import * as sentrySanitizeModule from "../app/lib/sentrySanitize.ts";

export function runSentrySanitizationTests() {
  const sentrySanitize = sentrySanitizeModule.default ?? sentrySanitizeModule;
  const sanitizedSentryPayload = sentrySanitize.sanitizeSentryPayload({
    exception: {
      values: [{
        value: "wallet 0x1111111111111111111111111111111111111111 failed via https://rpc.example.test/private",
        endpoint: "wss://rpc.example.test/socket?key=secret",
      }],
    },
    extra: {
      walletAddress: "0x2222222222222222222222222222222222222222",
      rpcUrl: "https://rpc.example.test/key",
      provider: { request: "raw wallet payload" },
      safeStatus: "pending",
    },
    request: {
      headers: { authorization: "Bearer synthetic-secret", cookie: "session=synthetic" },
      url: "/api/live-state",
    },
  });
  const serializedSentryPayload = JSON.stringify(sanitizedSentryPayload);
  assert.doesNotMatch(serializedSentryPayload, /0x[1-2]{40}|rpc\.example\.test|synthetic-secret|raw wallet payload/);
  assert.equal(sanitizedSentryPayload.extra.walletAddress, "<redacted>");
  assert.equal(sanitizedSentryPayload.extra.safeStatus, "pending");
  assert.equal(sanitizedSentryPayload.request.url, "/api/live-state");

  const sanitizedInlineSecrets = sentrySanitize.sanitizeSentryPayload(
    `api_key=inline-secret private=${"e".repeat(64)} mnemonic="seed phrase" passphrase=open-sesame webhook_url=https://hooks.example.test/secret dsn=https://sentry.example.test/key rpc_url=https://rpc.example.test/key ws_rpc=wss://rpc.example.test/socket token eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.signature authorization Basic dXNlcjpwYXNz`,
  );
  assert.doesNotMatch(sanitizedInlineSecrets, /inline-secret|e{64}|seed phrase|open-sesame|hooks\.example|sentry\.example|rpc\.example|eyJhbGciOiJIUzI1NiJ9|cGF5bG9hZA|dXNlcjpwYXNz|Basic/);
  const sanitizedPrefixedSecrets = sentrySanitize.sanitizeSentryPayload(
    `sk-proj-${"a".repeat(24)} github_pat_${"b".repeat(24)} ghp_${"c".repeat(24)} xoxb-${"d".repeat(24)} re_${"e".repeat(24)}`,
  );
  assert.doesNotMatch(sanitizedPrefixedSecrets, /sk-proj-|github_pat_|ghp_|xoxb-|re_/);
  const sanitizedModernSecretKeys = sentrySanitize.sanitizeSentryPayload({
    apiKey: "plain-api-key",
    clientSecret: "plain-client-secret",
    webhookUrl: "https://hooks.example.test/secret",
    sessionToken: "plain-session-token",
    credentials: { value: "nested-secret" },
    rpcEndpoint: "https://rpc.example.test/private",
  });
  assert.deepEqual(sanitizedModernSecretKeys, {
    apiKey: "<redacted>",
    clientSecret: "<redacted>",
    webhookUrl: "<redacted>",
    sessionToken: "<redacted>",
    credentials: "<redacted>",
    rpcEndpoint: "<redacted>",
  });

  const supportTxHash = `0x${"a".repeat(64)}`;
  const sanitizedSupportLog = sentrySanitize.sanitizeSupportLogPayload({
    epoch: "78",
    nonce: 4,
    retryCount: 2,
    stopReason: "retry-wait",
    txHash: supportTxHash,
    privateKey: `0x${"b".repeat(64)}`,
    walletAddress: `0x${"c".repeat(40)}`,
    error: `Bearer secret via https://rpc.example.test/key ${`0x${"d".repeat(64)}`} calldata=${`0x${"f".repeat(160)}`}`,
  });
  assert.equal(sanitizedSupportLog.txHash, supportTxHash);
  assert.equal(sanitizedSupportLog.epoch, "78");
  assert.equal(sanitizedSupportLog.nonce, 4);
  assert.equal(sanitizedSupportLog.retryCount, 2);
  assert.equal(sanitizedSupportLog.stopReason, "retry-wait");
  assert.equal(sanitizedSupportLog.privateKey, "<redacted>");
  assert.equal(sanitizedSupportLog.walletAddress, "<redacted>");
  assert.doesNotMatch(sanitizedSupportLog.error, /secret|rpc\.example|0x[d]{64}|0x[f]{80,}/i);
}
