import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, encodeFunctionResult, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const keeperSigningSafetyModule = await import("../server/keeperSigningSafety.ts");
const {
  assertKeeperReceiptFinality,
  assertKeeperSignedTransactionIntegrity,
  KeeperRpcAgreementError,
  KeeperSignedTransactionIntegrityError,
  readWithExactKeeperRpcAgreement,
  selectKeeperAgreementRpcUrls,
} = keeperSigningSafetyModule.default ?? keeperSigningSafetyModule;
const productionRuntimeModule = await import("../config/productionRuntime.ts");
const {
  parseRequiredRuntimeFinalityBlocks,
} = productionRuntimeModule.default ?? productionRuntimeModule;

const routeSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
const botSource = readFileSync("bot.ts", "utf8");
const indexerSource = readFileSync("scripts/indexer.ts", "utf8");
const productionRuntimeSource = readFileSync("config/productionRuntime.ts", "utf8");

const receiptForFinality = {
  status: "success",
  transactionHash: `0x${"2".repeat(64)}`,
  blockHash: `0x${"1".repeat(64)}`,
  blockNumber: 16n,
  transactionIndex: 0,
};
assert.equal(parseRequiredRuntimeFinalityBlocks("2"), 2n);
assert.equal(parseRequiredRuntimeFinalityBlocks("1000000"), 1_000_000n);
for (const invalidFinality of [
  undefined,
  "",
  "0",
  "01",
  " 2",
  "2 ",
  "+2",
  "2.0",
  "-1",
  "1000001",
  "999999999999999999999999999999999999999999999999",
]) {
  assert.throws(
    () => parseRequiredRuntimeFinalityBlocks(invalidFinality),
    /INDEXER_FINALITY_BLOCKS must/,
  );
}
assert.equal(
  assertKeeperReceiptFinality(receiptForFinality, 2n, [
    { headBlock: 17n, blockHash: null },
    { headBlock: 18n, blockHash: receiptForFinality.blockHash },
  ]),
  false,
  "a receipt must remain pending until both independent origins reach finality",
);
assert.equal(
  assertKeeperReceiptFinality(receiptForFinality, 2n, [
    { headBlock: 18n, blockHash: receiptForFinality.blockHash },
    { headBlock: 19n, blockHash: receiptForFinality.blockHash.toUpperCase().replace("0X", "0x") },
  ]),
  true,
  "both mature origins must revalidate the receipt's canonical block hash",
);
assert.throws(
  () => assertKeeperReceiptFinality(receiptForFinality, 2n, [
    { headBlock: 18n, blockHash: receiptForFinality.blockHash },
    { headBlock: 18n, blockHash: `0x${"3".repeat(64)}` },
  ]),
  KeeperRpcAgreementError,
  "a reorg or fork disagreement must remain unresolved",
);
assert.deepEqual(
  selectKeeperAgreementRpcUrls([
    " https://RPC-one.example:443/project-a?key=one ",
    "https://rpc-one.example/project-b?key=two",
    "https://rpc-two.example",
  ]),
  ["https://RPC-one.example:443/project-a?key=one", "https://rpc-two.example"],
  "bootstrap signing must preserve endpoints while selecting distinct canonical origins",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "https://RPC.example:443/project-a?key=one",
    "https://rpc.example/project-b?key=two",
  ]),
  /keeper_independent_rpc_required/,
  "path/query/API-key aliases on one canonical origin must remain one witness",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "https://rpc.example./project-a",
    "https://RPC.example:443/project-b",
  ]),
  /keeper_independent_rpc_required/,
  "a trailing DNS dot and default port must not manufacture a second witness",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "https://rpc.example:443/project-a",
    "http://RPC.example:8545/project-b",
  ]),
  /keeper_independent_rpc_required/,
  "scheme and nondefault-port aliases on one host must not manufacture a second witness",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "https://b\u00fccher.example/project-a",
    "https://xn--bcher-kva.example/project-b",
  ]),
  /keeper_independent_rpc_required/,
  "Unicode and IDNA spellings of one host must remain one witness",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "https://user:secret@rpc-one.example",
    "https://rpc-two.example",
  ]),
  /keeper_rpc_url_invalid reason=credentials/,
  "credential-bearing RPC URLs must be rejected before witness selection",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "https://@rpc-one.example",
    "https://rpc-two.example",
  ]),
  /keeper_rpc_url_invalid reason=credentials/,
  "even empty URL userinfo must be rejected at the RPC trust boundary",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "https:////@rpc-one.example",
    "https://rpc-two.example",
  ]),
  /keeper_rpc_url_invalid reason=credentials/,
  "alternate empty-userinfo URL syntax must also be rejected",
);
assert.throws(
  () => selectKeeperAgreementRpcUrls([
    "ws://rpc-one.example",
    "https://rpc-two.example",
  ]),
  /keeper_rpc_url_invalid reason=scheme/,
  "keeper agreement transports must be HTTP(S)",
);
assert.equal(
  await readWithExactKeeperRpcAgreement(
    "bootstrap-test",
    [async () => 7n, async () => 7n],
    (value) => value.toString(),
  ),
  7n,
);
await assert.rejects(
  readWithExactKeeperRpcAgreement(
    "bootstrap-test",
    [async () => 7n, async () => 8n],
    (value) => value.toString(),
  ),
  KeeperRpcAgreementError,
  "an RPC disagreement must fail closed",
);

for (const agreementFingerprint of [
  "fingerprintKeeperEligibility",
  "fingerprintKeeperNonce",
  "fingerprintKeeperReceipt",
]) {
  assert.ok(
    routeSource.includes(agreementFingerprint),
    `bootstrap signing must independently agree on ${agreementFingerprint}`,
  );
}
assert.doesNotMatch(
  routeSource,
  /readContractResilient|walletClient\.writeContract/,
  "bootstrap signing must not trust a first-success RPC or broadcast before local persistence",
);
const localSign = routeSource.indexOf("account.signTransaction");
const validateSigned = routeSource.indexOf("await assertBootstrapPendingResolveIntegrity(", localSign);
const persistSigned = routeSource.indexOf("savePendingResolveRecord(signedRecord)", validateSigned);
const broadcastSigned = routeSource.indexOf("await broadcastSignedResolve", persistSigned);
assert.ok(
  localSign >= 0 && validateSigned > localSign && persistSigned > validateSigned && broadcastSigned > persistSigned,
  "the locally verified signer-owned nonce and hash must be durable before raw transaction broadcast",
);
assert.match(
  routeSource,
  /function savePendingResolveRecord\([\s\S]*?setMetaJson\(BOOTSTRAP_PENDING_RESOLVE_META_KEY, record\)/,
  "the pre-broadcast signer record must use durable server metadata storage",
);
assert.match(
  productionRuntimeSource,
  /BOOTSTRAP_KEEPER_PRIVATE_KEY is required[\s\S]*BOOTSTRAP_KEEPER_PRIVATE_KEY must be distinct from KEEPER_PRIVATE_KEY/,
  "strict production must require a dedicated bootstrap key distinct from the bot key",
);
assert.match(
  productionRuntimeSource,
  /BOOTSTRAP_RESOLVE_SECRET must be distinct from lower-purpose authentication and diagnostics secrets/,
  "strict production must reject cross-purpose bootstrap credentials without logging values",
);
assert.match(
  productionRuntimeSource,
  /parseRequiredRuntimeFinalityBlocks[\s\S]*scope === "indexer"[\s\S]*scope === "bot"[\s\S]*scope === "web" && bootstrapKeeperEnabled[\s\S]*process\.env\.INDEXER_FINALITY_BLOCKS/,
  "strict runtime preflight must apply the same finality parser to indexer, bot, and enabled bootstrap web",
);
assert.match(
  indexerSource,
  /parseRequiredRuntimeFinalityBlocks\(\s*process\.env\.INDEXER_FINALITY_BLOCKS,?\s*\)/,
  "the executable indexer must reject absent, noncanonical, and out-of-range finality before running",
);
const botStart = botSource.indexOf("async function startKeeperBot()");
const botLoop = botSource.indexOf("while (true)", botStart);
const botPreflight = botSource.indexOf('assertProductionRuntimeConfig("bot")', botStart);
const botFinalityParse = botSource.indexOf("parseRequiredRuntimeFinalityBlocks(", botStart);
assert.ok(
  botStart >= 0 &&
    botPreflight > botStart &&
    botFinalityParse > botPreflight &&
    botLoop > botFinalityParse,
  "keeper production and finality configuration must fail inside the caught startup preflight before the supervisor loop",
);
assert.equal(
  botSource.indexOf('assertProductionRuntimeConfig("bot")'),
  botPreflight,
  "keeper production preflight must not throw outside the fatal startup handler",
);

assert.match(
  routeSource,
  /async function broadcastSignedResolve\([\s\S]*await assertBootstrapPendingResolveIntegrity\([\s\S]*record,[\s\S]*expectedSigner,[\s\S]*expectedEpoch,[\s\S]*sendRawTransaction/,
  "every raw broadcast must validate the complete local signed envelope first",
);
assert.match(
  botSource,
  /type PendingResolve = \{[\s\S]*signer: `0x\$\{string\}`;[\s\S]*serializedTransaction: Hex;[\s\S]*lastBroadcastAt\?: number;/,
  "the bot must durably retain the exact signed transaction needed for crash recovery",
);
assert.match(
  botSource,
  /async function broadcastPendingResolve\([\s\S]*await assertPendingResolveIntegrity\([\s\S]*savePendingResolve\([\s\S]*sendRawTransaction\([\s\S]*serializedTransaction: persisted\.serializedTransaction/,
  "every initial or recovery broadcast must validate and persist the exact signed envelope first",
);
assert.match(
  botSource,
  /readAgreedKeeperReceipt\([\s\S]*readAgreedKeeperNonce\([\s\S]*latestNonce > pending\.nonce \|\| pendingNonce > pending\.nonce[\s\S]*broadcastPendingResolve/,
  "idempotent raw rebroadcast must follow two-origin receipt and nonce checks",
);
assert.doesNotMatch(
  botSource,
  /latestNonce > pending\.nonce[\s\S]{0,500}savePendingResolve\(null\)/,
  "nonce consumption without the bound receipt must never discard the signed intent",
);
assert.match(
  botSource,
  /readAgreedKeeperReceipt\([\s\S]*receipt\.transactionHash\.toLowerCase\(\) !== hash\.toLowerCase\(\)[\s\S]*KeeperRpcAgreementError\("receipt_transaction_hash"\)[\s\S]*hasAgreedKeeperReceiptFinality\([\s\S]*if \(!finalized\)[\s\S]*continue;[\s\S]*receipt\.status === "success"[\s\S]*savePendingResolve\(null\)/,
  "the bot must bind the receipt hash before two-origin canonical finality and pending-record deletion",
);

const testRunDir = mkdtempSync(join(tmpdir(), "lore-bootstrap-record-integrity-"));
const bootstrapPrivateKey = `0x${"0".repeat(63)}1`;
const attackerPrivateKey = `0x${"0".repeat(63)}2`;
const bootstrapAccount = privateKeyToAccount(bootstrapPrivateKey);
const attackerAccount = privateKeyToAccount(attackerPrivateKey);
const contractAddress = "0x0000000000000000000000000000000000001234";
const pendingMetaKey = "bootstrap:pendingResolve:v1";

const tsxCliPath = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const invalidBotPreflight = spawnSync(process.execPath, [tsxCliPath, "bot.ts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 10_000,
  env: {
    ...process.env,
    NODE_ENV: "test",
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    LINEA_CHAIN_ID: "59141",
    NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
    KEEPER_PRIVATE_KEY: bootstrapPrivateKey,
    KEEPER_CONTRACT_ADDRESS: contractAddress,
    NEXT_PUBLIC_CONTRACT_ADDRESS: contractAddress,
    KEEPER_RPC_URL: "https://network-must-not-run.invalid,https://network-must-not-run-peer.invalid",
    INDEXER_FINALITY_BLOCKS: "01",
    LORE_DB_PATH: join(testRunDir, "bot-preflight.sqlite"),
  },
});
assert.equal(invalidBotPreflight.status, 1);
const invalidBotOutput = `${invalidBotPreflight.stdout ?? ""}\n${invalidBotPreflight.stderr ?? ""}`;
assert.match(
  invalidBotOutput,
  /\[keeper\] Fatal startup error: INDEXER_FINALITY_BLOCKS must be a canonical positive decimal integer/,
  "invalid finality must become a concise caught keeper startup error",
);
assert.doesNotMatch(
  invalidBotOutput,
  /LineaOre Keeper Bot|fetch failed|ENOTFOUND|ECONNREFUSED/,
  "invalid finality must fail before supervisor-loop startup or RPC access",
);

const invalidIndexerPreflight = spawnSync(
  process.execPath,
  [tsxCliPath, "scripts/indexer.ts"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      KEEPER_CONTRACT_ADDRESS: contractAddress,
      NEXT_PUBLIC_CONTRACT_ADDRESS: contractAddress,
      KEEPER_RPC_URL: "https://network-must-not-run.invalid,https://network-must-not-run-peer.invalid",
      INDEXER_FINALITY_BLOCKS: "1000001",
      LORE_DB_PATH: join(testRunDir, "indexer-preflight.sqlite"),
    },
  },
);
assert.equal(invalidIndexerPreflight.status, 1);
const invalidIndexerOutput = `${invalidIndexerPreflight.stdout ?? ""}\n${invalidIndexerPreflight.stderr ?? ""}`;
assert.match(
  invalidIndexerOutput,
  /INDEXER_FINALITY_BLOCKS must not exceed 1000000/,
  "out-of-range finality must fail the executable indexer preflight",
);
assert.doesNotMatch(
  invalidIndexerOutput,
  /\[indexer\] Starting|fetch failed|ENOTFOUND|ECONNREFUSED/,
  "invalid indexer finality must fail before its run loop or RPC access",
);

process.env.NODE_ENV = "development";
process.env.LINEA_NETWORK = "sepolia";
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";
process.env.LINEA_CHAIN_ID = "59141";
process.env.NEXT_PUBLIC_LINEA_CHAIN_ID = "59141";
process.env.KEEPER_CONTRACT_ADDRESS = contractAddress;
process.env.NEXT_PUBLIC_CONTRACT_ADDRESS = contractAddress;
process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY = bootstrapPrivateKey;
process.env.BOOTSTRAP_RESOLVE_SECRET = "r".repeat(48);
process.env.KEEPER_RPC_URL = [
  "https://network-must-not-run.invalid/rpc-a",
  "https://network-must-not-run-peer.invalid/rpc-b",
].join(",");
process.env.INDEXER_FINALITY_BLOCKS = "2";
process.env.WEB_REPLICA_COUNT = "1";
process.env.LORE_DB_PATH = join(testRunDir, "lore.sqlite");
process.env.TRUST_PROXY_HEADERS = "1";
process.env.TRUST_PROXY_SECRET = "p".repeat(48);

let dbModule;
const originalFetch = globalThis.fetch;
let rpcNetworkCalls = 0;
let rpcState = null;
const rpcMethods = [];
const externalLockCommands = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  if (url.replace(/\/$/, "") === "https://redis-unit-test.dev") {
    const command = JSON.parse(String(init?.body ?? "null"));
    externalLockCommands.push(command);
    return Response.json({ result: externalLockCommands.length === 1 ? "OK" : null });
  }
  if (!url.includes("network-must-not-run")) {
    throw new Error("bootstrap integrity test forbids network access");
  }
  rpcNetworkCalls += 1;
  if (!rpcState) {
    throw new Error("bootstrap integrity test forbids RPC before local validation");
  }

  const payload = JSON.parse(String(init?.body ?? "null"));
  const requests = Array.isArray(payload) ? payload : [payload];
  const responses = requests.map((request) => {
    rpcMethods.push(request.method);
    if (rpcState.failMethod === request.method) {
      throw new Error(rpcState.failureMessage ?? "injected bootstrap RPC failure");
    }
    let result;
    if (request.method === "eth_call") {
      const data = request.params?.[0]?.data?.toLowerCase();
      const currentEpochCall = encodeFunctionData({
        abi: rpcState.abi,
        functionName: "currentEpoch",
      }).toLowerCase();
      const endTimeCall = encodeFunctionData({
        abi: rpcState.abi,
        functionName: "getEpochEndTime",
        args: [rpcState.currentEpoch],
      }).toLowerCase();
      const epochCall = encodeFunctionData({
        abi: rpcState.abi,
        functionName: "epochs",
        args: [rpcState.currentEpoch],
      }).toLowerCase();
      if (data === currentEpochCall) {
        result = encodeFunctionResult({
          abi: rpcState.abi,
          functionName: "currentEpoch",
          result: rpcState.currentEpoch,
        });
      } else if (data === endTimeCall) {
        result = encodeFunctionResult({
          abi: rpcState.abi,
          functionName: "getEpochEndTime",
          result: rpcState.endTime,
        });
      } else if (data === epochCall) {
        result = encodeFunctionResult({
          abi: rpcState.abi,
          functionName: "epochs",
          result: [rpcState.totalPool, 0n, 0n, rpcState.isResolved, false, false],
        });
      } else {
        throw new Error(`unexpected eth_call data ${data}`);
      }
    } else if (request.method === "eth_getTransactionReceipt") {
      result = rpcState.receipt;
    } else if (request.method === "eth_getTransactionByHash") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32000, message: "Transaction receipt could not be found" },
      };
    } else if (request.method === "eth_getTransactionCount") {
      const blockTag = request.params?.[1];
      const nonce = blockTag === "pending" ? rpcState.pendingNonce : rpcState.latestNonce;
      result = `0x${nonce.toString(16)}`;
    } else if (request.method === "eth_blockNumber") {
      result = `0x${rpcState.headBlock.toString(16)}`;
    } else if (request.method === "eth_getBlockByNumber") {
      const blockNumber = BigInt(request.params?.[0] ?? "0x0");
      const isSecondOrigin = url.includes("peer");
      result = {
        number: `0x${blockNumber.toString(16)}`,
        hash: isSecondOrigin
          ? rpcState.secondCanonicalBlockHash
          : rpcState.canonicalBlockHash,
        timestamp: "0x1",
        transactions: [],
      };
    } else {
      throw new Error(`unexpected RPC method ${request.method}`);
    }
    return { jsonrpc: "2.0", id: request.id, result };
  });
  return new Response(JSON.stringify(Array.isArray(payload) ? responses : responses[0]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

try {
  const abiModule = await import("../config/abi.ts");
  const storageModule = await import("../server/storage.ts");
  const routeModule = await import("../app/api/bootstrap-resolve/route.ts");
  dbModule = await import("../server/db.ts");
  const { RESOLVE_ABI } = abiModule.default ?? abiModule;
  const storage = storageModule.default ?? storageModule;
  const route = routeModule.default ?? routeModule;
  const sharedModule = await import("../app/api/bootstrap-resolve/shared.ts");
  const shared = sharedModule.default ?? sharedModule;

  const epoch = 42n;
  const expectedData = encodeFunctionData({
    abi: RESOLVE_ABI,
    functionName: "resolveEpoch",
    args: [epoch],
  });
  const expectedEnvelope = {
    chainId: 59141,
    signer: bootstrapAccount.address,
    to: contractAddress,
    data: expectedData,
  };

  function configureRpc(overrides = {}) {
    rpcState = {
      abi: RESOLVE_ABI,
      currentEpoch: epoch,
      endTime: 1n,
      totalPool: 1n,
      isResolved: false,
      receipt: null,
      latestNonce: 7,
      pendingNonce: 7,
      headBlock: 18n,
      canonicalBlockHash: `0x${"1".repeat(64)}`,
      secondCanonicalBlockHash: `0x${"1".repeat(64)}`,
      ...overrides,
    };
    rpcMethods.length = 0;
    rpcNetworkCalls = 0;
  }

  let routeRequestCounter = 0;
  function postResolve() {
    return route.POST(new Request(
      "http://localhost:3000/api/bootstrap-resolve",
      {
        method: "POST",
        headers: {
          "x-bootstrap-resolve-secret": process.env.BOOTSTRAP_RESOLVE_SECRET,
          "x-lore-proxy-secret": process.env.TRUST_PROXY_SECRET,
          "x-real-ip": `192.0.2.${++routeRequestCounter}`,
        },
      },
    ));
  }

  async function expectRouteResponse(
    request,
    status,
    payload,
    message,
  ) {
    rpcState = null;
    rpcNetworkCalls = 0;
    const response = await route.POST(request);
    assert.equal(response.status, status, message);
    assert.deepEqual(await response.json(), payload, message);
    assert.match(
      response.headers.get("cache-control") ?? "",
      /no-store/,
      `${message}: response must be non-cacheable`,
    );
    assert.equal(rpcNetworkCalls, 0, `${message}: rejection must happen before RPC access`);
  }

  const resolveUrl = "http://localhost:3000/api/bootstrap-resolve";
  const correctSecret = process.env.BOOTSTRAP_RESOLVE_SECRET;
  process.env.KEEPER_PRIVATE_KEY = bootstrapPrivateKey;
  delete process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY;
  assert.equal(
    shared.getBootstrapKeeperAccount(),
    null,
    "bootstrap signing must not fall back to the keeper-bot account",
  );
  process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY = bootstrapPrivateKey;
  await expectRouteResponse(
    new Request(resolveUrl, { method: "POST" }),
    403,
    { ok: false, reason: "bootstrap_unauthorized" },
    "a configured keeper must reject a missing bootstrap secret even on localhost",
  );
  await expectRouteResponse(
    new Request(resolveUrl, {
      method: "POST",
      headers: { "x-bootstrap-resolve-secret": "x".repeat(257) },
    }),
    403,
    { ok: false, reason: "bootstrap_unauthorized" },
    "an oversized provided bootstrap secret must fail closed",
  );
  for (const peerSecretName of [
    "HEALTH_DIAGNOSTICS_SECRET",
    "TRUST_PROXY_SECRET",
    "CHAT_AUTH_SECRET",
    "NEXTAUTH_SECRET",
    "ADMIN_AUTH_SECRET",
  ]) {
    process.env[peerSecretName] = correctSecret;
    await expectRouteResponse(
      new Request(resolveUrl, {
        method: "POST",
        headers: { "x-bootstrap-resolve-secret": correctSecret },
      }),
      403,
      { ok: false, reason: "bootstrap_unauthorized" },
      `a bootstrap secret reused for ${peerSecretName} must fail purpose separation`,
    );
    delete process.env[peerSecretName];
  }
  process.env.TRUST_PROXY_SECRET = "p".repeat(48);
  for (const [name, init] of [
    ["streamed body", { body: "{}", headers: { "x-bootstrap-resolve-secret": correctSecret } }],
    ["nonzero content length", { headers: { "content-length": "1", "x-bootstrap-resolve-secret": correctSecret } }],
    ["noncanonical zero content length", { headers: { "content-length": "00", "x-bootstrap-resolve-secret": correctSecret } }],
  ]) {
    await expectRouteResponse(
      new Request(resolveUrl, { method: "POST", ...init }),
      413,
      { ok: false, reason: "bootstrap_body_not_supported" },
      `bootstrap resolver must reject a ${name}`,
    );
  }

  delete process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY;
  delete process.env.INDEXER_FINALITY_BLOCKS;
  rpcState = null;
  rpcNetworkCalls = 0;
  const disabledResponse = await postResolve();
  assert.equal(disabledResponse.status, 200);
  assert.deepEqual(await disabledResponse.json(), {
    ok: true,
    action: "noop",
    reason: "bootstrap_keeper_disabled",
  });
  assert.match(disabledResponse.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(rpcNetworkCalls, 0, "disabled bootstrap keeper must remain a zero-RPC noop");

  const fixedRateLimitHeaders = {
    "x-bootstrap-resolve-secret": correctSecret,
    "x-lore-proxy-secret": process.env.TRUST_PROXY_SECRET,
    "x-real-ip": "192.0.2.240",
  };
  let rateLimitedResponse;
  for (let attempt = 0; attempt < 13; attempt += 1) {
    rateLimitedResponse = await route.POST(new Request(resolveUrl, {
      method: "POST",
      headers: fixedRateLimitHeaders,
    }));
  }
  assert.equal(rateLimitedResponse.status, 429);
  const rateLimitedPayload = await rateLimitedResponse.json();
  assert.equal(rateLimitedPayload.error, "Too many requests");
  assert.ok(Number.isSafeInteger(rateLimitedPayload.retryAfter));
  assert.ok(rateLimitedPayload.retryAfter >= 1 && rateLimitedPayload.retryAfter <= 60);
  assert.equal(rateLimitedResponse.headers.get("retry-after"), String(rateLimitedPayload.retryAfter));
  assert.match(rateLimitedResponse.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(rpcNetworkCalls, 0, "rate limiting must reject before bootstrap RPC access");

  const invalidKeeperSentinel = "keeper-private-key-secret-sentinel";
  process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY = invalidKeeperSentinel;
  const capturedKeeperErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => capturedKeeperErrors.push(args.map(String).join(" "));
  let invalidKeeperResponse;
  try {
    invalidKeeperResponse = await postResolve();
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(invalidKeeperResponse.status, 500);
  assert.deepEqual(await invalidKeeperResponse.json(), {
    ok: false,
    reason: "bootstrap_keeper_misconfigured",
  });
  assert.match(invalidKeeperResponse.headers.get("cache-control") ?? "", /no-store/);
  assert.ok(capturedKeeperErrors.some((line) => line.includes("api/bootstrap-resolve")));
  assert.doesNotMatch(capturedKeeperErrors.join("\n"), new RegExp(invalidKeeperSentinel, "i"));
  assert.equal(rpcNetworkCalls, 0, "invalid keeper material must fail before RPC access");
  process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY = bootstrapPrivateKey;

  process.env.INDEXER_FINALITY_BLOCKS = "01";
  rpcState = null;
  rpcNetworkCalls = 0;
  const invalidFinalityResponse = await postResolve();
  assert.equal(invalidFinalityResponse.status, 500);
  assert.deepEqual(await invalidFinalityResponse.json(), {
    ok: false,
    reason: "bootstrap_keeper_misconfigured",
  });
  assert.equal(
    rpcNetworkCalls,
    0,
    "enabled bootstrap keeper finality misconfiguration must fail before any RPC access",
  );
  process.env.INDEXER_FINALITY_BLOCKS = "2";

  configureRpc({
    failMethod: "eth_call",
    failureMessage: "provider-error-secret-sentinel token=raw-provider-secret",
  });
  const providerFailureResponse = await postResolve();
  const providerFailurePayload = await providerFailureResponse.json();
  assert.ok([200, 500].includes(providerFailureResponse.status));
  assert.ok([
    "bootstrap_rpc_unavailable",
    "resolve_failed",
  ].includes(providerFailurePayload.reason));
  assert.match(providerFailureResponse.headers.get("cache-control") ?? "", /no-store/);
  assert.doesNotMatch(
    JSON.stringify(providerFailurePayload),
    /provider-error-secret-sentinel|raw-provider-secret/i,
  );

  function successfulReceipt(hash) {
    return {
      blockHash: `0x${"1".repeat(64)}`,
      blockNumber: "0x10",
      contractAddress: null,
      cumulativeGasUsed: "0x249f0",
      effectiveGasPrice: "0x3b9aca00",
      from: bootstrapAccount.address,
      gasUsed: "0x249f0",
      logs: [],
      logsBloom: `0x${"0".repeat(512)}`,
      status: "0x1",
      to: contractAddress,
      transactionHash: hash,
      transactionIndex: "0x0",
      type: "0x2",
    };
  }

  function revertedReceipt(hash) {
    return { ...successfulReceipt(hash), status: "0x0" };
  }

  async function signedRecord({
    account = bootstrapAccount,
    chainId = 59141,
    nonce = 7,
    to = contractAddress,
    value = 0n,
    data = expectedData,
  } = {}) {
    const serializedTransaction = await account.signTransaction({
      chainId,
      data,
      gas: 150_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      nonce,
      to,
      type: "eip1559",
      value,
    });
    return {
      epoch: epoch.toString(),
      signer: bootstrapAccount.address,
      nonce,
      hash: keccak256(serializedTransaction),
      serializedTransaction,
      signedAt: Date.now(),
      state: "signed",
    };
  }

  const validRecord = await signedRecord();
  await assert.doesNotReject(
    assertKeeperSignedTransactionIntegrity(validRecord, expectedEnvelope),
    "a locally signed exact resolve envelope must validate without RPC access",
  );

  async function rejectsIntegrity(record, field) {
    await assert.rejects(
      assertKeeperSignedTransactionIntegrity(record, expectedEnvelope),
      (error) =>
        error instanceof KeeperSignedTransactionIntegrityError &&
        error.message.includes(`field=${field}`),
      `tampered ${field} must fail before broadcast`,
    );
  }

  await rejectsIntegrity(
    { ...validRecord, hash: `0x${"0".repeat(64)}` },
    "hash",
  );
  await rejectsIntegrity(
    { ...validRecord, nonce: validRecord.nonce + 1 },
    "nonce",
  );
  await rejectsIntegrity(await signedRecord({ account: attackerAccount }), "signer");
  await rejectsIntegrity(await signedRecord({ chainId: 59144 }), "chain_id");
  await rejectsIntegrity(
    await signedRecord({ to: "0x0000000000000000000000000000000000005678" }),
    "to",
  );
  await rejectsIntegrity(await signedRecord({ value: 1n }), "value");
  const otherEpochData = encodeFunctionData({
    abi: RESOLVE_ABI,
    functionName: "resolveEpoch",
    args: [epoch + 1n],
  });
  await rejectsIntegrity(await signedRecord({ data: otherEpochData }), "data");

  const scopedMetaKey = `${storage.getCurrentStorageScope()}:${pendingMetaKey}`;
  const clearRouteState = () => {
    dbModule.db.prepare("DELETE FROM meta WHERE key = ?").run(scopedMetaKey);
    dbModule.db.prepare("DELETE FROM ephemeral_locks").run();
  };
  const clearOperationLocks = () => {
    dbModule.db.prepare("DELETE FROM ephemeral_locks").run();
  };

  clearRouteState();
  configureRpc({ totalPool: 0n });
  const emptyEpochResponse = await postResolve();
  assert.equal(emptyEpochResponse.status, 200);
  assert.deepEqual(await emptyEpochResponse.json(), {
    ok: true,
    action: "noop",
    reason: "epoch_empty",
    currentEpoch: epoch.toString(),
    isResolved: false,
    isExpired: true,
  });
  assert.equal(
    dbModule.db.prepare("SELECT COUNT(*) AS count FROM ephemeral_locks").get().count,
    0,
    "empty epochs must not acquire the keeper operation lock",
  );
  assert.ok(!rpcMethods.includes("eth_getTransactionCount"));
  assert.ok(!rpcMethods.includes("eth_estimateGas"));
  assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));

  clearRouteState();
  configureRpc({ latestNonce: 7, pendingNonce: 8 });
  const unboundNonceResponse = await postResolve();
  assert.equal(unboundNonceResponse.status, 200);
  assert.deepEqual(await unboundNonceResponse.json(), {
    ok: true,
    action: "noop",
    reason: "bootstrap_pending_nonce_unbound",
    currentEpoch: epoch.toString(),
    retryAfter: 5,
  });
  assert.ok(!rpcMethods.includes("eth_estimateGas"));
  assert.deepEqual(
    rpcMethods.filter((method) =>
      ["eth_sendTransaction", "eth_sendRawTransaction"].includes(method),
    ),
    [],
    "an unbound pending nonce must not reach a transaction submission RPC",
  );
  assert.deepEqual(storage.readMetaJsonStrict(pendingMetaKey), { found: false });

  clearRouteState();
  assert.equal(await shared.acquireResolveLock(epoch), true);
  assert.equal(
    await shared.acquireResolveLock(epoch + 1n),
    false,
    "a different epoch must not bypass the global keeper lock",
  );
  clearOperationLocks();

  process.env.NODE_ENV = "production";
  process.env.WEB_REPLICA_COUNT = "2";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis-unit-test.dev";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token-not-a-secret";
  externalLockCommands.length = 0;
  assert.equal(await shared.acquireResolveLock(epoch), true);
  assert.equal(
    await shared.acquireResolveLock(epoch + 1n),
    false,
    "two production replicas must contend on the same external keeper lock across epochs",
  );
  assert.equal(externalLockCommands.length, 2);
  assert.equal(externalLockCommands[0][0], "SET");
  assert.equal(externalLockCommands[0][1], externalLockCommands[1][1]);
  assert.deepEqual(externalLockCommands[0].slice(2), ["1", "NX", "PX", "300000"]);
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.NODE_ENV = "development";
  process.env.WEB_REPLICA_COUNT = "1";

  // Simulate a crash after local signing/persistence and verify that the exact
  // durable envelope remains independently verifiable on resume.
  storage.setMetaJson(pendingMetaKey, validRecord);
  const resumedResult = storage.readMetaJsonStrict(pendingMetaKey);
  assert.equal(resumedResult.found, true);
  const resumedRecord = resumedResult.value;
  assert.deepEqual(resumedRecord, validRecord);
  await assert.doesNotReject(
    assertKeeperSignedTransactionIntegrity(resumedRecord, expectedEnvelope),
  );

  dbModule.db.prepare("DELETE FROM meta WHERE key = ?").run(scopedMetaKey);
  assert.deepEqual(
    storage.readMetaJsonStrict(pendingMetaKey),
    { found: false },
    "a genuinely missing durable record must remain distinguishable",
  );

  dbModule.db.prepare(`
    INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(scopedMetaKey, "{malformed-json");
  assert.throws(
    () => storage.readMetaJsonStrict(pendingMetaKey),
    /stored metadata JSON is invalid/,
  );

  rpcNetworkCalls = 0;
  const malformedResponse = await postResolve();
  assert.equal(malformedResponse.status, 409);
  assert.deepEqual(await malformedResponse.json(), {
    ok: false,
    reason: "bootstrap_pending_record_reconciliation_required",
  });

  dbModule.db.prepare(`
    INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(scopedMetaKey, "null");
  const nullRecordResponse = await postResolve();
  assert.equal(nullRecordResponse.status, 409);
  assert.deepEqual(await nullRecordResponse.json(), {
    ok: false,
    reason: "bootstrap_pending_record_reconciliation_required",
  });

  const valueTamperedRecord = await signedRecord({ value: 1n });
  storage.setMetaJson(pendingMetaKey, valueTamperedRecord);
  const tamperedResponse = await postResolve();
  assert.equal(tamperedResponse.status, 409);
  assert.deepEqual(await tamperedResponse.json(), {
    ok: false,
    reason: "bootstrap_pending_record_reconciliation_required",
  });

  storage.setMetaJson(pendingMetaKey, { ...valueTamperedRecord, state: "success" });
  const tamperedFinalResponse = await postResolve();
  assert.equal(tamperedFinalResponse.status, 409);
  assert.deepEqual(await tamperedFinalResponse.json(), {
    ok: false,
    reason: "bootstrap_pending_record_reconciliation_required",
  });

  dbModule.db.prepare(`
    INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(scopedMetaKey, Buffer.from(JSON.stringify(validRecord)));
  assert.throws(
    () => storage.readMetaJsonStrict(pendingMetaKey),
    /stored metadata value is not text/,
    "an existing non-text metadata row must not collapse into a missing record",
  );
  const blobRecordResponse = await postResolve();
  assert.equal(blobRecordResponse.status, 409);
  assert.deepEqual(await blobRecordResponse.json(), {
    ok: false,
    reason: "bootstrap_pending_record_reconciliation_required",
  });
  assert.equal(rpcNetworkCalls, 0, "corrupt durable records must fail before any RPC access");

  storage.setMetaJson(pendingMetaKey, { ...validRecord, state: "success" });
  configureRpc();
  const forgedFinalResponse = await postResolve();
  assert.equal(forgedFinalResponse.status, 409);
  assert.deepEqual(await forgedFinalResponse.json(), {
    ok: false,
    reason: "bootstrap_pending_record_reconciliation_required",
  });
  assert.ok(rpcMethods.includes("eth_getTransactionReceipt"));
  assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));
  assert.equal(
    storage.readMetaJsonStrict(pendingMetaKey).found,
    true,
    "an unverified mutable final-state label must remain durable for manual reconciliation",
  );

  storage.setMetaJson(pendingMetaKey, validRecord);
  configureRpc({ currentEpoch: epoch + 1n });
  const staleEpochResponse = await postResolve();
  assert.equal(staleEpochResponse.status, 409);
  assert.deepEqual(await staleEpochResponse.json(), {
    ok: false,
    reason: "bootstrap_pending_record_reconciliation_required",
  });
  assert.ok(rpcMethods.includes("eth_getTransactionReceipt"));
  assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));
  assert.equal(
    storage.readMetaJsonStrict(pendingMetaKey).found,
    true,
    "a stale unresolved envelope must never be discarded or rebroadcast automatically",
  );

  storage.setMetaJson(pendingMetaKey, validRecord);
  clearOperationLocks();
  configureRpc({ latestNonce: validRecord.nonce + 1, pendingNonce: validRecord.nonce + 1 });
  const missingReceiptResponse = await postResolve();
  assert.equal(missingReceiptResponse.status, 200);
  assert.deepEqual(await missingReceiptResponse.json(), {
    ok: true,
    action: "pending",
    reason: "resolve_receipt_timeout",
    currentEpoch: epoch.toString(),
    hash: validRecord.hash,
    retryAfter: 5,
  });
  assert.equal(storage.readMetaJsonStrict(pendingMetaKey).found, true);
  assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));

  storage.setMetaJson(pendingMetaKey, validRecord);
  clearOperationLocks();
  configureRpc({
    receipt: successfulReceipt(validRecord.hash),
    latestNonce: validRecord.nonce + 1,
    pendingNonce: validRecord.nonce + 1,
    headBlock: 17n,
  });
  const unfinalizedReceiptResponse = await postResolve();
  assert.equal(unfinalizedReceiptResponse.status, 200);
  assert.deepEqual(await unfinalizedReceiptResponse.json(), {
    ok: true,
    action: "pending",
    reason: "resolve_receipt_timeout",
    currentEpoch: epoch.toString(),
    hash: validRecord.hash,
    retryAfter: 5,
  });
  assert.equal(storage.readMetaJsonStrict(pendingMetaKey).found, true);
  assert.ok(rpcMethods.includes("eth_blockNumber"));
  assert.ok(!rpcMethods.includes("eth_getBlockByNumber"));
  assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));

  storage.setMetaJson(pendingMetaKey, validRecord);
  clearOperationLocks();
  configureRpc({
    receipt: revertedReceipt(validRecord.hash),
    latestNonce: validRecord.nonce + 1,
    pendingNonce: validRecord.nonce + 1,
  });
  const revertedReceiptResponse = await postResolve();
  assert.equal(revertedReceiptResponse.status, 200);
  assert.deepEqual(await revertedReceiptResponse.json(), {
    ok: true,
    action: "noop",
    reason: "resolve_tx_reverted",
    currentEpoch: epoch.toString(),
    hash: validRecord.hash,
    retryAfter: 5,
  });
  assert.deepEqual(
    storage.readMetaJsonStrict(pendingMetaKey),
    { found: false },
    "a finalized reverted receipt must clear the old signed intent so retry can use a fresh nonce observation",
  );
  assert.ok(rpcMethods.includes("eth_getBlockByNumber"));
  assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));

  storage.setMetaJson(pendingMetaKey, validRecord);
  clearOperationLocks();
  configureRpc({
    receipt: successfulReceipt(validRecord.hash),
    latestNonce: validRecord.nonce + 1,
    pendingNonce: validRecord.nonce + 1,
  });
  const resumedCrashResponse = await postResolve();
  assert.equal(resumedCrashResponse.status, 200);
  assert.deepEqual(await resumedCrashResponse.json(), {
    ok: true,
    action: "sent",
    currentEpoch: epoch.toString(),
    hash: validRecord.hash,
    txStatus: "success",
  });
  assert.ok(rpcMethods.includes("eth_getTransactionReceipt"));
  assert.ok(rpcMethods.includes("eth_blockNumber"));
  assert.ok(rpcMethods.includes("eth_getBlockByNumber"));
  assert.ok(!rpcMethods.includes("eth_sendRawTransaction"));
  assert.deepEqual(
    storage.readMetaJsonStrict(pendingMetaKey),
    { found: false },
    "a valid receipt-backed crash resume may clear the pending-only record",
  );
} finally {
  globalThis.fetch = originalFetch;
  dbModule?.db.close();
  rmSync(testRunDir, { recursive: true, force: true });
}

console.log("bootstrap resolve lock tests passed");
process.exit(0);
