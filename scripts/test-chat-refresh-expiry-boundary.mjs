import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = mkdtempSync(join(tmpdir(), "lore-chat-refresh-boundary-"));
const originalNow = Date.now;
process.env.LORE_DB_PATH = join(testRoot, "lore.sqlite");
process.env.NODE_ENV = "development";
process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "1";
process.env.CHAT_AUTH_SECRET = "chat-refresh-boundary-test-secret";

try {
  const { NextRequest, NextResponse } = await import("next/server");
  const chatAuth = await import("../app/lib/chatAuth.ts");
  const chatSession = await import("../app/api/_lib/chatSession.ts");
  const chatAuthRoute = await import("../app/api/chat/auth/route.ts");

  const initialNow = Date.parse("2026-08-13T12:05:00.000Z");
  const seedResponse = NextResponse.json({ ok: true });
  const initialExpiresAt = chatSession.issueChatSession(
    seedResponse,
    "0x1111111111111111111111111111111111111111",
    initialNow,
  );
  const cookie = seedResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^lore_chat_session=/, "seed chat session cookie must be issued");

  Date.now = () => (
    new Error().stack?.includes("issueChatSession")
      ? initialExpiresAt
      : initialExpiresAt - 1
  );
  const response = await chatAuthRoute.GET(new NextRequest("https://playlore.xyz/api/chat/auth", {
    headers: {
      cookie,
      "user-agent": "lore-chat-refresh-boundary-test",
    },
  }));

  assert.equal(response.status, 200, "a session valid at the refresh clock must remain refreshable");
  assert.equal(
    response.headers.get("x-chat-session-expires-at"),
    String(initialExpiresAt - 1 + chatAuth.CHAT_AUTH_SESSION_TTL_MS),
    "refresh must derive its expiry from the validation clock rather than a later clock",
  );
  assert.match(response.headers.get("set-cookie") ?? "", /^lore_chat_session=/);
  console.log("chat-refresh-expiry-boundary: ok");
} finally {
  Date.now = originalNow;
  try {
    const dbModule = await import("../server/db.ts");
    dbModule.db.close();
  } catch {
    // The test may fail before the database module is initialized.
  }
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
