import assert from "node:assert/strict";
import * as chatPollDelayModule from "../app/lib/chatPollDelay.ts";
import * as chatRateLimitModule from "../app/lib/chatRateLimit.ts";

export function runChatPollingTests() {
  const chatPollDelay = chatPollDelayModule.default ?? chatPollDelayModule;
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: 0 }), 3_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: false, failureCount: 1 }), 60_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: false, isPageVisible: true, failureCount: 2 }), 80_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: false, isPageVisible: false, failureCount: 99 }), 240_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: -1 }), 3_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: 1.5 }), 3_000);
  assert.equal(chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: Number.NaN }), 3_000);
  assert.equal(
    chatPollDelay.getChatPollDelayMs({ open: true, isPageVisible: true, failureCount: Number.MAX_SAFE_INTEGER + 1 }),
    3_000,
  );

  const chatRateLimit = chatRateLimitModule.default ?? chatRateLimitModule;
  assert.equal(chatRateLimit.parseChatRetryAfterMs(2), 2_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("2"), 2_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("bad"), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("02"), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("1e3"), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(1.5), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(Number.MAX_SAFE_INTEGER + 1), 1_500);
  assert.equal(chatRateLimit.parseChatRetryAfterMs(999), 120_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("999"), 120_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("2", Number.NaN), 2_000);
  assert.equal(chatRateLimit.parseChatRetryAfterMs("1", 2_000.5), 1_500);
}
