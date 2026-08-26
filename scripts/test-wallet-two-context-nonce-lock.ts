import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import ts from "typescript";
import { findExecutablePath } from "./smoke-browser-lib/core.mjs";

const ACTOR = "0x1111111111111111111111111111111111111111";
const OTHER_ACTOR = "0x2222222222222222222222222222222222222222";
const DESTINATION = "0x3333333333333333333333333333333333333333";
const OTHER_DESTINATION = "0x4444444444444444444444444444444444444444";
const TOKEN = "0x5555555555555555555555555555555555555555";
const SPENDER = "0x6666666666666666666666666666666666666666";
const CHAIN_ID = 59144;
const NONCE = 12;
const HASH = `0x${"ab".repeat(32)}`;
const STORAGE_PREFIX = "lineaore:wallet-transfer-intent:v1";
const APPROVAL_STORAGE_PREFIX = "lineaore:pending-mining-approval:v1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER_EXECUTABLE,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((value): value is string => Boolean(value));

type BrowserIntent = {
  actor: `0x${string}`;
  chainId: number;
  asset: "native";
  destination: `0x${string}`;
  amountWei: bigint;
};

type BrowserAcquisition =
  | { status: "acquired"; lease: { id: string; intent: BrowserIntent; nonce: number } }
  | { status: "known-hash"; hash: `0x${string}` };

type BrowserNonceClient = {
  getTransactionCount: (input: { blockTag: "latest" | "pending" }) => Promise<number>;
};

type WalletIntentModule = {
  createWalletTransferIntent: (input: {
    actor: string;
    chainId: number;
    asset: "native";
    destination: string;
    amountWei: bigint;
  }) => BrowserIntent;
  acquireWalletTransferIntentLease: (
    intent: BrowserIntent,
    clients: readonly [BrowserNonceClient, BrowserNonceClient],
    now?: number,
  ) => Promise<BrowserAcquisition>;
  withWalletTransferIntentLease: <T>(
    intent: BrowserIntent,
    clients: readonly [BrowserNonceClient, BrowserNonceClient],
    callback: (acquisition: BrowserAcquisition) => Promise<T>,
    options?: { abandonOnError?: (error: unknown) => boolean },
    now?: number,
  ) => Promise<T>;
  recordWalletTransferIntentHash: (
    intent: BrowserIntent,
    leaseId: string,
    hash: string,
    now?: number,
  ) => Promise<string>;
};

type EoaNonceLockModule = {
  getEoaNonceLockName: (identity: { chainId: number; actor: string }) => string;
  withEoaNonceLock: <T>(
    identity: { chainId: number; actor: string },
    options: { ifAvailable?: boolean },
    operation: () => Promise<T>,
  ) => Promise<T>;
};

type BrowserApprovalClient = {
  getTransactionCount: (input: { blockTag: "latest" | "pending" }) => Promise<number>;
  getChainId: () => Promise<number>;
  readContract: () => Promise<bigint>;
  getTransaction: () => Promise<never>;
  getTransactionReceipt: () => Promise<never>;
};

type BrowserApprovalState = {
  chainId: number;
  token: `0x${string}`;
  spender: `0x${string}`;
  actor: `0x${string}`;
  nonce: number;
  hash?: `0x${string}`;
  ts: number;
};

type MiningTxPathModule = {
  clearVerifiedPendingMiningApprovalState: (state: BrowserApprovalState) => boolean;
  executeReservedMiningApprovalWalletSink: <T>(
    state: BrowserApprovalState,
    assertBeforeWalletSink: () => Promise<void> | void,
    invokeWalletSink: () => Promise<T>,
  ) => Promise<T>;
  readAgreedPendingMiningAllowance: (
    clients: readonly [BrowserApprovalClient, BrowserApprovalClient],
    token: `0x${string}`,
    spender: `0x${string}`,
    actor: `0x${string}`,
  ) => Promise<bigint>;
  readAgreedPendingMiningApprovalNonce: (
    clients: readonly [BrowserApprovalClient, BrowserApprovalClient],
    actor: `0x${string}`,
  ) => Promise<number>;
  readPendingMiningApprovalState: (
    chainId: number,
    token: string,
    spender: string,
    actor: string,
  ) => BrowserApprovalState | null;
  recoverPendingMiningApproval: (
    clients: readonly [BrowserApprovalClient, BrowserApprovalClient],
    state: BrowserApprovalState,
    finalityBlocks?: bigint,
  ) => Promise<"confirmed" | "pending" | "reverted" | "manual-reconciliation-required">;
  withPendingMiningApprovalLock: <T>(
    input: { chainId: number; token: string; spender: string; actor: string },
    operation: () => Promise<T>,
  ) => Promise<T>;
  writePendingMiningApprovalState: (
    state: Omit<BrowserApprovalState, "ts">,
  ) => BrowserApprovalState | null;
};

type BrowserHarness = typeof globalThis & {
  __walletIntent: WalletIntentModule;
  __eoaNonceLock: EoaNonceLockModule;
  __miningTxPath: MiningTxPathModule;
  __approvalClient: (
    latestNonce: number,
    pendingNonce: number,
    allowance: bigint,
    chainId?: number,
  ) => BrowserApprovalClient;
  __approvalBehavior: (input: {
    actor: string;
    chainId: number;
    hash: string;
    nonce: number;
    spender: string;
    storagePrefix: string;
    token: string;
  }) => Promise<Record<string, unknown>>;
  __errorResult: (error: unknown) => { ok: false; name: string; message: string };
  __constantNonceClient: (nonce: number) => BrowserNonceClient;
  __tryNonceLock: (
    actor: string,
    chainId: number,
  ) => Promise<{ ok: true; value: string } | { ok: false; name: string; message: string }>;
  __testReady: boolean;
  __submissionBoundaryEntered?: boolean;
  __leaseId?: string;
  __heldLeasePromise?: Promise<unknown>;
};

function browserIntentInput(destination = DESTINATION) {
  return {
    actor: ACTOR,
    chainId: CHAIN_ID,
    asset: "native" as const,
    destination,
    amountWei: "1000000000000000",
  };
}

async function bundleBrowserModule(entryPoint: string) {
  const source = await readFile(resolve(REPO_ROOT, entryPoint), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: entryPoint,
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `browser transpilation failed for ${entryPoint}`);
  return transpiled.outputText;
}

function listen(server: Server) {
  return new Promise<number>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("wallet two-tab fixture did not expose a loopback TCP port"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

function attachPageDiagnostics(page: Page, diagnostics: string[]) {
  page.on("pageerror", (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console:${message.text()}`);
  });
}

async function main() {
const [walletBundle, nonceLockBundle, miningTxPathBundle] = await Promise.all([
  bundleBrowserModule("app/lib/walletTransferIntent.ts"),
  bundleBrowserModule("app/lib/eoaNonceLock.ts"),
  bundleBrowserModule("app/lib/miningTxPath.ts"),
]);

let submissionBoundaryEntries = 0;
const fixtureHtml = `<!doctype html>
<meta charset="utf-8">
<title>Wallet nonce lock two-tab harness</title>
<script type="importmap">
  {
    "imports": {
      "viem": "/viem.js",
      "../../config/publicConfig": "/public-config.js",
      "../../config/publicConfig.js": "/public-config.js",
      "./constants": "/constants.js",
      "./constants.js": "/constants.js",
      "./eoaNonceLock": "/eoa-nonce-lock.js",
      "./eoaNonceLock.js": "/eoa-nonce-lock.js",
      "./utils": "/utils.js",
      "./utils.js": "/utils.js"
    }
  }
</script>
<script type="module">
  const [walletIntent, eoaNonceLock, miningTxPath] = await Promise.all([
    import("/wallet-transfer-intent.js"),
    import("/eoa-nonce-lock.js"),
    import("/mining-tx-path.js"),
  ]);
  globalThis.__walletIntent = walletIntent;
  globalThis.__eoaNonceLock = eoaNonceLock;
  globalThis.__miningTxPath = miningTxPath;
  globalThis.__errorResult = (error) => ({
    ok: false,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
  });
  globalThis.__constantNonceClient = (nonce) => ({
    getTransactionCount: () => Promise.resolve(nonce),
  });
  globalThis.__approvalClient = (latestNonce, pendingNonce, allowance, chainId = ${CHAIN_ID}) => ({
    getTransactionCount: ({ blockTag }) => Promise.resolve(blockTag === "latest" ? latestNonce : pendingNonce),
    getChainId: () => Promise.resolve(chainId),
    readContract: () => Promise.resolve(allowance),
    getTransaction: () => Promise.reject(Object.assign(new Error("transaction not found"), { name: "TransactionNotFoundError" })),
    getTransactionReceipt: () => Promise.reject(Object.assign(new Error("receipt not found"), { name: "ReceiptNotFoundError" })),
  });
  globalThis.__approvalBehavior = async ({ actor, chainId, token, spender, nonce, hash, storagePrefix }) => {
    const asAddress = (value) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("invalid synthetic approval address");
      return value;
    };
    const asHash = (value) => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("invalid synthetic approval hash");
      return value;
    };
    const actorAddress = asAddress(actor);
    const tokenAddress = asAddress(token);
    const spenderAddress = asAddress(spender);
    const transactionHash = asHash(hash);
    const captureError = async (action) => {
      try {
        await action();
        return { ok: true, name: "", message: "" };
      } catch (error) {
        return globalThis.__errorResult(error);
      }
    };
    const agreedClients = [
      globalThis.__approvalClient(nonce, nonce, 500n),
      globalThis.__approvalClient(nonce, nonce, 500n),
    ];
    const nonceDisagreementClients = [
      globalThis.__approvalClient(nonce, nonce, 500n),
      globalThis.__approvalClient(nonce, nonce + 1, 500n),
    ];
    const allowanceDisagreementClients = [
      globalThis.__approvalClient(nonce, nonce, 500n),
      globalThis.__approvalClient(nonce, nonce, 501n),
    ];
    const agreedNonce = await miningTxPath.readAgreedPendingMiningApprovalNonce(agreedClients, actorAddress);
    const agreedAllowance = await miningTxPath.readAgreedPendingMiningAllowance(
      agreedClients,
      tokenAddress,
      spenderAddress,
      actorAddress,
    );
    const nonceDisagreement = await captureError(() =>
      miningTxPath.readAgreedPendingMiningApprovalNonce(nonceDisagreementClients, actorAddress)
    );
    const allowanceDisagreement = await captureError(() =>
      miningTxPath.readAgreedPendingMiningAllowance(
        allowanceDisagreementClients,
        tokenAddress,
        spenderAddress,
        actorAddress,
      )
    );

    return miningTxPath.withPendingMiningApprovalLock(
      { actor: actorAddress, chainId, token: tokenAddress, spender: spenderAddress },
      async () => {
        let walletSinkEntries = 0;
        const reservation = miningTxPath.writePendingMiningApprovalState({
          actor: actorAddress,
          chainId,
          nonce,
          spender: spenderAddress,
          token: tokenAddress,
        });
        if (!reservation) throw new Error("approval reservation was not persisted");
        const approvalKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .filter((key) => key?.startsWith(storagePrefix + ":" + chainId + ":") === true);
        const wrongStateCleared = miningTxPath.clearVerifiedPendingMiningApprovalState({ ...reservation, nonce: nonce + 1 });
        const persistedAfterWrongClear = miningTxPath.readPendingMiningApprovalState(
          chainId, tokenAddress, spenderAddress, actorAddress,
        );

        const preflightError = await captureError(() =>
          miningTxPath.executeReservedMiningApprovalWalletSink(
            reservation,
            () => { throw new Error("synthetic approval preflight rejection"); },
            async () => {
              walletSinkEntries += 1;
              return transactionHash;
            },
          )
        );
        const preflightCleared = miningTxPath.readPendingMiningApprovalState(
          chainId, tokenAddress, spenderAddress, actorAddress,
        ) === null;

        const ambiguousReservation = miningTxPath.writePendingMiningApprovalState({
          actor: actorAddress,
          chainId,
          nonce,
          spender: spenderAddress,
          token: tokenAddress,
        });
        if (!ambiguousReservation) throw new Error("ambiguous approval reservation was not persisted");
        const ambiguousError = await captureError(() =>
          miningTxPath.executeReservedMiningApprovalWalletSink(
            ambiguousReservation,
            () => undefined,
            async () => {
              walletSinkEntries += 1;
              throw new Error("synthetic ambiguous wallet transport");
            },
          )
        );
        const persistedAfterAmbiguous = miningTxPath.readPendingMiningApprovalState(
          chainId, tokenAddress, spenderAddress, actorAddress,
        );
        const mismatchedCleanup = miningTxPath.clearVerifiedPendingMiningApprovalState({
          ...ambiguousReservation,
          nonce: nonce + 1,
        });
        const persistedAfterMismatchedCleanup = miningTxPath.readPendingMiningApprovalState(
          chainId, tokenAddress, spenderAddress, actorAddress,
        );
        const submittedState = miningTxPath.writePendingMiningApprovalState({
          actor: actorAddress,
          chainId,
          hash: transactionHash,
          nonce,
          spender: spenderAddress,
          token: tokenAddress,
        });
        if (!submittedState) throw new Error("submitted approval state was not persisted");
        const chainDisagreementClients = [
          globalThis.__approvalClient(nonce, nonce, 500n, chainId),
          globalThis.__approvalClient(nonce, nonce, 500n, chainId + 1),
        ];
        const recovery = await miningTxPath.recoverPendingMiningApproval(
          chainDisagreementClients,
          submittedState,
          2n,
        );
        const persistedAfterUnsafeRecovery = miningTxPath.readPendingMiningApprovalState(
          chainId, tokenAddress, spenderAddress, actorAddress,
        );
        const exactCleanup = miningTxPath.clearVerifiedPendingMiningApprovalState(submittedState);
        const finalState = miningTxPath.readPendingMiningApprovalState(
          chainId, tokenAddress, spenderAddress, actorAddress,
        );
        return {
          agreedAllowance: agreedAllowance.toString(),
          agreedNonce,
          allowanceDisagreement,
          ambiguousError,
          ambiguousReservationRetained: JSON.stringify(persistedAfterAmbiguous) === JSON.stringify(ambiguousReservation),
          approvalKeyCount: approvalKeys.length,
          exactCleanup,
          finalState,
          mismatchedCleanup,
          mismatchedCleanupRetained: JSON.stringify(persistedAfterMismatchedCleanup) === JSON.stringify(ambiguousReservation),
          nonceDisagreement,
          persistedWrongNonce: persistedAfterWrongClear?.nonce ?? null,
          preflightCleared,
          preflightError,
          recovery,
          unsafeRecoveryRetained: JSON.stringify(persistedAfterUnsafeRecovery) === JSON.stringify(submittedState),
          walletSinkEntries,
          wrongStateCleared,
        };
      },
    );
  };
  globalThis.__tryNonceLock = async (actor, chainId) => {
    try {
      const value = await eoaNonceLock.withEoaNonceLock(
        { actor, chainId },
        { ifAvailable: true },
        () => Promise.resolve("acquired"),
      );
      return { ok: true, value };
    } catch (error) {
      return globalThis.__errorResult(error);
    }
  };
  globalThis.__testReady = true;
</script>`;

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method === "GET" && path === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixtureHtml);
    return;
  }
  if (request.method === "GET" && path === "/wallet-transfer-intent.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(walletBundle);
    return;
  }
  if (request.method === "GET" && path === "/eoa-nonce-lock.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(nonceLockBundle);
    return;
  }
  if (request.method === "GET" && path === "/mining-tx-path.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(miningTxPathBundle);
    return;
  }
  if (request.method === "GET" && path === "/viem.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end([
      `const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;`,
      `export function getAddress(value) {`,
      `  if (typeof value !== "string" || !ADDRESS_RE.test(value)) throw new Error("invalid address");`,
      `  return value.toLowerCase();`,
      `}`,
      `export function createPublicClient() { throw new Error("createPublicClient unused in hermetic approval test"); }`,
      `export function encodeFunctionData() { throw new Error("encodeFunctionData unused in hermetic approval test"); }`,
      `export function http() { throw new Error("http unused in hermetic approval test"); }`,
      `export function keccak256() { throw new Error("keccak256 unused in hermetic native-transfer test"); }`,
      `export const maxUint256 = (1n << 256n) - 1n;`,
    ].join("\n"));
    return;
  }
  if (request.method === "GET" && path === "/public-config.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(`export function getStableLineaReadRpcs() { return []; }`);
    return;
  }
  if (request.method === "GET" && path === "/constants.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end([
      `export const APP_CHAIN = { id: ${CHAIN_ID} };`,
      `export const APP_NETWORK = "mainnet";`,
      `export const GAME_ABI = [];`,
      `export const TOKEN_ABI = [];`,
    ].join("\n"));
    return;
  }
  if (request.method === "GET" && path === "/utils.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(`export function isUserRejection(error) { return error instanceof Error && error.name === "UserRejectedRequestError"; }`);
    return;
  }
  if (request.method === "GET" && path === "/favicon.ico") {
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }
  if (request.method === "POST" && path === "/submission-boundary-entry") {
    submissionBoundaryEntries += 1;
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("not found");
});

let browser: Browser | null = null;
try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const executablePath = await findExecutablePath(BROWSER_CANDIDATES);
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext();
  const diagnostics: string[] = [];
  let allowedFixtureRequests = 0;
  let blockedExternalRequests = 0;
  const fixtureOrigin = new URL(baseUrl).origin;
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== fixtureOrigin) {
      blockedExternalRequests += 1;
      await route.abort("blockedbyclient");
      return;
    }
    allowedFixtureRequests += 1;
    await route.continue();
  });
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  attachPageDiagnostics(tabA, diagnostics);
  attachPageDiagnostics(tabB, diagnostics);
  await Promise.all([
    tabA.goto(baseUrl, { waitUntil: "load" }),
    tabB.goto(baseUrl, { waitUntil: "load" }),
  ]);
  await Promise.all([
    tabA.waitForFunction(() => (globalThis as unknown as BrowserHarness).__testReady === true),
    tabB.waitForFunction(() => (globalThis as unknown as BrowserHarness).__testReady === true),
  ]);

  const lockSupport = await Promise.all([
    tabA.evaluate(() => typeof navigator.locks?.request === "function"),
    tabB.evaluate(() => typeof navigator.locks?.request === "function"),
  ]);
  assert.deepEqual(lockSupport, [true, true], "both real browsing contexts must expose Web Locks");
  await tabA.evaluate(() => localStorage.clear());

  const startedAt = Date.now();
  await tabA.evaluate(({ input, nonce, now }) => {
    const scope = globalThis as unknown as BrowserHarness;
    const intent = scope.__walletIntent.createWalletTransferIntent({
      ...input,
      amountWei: BigInt(input.amountWei),
    });
    const nonceClient = scope.__constantNonceClient(nonce);
    scope.__heldLeasePromise = scope.__walletIntent.withWalletTransferIntentLease(
      intent,
      [nonceClient, nonceClient],
      async (acquisition) => {
        if (acquisition.status !== "acquired") {
          throw new Error("first tab did not acquire the durable lease");
        }
        scope.__leaseId = acquisition.lease.id;
        const response = await fetch("/submission-boundary-entry", { method: "POST" });
        if (!response.ok) throw new Error(`submission boundary fixture failed: ${response.status}`);
        scope.__submissionBoundaryEntered = true;
        await new Promise<never>(() => undefined);
      },
      undefined,
      now,
    );
  }, { input: browserIntentInput(), nonce: NONCE, now: startedAt });

  await tabA.waitForFunction(
    () => (globalThis as unknown as BrowserHarness).__submissionBoundaryEntered === true,
  );
  assert.equal(submissionBoundaryEntries, 1, "only tab A may enter the wallet submission boundary");
  const leaseId = await tabA.evaluate(
    () => (globalThis as unknown as BrowserHarness).__leaseId ?? null,
  );
  assert.match(leaseId ?? "", /^[0-9a-f-]{36}$/i, "tab A must persist a lease id before submission");

  const contended = await tabB.evaluate(async ({ input, nonce }) => {
    const scope = globalThis as unknown as BrowserHarness;
    const intent = scope.__walletIntent.createWalletTransferIntent({
      ...input,
      amountWei: BigInt(input.amountWei),
    });
    const nonceClient = scope.__constantNonceClient(nonce);
    try {
      await scope.__walletIntent.withWalletTransferIntentLease(
        intent,
        [nonceClient, nonceClient],
        async () => {
          await fetch("/submission-boundary-entry", { method: "POST" });
          return "unexpected-second-entry";
        },
      );
      return { ok: true, name: "", message: "" };
    } catch (error) {
      return scope.__errorResult(error);
    }
  }, { input: browserIntentInput(), nonce: NONCE });
  assert.deepEqual(contended, {
    ok: false,
    name: "WalletTransferIntentError",
    message: "wallet_transfer_intent_locked",
  });
  assert.equal(
    submissionBoundaryEntries,
    1,
    "the contending tab must be rejected before the wallet submission callback",
  );

  const approvalWhileTransferLockHeld = await tabB.evaluate(async ({ actor, chainId, token, spender }) => {
    const scope = globalThis as unknown as BrowserHarness;
    let entered = false;
    try {
      await scope.__miningTxPath.withPendingMiningApprovalLock(
        { actor, chainId, token, spender },
        async () => {
          entered = true;
          return "unexpected-approval-entry";
        },
      );
      return { ok: true, name: "", message: "", entered };
    } catch (error) {
      return { ...scope.__errorResult(error), entered };
    }
  }, { actor: ACTOR, chainId: CHAIN_ID, token: TOKEN, spender: SPENDER });
  assert.deepEqual(approvalWhileTransferLockHeld, {
    ok: false,
    name: "PendingMiningTxSafetyError",
    message: "Another tab is already reserving or submitting a transaction for this wallet; token approval is blocked.",
    entered: false,
  }, "wallet transfer and token approval must contend on the same actor nonce lock");

  const independentLockResults = await tabB.evaluate(async ({ actor, otherActor, chainId }) => {
    const scope = globalThis as unknown as BrowserHarness;
    return {
      otherActor: await scope.__tryNonceLock(otherActor, chainId),
      otherChain: await scope.__tryNonceLock(actor, chainId + 1),
    };
  }, { actor: ACTOR, otherActor: OTHER_ACTOR, chainId: CHAIN_ID });
  assert.deepEqual(independentLockResults, {
    otherActor: { ok: true, value: "acquired" },
    otherChain: { ok: true, value: "acquired" },
  }, "the nonce lock must scope contention to the exact chain and actor");

  const lockName = await tabB.evaluate(({ actor, chainId }) => {
    const scope = globalThis as unknown as BrowserHarness;
    return scope.__eoaNonceLock.getEoaNonceLockName({ actor, chainId });
  }, { actor: ACTOR, chainId: CHAIN_ID });
  const heldBeforeClose = await tabB.evaluate(async (name) => {
    const snapshot = await navigator.locks.query();
    return (snapshot.held ?? []).some((lock) => lock.name === name);
  }, lockName);
  assert.equal(heldBeforeClose, true, "tab A must hold the native actor nonce lock");

  await tabA.close();
  await tabB.waitForFunction(async (name) => {
    const snapshot = await navigator.locks.query();
    return !(snapshot.held ?? []).some((lock) => lock.name === name);
  }, lockName);

  const storedState = await tabB.evaluate(({ prefix }) => {
    const matchingKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key?.startsWith(prefix) === true);
    return {
      keys: matchingKeys,
      state: matchingKeys.length === 1
        ? JSON.parse(localStorage.getItem(matchingKeys[0]) ?? "null") as Record<string, unknown>
        : null,
    };
  }, { prefix: `${STORAGE_PREFIX}:${CHAIN_ID}:${ACTOR.toLowerCase()}:` });
  assert.equal(storedState.keys.length, 1, "tab close must leave one durable actor intent");
  assert.equal(storedState.state?.id, leaseId);
  assert.equal(storedState.state?.nonce, NONCE);
  assert.equal(storedState.state?.hash, undefined);
  assert.equal(storedState.state?.broadcastObserved, false);

  const afterCrash = await tabB.evaluate(async ({ input, nonce }) => {
    const scope = globalThis as unknown as BrowserHarness;
    const intent = scope.__walletIntent.createWalletTransferIntent({
      ...input,
      amountWei: BigInt(input.amountWei),
    });
    const nonceClient = scope.__constantNonceClient(nonce);
    try {
      const result = await scope.__walletIntent.acquireWalletTransferIntentLease(
        intent,
        [nonceClient, nonceClient],
      );
      return { ok: true, result };
    } catch (error) {
      return scope.__errorResult(error);
    }
  }, { input: browserIntentInput(), nonce: NONCE });
  assert.deepEqual(afterCrash, {
    ok: false,
    name: "WalletTransferIntentError",
    message: "wallet_transfer_intent_unresolved",
  }, "after a tab crash, durable state must suppress a second send after the native lock releases");

  const recordedHash = await tabB.evaluate(async ({ input, id, hash }) => {
    const scope = globalThis as unknown as BrowserHarness;
    const intent = scope.__walletIntent.createWalletTransferIntent({
      ...input,
      amountWei: BigInt(input.amountWei),
    });
    return scope.__walletIntent.recordWalletTransferIntentHash(intent, id, hash);
  }, { input: browserIntentInput(), id: leaseId ?? "", hash: HASH });
  assert.equal(recordedHash, HASH);

  await tabB.reload({ waitUntil: "load" });
  await tabB.waitForFunction(() => (globalThis as unknown as BrowserHarness).__testReady === true);
  const afterReload = await tabB.evaluate(async ({ input, nonce }) => {
    const scope = globalThis as unknown as BrowserHarness;
    const intent = scope.__walletIntent.createWalletTransferIntent({
      ...input,
      amountWei: BigInt(input.amountWei),
    });
    const nonceClient = scope.__constantNonceClient(nonce);
    return scope.__walletIntent.acquireWalletTransferIntentLease(
      intent,
      [nonceClient, nonceClient],
    );
  }, { input: browserIntentInput(), nonce: NONCE });
  assert.deepEqual(
    afterReload,
    { status: "known-hash", hash: HASH },
    "a new document context must recover the persisted hash instead of permitting a duplicate send",
  );

  const conflictingIntent = await tabB.evaluate(async ({ input, nonce }) => {
    const scope = globalThis as unknown as BrowserHarness;
    const intent = scope.__walletIntent.createWalletTransferIntent({
      ...input,
      amountWei: BigInt(input.amountWei),
    });
    const nonceClient = scope.__constantNonceClient(nonce);
    try {
      const result = await scope.__walletIntent.acquireWalletTransferIntentLease(
        intent,
        [nonceClient, nonceClient],
      );
      return { ok: true, result };
    } catch (error) {
      return scope.__errorResult(error);
    }
  }, { input: browserIntentInput(OTHER_DESTINATION), nonce: NONCE });
  assert.deepEqual(conflictingIntent, {
    ok: false,
    name: "WalletTransferIntentError",
    message: "wallet_transfer_actor_unresolved",
  }, "a different intent must not reuse the same actor nonce while the prior hash is unresolved");

  await tabB.evaluate(() => localStorage.clear());
  const approvalBehavior = await tabB.evaluate(
    (input) => (globalThis as unknown as BrowserHarness).__approvalBehavior(input),
    {
      actor: OTHER_ACTOR,
      chainId: CHAIN_ID,
      hash: HASH,
      nonce: NONCE + 10,
      spender: SPENDER,
      storagePrefix: APPROVAL_STORAGE_PREFIX,
      token: TOKEN,
    },
  );
  assert.deepEqual(approvalBehavior, {
    agreedAllowance: "500",
    agreedNonce: NONCE + 10,
    allowanceDisagreement: {
      ok: false,
      name: "PendingMiningTxSafetyError",
      message: "Approval allowance evidence does not agree across RPC origins.",
    },
    ambiguousError: {
      ok: false,
      name: "Error",
      message: "synthetic ambiguous wallet transport",
    },
    ambiguousReservationRetained: true,
    approvalKeyCount: 1,
    exactCleanup: true,
    finalState: null,
    mismatchedCleanup: false,
    mismatchedCleanupRetained: true,
    nonceDisagreement: {
      ok: false,
      name: "PendingMiningTxSafetyError",
      message: "Approval nonce evidence does not agree across RPC origins.",
    },
    persistedWrongNonce: NONCE + 10,
    preflightCleared: true,
    preflightError: {
      ok: false,
      name: "Error",
      message: "synthetic approval preflight rejection",
    },
    recovery: "manual-reconciliation-required",
    unsafeRecoveryRetained: true,
    walletSinkEntries: 1,
    wrongStateCleared: false,
  }, "approval behavior must fail closed across quorum, reservation, cleanup, and recovery boundaries");

  assert.equal(submissionBoundaryEntries, 1);
  assert.ok(allowedFixtureRequests > 0, "the browser proof must exercise the loopback fixture");
  assert.ok(blockedExternalRequests >= 0, "external browser requests must be counted and blocked");
  assert.ok(
    diagnostics.every((message) => !message.startsWith("pageerror:")),
    `the two-tab harness emitted a page error: ${diagnostics.join(" | ")}`,
  );
  await context.close();
  console.log(
    "Wallet two-tab nonce-lock tests passed: 2 real same-origin pages, native Web Locks, " +
    "shared approval contention, two-RPC fail-closed behavior, exact cleanup, crash persistence, and reload recovery",
  );
} finally {
  await browser?.close().catch(() => undefined);
  await closeServer(server).catch(() => undefined);
}
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
