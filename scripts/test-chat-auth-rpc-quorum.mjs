import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { custom, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const chatSignatureModule = await import("../app/api/_lib/chatSignatureVerification.ts");
const {
  ChatSignatureRpcBusyError,
  ChatSignatureRpcQuorumError,
  createChatSignatureRpcWitnesses,
  verifyChatWalletMessage,
} = chatSignatureModule.default ?? chatSignatureModule;

const victim = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const attacker = privateKeyToAccount(`0x${"0".repeat(63)}2`);
const message = "chat-rpc-verdict-regression";
const attackerSignature = await attacker.signMessage({ message });
const victimSignature = await victim.signMessage({ message });

function createDecisionTransport(decision, calls) {
  return custom({
    request: async ({ method }) => {
      calls.push(method);
      assert.equal(method, "eth_call");
      return encodeAbiParameters([{ type: "bool" }], [decision]);
    },
  });
}

const forgedCalls = [];
const honestCalls = [];
const splitVerdictWitnesses = createChatSignatureRpcWitnesses({
  rpcUrls: ["https://rpc-a.invalid/key", "https://rpc-b.invalid/key"],
  transportForUrl: (url) => url.includes("rpc-a")
    ? createDecisionTransport(true, forgedCalls)
    : createDecisionTransport(false, honestCalls),
});

assert.equal(
  await verifyChatWalletMessage({
    address: victim.address,
    message,
    signature: attackerSignature,
    rpcWitnesses: splitVerdictWitnesses,
    beforeRpcVerification: async () => undefined,
  }),
  false,
  "one forged RPC verdict must not authenticate a signature for another address",
);
assert.deepEqual(forgedCalls, ["eth_call"]);
assert.deepEqual(honestCalls, ["eth_call"]);

const localEoaCalls = [];
const localEoaWitnesses = createChatSignatureRpcWitnesses({
  rpcUrls: ["https://rpc-a.invalid", "https://rpc-b.invalid"],
  transportForUrl: () => createDecisionTransport(false, localEoaCalls),
});
assert.equal(
  await verifyChatWalletMessage({
    address: victim.address,
    message,
    signature: victimSignature,
    rpcWitnesses: localEoaWitnesses,
    beforeRpcVerification: async () => undefined,
  }),
  true,
  "a legitimate EOA signature must remain valid",
);
assert.deepEqual(localEoaCalls, [], "EOA verification must not consult any RPC");

const contractWalletCalls = [];
const agreeingWitnesses = createChatSignatureRpcWitnesses({
  rpcUrls: ["https://rpc-a.invalid", "https://rpc-b.invalid"],
  transportForUrl: () => createDecisionTransport(true, contractWalletCalls),
});
assert.equal(
  await verifyChatWalletMessage({
    address: victim.address,
    message,
    signature: attackerSignature,
    rpcWitnesses: agreeingWitnesses,
    beforeRpcVerification: async () => undefined,
  }),
  true,
  "two independent agreeing RPCs must preserve supported contract-wallet verification",
);
assert.deepEqual(contractWalletCalls, ["eth_call", "eth_call"]);

const aliasedWitnesses = createChatSignatureRpcWitnesses({
  rpcUrls: [
    "https://rpc-a.invalid/key-one",
    "https://RPC-A.invalid:8443/key-two?token=2",
  ],
  transportForUrl: () => createDecisionTransport(true, []),
});
assert.equal(aliasedWitnesses.length, 1, "ports and paths on one hostname are one witness");
await assert.rejects(
  verifyChatWalletMessage({
    address: victim.address,
    message,
    signature: attackerSignature,
    rpcWitnesses: aliasedWitnesses,
    beforeRpcVerification: async () => undefined,
  }),
  ChatSignatureRpcQuorumError,
  "one canonical hostname must not satisfy contract-wallet quorum",
);

let deniedWitnessCalls = 0;
await assert.rejects(
  verifyChatWalletMessage({
    address: victim.address,
    message,
    signature: attackerSignature,
    rpcWitnesses: [
      { canonicalHost: "rpc-a.invalid", verifyMessage: async () => (deniedWitnessCalls += 1, true) },
      { canonicalHost: "rpc-b.invalid", verifyMessage: async () => (deniedWitnessCalls += 1, true) },
    ],
    beforeRpcVerification: async () => {
      throw new Error("rpc admission denied");
    },
  }),
  /rpc admission denied/,
  "shared admission denial must fail before either RPC witness",
);
assert.equal(deniedWitnessCalls, 0);

const blockingResolvers = [];
let blockingAdmissions = 0;
const blockingWitnesses = [
  {
    canonicalHost: "rpc-a.invalid",
    verifyMessage: () => new Promise((resolve) => blockingResolvers.push(resolve)),
  },
  {
    canonicalHost: "rpc-b.invalid",
    verifyMessage: () => new Promise((resolve) => blockingResolvers.push(resolve)),
  },
];
const startBlockingVerification = () => verifyChatWalletMessage({
  address: victim.address,
  message,
  signature: attackerSignature,
  rpcWitnesses: blockingWitnesses,
  beforeRpcVerification: async () => {
    blockingAdmissions += 1;
  },
});
const firstBlocking = startBlockingVerification();
const secondBlocking = startBlockingVerification();
while (blockingResolvers.length < 4) {
  await new Promise((resolve) => setImmediate(resolve));
}
await assert.rejects(
  startBlockingVerification(),
  ChatSignatureRpcBusyError,
  "a third concurrent contract-wallet verification must fail before admission or RPC",
);
assert.equal(blockingAdmissions, 2);
assert.equal(blockingResolvers.length, 4);
for (const resolve of blockingResolvers) resolve(true);
assert.deepEqual(await Promise.all([firstBlocking, secondBlocking]), [true, true]);

const testRunDir = mkdtempSync(join(tmpdir(), "lore-chat-auth-rpc-quorum-"));
const originalFetch = globalThis.fetch;
let dbModule;
try {
  process.env.NODE_ENV = "development";
  process.env.LINEA_NETWORK = "sepolia";
  process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.KEEPER_RPC_URL = "https://rpc-a.invalid/key";
  process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS = "https://rpc-b.invalid/key";
  process.env.CHAT_AUTH_SECRET = "c".repeat(48);
  process.env.WEB_REPLICA_COUNT = "1";
  process.env.LORE_DB_PATH = join(testRunDir, "lore.sqlite");
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const rpcDecisions = new Map([
    ["rpc-a.invalid", true],
    ["rpc-b.invalid", false],
  ]);
  const routeRpcCalls = [];
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const requestBody = init?.body ??
      (input instanceof Request ? await input.clone().text() : "");
    const requestPayload = JSON.parse(String(requestBody));
    assert.equal(requestPayload.method, "eth_call");
    routeRpcCalls.push(requestUrl.hostname);
    const decision = rpcDecisions.get(requestUrl.hostname);
    assert.notEqual(decision, undefined, `unexpected RPC host: ${requestUrl.hostname}`);
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: requestPayload.id,
      result: encodeAbiParameters([{ type: "bool" }], [decision]),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const { NextRequest } = await import("next/server");
  const chatAuthModule = await import("../app/lib/chatAuth.ts");
  const routeModule = await import("../app/api/chat/auth/route.ts");
  const sharedRateLimitModule = await import("../app/api/_lib/sharedRateLimit.ts");
  dbModule = await import("../server/db.ts");
  const chatAuth = chatAuthModule.default ?? chatAuthModule;
  const route = routeModule.default ?? routeModule;
  const sharedRateLimit = sharedRateLimitModule.default ?? sharedRateLimitModule;

  function buildRouteMessage(nonce) {
    return chatAuth.buildChatAuthMessage({
      address: victim.address,
      uri: "http://localhost:3000/chat",
      chainId: 59141,
      nonce,
      issuedAt: new Date().toISOString(),
    });
  }

  function createRouteRequest(authMessage, authSignature) {
    return new NextRequest("http://localhost:3000/api/chat/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authAddress: victim.address,
        authMessage,
        authSignature,
      }),
    });
  }

  const forgedRouteMessage = buildRouteMessage("a".repeat(32));
  const forgedRouteSignature = await attacker.signMessage({ message: forgedRouteMessage });
  const rejected = await route.POST(createRouteRequest(forgedRouteMessage, forgedRouteSignature));
  assert.equal(rejected.status, 401, "one forged route-level RPC verdict must not issue chat auth");
  assert.deepEqual(await rejected.json(), { error: "Signature verification failed" });
  assert.equal(rejected.headers.get("set-cookie"), null);
  assert.deepEqual(routeRpcCalls, ["rpc-a.invalid", "rpc-b.invalid"]);

  const eoaRouteMessage = buildRouteMessage("b".repeat(32));
  const eoaRouteSignature = await victim.signMessage({ message: eoaRouteMessage });
  const acceptedEoa = await route.POST(createRouteRequest(eoaRouteMessage, eoaRouteSignature));
  assert.equal(acceptedEoa.status, 200, "a valid route-level EOA signature must remain accepted");
  assert.deepEqual(await acceptedEoa.json(), { ok: true });
  assert.match(acceptedEoa.headers.get("set-cookie") ?? "", /lore_chat_session=/);
  assert.deepEqual(routeRpcCalls, ["rpc-a.invalid", "rpc-b.invalid"]);

  rpcDecisions.set("rpc-b.invalid", true);
  const contractRouteMessage = buildRouteMessage("c".repeat(32));
  const contractRouteSignature = await attacker.signMessage({ message: contractRouteMessage });
  const acceptedContract = await route.POST(createRouteRequest(contractRouteMessage, contractRouteSignature));
  assert.equal(
    acceptedContract.status,
    200,
    "two agreeing route-level RPC witnesses must preserve contract-wallet authentication",
  );
  assert.deepEqual(await acceptedContract.json(), { ok: true });
  assert.match(acceptedContract.headers.get("set-cookie") ?? "", /lore_chat_session=/);
  assert.deepEqual(routeRpcCalls, [
    "rpc-a.invalid",
    "rpc-b.invalid",
    "rpc-a.invalid",
    "rpc-b.invalid",
  ]);

  for (let index = 2; index < route.CHAT_AUTH_RPC_GLOBAL_LIMIT; index += 1) {
    assert.equal(
      await sharedRateLimit.enforceSharedGlobalRateLimit({
        bucket: "api-chat-auth-rpc-outbound",
        limit: route.CHAT_AUTH_RPC_GLOBAL_LIMIT,
        windowMs: route.CHAT_AUTH_RPC_GLOBAL_WINDOW_MS,
      }),
      null,
      `global RPC admission ${index + 1} must fill the remaining bounded budget`,
    );
  }
  const rateLimitedRouteMessage = buildRouteMessage("d".repeat(32));
  const rateLimitedRouteSignature = await attacker.signMessage({ message: rateLimitedRouteMessage });
  const rpcCallsBeforeRateLimit = routeRpcCalls.length;
  const rateLimited = await route.POST(
    createRouteRequest(rateLimitedRouteMessage, rateLimitedRouteSignature),
  );
  assert.equal(rateLimited.status, 429, "exhausted global RPC budget must reject before provider calls");
  const retryAfter = Number(rateLimited.headers.get("Retry-After"));
  assert.ok(Number.isSafeInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60);
  assert.deepEqual(await rateLimited.json(), { error: "Too many requests", retryAfter });
  assert.equal(routeRpcCalls.length, rpcCallsBeforeRateLimit);
} finally {
  globalThis.fetch = originalFetch;
  dbModule?.db.close();
  rmSync(testRunDir, { recursive: true, force: true });
}

console.log("chat-auth-rpc-quorum: ok");
process.exit(0);
