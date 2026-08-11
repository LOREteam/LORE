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

  function buildMessage(nonce) {
    return adminAuth.buildAdminAuthMessage({
      address: adminAccount.address,
      uri: "http://localhost:3000/admin",
      chainId: 59141,
      nonce,
      issuedAt: new Date().toISOString(),
    });
  }

  function createRequest(message, signature) {
    return new NextRequest("http://localhost:3000/api/admin/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
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

  const attackerMessage = buildMessage("1".repeat(32));
  const attackerSignature = await attackerAccount.signMessage({ message: attackerMessage });
  const rejected = await route.POST(createRequest(attackerMessage, attackerSignature));
  const rejectedJson = await rejected.json();
  assert.equal(rejected.status, 401, "a malicious RPC verdict must not authorize a non-admin EOA signature");
  assert.deepEqual(rejectedJson, { error: "Signature verification failed" });
  assert.equal(rejected.headers.get("set-cookie"), null, "a rejected signature must not issue an admin cookie");
  assert.equal(countAdminSessions(), 0, "a rejected signature must not create a server-side admin session");
  assert.equal(rpcVerifyCalls, 0, "admin EOA verification must never consult the RPC verifier");

  const malformedMessage = buildMessage("3".repeat(32));
  const malformed = await route.POST(createRequest(malformedMessage, `0x${"0".repeat(130)}`));
  assert.equal(malformed.status, 401, "a non-recoverable signature must preserve the authentication failure response");
  assert.deepEqual(await malformed.json(), { error: "Signature verification failed" });
  assert.equal(malformed.headers.get("set-cookie"), null);
  assert.equal(countAdminSessions(), 0);
  assert.equal(rpcVerifyCalls, 0);

  const adminMessage = buildMessage("2".repeat(32));
  const adminSignature = await adminAccount.signMessage({ message: adminMessage });
  const accepted = await route.POST(createRequest(adminMessage, adminSignature));
  const acceptedJson = await accepted.json();
  assert.equal(
    accepted.status,
    200,
    `the configured admin EOA signature must remain valid: ${JSON.stringify(acceptedJson)}`,
  );
  assert.deepEqual(acceptedJson, { ok: true });
  assert.match(accepted.headers.get("set-cookie") ?? "", /lore_admin_session=/);
  assert.equal(countAdminSessions(), 1, "a valid admin EOA signature must create one server-side session");
  assert.equal(rpcVerifyCalls, 0, "the legitimate EOA path must also remain RPC-independent");
} finally {
  if (publicClient && originalRpcVerifyMessage) {
    publicClient.verifyMessage = originalRpcVerifyMessage;
  }
  dbModule?.db.close();
  rmSync(testRunDir, { recursive: true, force: true });
}

console.log("admin-auth-local-signature: ok");
process.exit(0);
