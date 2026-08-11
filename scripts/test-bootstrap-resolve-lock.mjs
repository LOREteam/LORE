import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, encodeFunctionResult, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const keeperSigningSafetyModule = await import("../server/keeperSigningSafety.ts");
const {
  assertKeeperSignedTransactionIntegrity,
  KeeperRpcAgreementError,
  KeeperSignedTransactionIntegrityError,
  readWithExactKeeperRpcAgreement,
  selectKeeperAgreementRpcUrls,
} = keeperSigningSafetyModule.default ?? keeperSigningSafetyModule;

const sharedSource = readFileSync("app/api/bootstrap-resolve/shared.ts", "utf8");
const routeSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
const productionRuntimeSource = readFileSync("config/productionRuntime.ts", "utf8");

assert.match(
  sharedSource,
  /RESOLVE_OPERATION_LOCK_TTL_MS = 5 \* 60 \* 1000[\s\S]*acquireExternalExpiringLock\([\s\S]*RESOLVE_OPERATION_LOCK_TTL_MS[\s\S]*acquireExpiringLock\([\s\S]*RESOLVE_OPERATION_LOCK_TTL_MS/,
  "the resolve operation lock must outlive RPC failover and the receipt wait in both stores",
);
assert.doesNotMatch(
  sharedSource,
  /`\$\{RESOLVE_LOCK_PATH\}:\$\{epoch\}`|epoch\.toString\(\),\s*RESOLVE_OPERATION_LOCK_TTL_MS/,
  "a new epoch must not bypass serialization of the same keeper account",
);
assert.match(
  sharedSource,
  /acquireExternalExpiringLock\(\s*RESOLVE_LOCK_PATH,[\s\S]*acquireExpiringLock\(\s*RESOLVE_LOCK_PATH,\s*"keeper"/,
  "external and SQLite locks must use the same global keeper resource",
);
assert.match(
  sharedSource,
  /now - lastResolveAttemptAt < RESOLVE_OPERATION_LOCK_TTL_MS/,
  "the development emergency fallback must preserve the same operation lifetime",
);

const noopCheck = routeSource.indexOf("if (isResolved || !isExpired)");
const emptyCheck = routeSource.indexOf("if (totalPool === 0n)");
const lockAcquire = routeSource.indexOf("if (!(await acquireResolveLock(currentEpoch)))");
const nonceRead = routeSource.indexOf("const nonceObservation = await readAgreedBootstrapNonce");
assert.ok(noopCheck >= 0 && emptyCheck > noopCheck);
assert.ok(
  lockAcquire > emptyCheck && nonceRead > lockAcquire,
  "only a funded expired epoch may acquire the long operation lock, before nonce/signing work",
);
assert.match(
  routeSource,
  /reason: "bootstrap_resolve_throttled"[\s\S]*Math\.ceil\(RESOLVE_OPERATION_LOCK_TTL_MS \/ 1000\)/,
  "lock contention must return retry guidance matching the operation lock lifetime",
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

assert.match(
  sharedSource,
  /selectKeeperAgreementRpcUrls\(SERVER_RPC_URLS\)/,
  "bootstrap signing must construct a two-RPC agreement pair",
);
assert.doesNotMatch(
  sharedSource,
  /BOOTSTRAP_KEEPER_PRIVATE_KEY\s*\|\|\s*process\.env\.KEEPER_PRIVATE_KEY/,
  "bootstrap signing must not fall back to the keeper-bot account",
);
for (const peerSecretName of [
  "HEALTH_DIAGNOSTICS_SECRET",
  "TRUST_PROXY_SECRET",
  "CHAT_AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "ADMIN_AUTH_SECRET",
]) {
  assert.ok(
    sharedSource.includes(peerSecretName),
    `bootstrap authorization must reject equality with ${peerSecretName}`,
  );
}

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
  routeSource,
  /function readPendingResolveRecord\(\)[\s\S]*readMetaJsonStrict[\s\S]*BootstrapPendingResolveRecordError\("json"\)/,
  "malformed durable JSON must be distinguishable from a missing pending record",
);
assert.match(
  routeSource,
  /async function broadcastSignedResolve\([\s\S]*await assertBootstrapPendingResolveIntegrity\([\s\S]*record,[\s\S]*expectedSigner,[\s\S]*expectedEpoch,[\s\S]*sendRawTransaction/,
  "every raw broadcast must validate the complete local signed envelope first",
);
assert.match(
  routeSource,
  /storedEpoch !== currentEpoch \|\| FINAL_STATES\.has\(pendingRecord\.state\)[\s\S]*confirmBootstrapSubmission\([\s\S]*waitForReceipt: false[\s\S]*bootstrap_pending_record_reconciliation_required/,
  "stale epochs and mutable final-state labels must be reconciled, never used to authorize new signing",
);

const testRunDir = mkdtempSync(join(tmpdir(), "lore-bootstrap-record-integrity-"));
const bootstrapPrivateKey = `0x${"0".repeat(63)}1`;
const attackerPrivateKey = `0x${"0".repeat(63)}2`;
const bootstrapAccount = privateKeyToAccount(bootstrapPrivateKey);
const attackerAccount = privateKeyToAccount(attackerPrivateKey);
const contractAddress = "0x0000000000000000000000000000000000001234";
const pendingMetaKey = "bootstrap:pendingResolve:v1";

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
process.env.WEB_REPLICA_COUNT = "1";
process.env.LORE_DB_PATH = join(testRunDir, "lore.sqlite");

let dbModule;
const originalFetch = globalThis.fetch;
let rpcNetworkCalls = 0;
let rpcState = null;
const rpcMethods = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
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
    } else if (request.method === "eth_getTransactionCount") {
      const blockTag = request.params?.[1];
      const nonce = blockTag === "pending" ? rpcState.pendingNonce : rpcState.latestNonce;
      result = `0x${nonce.toString(16)}`;
    } else if (request.method === "eth_blockNumber") {
      result = "0x10";
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
      ...overrides,
    };
    rpcMethods.length = 0;
    rpcNetworkCalls = 0;
  }

  function postResolve() {
    return route.POST(new Request(
      "http://localhost:3000/api/bootstrap-resolve",
      {
        method: "POST",
        headers: { "x-bootstrap-resolve-secret": process.env.BOOTSTRAP_RESOLVE_SECRET },
      },
    ));
  }

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

  const scopedMetaKey = `${storage.getCurrentStorageScope()}:${pendingMetaKey}`;
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
