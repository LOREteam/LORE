import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

const ADMIN_ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`);
const ADMIN_ADDRESS = ADMIN_ACCOUNT.address.toLowerCase();
const ADMIN_COOKIE = "lore_admin_session";
const CHAT_COOKIE = "lore_chat_session";
const SHARED_SECRET = "s".repeat(48);
const PERSISTENCE_PROBE = process.env.ADMIN_SESSION_TEST_MODE === "persistence-probe";
const ROUTE_AUTH_FAULT_PROBE = process.env.ADMIN_SESSION_TEST_MODE === "route-auth-fault-probe";
const OWNER_NORMALIZATION_PROBE = process.env.ADMIN_SESSION_TEST_MODE === "owner-normalization-probe";
const REFRESH_STORE_FAULT_PROBE = process.env.ADMIN_SESSION_TEST_MODE === "refresh-store-fault-probe";
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

if (ROUTE_AUTH_FAULT_PROBE) {
  try {
    await runRouteAuthorizationFaultProbe();
  } finally {
    try {
      const faultDbModule = await import("../server/db.ts");
      faultDbModule.db.close();
    } catch {
      // The fault may occur before storage is imported.
    }
    if (testRunDir) {
      try {
        rmSync(testRunDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        // This child intentionally fails its boundary assertion. A transient Windows temp-dir lock must not mask it.
      }
    }
  }
  process.exit(0);
}

if (OWNER_NORMALIZATION_PROBE) {
  try {
    await runOwnerNormalizationProbe();
  } finally {
    try {
      const ownerDbModule = await import("../server/db.ts");
      ownerDbModule.db.close();
    } catch {
      // The probe may fail before storage is imported.
    }
    if (testRunDir) rmSync(testRunDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  process.exit(0);
}

if (REFRESH_STORE_FAULT_PROBE) {
  try {
    await runRefreshStoreFaultProbe();
  } finally {
    try {
      const refreshDbModule = await import("../server/db.ts");
      refreshDbModule.db.close();
    } catch {
      // The probe may fail before storage is imported.
    }
    if (testRunDir) rmSync(testRunDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  process.exit(0);
}

const adminAuthModule = await import("../app/lib/adminAuth.ts");
const chatAuthModule = await import("../app/lib/chatAuth.ts");
const adminSessionModule = await import("../app/api/_lib/adminSession.ts");
const chatSessionModule = await import("../app/api/_lib/chatSession.ts");
const diagnosticsAuthModule = await import("../app/api/health/_lib/diagnosticsAuth.ts");
const dbModule = await import("../server/db.ts");

const adminAuth = adminAuthModule.default ?? adminAuthModule;
const chatAuth = chatAuthModule.default ?? chatAuthModule;
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
  const commandPayloads = [];
  const rateLimitCounts = new Map();
  return {
    records,
    commands,
    commandPayloads,
    rateLimitCounts,
    async fetch(_url, init) {
      const command = JSON.parse(String(init?.body ?? "null"));
      assert.ok(Array.isArray(command), "shared session store command must be an array");
      commands.push(command[0]);
      commandPayloads.push(command);
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
        const script = String(command[1] ?? "");
        const key = command[3];
        if (script.includes('redis.call("INCR", KEYS[1])')) {
          const count = (rateLimitCounts.get(key) ?? 0) + 1;
          rateLimitCounts.set(key, count);
          result = [count, 60_000];
        } else if (script.includes('redis.call("DEL", KEYS[1])')) {
          const expected = command[4];
          if (!records.has(key)) {
            result = 0;
          } else if (records.get(key) === expected) {
            records.delete(key);
            result = 1;
          } else {
            result = -1;
          }
        } else {
          const previous = command[4];
          const next = command[5];
          if (records.get(key) === previous) {
            records.set(key, next);
            result = 1;
          } else {
            result = 0;
          }
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

async function runRouteAuthorizationFaultProbe() {
  process.env.NODE_ENV = "development";
  process.env.WEB_REPLICA_COUNT = "1";
  process.env.ADMIN_PROCESS_ROUTE_ENABLED = "1";
  process.env.HEALTH_DIAGNOSTICS_SECRET = "h".repeat(32);
  process.env.TRUST_PROXY_HEADERS = "1";
  process.env.TRUST_PROXY_SECRET = "p".repeat(32);
  process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "0";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const { mock } = await import("node:test");
  mock.module(new URL("../app/api/_lib/adminSession.ts", import.meta.url).href, {
    namedExports: {
      readAdminSession: async () => ({ address: ADMIN_ADDRESS }),
    },
  });

  const { NextRequest } = await import("next/server");
  const previousWorkingDirectory = process.cwd();
  mkdirSync(join(testRunDir, "artifacts"), { recursive: true });
  let processRoute;
  let opsRoute;
  process.chdir(testRunDir);
  try {
    const [processRouteModule, opsRouteModule] = await Promise.all([
      import("../app/api/admin/processes/route.ts"),
      import("../app/api/admin/ops/route.ts"),
    ]);
    processRoute = processRouteModule.default ?? processRouteModule;
    opsRoute = opsRouteModule.default ?? opsRouteModule;
  } finally {
    process.chdir(previousWorkingDirectory);
  }
  const headers = {
    "content-type": "application/json",
    "user-agent": "lore-admin-route-fault-probe",
    "x-health-diagnostics-secret": process.env.HEALTH_DIAGNOSTICS_SECRET,
    "x-lore-proxy-secret": process.env.TRUST_PROXY_SECRET,
    "x-real-ip": "203.0.113.72",
  };

  const processGet = await processRoute.GET(new NextRequest("http://localhost:3000/api/admin/processes", {
    headers,
  }));
  const processPost = await processRoute.POST(new NextRequest("http://localhost:3000/api/admin/processes", {
    method: "POST",
    headers,
    body: JSON.stringify({ target: "__must_not_spawn__" }),
  }));
  const opsGet = await opsRoute.GET(new NextRequest("http://localhost:3000/api/admin/ops", {
    headers,
  }));

  assert.deepEqual(
    [processGet.status, processPost.status, opsGet.status],
    [401, 401, 401],
    "route authorization fault probe must be rejected by the real boundary assertions",
  );
}

async function runOwnerNormalizationProbe() {
  process.env.NODE_ENV = "development";
  process.env.WEB_REPLICA_COUNT = "1";
  process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "1";

  const { mock } = await import("node:test");
  let ownerReads = 0;
  mock.module(new URL("../app/api/_lib/dataBridge.ts", import.meta.url).href, {
    namedExports: {
      publicClient: {
        readContract: async () => {
          ownerReads += 1;
          return ADMIN_ADDRESS;
        },
      },
    },
  });

  const { NextRequest } = await import("next/server");
  const ownerRouteModule = await import("../app/api/admin/check-owner/route.ts");
  const ownerRoute = ownerRouteModule.default ?? ownerRouteModule;
  assert.notEqual(
    ADMIN_ACCOUNT.address,
    ADMIN_ADDRESS,
    "owner normalization fixture must use a checksummed mixed-case query address",
  );

  const ownerResponse = await ownerRoute.GET(new NextRequest(
    `http://localhost:3000/api/admin/check-owner?address=${encodeURIComponent(ADMIN_ACCOUNT.address)}`,
    { headers: { "user-agent": "lore-owner-normalization-probe" } },
  ));
  assert.equal(ownerResponse.status, 200);
  assert.equal((await ownerResponse.json()).isOwner, true, "checksummed query and lowercase owner() must compare equal");
  assert.equal(ownerReads, 1, "valid normalized owner query must make exactly one contract read");

  const invalidResponse = await ownerRoute.GET(new NextRequest(
    "http://localhost:3000/api/admin/check-owner?address=not-an-address",
    { headers: { "user-agent": "lore-owner-normalization-invalid-probe" } },
  ));
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { isOwner: false, error: "Invalid address" });
  assert.equal(ownerReads, 1, "invalid owner query must fail before any contract read");
}

async function runRefreshStoreFaultProbe() {
  process.env.NODE_ENV = "development";
  process.env.WEB_REPLICA_COUNT = "1";
  process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "1";
  const { mock } = await import("node:test");
  mock.module(new URL("../app/api/_lib/adminSession.ts", import.meta.url).href, {
    namedExports: {
      clearAdminSession: () => {
        throw new Error("refresh response attempted to clear the cookie");
      },
      issueAdminSession: async () => {
        throw new Error("unexpected issueAdminSession call");
      },
      readAdminSessionForRefresh: async () => {
        throw new Error("synthetic shared session store outage");
      },
      revokeAdminSession: async () => {
        throw new Error("synthetic shared session store outage");
      },
      rotateAdminSession: async () => null,
    },
  });
  const { NextRequest } = await import("next/server");
  const authRouteModule = await import("../app/api/admin/auth/route.ts");
  const authRoute = authRouteModule.default ?? authRouteModule;
  const response = await authRoute.GET(new NextRequest("http://localhost:3000/api/admin/auth", {
    headers: {
      cookie: `${ADMIN_COOKIE}=synthetic-active-cookie`,
      "user-agent": "lore-admin-refresh-store-fault-probe",
    },
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Admin session refresh unavailable" });
  assert.equal(response.headers.get("set-cookie"), null, "refresh-store failure must preserve the browser cookie");
  assert.match(response.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store(?:,|$)/);
  assert.match(response.headers.get("vary") ?? "", /(?:^|,)\s*Cookie(?:,|$)/i);

  const logoutResponse = await authRoute.DELETE(new NextRequest("http://localhost:3000/api/admin/auth", {
    method: "DELETE",
    headers: {
      cookie: `${ADMIN_COOKIE}=synthetic-active-cookie`,
      "user-agent": "lore-admin-logout-store-fault-probe",
    },
  }));
  assert.equal(logoutResponse.status, 503);
  assert.deepEqual(await logoutResponse.json(), { error: "Admin session logout unavailable" });
  assert.equal(logoutResponse.headers.get("set-cookie"), null, "logout-store failure must preserve the browser cookie");
  assert.match(logoutResponse.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store(?:,|$)/);
  assert.match(logoutResponse.headers.get("vary") ?? "", /(?:^|,)\s*Cookie(?:,|$)/i);
}

function assertRouteAuthorizationFaultIsCaught() {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ADMIN_SESSION_TEST_MODE: "route-auth-fault-probe",
      },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024,
    },
  );
  assert.equal(result.signal, null, "route authorization fault probe must not be killed");
  assert.equal(result.status, 1, "route authorization fault must make the boundary assertions fail");
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /route authorization fault probe must be rejected by the real boundary assertions/,
    "fault probe must fail specifically at the diagnostics-only admin boundary",
  );
}

function assertOwnerNormalizationBehavior() {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ADMIN_SESSION_TEST_MODE: "owner-normalization-probe",
      },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.signal, null, "owner normalization probe must not be killed");
  assert.equal(
    result.status,
    0,
    `owner normalization route probe failed: ${`${result.stdout}\n${result.stderr}`.trim().slice(0, 500)}`,
  );
}

function assertRefreshStoreFaultBehavior() {
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", fileURLToPath(import.meta.url)],
    {
      cwd: process.cwd(),
      env: { ...process.env, ADMIN_SESSION_TEST_MODE: "refresh-store-fault-probe" },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.signal, null, "refresh store fault probe must not be killed");
  assert.equal(
    result.status,
    0,
    `refresh store fault route probe failed: ${`${result.stdout}\n${result.stderr}`.trim().slice(0, 500)}`,
  );
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
const originalWorkingDirectory = process.cwd();
const routeArtifactsDir = join(testRunDir, "artifacts");
mkdirSync(routeArtifactsDir, { recursive: true });
let NextRequest;
let authRoute;
let processRoute;
let opsRoute;
let appChainId;
process.chdir(testRunDir);
try {
  ({ NextRequest } = await import("next/server"));
  const [authRouteModule, processRouteModule, opsRouteModule, constantsModule] = await Promise.all([
    import("../app/api/admin/auth/route.ts"),
    import("../app/api/admin/processes/route.ts"),
    import("../app/api/admin/ops/route.ts"),
    import("../app/lib/constants.ts"),
  ]);
  authRoute = authRouteModule.default ?? authRouteModule;
  processRoute = processRouteModule.default ?? processRouteModule;
  opsRoute = opsRouteModule.default ?? opsRouteModule;
  appChainId = constantsModule.APP_CHAIN_ID;
} finally {
  process.chdir(originalWorkingDirectory);
}

async function createSignedAdminAuthPayload(nonce, uri) {
  const authMessage = adminAuth.buildAdminAuthMessage({
    address: ADMIN_ACCOUNT.address,
    uri,
    chainId: appChainId,
    nonce,
    issuedAt: new Date().toISOString(),
  });
  return {
    authAddress: ADMIN_ACCOUNT.address,
    authMessage,
    authSignature: await ADMIN_ACCOUNT.signMessage({ message: authMessage }),
  };
}

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
const previousAdminCookieEnv = {
  nodeEnv: process.env.NODE_ENV,
  adminAuthSecret: process.env.ADMIN_AUTH_SECRET,
};
try {
  process.env.NODE_ENV = "production";
  delete process.env.ADMIN_AUTH_SECRET;
  for (const malformedAdminCookie of [
    `${"a".repeat(1025)}.sig`,
    "encoded.sig.extra",
    "encoded.signature!",
  ]) {
    await assert.doesNotReject(
      () => adminSession.readAdminSessionForRefresh(
        requestWithCookie(ADMIN_COOKIE, malformedAdminCookie),
        100_000,
      ),
      "malformed admin cookies must be rejected before production secret lookup",
    );
    assert.equal(
      await adminSession.readAdminSessionForRefresh(
        requestWithCookie(ADMIN_COOKIE, malformedAdminCookie),
        100_000,
      ),
      null,
    );
  }
} finally {
  if (previousAdminCookieEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousAdminCookieEnv.nodeEnv;
  if (previousAdminCookieEnv.adminAuthSecret === undefined) delete process.env.ADMIN_AUTH_SECRET;
  else process.env.ADMIN_AUTH_SECRET = previousAdminCookieEnv.adminAuthSecret;
}
const issuedAdmin = createCookieResponse();
const adminExpiresAt = await adminSession.issueAdminSession(
  issuedAdmin.response,
  ADMIN_ACCOUNT.address,
  baseNow,
);
const adminCookie = issuedAdmin.get(ADMIN_COOKIE);
assert.ok(adminCookie, "admin login must set its cookie");
const adminPayload = decodePayload(adminCookie.value);
assert.equal(adminPayload.aud, "lore-admin");
assert.equal(adminPayload.type, "admin-session");
assert.equal(adminPayload.address, ADMIN_ADDRESS, "admin session cookies must store the canonical wallet address");
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

for (const [raw, expected] of [
  ["encoded.signature", ["encoded", "signature"]],
  ["", null],
  [".signature", null],
  ["encoded.", null],
  ["encoded.signature.extra", null],
  ["encoded.signature!", null],
  [`${"a".repeat(1025)}.signature`, null],
]) {
  assert.deepEqual(
    chatSession.parseChatSessionCookie(raw),
    expected,
    "chat session cookie parser must reject malformed, suffixed, unsafe, and oversized values before HMAC verification",
  );
}

assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000, 100_000), 120_000);
assert.equal(chatSession.normalizeChatSessionExpiresAt("120000", 100_000), null);
assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000.5, 100_000), null);
assert.equal(chatSession.normalizeChatSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
assert.equal(chatSession.normalizeChatSessionExpiresAt(99_999, 100_000), null);
assert.equal(
  chatSession.normalizeChatSessionExpiresAt(100_000 + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 60_001, 100_000),
  null,
);

const previousChatSessionEnv = {
  nodeEnv: process.env.NODE_ENV,
  chatAuthSecret: process.env.CHAT_AUTH_SECRET,
  nextAuthSecret: process.env.NEXTAUTH_SECRET,
};
try {
  process.env.NODE_ENV = "production";
  delete process.env.CHAT_AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  for (const malformedChatCookie of [
    `${"a".repeat(1025)}.sig`,
    "encoded.sig.extra",
    "encoded.signature!",
  ]) {
    assert.doesNotThrow(
      () => chatSession.readChatSession(requestWithCookie(CHAT_COOKIE, malformedChatCookie)),
      "malformed chat cookies must be rejected before production secret lookup",
    );
    assert.equal(chatSession.readChatSession(requestWithCookie(CHAT_COOKIE, malformedChatCookie)), null);
  }
} finally {
  if (previousChatSessionEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousChatSessionEnv.nodeEnv;
  if (previousChatSessionEnv.chatAuthSecret === undefined) delete process.env.CHAT_AUTH_SECRET;
  else process.env.CHAT_AUTH_SECRET = previousChatSessionEnv.chatAuthSecret;
  if (previousChatSessionEnv.nextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = previousChatSessionEnv.nextAuthSecret;
}

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
    await adminSession.revokeAdminSession(
      requestWithCookie(ADMIN_COOKIE, adminCookie.value),
      baseNow + 1_000,
    ),
    "superseded",
  "a rotated-out cookie must not revoke its active successor",
);
assert.ok(
  await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, rotatedCookie.value), baseNow + 1_000),
  "stale local logout must preserve the active rotated session",
);
assert.equal(
  await adminSession.rotateAdminSession(createCookieResponse().response, activeAdmin, baseNow + 2_000),
  null,
  "the same cookie version must not rotate twice",
);
  assert.equal(
    await adminSession.revokeAdminSession(
      requestWithCookie(ADMIN_COOKIE, rotatedCookie.value),
      baseNow + 1_000,
    ),
    "revoked",
    "an active local cookie must still revoke its own session",
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
  assert.equal(
    await adminSession.revokeAdminSession(
      requestWithCookie(ADMIN_COOKIE, sharedCookie.value),
      sharedNow + 1_000,
    ),
    "superseded",
    "a shared rotated-out cookie must not revoke its active successor",
  );
  assert.ok(
    await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value), sharedNow + 1_000),
    "stale shared logout must preserve the active rotated session",
  );
  assert.equal(
    await adminSession.revokeAdminSession(
      requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value),
      sharedNow + 1_000,
    ),
    "revoked",
    "an active shared cookie must still revoke its own session",
  );
  assert.equal(
    await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, sharedRotatedCookie.value), sharedNow + 1_000),
    null,
    "shared logout must revoke the session across replicas",
  );
  for (const command of ["SET", "GET", "EVAL"]) {
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

process.env.NODE_ENV = "development";
process.env.WEB_REPLICA_COUNT = "1";
process.env.ADMIN_AUTH_SECRET = "a".repeat(48);
process.env.CHAT_AUTH_SECRET = "c".repeat(48);
process.env.ADMIN_PROCESS_ROUTE_ENABLED = "1";
process.env.TRUST_PROXY_HEADERS = "1";
process.env.TRUST_PROXY_SECRET = "p".repeat(32);
process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "0";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const diagnosticsSecret = process.env.HEALTH_DIAGNOSTICS_SECRET;

function createAdminRouteRequest(path, options = {}) {
  const headers = new Headers({
    origin: "https://untrusted-admin-origin.example",
    "user-agent": "lore-admin-session-route-boundary",
    "x-lore-proxy-secret": process.env.TRUST_PROXY_SECRET,
    "x-real-ip": "203.0.113.71",
  });
  if (options.cookie) headers.set("cookie", `${ADMIN_COOKIE}=${options.cookie}`);
  if (options.diagnosticsSecret) {
    headers.set("x-health-diagnostics-secret", options.diagnosticsSecret);
  }
  if (options.body !== undefined) headers.set("content-type", options.contentType ?? "application/json");
  return new NextRequest(`http://localhost:3000${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

function assertAdminRouteHeaders(response, label) {
  assert.match(
    response.headers.get("cache-control") ?? "",
    /(?:^|,)\s*no-store(?:,|$)/,
    `${label} must be no-store`,
  );
  assert.match(
    response.headers.get("vary") ?? "",
    /(?:^|,)\s*Cookie(?:,|$)/i,
    `${label} must vary on Cookie`,
  );
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    null,
    `${label} must not reflect Origin`,
  );
}

async function assertAdminRequired(response, label) {
  assert.equal(response.status, 401, `${label} must require an admin session`);
  assert.deepEqual(await response.json(), { error: "Admin auth required" });
  assertAdminRouteHeaders(response, label);
}

async function assertProcessRouteDisabled(response, label) {
  assert.equal(response.status, 404, `${label} must keep process controls disabled`);
  assert.deepEqual(await response.json(), { error: "Admin process controls are disabled" });
  assertAdminRouteHeaders(response, label);
}

function snapshotProcessArtifacts() {
  return ["indexer-watch.log", "indexer-watch.pid", "bot.log", "bot.pid"].map((fileName) => {
    const file = join(routeArtifactsDir, fileName);
    if (!existsSync(file)) return { fileName, exists: false };
    const stat = statSync(file);
    return {
      fileName,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  });
}

assert.ok(diagnosticsSecret, "diagnostics secret fixture must be configured");
assertOwnerNormalizationBehavior();
assertRefreshStoreFaultBehavior();
await assertAdminRequired(
  await processRoute.GET(createAdminRouteRequest("/api/admin/processes", { diagnosticsSecret })),
  "diagnostics-only process status",
);
await assertAdminRequired(
  await processRoute.POST(createAdminRouteRequest("/api/admin/processes", {
    method: "POST",
    diagnosticsSecret,
    // This remains a non-starting target even if an authorization mutant reaches body validation.
    body: JSON.stringify({ target: "__must_not_spawn__" }),
  })),
  "diagnostics-only process start",
);
await assertAdminRequired(
  await opsRoute.GET(createAdminRouteRequest("/api/admin/ops", { diagnosticsSecret })),
  "diagnostics-only admin ops",
);

const routeSessionResponse = createCookieResponse();
await adminSession.issueAdminSession(routeSessionResponse.response, ADMIN_ADDRESS, Date.now());
const routeSessionCookie = routeSessionResponse.get(ADMIN_COOKIE);
assert.ok(routeSessionCookie, "route boundary fixture must issue a fresh admin cookie");

const localProofNonce = "ab".repeat(16);
const localProofUri = "http://localhost:3000/admin";
const localProofPayload = await createSignedAdminAuthPayload(localProofNonce, localProofUri);
const localProofResponse = await authRoute.POST(createAdminRouteRequest("/api/admin/auth", {
  method: "POST",
  body: JSON.stringify(localProofPayload),
}));
assert.equal(localProofResponse.status, 200, "a valid EOA proof must authenticate through the real admin route");
assertAdminRouteHeaders(localProofResponse, "valid admin proof");
const localProofLocks = dbModule.db.prepare(
  "SELECT name, epoch FROM ephemeral_locks WHERE name LIKE 'admin-auth:%' ORDER BY name",
).all();
assert.equal(localProofLocks.length, 1, "a valid local admin proof must consume exactly one replay lock");
assert.match(localProofLocks[0].name, /^admin-auth:[a-f0-9]{64}$/);
assert.equal(localProofLocks[0].epoch, localProofNonce);
assert.doesNotMatch(
  localProofLocks[0].name,
  new RegExp(`${localProofNonce}|${ADMIN_ADDRESS}|localhost`, "i"),
  "the local replay lock name must not retain the raw nonce, address, or URI",
);
const replayedLocalProofResponse = await authRoute.POST(createAdminRouteRequest("/api/admin/auth", {
  method: "POST",
  body: JSON.stringify(localProofPayload),
}));
assert.equal(replayedLocalProofResponse.status, 409, "the same valid admin proof must be rejected on replay");
assert.deepEqual(await replayedLocalProofResponse.json(), { error: "Auth proof already used" });
assertAdminRouteHeaders(replayedLocalProofResponse, "replayed admin proof");

const oversizedAuthResponse = await authRoute.POST(createAdminRouteRequest("/api/admin/auth", {
  method: "POST",
  body: JSON.stringify({ padding: "x".repeat(9_000) }),
}));
assert.equal(oversizedAuthResponse.status, 413, "admin auth must reject request bodies above its byte limit");
assertAdminRouteHeaders(oversizedAuthResponse, "oversized admin auth payload");
const unsupportedAuthResponse = await authRoute.POST(createAdminRouteRequest("/api/admin/auth", {
  method: "POST",
  contentType: "text/plain",
  body: JSON.stringify(localProofPayload),
}));
assert.equal(unsupportedAuthResponse.status, 415, "admin auth must reject non-JSON request bodies");
assertAdminRouteHeaders(unsupportedAuthResponse, "unsupported admin auth payload");

const refreshSessionResponse = createCookieResponse();
await adminSession.issueAdminSession(refreshSessionResponse.response, ADMIN_ACCOUNT.address, Date.now());
const refreshSessionCookie = refreshSessionResponse.get(ADMIN_COOKIE);
const refreshResponse = await authRoute.GET(createAdminRouteRequest("/api/admin/auth", {
  cookie: refreshSessionCookie.value,
}));
assert.equal(refreshResponse.status, 200, "admin refresh must rotate a valid session through the real route");
assert.deepEqual(await refreshResponse.json(), { ok: true, address: ADMIN_ADDRESS });
assert.match(refreshResponse.headers.get("x-admin-session-expires-at") ?? "", /^\d{13}$/);
assert.match(refreshResponse.headers.get("set-cookie") ?? "", /lore_admin_session=/);
assertAdminRouteHeaders(refreshResponse, "successful admin refresh");

let refreshRateLimitedResponse = null;
for (let attempt = 0; attempt < 65 && !refreshRateLimitedResponse; attempt += 1) {
  const response = await authRoute.GET(createAdminRouteRequest("/api/admin/auth"));
  if (response.status === 429) refreshRateLimitedResponse = response;
}
assert.ok(refreshRateLimitedResponse, "admin refresh must enforce its request-rate boundary");
assert.match(refreshRateLimitedResponse.headers.get("retry-after") ?? "", /^\d+$/);
assertAdminRouteHeaders(refreshRateLimitedResponse, "rate-limited admin refresh");

const oversizedProcessResponse = await processRoute.POST(createAdminRouteRequest("/api/admin/processes", {
  method: "POST",
  cookie: routeSessionCookie.value,
  body: JSON.stringify({ target: "__must_not_spawn__", padding: "x".repeat(2_000) }),
}));
assert.equal(oversizedProcessResponse.status, 413, "admin process POST must reject request bodies above its byte limit");
assertAdminRouteHeaders(oversizedProcessResponse, "oversized admin process payload");
const unsupportedProcessResponse = await processRoute.POST(createAdminRouteRequest("/api/admin/processes", {
  method: "POST",
  cookie: routeSessionCookie.value,
  contentType: "text/plain",
  body: JSON.stringify({ target: "__must_not_spawn__" }),
}));
assert.equal(unsupportedProcessResponse.status, 415, "admin process POST must reject non-JSON request bodies");
assertAdminRouteHeaders(unsupportedProcessResponse, "unsupported admin process payload");

const artifactsBeforeInvalidTarget = snapshotProcessArtifacts();
const invalidTargetResponse = await processRoute.POST(
  createAdminRouteRequest("/api/admin/processes", {
    method: "POST",
    cookie: routeSessionCookie.value,
    body: JSON.stringify({ target: "__must_not_spawn__" }),
  }),
);
assert.equal(invalidTargetResponse.status, 400, "authenticated process POST must reject an unknown target");
assert.deepEqual(await invalidTargetResponse.json(), { error: "Unknown process target" });
assertAdminRouteHeaders(invalidTargetResponse, "authenticated invalid process target");
assert.deepEqual(
  snapshotProcessArtifacts(),
  artifactsBeforeInvalidTarget,
  "an invalid process target must not create or mutate process log/PID artifacts",
);

writeFileSync(join(routeArtifactsDir, "indexer-watch.pid"), "2147483648", "utf8");
writeFileSync(join(routeArtifactsDir, "bot.pid"), "123abc", "utf8");
const omittedPrefixSecret = "must-not-read-old-log-prefix";
const visibleSecret = "must-not-return-live-secret";
const visibleUrl = "https://rpc.example.invalid/keyed/path";
const visibleWallet = ADMIN_ACCOUNT.address;
writeFileSync(
  join(routeArtifactsDir, "indexer-watch.log"),
  `API_SECRET=${omittedPrefixSecret}\n${"x".repeat(270_000)}\n2026-08-13T12:00:00.000Z [ERROR] API_SECRET=${visibleSecret} ${visibleUrl} ${visibleWallet}\n2026-02-30T12:00:02.000Z [ERROR] invalid-calendar\n[indexer] Scanning blocks 100 -> 199 (100 blocks)\n[indexer] Chunk 2/4: 125 -> 149\n[indexer] Chunk 2/4 fetched 9007199254740992 logs\n[indexer] Chunk 2/4 parsed: 3 bets, 4 epochs, 5 jackpots, 6 claims\n[indexer] Chunk 2/4 written to local SQLite\n`,
  "utf8",
);
writeFileSync(join(routeArtifactsDir, "bot.log"), "2026-08-13T12:00:01.000Z [INFO] healthy\n", "utf8");

const authorizedProcessResponse = await processRoute.GET(
  createAdminRouteRequest("/api/admin/processes", { cookie: routeSessionCookie.value }),
);
assert.equal(authorizedProcessResponse.status, 200, "enabled process status must accept a fresh admin session");
const authorizedProcessPayload = await authorizedProcessResponse.json();
assert.equal(authorizedProcessPayload.status, "ok");
assert.deepEqual(
  {
    indexer: {
      logFile: authorizedProcessPayload.processes.indexer.logFile,
      pid: authorizedProcessPayload.processes.indexer.pid,
      running: authorizedProcessPayload.processes.indexer.running,
    },
    bot: {
      logFile: authorizedProcessPayload.processes.bot.logFile,
      pid: authorizedProcessPayload.processes.bot.pid,
      running: authorizedProcessPayload.processes.bot.running,
    },
  },
  {
    indexer: { logFile: "indexer-watch.log", pid: null, running: false },
    bot: { logFile: "bot.log", pid: null, running: false },
  },
  "process status must expose only basenames and reject partial or out-of-range PID files",
);
assert.doesNotMatch(JSON.stringify(authorizedProcessPayload), /lore-admin-session-security-|[A-Z]:\\/i);
assertAdminRouteHeaders(authorizedProcessResponse, "authorized process status");

const authorizedOpsResponse = await opsRoute.GET(
  createAdminRouteRequest("/api/admin/ops", { cookie: routeSessionCookie.value }),
);
assert.equal(authorizedOpsResponse.status, 200, "admin ops must accept a fresh admin session");
const authorizedOpsPayload = await authorizedOpsResponse.json();
assert.equal(authorizedOpsPayload.status, "ok");
const serializedOpsPayload = JSON.stringify(authorizedOpsPayload);
assert.equal(
  authorizedOpsPayload.logSources.some((source) => Object.hasOwn(source, "file")),
  false,
  "admin ops log metadata must not expose internal file paths",
);
const serializedTestRunDir = JSON.stringify(testRunDir).slice(1, -1);
assert.equal(
  serializedOpsPayload.includes(serializedTestRunDir),
  false,
  "admin ops payload must not expose its absolute runtime directory",
);
for (const forbidden of [omittedPrefixSecret, visibleSecret, visibleUrl, visibleWallet]) {
  assert.equal(serializedOpsPayload.includes(forbidden), false, `admin ops payload must redact ${forbidden}`);
}
assert.match(serializedOpsPayload, /API_SECRET=<redacted>/);
assert.match(serializedOpsPayload, /<redacted-url>/);
assert.match(serializedOpsPayload, /<redacted-address>/);
assert.equal(
  authorizedOpsPayload.logSources.find((source) => source.key === "indexer")?.fileName,
  "indexer-watch.log",
  "admin ops log metadata must expose only a basename",
);
assert.equal(
  authorizedOpsPayload.recentErrors[0]?.ts,
  "2026-08-13T12:00:00.000Z",
  "admin ops must sort a noncanonical calendar timestamp behind canonical log entries",
);
assert.deepEqual(
  authorizedOpsPayload.liveIndexer,
  {
    scanFromBlock: "100",
    scanToBlock: "199",
    scanBlockCount: 100,
    chunkIndex: 2,
    chunkTotal: 4,
    chunkFromBlock: "125",
    chunkToBlock: "149",
    fetchedLogs: null,
    parsedBets: 3,
    parsedEpochs: 4,
    parsedJackpots: 5,
    parsedClaims: 6,
    wroteChunk: true,
    progressPct: 50,
  },
  "admin ops must preserve canonical progress while rejecting an unsafe live log counter",
);
assertAdminRouteHeaders(authorizedOpsResponse, "authorized admin ops");

rmSync(join(routeArtifactsDir, "indexer-watch.pid"), { force: true });
rmSync(join(routeArtifactsDir, "indexer-watch.log"), { force: true });
mkdirSync(join(routeArtifactsDir, "indexer-watch.pid"));
mkdirSync(join(routeArtifactsDir, "indexer-watch.log"));
const nonFileProcessResponse = await processRoute.GET(
  createAdminRouteRequest("/api/admin/processes", { cookie: routeSessionCookie.value }),
);
const nonFileProcessPayload = await nonFileProcessResponse.json();
assert.equal(nonFileProcessPayload.processes.indexer.pid, null);
assert.equal(nonFileProcessPayload.processes.indexer.running, false);
assert.equal(nonFileProcessPayload.processes.indexer.status, "missing");
assertAdminRouteHeaders(nonFileProcessResponse, "non-file process artifacts");
const nonFileOpsResponse = await opsRoute.GET(
  createAdminRouteRequest("/api/admin/ops", { cookie: routeSessionCookie.value }),
);
const nonFileOpsPayload = await nonFileOpsResponse.json();
const nonFileIndexerSource = nonFileOpsPayload.logSources.find((source) => source.key === "indexer");
assert.deepEqual(
  {
    exists: nonFileIndexerSource?.exists,
    status: nonFileIndexerSource?.status,
    lineCount: nonFileIndexerSource?.lineCount,
    lastLine: nonFileIndexerSource?.lastLine,
  },
  { exists: false, status: "missing", lineCount: 0, lastLine: null },
  "admin ops must treat directory-backed log artifacts as missing",
);
assertAdminRouteHeaders(nonFileOpsResponse, "non-file admin ops artifact");

const routeActiveSession = await adminSession.readAdminSession(
  requestWithCookie(ADMIN_COOKIE, routeSessionCookie.value),
  Date.now(),
);
assert.ok(routeActiveSession, "route boundary session must remain active before refresh");
const routeRotatedResponse = createCookieResponse();
assert.ok(
  await adminSession.rotateAdminSession(routeRotatedResponse.response, routeActiveSession, Date.now()),
  "route boundary session must rotate before the stale logout regression",
);
const routeRotatedCookie = routeRotatedResponse.get(ADMIN_COOKIE);
assert.ok(routeRotatedCookie, "route boundary refresh must produce a successor cookie");
const staleLogoutResponse = await authRoute.DELETE(createAdminRouteRequest("/api/admin/auth", {
  method: "DELETE",
  cookie: routeSessionCookie.value,
}));
assert.equal(staleLogoutResponse.status, 200, "stale route logout remains idempotent");
assert.deepEqual(await staleLogoutResponse.json(), { ok: true });
assert.equal(
  staleLogoutResponse.headers.get("set-cookie"),
  null,
  "stale route logout must not clear a newer browser cookie",
);
assert.ok(
  await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, routeRotatedCookie.value), Date.now()),
  "stale route logout must preserve its active server-side successor",
);

const logoutResponse = await authRoute.DELETE(createAdminRouteRequest("/api/admin/auth", {
  method: "DELETE",
  cookie: routeRotatedCookie.value,
}));
assert.equal(logoutResponse.status, 200, "admin logout must revoke through the real route");
assert.deepEqual(await logoutResponse.json(), { ok: true });
assert.match(logoutResponse.headers.get("set-cookie") ?? "", /lore_admin_session=/);
assertAdminRouteHeaders(logoutResponse, "successful admin logout");
assert.equal(
  await adminSession.readAdminSession(requestWithCookie(ADMIN_COOKIE, routeRotatedCookie.value), Date.now()),
  null,
  "successful route logout must revoke the prior cookie in server state",
);

const externalAuthRedis = createRedisFetch();
globalThis.fetch = externalAuthRedis.fetch;
try {
  process.env.NODE_ENV = "production";
  process.env.WEB_REPLICA_COUNT = "2";
  process.env.UPSTASH_REDIS_REST_URL = "https://unit-test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "synthetic-test-token";
  const sharedProofNonce = "cd".repeat(16);
  const sharedProofUri = "https://playlore.xyz/admin";
  const sharedProofPayload = await createSignedAdminAuthPayload(sharedProofNonce, sharedProofUri);
  const sharedProofResponse = await authRoute.POST(createAdminRouteRequest("/api/admin/auth", {
    method: "POST",
    body: JSON.stringify(sharedProofPayload),
  }));
  assert.equal(sharedProofResponse.status, 200, "multi-replica admin auth must consume a shared proof lock");
  const sharedReplayResponse = await authRoute.POST(createAdminRouteRequest("/api/admin/auth", {
    method: "POST",
    body: JSON.stringify(sharedProofPayload),
  }));
  assert.equal(sharedReplayResponse.status, 409, "the shared proof lock must reject replay across replicas");
  const externalProofLockCommands = externalAuthRedis.commandPayloads.filter(
    (command) => command[0] === "SET" && String(command[1]).startsWith("lore:proof-lock:"),
  );
  assert.equal(externalProofLockCommands.length, 2, "both shared proof attempts must reach the same external lock");
  assert.equal(externalProofLockCommands[0][1], externalProofLockCommands[1][1]);
  assert.match(externalProofLockCommands[0][1], /^lore:proof-lock:[a-f0-9]{64}$/);
  assert.doesNotMatch(
    JSON.stringify(externalProofLockCommands),
    new RegExp(`${sharedProofNonce}|${ADMIN_ADDRESS}|playlore`, "i"),
    "shared replay lock commands must not disclose raw proof fields",
  );
} finally {
  globalThis.fetch = originalFetch;
  process.env.NODE_ENV = "development";
  process.env.WEB_REPLICA_COUNT = "1";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

process.env.NODE_ENV = "production";
await assertProcessRouteDisabled(
  await processRoute.GET(createAdminRouteRequest("/api/admin/processes", { cookie: routeSessionCookie.value })),
  "production process status",
);
await assertProcessRouteDisabled(
  await processRoute.POST(createAdminRouteRequest("/api/admin/processes", {
    method: "POST",
    cookie: routeSessionCookie.value,
    body: JSON.stringify({ target: "indexer" }),
  })),
  "production process start",
);
process.env.NODE_ENV = "development";
delete process.env.ADMIN_PROCESS_ROUTE_ENABLED;
await assertProcessRouteDisabled(
  await processRoute.GET(createAdminRouteRequest("/api/admin/processes", { cookie: routeSessionCookie.value })),
  "unconfigured development process status",
);
process.env.ADMIN_PROCESS_ROUTE_ENABLED = "1";
assertRouteAuthorizationFaultIsCaught();

for (const [file, pattern] of [
  ["app/api/health/_lib/diagnosticsAuth.ts", /async function isAuthorizedHealthDiagnosticsRequest[\s\S]*await readAdminSession\(request\)/],
  ["app/api/health/runtime/route.ts", /await isAuthorizedHealthDiagnosticsRequest\(request\)/],
  ["app/api/health/data-sync/route.ts", /await isAuthorizedHealthDiagnosticsRequest\(request\)/],
]) {
  assert.match(readFileSync(file, "utf8"), pattern, `${file} must await active server-side admin session validation`);
}

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
    if (testRunDir) rmSync(testRunDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  console.log("admin-session-security: ok");
}
