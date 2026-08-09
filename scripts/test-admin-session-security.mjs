import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_ADDRESS = "0x0000000000000000000000000000000000000003";
const ADMIN_COOKIE = "lore_admin_session";
const CHAT_COOKIE = "lore_chat_session";
const SHARED_SECRET = "s".repeat(48);
const PERSISTENCE_PROBE = process.env.ADMIN_SESSION_TEST_MODE === "persistence-probe";
const testRunDir = PERSISTENCE_PROBE
  ? null
  : mkdtempSync(join(tmpdir(), "lore-admin-session-security-"));

if (PERSISTENCE_PROBE) {
  assert.ok(
    process.env.LORE_DB_PATH && isAbsolute(process.env.LORE_DB_PATH),
    "persistence probe requires the parent's absolute temporary database path",
  );
} else {
  process.env.LORE_DB_PATH = join(testRunDir, "lore.sqlite");
}

process.env.NODE_ENV = "development";
process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS = ADMIN_ADDRESS;
process.env.ADMIN_AUTH_SECRET = SHARED_SECRET;
process.env.CHAT_AUTH_SECRET = SHARED_SECRET;

const adminAuthModule = await import("../app/lib/adminAuth.ts");
const adminSessionModule = await import("../app/api/_lib/adminSession.ts");
const chatSessionModule = await import("../app/api/_lib/chatSession.ts");
const diagnosticsAuthModule = await import("../app/api/health/_lib/diagnosticsAuth.ts");
const dbModule = await import("../server/db.ts");

const adminAuth = adminAuthModule.default ?? adminAuthModule;
const adminSession = adminSessionModule.default ?? adminSessionModule;
const chatSession = chatSessionModule.default ?? chatSessionModule;
const diagnosticsAuth = diagnosticsAuthModule.default ?? diagnosticsAuthModule;

function createCookieResponse() {
  const cookies = new Map();
  return {
    response: {
      cookies: {
        set(name, value, options) {
          cookies.set(name, { name, value, options });
        },
      },
    },
    get(name) {
      return cookies.get(name) ?? null;
    },
  };
}

function requestWithCookie(name, value, headers = {}) {
  const normalizedHeaders = new Headers(headers);
  return {
    cookies: {
      get(requestedName) {
        return requestedName === name && value
          ? { name, value }
          : undefined;
      },
    },
    headers: normalizedHeaders,
  };
}

function decodePayload(token) {
  const [encoded, signature, suffix] = token.split(".");
  assert.ok(encoded && signature && suffix === undefined, "session token must have exactly two parts");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function createRedisFetch() {
  const records = new Map();
  const commands = [];
  return {
    records,
    commands,
    async fetch(_url, init) {
      const command = JSON.parse(String(init?.body ?? "null"));
      assert.ok(Array.isArray(command), "shared session store command must be an array");
      commands.push(command[0]);
      let result;
      if (command[0] === "SET") {
        const [, key, value] = command;
        if (records.has(key)) result = null;
        else {
          records.set(key, value);
          result = "OK";
        }
      } else if (command[0] === "GET") {
        result = records.get(command[1]) ?? null;
      } else if (command[0] === "EVAL") {
        const key = command[3];
        const previous = command[4];
        const next = command[5];
        if (records.get(key) === previous) {
          records.set(key, next);
          result = 1;
        } else {
          result = 0;
        }
      } else if (command[0] === "DEL") {
        result = records.delete(command[1]) ? 1 : 0;
      } else {
        throw new Error(`Unexpected session store command: ${String(command[0])}`);
      }
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

async function runPersistenceProbe() {
  const token = process.env.ADMIN_SESSION_TEST_COOKIE;
  const now = Number(process.env.ADMIN_SESSION_TEST_NOW);
  assert.ok(token, "persistence probe requires a synthetic session cookie");
  assert.ok(Number.isSafeInteger(now), "persistence probe requires a safe clock value");
  assert.ok(
    await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, token), now),
    "a fresh process must remount the SQLite-backed admin session",
  );
}

async function runTests() {

const baseNow = Date.now();
assert.equal(adminSession.normalizeAdminSessionExpiresAt(120_000, 100_000), 120_000);
assert.equal(adminSession.normalizeAdminSessionExpiresAt("120000", 100_000), null);
assert.equal(adminSession.normalizeAdminSessionExpiresAt(120_000.5, 100_000), null);
assert.equal(adminSession.normalizeAdminSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
assert.equal(adminSession.normalizeAdminSessionExpiresAt(99_999, 100_000), null);
assert.equal(
  adminSession.normalizeAdminSessionExpiresAt(
    100_000 + adminAuth.ADMIN_AUTH_SESSION_IDLE_TTL_MS + 60_001,
    100_000,
  ),
  null,
);
const issuedAdmin = createCookieResponse();
const adminExpiresAt = await adminSession.issueAdminSession(
  issuedAdmin.response,
  ADMIN_ADDRESS,
  baseNow,
);
const adminCookie = issuedAdmin.get(ADMIN_COOKIE);
assert.ok(adminCookie, "admin login must set its cookie");
const adminPayload = decodePayload(adminCookie.value);
assert.equal(adminPayload.aud, "lore-admin");
assert.equal(adminPayload.type, "admin-session");
assert.match(adminPayload.sessionId, /^[A-Za-z0-9_-]{43}$/);
assert.equal(adminPayload.sessionVersion, 1);
assert.equal(adminPayload.expiresAt, adminExpiresAt);
assert.equal(
  adminPayload.expiresAt - adminPayload.issuedAt,
  adminAuth.ADMIN_AUTH_SESSION_IDLE_TTL_MS,
);
assert.equal(
  adminPayload.absoluteExpiresAt - adminPayload.startedAt,
  adminAuth.ADMIN_AUTH_SESSION_ABSOLUTE_TTL_MS,
);

const issuedChat = createCookieResponse();
chatSession.issueChatSession(issuedChat.response, ADMIN_ADDRESS);
const chatCookie = issuedChat.get(CHAT_COOKIE);
assert.ok(chatCookie, "chat login must set its cookie");
const chatPayload = decodePayload(chatCookie.value);
assert.equal(chatPayload.aud, "lore-chat");
assert.equal(chatPayload.type, "chat-session");

assert.equal(
  await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, chatCookie.value), baseNow),
  null,
  "chat token must not authenticate as admin even when both test keys are intentionally equal",
);
assert.equal(
  chatSession.readChatSession(requestWithCookie(CHAT_COOKIE, adminCookie.value)),
  null,
  "admin token must not authenticate as chat even when both test keys are intentionally equal",
);

const activeAdmin = await adminSession.readAdminSession(
  requestWithCookie(ADMIN_COOKIE, adminCookie.value),
  baseNow,
);
assert.ok(activeAdmin, "new admin session must be active in the server-side registry");
const persistenceProbe = spawnSync(
  process.execPath,
  [...process.execArgv, fileURLToPath(import.meta.url)],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      ADMIN_SESSION_TEST_MODE: "persistence-probe",
      ADMIN_SESSION_TEST_COOKIE: adminCookie.value,
      ADMIN_SESSION_TEST_NOW: String(baseNow),
    },
  },
);
assert.equal(
  persistenceProbe.status,
  0,
  `fresh-process SQLite session probe failed: ${persistenceProbe.stderr.trim().slice(0, 500)}`,
);
const rotatedAdmin = createCookieResponse();
const rotatedExpiresAt = await adminSession.rotateAdminSession(
  rotatedAdmin.response,
  activeAdmin,
  baseNow + 1_000,
);
assert.equal(rotatedExpiresAt, baseNow + 1_000 + adminAuth.ADMIN_AUTH_SESSION_IDLE_TTL_MS);
const rotatedCookie = rotatedAdmin.get(ADMIN_COOKIE);
assert.ok(rotatedCookie, "refresh must set a rotated admin cookie");
const rotatedPayload = decodePayload(rotatedCookie.value);
assert.equal(rotatedPayload.sessionId, adminPayload.sessionId);
assert.equal(rotatedPayload.sessionVersion, 2);
assert.equal(rotatedPayload.absoluteExpiresAt, adminPayload.absoluteExpiresAt);
assert.equal(
  await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, adminCookie.value), baseNow + 1_000),
  null,
  "rotation must immediately revoke the previous cookie version",
);
assert.ok(
  await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, rotatedCookie.value), baseNow + 1_000),
  "rotated cookie must match the active server-side version",
);
assert.equal(
  await adminSession.rotateAdminSession(createCookieResponse().response, activeAdmin, baseNow + 2_000),
  null,
  "the same cookie version must not rotate twice",
);
await adminSession.revokeAdminSession(
  requestWithCookie(ADMIN_COOKIE, rotatedCookie.value),
  baseNow + 1_000,
);
assert.equal(
  await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, rotatedCookie.value), baseNow + 1_000),
  null,
  "logout must revoke the active server-side session",
);

const idleSessionResponse = createCookieResponse();
await adminSession.issueAdminSession(idleSessionResponse.response, ADMIN_ADDRESS, baseNow + 2_000);
const idleCookie = idleSessionResponse.get(ADMIN_COOKIE);
assert.equal(
  await adminSession.readAdminSession(
    requestWithCookie(ADMIN_COOKIE, idleCookie.value),
    baseNow + 2_000 + adminAuth.ADMIN_AUTH_SESSION_IDLE_TTL_MS,
  ),
  null,
  "admin cookie must expire at the short idle boundary",
);
const expiredIdlePayload = decodePayload(idleCookie.value);
assert.equal(
  await adminSession.rotateAdminSession(
    createCookieResponse().response,
    expiredIdlePayload,
    baseNow + 2_000 + adminAuth.ADMIN_AUTH_SESSION_IDLE_TTL_MS,
  ),
  null,
  "an expired idle token must not be revived by calling the rotation helper directly",
);

const absoluteSessionResponse = createCookieResponse();
let absoluteCursor = baseNow + 3_000;
await adminSession.issueAdminSession(absoluteSessionResponse.response, ADMIN_ADDRESS, absoluteCursor);
let absoluteCookie = absoluteSessionResponse.get(ADMIN_COOKIE);
let absoluteSession = await adminSession.readAdminSession(
  requestWithCookie(ADMIN_COOKIE, absoluteCookie.value),
  absoluteCursor,
);
assert.ok(absoluteSession);
while (absoluteSession.expiresAt < absoluteSession.absoluteExpiresAt) {
  absoluteCursor = absoluteSession.expiresAt - 1;
  const nextResponse = createCookieResponse();
  assert.ok(await adminSession.rotateAdminSession(nextResponse.response, absoluteSession, absoluteCursor));
  absoluteCookie = nextResponse.get(ADMIN_COOKIE);
  absoluteSession = await adminSession.readAdminSession(
    requestWithCookie(ADMIN_COOKIE, absoluteCookie.value),
    absoluteCursor,
  );
  assert.ok(absoluteSession);
}
assert.equal(
  absoluteSession.expiresAt,
  absoluteSession.absoluteExpiresAt,
  "sliding refresh must stop at the fixed absolute lifetime",
);
assert.equal(
  await adminSession.readAdminSession(
    requestWithCookie(ADMIN_COOKIE, absoluteCookie.value),
    absoluteSession.absoluteExpiresAt,
  ),
  null,
  "the absolute lifetime must terminate even a continuously refreshed session",
);

process.env.HEALTH_DIAGNOSTICS_SECRET = "h".repeat(32);
assert.equal(
  await diagnosticsAuth.isAuthorizedHealthDiagnosticsRequest(
    requestWithCookie("unused", "", { "x-health-diagnostics-secret": "h".repeat(32) }),
  ),
  true,
  "the independent diagnostics secret must remain authorized",
);

const originalFetch = globalThis.fetch;
const redis = createRedisFetch();
globalThis.fetch = redis.fetch;
try {
  process.env.NODE_ENV = "production";
  process.env.WEB_REPLICA_COUNT = "2";
  process.env.UPSTASH_REDIS_REST_URL = "https://unit-test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "synthetic-test-token";
  process.env.ADMIN_AUTH_SECRET = "a".repeat(48);
  process.env.CHAT_AUTH_SECRET = "c".repeat(48);

  const sharedNow = baseNow + 10_000;
  const sharedIssued = createCookieResponse();
  await adminSession.issueAdminSession(sharedIssued.response, ADMIN_ADDRESS, sharedNow);
  const sharedCookie = sharedIssued.get(ADMIN_COOKIE);
  const sharedSession = await adminSession.readAdminSession(
    requestWithCookie(ADMIN_COOKIE, sharedCookie.value),
    sharedNow,
  );
  assert.ok(sharedSession, "a second replica must accept the version stored in the shared registry");

  const sharedRotationA = createCookieResponse();
  const sharedRotationB = createCookieResponse();
  const sharedRotationResults = await Promise.all([
    adminSession.rotateAdminSession(sharedRotationA.response, sharedSession, sharedNow + 1_000),
    adminSession.rotateAdminSession(sharedRotationB.response, sharedSession, sharedNow + 1_000),
  ]);
  assert.equal(
    sharedRotationResults.filter((result) => result !== null).length,
    1,
    "two replicas racing the same version must produce exactly one successful rotation",
  );
  const sharedRotated = sharedRotationResults[0] !== null
    ? sharedRotationA
    : sharedRotationB;
  const sharedRotatedCookie = sharedRotated.get(ADMIN_COOKIE);
  assert.equal(
    await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, sharedCookie.value), sharedNow + 1_000),
    null,
    "shared rotation must invalidate the old version across replicas",
  );
  assert.ok(
    await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value), sharedNow + 1_000),
    "shared rotation must expose exactly the new version",
  );
  await adminSession.revokeAdminSession(
    requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value),
    sharedNow + 1_000,
  );
  assert.equal(
    await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value), sharedNow + 1_000),
    null,
    "shared logout must revoke the session across replicas",
  );
  for (const command of ["SET", "GET", "EVAL", "DEL"]) {
    assert.ok(redis.commands.includes(command), `shared lifecycle must exercise ${command}`);
  }

  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal(
    await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value), sharedNow + 1_000),
    null,
    "multi-replica validation must fail closed without the shared store",
  );
  await assert.rejects(
    () => adminSession.readAdminSessionForRefresh(
      requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value),
      sharedNow + 1_000,
    ),
    /shared admin session store is not configured/,
    "refresh must distinguish store unavailability from an invalid cookie",
  );
  await assert.rejects(
    () => adminSession.issueAdminSession(createCookieResponse().response, ADMIN_ADDRESS, sharedNow + 2_000),
    /shared admin session store is not configured/,
  );

  process.env.WEB_REPLICA_COUNT = "1";
  process.env.ADMIN_AUTH_SECRET = process.env.CHAT_AUTH_SECRET;
  await assert.rejects(
    () => adminSession.issueAdminSession(createCookieResponse().response, ADMIN_ADDRESS, sharedNow + 3_000),
    /must be distinct/,
    "production must reject a chat/admin key collision even on one replica",
  );
} finally {
  globalThis.fetch = originalFetch;
}

for (const [file, pattern] of [
  ["app/api/admin/ops/route.ts", /await readAdminSession\(request\)/],
  ["app/api/admin/processes/route.ts", /await readAdminSession\(request\)/],
  ["app/api/health/_lib/diagnosticsAuth.ts", /async function isAuthorizedHealthDiagnosticsRequest[\s\S]*await readAdminSession\(request\)/],
  ["app/api/health/runtime/route.ts", /await isAuthorizedHealthDiagnosticsRequest\(request\)/],
  ["app/api/health/data-sync/route.ts", /await isAuthorizedHealthDiagnosticsRequest\(request\)/],
]) {
  assert.match(readFileSync(file, "utf8"), pattern, `${file} must await active server-side admin session validation`);
}

const processRouteSource = readFileSync("app/api/admin/processes/route.ts", "utf8");
assert.match(
  processRouteSource,
  /process\.env\.NODE_ENV !== "production" && process\.env\.ADMIN_PROCESS_ROUTE_ENABLED === "1"/,
  "production process control must remain disabled",
);
const adminAuthRouteSource = readFileSync("app/api/admin/auth/route.ts", "utf8");
assert.match(
  adminAuthRouteSource,
  /await readAdminSessionForRefresh\(request\)[\s\S]*const expiresAt = await rotateAdminSession\(response, session\)[\s\S]*clearAdminSession\(unauthorized\)/,
  "admin refresh must atomically rotate instead of minting an unrelated sliding cookie",
);
assert.match(
  adminAuthRouteSource,
  /export async function DELETE\(request: NextRequest\)[\s\S]*await revokeAdminSession\(request\)[\s\S]*clearAdminSession\(response\)/,
  "admin logout must revoke server state before clearing the browser cookie",
);
const refreshFailureStart = adminAuthRouteSource.indexOf(
  'logRouteError("api/admin/auth", error, { action: "refresh" })',
);
const deleteRouteStart = adminAuthRouteSource.indexOf("export async function DELETE");
assert.ok(refreshFailureStart >= 0 && deleteRouteStart > refreshFailureStart);
assert.doesNotMatch(
  adminAuthRouteSource.slice(refreshFailureStart, deleteRouteStart),
  /clearAdminSession/,
  "a refresh-store 503 must preserve the cookie so logout/revocation can be retried",
);
const logoutFailureStart = adminAuthRouteSource.indexOf(
  'logRouteError("api/admin/auth", error, { action: "logout" })',
);
assert.ok(logoutFailureStart > deleteRouteStart);
assert.doesNotMatch(
  adminAuthRouteSource.slice(logoutFailureStart),
  /clearAdminSession/,
  "a logout-store 503 must preserve the cookie so revocation can be retried",
);
const productionRuntimeSource = readFileSync("config/productionRuntime.ts", "utf8");
assert.match(productionRuntimeSource, /const adminAuthSecret = getEnv\("ADMIN_AUTH_SECRET"\)/);
assert.doesNotMatch(productionRuntimeSource, /getEnv\("ADMIN_AUTH_SECRET"\) \|\| chatAuthSecret/);
assert.match(productionRuntimeSource, /ADMIN_AUTH_SECRET must be distinct from the chat authentication secret/);
}

if (PERSISTENCE_PROBE) {
  try {
    await runPersistenceProbe();
  } finally {
    dbModule.db.close();
  }
} else {
  try {
    await runTests();
  } finally {
    dbModule.db.close();
    if (testRunDir) rmSync(testRunDir, { recursive: true, force: true });
  }
  console.log("admin-session-security: ok");
}
