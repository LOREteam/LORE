import assert from "node:assert/strict";
import * as utilsModule from "../app/lib/utils.ts";

export async function runUtilitySafetyTests() {
  const utils = utilsModule.default ?? utilsModule;
  assert.equal(utils.normalizeDecimalInput("1,25"), "1.25");
  assert.equal(utils.validateBetAmount(""), "Enter an amount");
  assert.equal(utils.validateBetAmount("   "), "Enter an amount");
  assert.equal(utils.validateBetAmount("0"), "Amount must be greater than 0");
  assert.equal(utils.validateBetAmount("-1"), "Amount must be greater than 0");
  assert.equal(utils.validateBetAmount("1e3"), "Invalid amount");
  assert.equal(utils.validateBetAmount("1.2.3"), "Invalid amount");
  assert.equal(utils.validateBetAmount("1,25"), null);
  assert.equal(utils.validateBetAmount("0.0001"), null);
  assert.equal(utils.validateBetAmount("0.0000000000000000001"), "Use 18 decimals or fewer");

  assert.equal(utils.isUserRejection(new Error("User rejected the request")), true);
  assert.equal(utils.isUserRejection({ code: 4001, message: "wallet request closed" }), true);
  assert.equal(utils.isUserRejection({ code: "ACTION_REJECTED" }), true);
  assert.equal(utils.isUserRejection({ cause: { code: 4001 } }), true);
  assert.equal(utils.isUserRejection({ details: "User denied transaction signature" }), true);
  assert.equal(utils.isUserRejection({ shortMessage: "User rejected the request." }), true);
  assert.equal(utils.isUserRejection({ cause: { shortMessage: "Request rejected by user." } }), true);
  assert.equal(utils.isUserRejection(Object.assign(new Error("wallet error"), { cause: { details: "User cancelled the signature prompt" } })), true);
  assert.equal(utils.isUserRejection({ shortMessage: "User closed modal before signing." }), true);
  assert.equal(utils.isUserRejection({ cause: { details: "Wallet modal closed by the user." } }), true);
  assert.equal(utils.isUserRejection({ code: -32000, message: "replacement transaction underpriced" }), false);
  assert.equal(utils.isUserRejection({ shortMessage: "replacement transaction underpriced" }), false);
  assert.equal(utils.isUserRejection({ message: "connection closed while reading RPC response" }), false);

  assert.equal(utils.safeParseFloat("1.5"), 1.5);
  assert.equal(utils.safeParseFloat("1,5"), 1.5);
  assert.equal(utils.safeParseFloat(".5"), 0.5);
  assert.equal(utils.safeParseFloat("1e3"), 0);
  assert.equal(utils.safeParseFloat("1e309"), 0);
  assert.equal(utils.safeParseFloat("12abc"), 0);
  assert.equal(utils.safeParseFloat("1.2.3"), 0);
  assert.equal(utils.safeParseFloat("NaN"), 0);
  assert.equal(utils.safeToFixed(12.345, 2), "12.35");
  assert.equal(utils.safeToFixed(Number.NaN, 2), "0.00");
  assert.equal(utils.safeToFixed(Number.POSITIVE_INFINITY, 2, "fallback"), "fallback");
  assert.equal(utils.safeToFixed(12.345, 101, "fallback"), "fallback");
  assert.equal(utils.safeToFixed(12.345, 1.5, "fallback"), "fallback");
  for (const timeoutMs of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, 2_147_483_648]) {
    await assert.rejects(
      utils.withTimeout(Promise.resolve("ignored"), timeoutMs, "utility"),
      /utility timeout must be between 1 and 2147483647 milliseconds/,
    );
  }

  const rawFormattedError = utils.formatUnknownError(Object.assign(
    new Error(`provider failed https://rpc.example.test/secret Bearer synthetic-token ${"a".repeat(80)} ${"b".repeat(700)}`),
    {
      code: "CALL_EXCEPTION",
      details: `wallet 0x${"c".repeat(40)} privateKey=${"d".repeat(64)}`,
      data: { rpcUrl: "https://rpc.example.test/key", token: "inline-secret" },
      status: 500,
    },
  ));
  assert.match(rawFormattedError, /CALL_EXCEPTION/);
  assert.match(rawFormattedError, /Status: 500/);
  assert.ok(rawFormattedError.length <= 600, "unknown error formatting must stay bounded");
  assert.doesNotMatch(
    rawFormattedError,
    /rpc\.example|synthetic-token|inline-secret|0x[c]{40}|d{64}|b{300}/i,
    "unknown error formatting must redact provider URLs, wallet addresses, tokens, and long raw payloads",
  );
}
