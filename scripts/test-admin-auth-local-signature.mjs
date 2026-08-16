import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const ADMIN_PRIVATE_KEY = `0x${"0".repeat(63)}1`;
const ATTACKER_PRIVATE_KEY = `0x${"0".repeat(63)}2`;
const adminAccount = privateKeyToAccount(ADMIN_PRIVATE_KEY);
const attackerAccount = privateKeyToAccount(ATTACKER_PRIVATE_KEY);
const testRunDir = mkdtempSync(join(tmpdir(), "lore-admin-auth-local-signature-"));

process.env.NODE_ENV = "development";
process.env.LINEA_NETWORK = "sepolia";
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";
process.env.LINEA_CHAIN_ID = "59141";
process.env.NEXT_PUBLIC_LINEA_CHAIN_ID = "59141";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS = adminAccount.address;
process.env.ADMIN_AUTH_SECRET = "a".repeat(48);
process.env.CHAT_AUTH_SECRET = "c".repeat(48);
process.env.KEEPER_RPC_URL = "https://malicious-rpc.invalid";
process.env.WEB_REPLICA_COUNT = "1";
process.env.LORE_DB_PATH = join(testRunDir, "lore.sqlite");
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let dbModule;
let publicClient;
let originalRpcVerifyMessage;
const originalDateNow = Date.now;

try {
  const { NextRequest } = await import("next/server");
  const adminAuthModule = await import("../app/lib/adminAuth.ts");
  const dataBridgeModule = await import("../app/api/_lib/dataBridge.ts");
  const routeModule = await import("../app/api/admin/auth/route.ts");
  dbModule = await import("../server/db.ts");

  const adminAuth = adminAuthModule.default ?? adminAuthModule;
  const dataBridge = dataBridgeModule.default ?? dataBridgeModule;
  const route = routeModule.default ?? routeModule;
  publicClient = dataBridge.publicClient;
  originalRpcVerifyMessage = publicClient.verifyMessage;

  let rpcVerifyCalls = 0;
  publicClient.verifyMessage = async () => {
    rpcVerifyCalls += 1;
    return true;
  };

  function buildMessage(nonce, { uri = "http://localhost:3000/admin", issuedAt = new Date(Date.now()).toISOString() } = {}) {
    return adminAuth.buildAdminAuthMessage({
      address: adminAccount.address,
      uri,
      chainId: 59141,
      nonce,
      issuedAt,
    });
  }

  function createRequest(message, signature, bodyOverride) {
    return new NextRequest("http://localhost:3000/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyOverride ?? JSON.stringify({
        authAddress: adminAccount.address,
        authMessage: message,
        authSignature: signature,
      }),
    });
  }

  function countAdminSessions() {
    const row = dbModule.db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get();
    return Number(row.count);
  }

  function assertAuthResponseHeaders(response, label) {
    assert.match(response.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store(?:,|$)/, `${label} must be no-store`);
    assert.match(response.headers.get("vary") ?? "", /(?:^|,)\s*Cookie(?:,|$)/i, `${label} must vary on Cookie`);
  }

  const attackerMessage = buildMessage("1".repeat(32));
  const attackerSignature = await attackerAccount.signMessage({ message: attackerMessage });
  const rejected = await route.POST(createRequest(attackerMessage, attackerSignature));
  const rejectedJson = await rejected.json();
  assert.equal(rejected.status, 401, "a malicious RPC verdict must not authorize a non-admin EOA signature");
  assert.deepEqual(rejectedJson, { error: "Signature verification failed" });
  assert.equal(rejected.headers.get("set-cookie"), null, "a rejected signature must not issue an admin cookie");
  assert.equal(countAdminSessions(), 0, "a rejected signature must not create a server-side admin session");
  assert.equal(rpcVerifyCalls, 0, "admin EOA verification must never consult the RPC verifier");
  assertAuthResponseHeaders(rejected, "rejected signature response");

  const malformed = await route.POST(createRequest("", "", "{"));
  assert.equal(malformed.status, 400, "malformed JSON must be rejected by the real admin route");
  assert.deepEqual(await malformed.json(), { error: "Invalid auth payload" });
  assertAuthResponseHeaders(malformed, "malformed JSON response");
  assert.equal(countAdminSessions(), 0);

  const oversized = await route.POST(createRequest("", "", JSON.stringify({ padding: "x".repeat(8_193) })));
  assert.equal(oversized.status, 413, "oversized JSON must be rejected by the real admin route");
  assert.deepEqual(await oversized.json(), { error: "Auth payload too large" });
  assertAuthResponseHeaders(oversized, "oversized JSON response");
  assert.equal(countAdminSessions(), 0);

  const wrongPathMessage = buildMessage("4".repeat(32), { uri: "http://localhost:3000/admin/child" });
  const wrongPathSignature = await adminAccount.signMessage({ message: wrongPathMessage });
  const wrongPath = await route.POST(createRequest(wrongPathMessage, wrongPathSignature));
  assert.equal(wrongPath.status, 400, "a signed child path must not satisfy the exact admin origin boundary");
  assert.deepEqual(await wrongPath.json(), { error: "Invalid auth origin" });
  assert.equal(countAdminSessions(), 0);

  const issuedAtMs = originalDateNow() - 1_000;
  const reusableMessage = buildMessage("5".repeat(32), { issuedAt: new Date(issuedAtMs).toISOString() });
  const reusableSignature = await adminAccount.signMessage({ message: reusableMessage });
  Date.now = () => issuedAtMs + adminAuth.ADMIN_AUTH_PROOF_TTL_MS + 1;
  const expired = await route.POST(createRequest(reusableMessage, reusableSignature));
  assert.equal(expired.status, 401, "an expired signed proof must fail before replay consumption");
  assert.deepEqual(await expired.json(), { error: "Expired auth proof" });
  assert.equal(countAdminSessions(), 0);

  Date.now = () => issuedAtMs + 60_000;
  const accepted = await route.POST(createRequest(reusableMessage, reusableSignature));
  const acceptedJson = await accepted.json();
  assert.equal(
    accepted.status,
    200,
    `the configured admin EOA signature must remain valid: ${JSON.stringify(acceptedJson)}`,
  );
  assert.deepEqual(acceptedJson, { ok: true });
  assert.match(accepted.headers.get("set-cookie") ?? "", /lore_admin_session=/);
  assertAuthResponseHeaders(accepted, "accepted admin response");
  assert.equal(countAdminSessions(), 1, "a valid admin EOA signature must create one server-side session");
  assert.equal(rpcVerifyCalls, 0, "the legitimate EOA path must also remain RPC-independent");

  const replayed = await route.POST(createRequest(reusableMessage, reusableSignature));
  assert.equal(replayed.status, 409, "the exact valid proof must be consumed only once");
  assert.deepEqual(await replayed.json(), { error: "Auth proof already used" });
  assert.equal(countAdminSessions(), 1, "a replay must not issue another admin session");
} finally {
  Date.now = originalDateNow;
  if (publicClient && originalRpcVerifyMessage) {
    publicClient.verifyMessage = originalRpcVerifyMessage;
  }
  dbModule?.db.close();
  rmSync(testRunDir, { recursive: true, force: true });
}

console.log("admin-auth-local-signature: ok");
process.exit(0);
