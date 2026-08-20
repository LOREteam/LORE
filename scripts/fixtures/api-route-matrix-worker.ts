import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, sep } from "node:path";
import { inspect } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import {
  encodeAbiParameters,
  encodeEventTopics,
  toFunctionSelector,
} from "viem";
import { GAME_EVENTS_ABI } from "../../config/generated/lineaOreV10Abi";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";
import { issueChatSession } from "../../app/api/_lib/chatSession";

type RouteModule = Parameters<typeof autoImplementMethods>[0];
type HttpMethod = keyof ReturnType<typeof autoImplementMethods>;

type ResponseSnapshot = {
  status: number;
  headers: Record<string, string | null>;
  bodyBytes: number;
  bodySha256: string;
  prefixHex: string;
  json: unknown;
};

const PROXY_SECRET = "route-matrix-proxy-secret-0123456789abcdef";
const HEALTH_SECRET = "route-matrix-health-secret-0123456789abcdef";
const RATE_LIMIT_TOKEN = "route-matrix-rate-limit-token";
const ERROR_SENTINEL = "route-matrix-sensitive-bearer";
const RESPONSE_HEADERS = [
  "access-control-allow-origin",
  "allow",
  "cache-control",
  "content-type",
  "expires",
  "pragma",
  "retry-after",
  "set-cookie",
  "vary",
] as const;

function configureBaseEnvironment() {
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.TRUST_PROXY_HEADERS = "1";
  process.env.TRUST_PROXY_SECRET = PROXY_SECRET;
  process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "0";
  process.env.API_DEPOSITS_CHAIN_RECOVERY = "0";
  process.env.HEALTH_DIAGNOSTICS_SECRET = HEALTH_SECRET;
  process.env.ADMIN_AUTH_SECRET = "route-matrix-admin-secret-0123456789abcdef";
  process.env.CHAT_AUTH_SECRET = "route-matrix-chat-secret-0123456789abcdef";
  process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
  process.env.NEXT_PUBLIC_SITE_URL = "https://playlore.xyz";
  process.env.KEEPER_RPC_URL = "https://rpc.playlore.xyz";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.WEB_REPLICA_COUNT;
}

function requestHeaders(extra: HeadersInit = {}) {
  const headers = new Headers({
    origin: "https://attacker.invalid",
    "user-agent": "lore-route-matrix",
    "accept-language": "en-US",
    "x-lore-proxy-secret": PROXY_SECRET,
    "x-real-ip": "203.0.113.44",
  });
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
}

function chatSessionCookie(address: string) {
  const response = NextResponse.json({ ok: true });
  issueChatSession(response, address);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  if (!cookie.startsWith("lore_chat_session=")) throw new Error("failed to issue route-matrix chat session");
  return cookie;
}

function encodeWords(values: bigint[]) {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

function inputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

async function inputBodyText(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (input instanceof Request) return input.clone().text();
  return "";
}

function installRouteFetchMock(mode: "success" | "failure" | "health-finality" = "success") {
  const urls: string[] = [];
  const rpcMethods: string[] = [];
  const platformFetch = globalThis.fetch.bind(globalThis);
  const publicRoot = resolve(process.cwd(), "public");
  const currentEpochSelector = toFunctionSelector("currentEpoch()");
  const jackpotInfoSelector = toFunctionSelector("getJackpotInfo()");

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = inputUrl(input);
    const url = new URL(rawUrl);
    if (url.protocol === "data:") {
      return platformFetch(input, init);
    }
    urls.push(rawUrl);

    if (url.pathname.endsWith(".png")) {
      const assetPath = resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
      if (assetPath !== publicRoot && !assetPath.startsWith(`${publicRoot}${sep}`)) {
        throw new Error("route matrix asset escaped the public directory");
      }
      return new Response(readFileSync(assetPath), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }

    if (mode === "failure") {
      throw new Error(
        `Authorization: Bearer ${ERROR_SENTINEL}; https://user:matrix-password@rpc.playlore.xyz/private`,
      );
    }

    const rawBody = await inputBodyText(input, init);
    const payload = JSON.parse(rawBody) as Record<string, unknown> | Array<Record<string, unknown>>;
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = requests.map((entry) => {
      const method = String(entry.method ?? "");
      rpcMethods.push(method);
      const params = Array.isArray(entry.params) ? entry.params : [];
      let result: unknown;
      if (method === "eth_blockNumber") {
        result = "0x64";
      } else if (method === "eth_chainId") {
        result = "0xe705";
      } else if (method === "net_version") {
        result = "59141";
      } else if (method === "net_listening") {
        result = true;
      } else if (method === "eth_getLogs") {
        result = [];
      } else if (method === "eth_call") {
        const call = params[0] && typeof params[0] === "object"
          ? params[0] as Record<string, unknown>
          : {};
        const data = String(call.data ?? "").toLowerCase();
        if (data.startsWith(currentEpochSelector.toLowerCase())) {
          result = encodeWords([mode === "health-finality" ? 1n : 10n]);
        } else if (data.startsWith(jackpotInfoSelector.toLowerCase())) {
          result = mode === "health-finality"
            ? encodeWords([1_000n, 2_000n, 1n, 1n, 0n, 0n, 0n, 0n])
            : encodeWords([1_000n, 2_000n, 1n, 1n, 8n, 7n, 100n, 200n]);
        } else {
          return {
            jsonrpc: "2.0",
            id: entry.id ?? null,
            error: { code: -32601, message: "unimplemented fixture eth_call" },
          };
        }
      } else {
        return {
          jsonrpc: "2.0",
          id: entry.id ?? null,
          error: { code: -32601, message: `unimplemented fixture method ${method}` },
        };
      }
      return { jsonrpc: "2.0", id: entry.id ?? null, result };
    });

    return new Response(JSON.stringify(Array.isArray(payload) ? responses : responses[0]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { urls, rpcMethods };
}

function installForbiddenNetworkFetch() {
  const fetchUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchUrls.push(inputUrl(input));
    throw new Error("API route matrix attempted an unexpected network request");
  }) as typeof fetch;
  return () => fetchUrls;
}

async function snapshotResponse(response: Response): Promise<ResponseSnapshot> {
  const headers = Object.fromEntries(
    RESPONSE_HEADERS.map((name) => [name, response.headers.get(name)]),
  );
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  let json: unknown = null;
  if (body.length > 0 && contentType.includes("application/json")) {
    json = JSON.parse(body.toString("utf8"));
  }
  return {
    status: response.status,
    headers,
    bodyBytes: body.length,
    bodySha256: createHash("sha256").update(body).digest("hex"),
    prefixHex: body.subarray(0, 8).toString("hex"),
    json,
  };
}

function routeHandlers(route: RouteModule) {
  return autoImplementMethods(route);
}

async function dispatch(
  route: RouteModule,
  method: HttpMethod,
  url: string,
  options: { headers?: HeadersInit; body?: BodyInit } = {},
) {
  const request = new NextRequest(url, {
    method,
    headers: options.headers ?? requestHeaders(),
    body: options.body,
  });
  return routeHandlers(route)[method](request, { params: Promise.resolve({}) }) as Promise<Response>;
}

async function methodMatrix(route: RouteModule, url: string) {
  const headers = requestHeaders({ "access-control-request-method": "POST" });
  return {
    postMalformed: await snapshotResponse(await dispatch(route, "POST", url, {
      headers,
      body: "{",
    })),
    putOversized: await snapshotResponse(await dispatch(route, "PUT", url, {
      headers,
      body: "x".repeat(256 * 1024),
    })),
    patch: await snapshotResponse(await dispatch(route, "PATCH", url, { headers, body: "{}" })),
    delete: await snapshotResponse(await dispatch(route, "DELETE", url, { headers })),
    options: await snapshotResponse(await dispatch(route, "OPTIONS", url, { headers })),
  };
}

async function supportedRouteMethodBoundary(
  route: RouteModule,
  url: string,
  unsupportedMethod: HttpMethod,
) {
  const headers = requestHeaders({ "access-control-request-method": "POST" });
  return {
    unsupported: await snapshotResponse(await dispatch(route, unsupportedMethod, url, { headers })),
    options: await snapshotResponse(await dispatch(route, "OPTIONS", url, { headers })),
  };
}

function jsonHeaders(extra: HeadersInit = {}) {
  return requestHeaders({ "content-type": "application/json", ...Object.fromEntries(new Headers(extra)) });
}

async function persistenceState() {
  const { db } = await import("../../server/db");
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM admin_sessions) AS admin_sessions,
      (SELECT COUNT(*) FROM ephemeral_locks) AS auth_proof_locks,
      (SELECT COUNT(*) FROM chat_messages) AS chat_messages,
      (SELECT COUNT(*) FROM chat_profiles) AS chat_profiles
  `).get() as Record<string, number | bigint> | undefined;
  return {
    adminSessions: Number(row?.admin_sessions ?? 0),
    authProofLocks: Number(row?.auth_proof_locks ?? 0),
    chatMessages: Number(row?.chat_messages ?? 0),
    chatProfiles: Number(row?.chat_profiles ?? 0),
  };
}

function formatLog(args: unknown[]) {
  return args.map((value) => typeof value === "string" ? value : inspect(value, { depth: 4 })).join(" ");
}

async function captureRouteLogs<T>(run: () => Promise<T>) {
  const logs: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => logs.push(formatLog(args));
  console.warn = (...args: unknown[]) => logs.push(formatLog(args));
  try {
    return { value: await run(), logs };
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

async function loadRoute(
  name:
    | "og"
    | "jackpots"
    | "deposits"
    | "health"
    | "admin-auth"
    | "chat-auth"
    | "chat-messages"
    | "chat-profile"
    | "rewards",
) {
  if (name === "og") return await import("../../app/api/jackpots/og/route") as RouteModule;
  if (name === "jackpots") return await import("../../app/api/jackpots/route") as RouteModule;
  if (name === "deposits") return await import("../../app/api/deposits/route") as RouteModule;
  if (name === "health") return await import("../../app/api/health/data-sync/route") as RouteModule;
  if (name === "admin-auth") return await import("../../app/api/admin/auth/route") as RouteModule;
  if (name === "chat-auth") return await import("../../app/api/chat/auth/route") as RouteModule;
  if (name === "chat-messages") return await import("../../app/api/chat/messages/route") as RouteModule;
  if (name === "chat-profile") return await import("../../app/api/chat/profile/route") as RouteModule;
  return await import("../../app/api/rewards/route") as RouteModule;
}

async function runOgScenario() {
  const fetchState = installRouteFetchMock();
  const storage = await import("../../server/storage");
  const txHash = `0x${"ab".repeat(32)}`;
  storage.upsertJackpots([{
    epoch: "10",
    kind: "daily",
    amount: "1",
    amountNum: 1,
    txHash,
    blockNumber: "31678225",
  }]);
  storage.setMetaJson("lastIndexedBlock", "31678225");
  const route = await loadRoute("og");
  Object.assign(process.env, { NODE_ENV: "production" });
  const baseUrl = "https://attacker.invalid/api/jackpots/og";
  const verifiedUrl = `${baseUrl}?tx=${txHash}`;
  const headers = requestHeaders({ host: "attacker.invalid" });

  const captured = await captureRouteLogs(async () => {
    const headFirst = await dispatch(route, "HEAD", verifiedUrl, { headers });
    const headSecond = await dispatch(route, "HEAD", verifiedUrl, { headers });
    const afterHeads = await snapshotResponse(await dispatch(route, "GET", verifiedUrl, { headers }));

    const heldFirst = await dispatch(route, "GET", verifiedUrl, { headers });
    const heldSecond = await dispatch(route, "GET", verifiedUrl, { headers });
    const busy = await snapshotResponse(await dispatch(route, "GET", verifiedUrl, { headers }));
    await heldFirst.body?.cancel();
    await heldSecond.body?.cancel();

    const baseline = await snapshotResponse(await dispatch(route, "GET", verifiedUrl, { headers }));
    const oversized = await snapshotResponse(await dispatch(
      route,
      "GET",
      `${verifiedUrl}&amount=${"9".repeat(10_000)}&kind=weekly&tile=26&epoch=1000000001`,
      { headers },
    ));

    return {
      headStatuses: [headFirst.status, headSecond.status],
      headBodies: [headFirst.body !== null, headSecond.body !== null],
      afterHeads,
      heldStatuses: [heldFirst.status, heldSecond.status],
      busy,
      baseline,
      oversized,
      methods: await methodMatrix(route, baseUrl),
    };
  });

  return {
    scenario: "og",
    ...captured.value,
    logs: captured.logs,
    fetchUrls: fetchState.urls,
    rpcMethods: fetchState.rpcMethods,
  };
}

async function runJackpotsScenario() {
  const fetchState = installRouteFetchMock();
  const route = await loadRoute("jackpots");
  const baseUrl = "https://playlore.xyz/api/jackpots";
  const headers = requestHeaders();
  const captured = await captureRouteLogs(async () => ({
    baseline: await snapshotResponse(await dispatch(route, "GET", baseUrl, { headers })),
    fresh: await snapshotResponse(await dispatch(route, "GET", `${baseUrl}?fresh=1`, { headers })),
    oversized: await snapshotResponse(await dispatch(
      route,
      "GET",
      `${baseUrl}?fresh=${"1".repeat(10_000)}&unknown=%7B%22x%22%3A1%7D`,
      { headers },
    )),
    methods: await methodMatrix(route, baseUrl),
  }));
  await new Promise<void>((resolveDone) => setImmediate(resolveDone));
  return {
    scenario: "jackpots",
    ...captured.value,
    logs: captured.logs,
    fetchUrls: fetchState.urls,
    rpcMethods: fetchState.rpcMethods,
  };
}

async function runDepositsScenario() {
  installRouteFetchMock();
  const route = await loadRoute("deposits");
  const baseUrl = "https://playlore.xyz/api/deposits";
  const headers = requestHeaders();
  const captured = await captureRouteLogs(async () => ({
    missing: await snapshotResponse(await dispatch(route, "GET", baseUrl, { headers })),
    malformed: await snapshotResponse(await dispatch(route, "GET", `${baseUrl}?user=not-an-address`, { headers })),
    oversized: await snapshotResponse(await dispatch(
      route,
      "GET",
      `${baseUrl}?user=0x${"a".repeat(10_000)}`,
      { headers },
    )),
    valid: await snapshotResponse(await dispatch(
      route,
      "GET",
      `${baseUrl}?user=0x1111111111111111111111111111111111111111&includeRewards=1`,
      { headers },
    )),
    methods: await methodMatrix(route, baseUrl),
  }));
  return { scenario: "deposits", ...captured.value, logs: captured.logs };
}

type DepositsRecoveryVariant =
  | "valid"
  | "invalid-tile"
  | "unsafe-epoch"
  | "short-tx"
  | "missing-log-index";

function buildRecoveryBetLog(
  user: `0x${string}`,
  variant: DepositsRecoveryVariant,
  logIndex: number,
) {
  const epoch = variant === "unsafe-epoch" ? BigInt(Number.MAX_SAFE_INTEGER) + 1n : 12n;
  const tileId = variant === "invalid-tile" ? 26n : 7n;
  const topics = encodeEventTopics({
    abi: GAME_EVENTS_ABI,
    eventName: "BetPlaced",
    args: { epoch, user, tileId },
  });
  return {
    address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    blockHash: `0x${"ab".repeat(32)}` as `0x${string}`,
    blockNumber: 120n,
    data: encodeAbiParameters([{ type: "uint256" }], [1_000_000_000_000_000_000n]),
    logIndex: variant === "missing-log-index" ? null : logIndex,
    removed: false,
    topics,
    transactionHash: variant === "short-tx"
      ? "0x1234"
      : `0x${logIndex.toString(16).padStart(64, "0")}`,
    transactionIndex: 0,
  };
}

async function runDepositsPersistenceScenario() {
  process.env.INDEXER_START_BLOCK = "1";
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const { getUserBetsMap, putJsonPath, upsertBets } = await import("../../server/storage");
  const user = TEST_WALLET;
  const validHash = `0x${"44".repeat(32)}`;
  upsertBets([
    {
      epoch: "12",
      user,
      tileIds: [7, 7, 26],
      amounts: ["1", "2", "3"],
      totalAmount: "6",
      totalAmountNum: 6,
      txHash: validHash.toUpperCase(),
      blockNumber: "120",
    },
    {
      epoch: "11",
      user,
      tileIds: [26],
      amounts: ["9"],
      totalAmount: "9",
      totalAmountNum: 9,
      txHash: `0x${"55".repeat(32)}`,
      blockNumber: "119",
    },
    {
      epoch: "13",
      user,
      tileIds: [8],
      amounts: ["1"],
      totalAmount: "1",
      totalAmountNum: 1,
      txHash: `0x${"66".repeat(32)}`,
      blockNumber: "121",
    },
    {
      epoch: "10",
      user,
      tileIds: [9],
      amounts: ["1"],
      totalAmount: "1",
      totalAmountNum: 1,
      txHash: "0x1234",
      blockNumber: "118",
    },
  ]);
  putJsonPath("gamedata/_meta/currentEpoch", 12);
  putJsonPath("gamedata/_meta/lastIndexedBlock", "120");

  const route = await loadRoute("deposits");
  const response = await snapshotResponse(await dispatch(
    route,
    "GET",
    `https://playlore.xyz/api/deposits?user=${user}`,
    { headers: requestHeaders() },
  ));
  return {
    scenario: "deposits-persistence",
    response,
    storedRows: Object.values(getUserBetsMap(user, 50)),
    mockedFetchUrls: readNetworkFetchUrls(),
  };
}

async function runDepositsRecoveryScenario(options: { globalBoundMutant?: boolean } = {}) {
  process.env.API_DEPOSITS_CHAIN_RECOVERY = "1";
  process.env.INDEXER_FINALITY_BLOCKS = "10";
  process.env.INDEXER_START_BLOCK = "1";
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const storage = await import("../../server/storage");
  storage.putJsonPath("gamedata/_meta/currentEpoch", 12);
  storage.putJsonPath("gamedata/_meta/lastIndexedBlock", "100");

  const { publicClient } = await import("../../app/api/_lib/dataBridge");
  const originalReadContract = publicClient.readContract;
  const originalGetBlockNumber = publicClient.getBlockNumber;
  const originalGetLogs = publicClient.getLogs;
  let activeLogCalls = 0;
  let maxActiveLogCalls = 0;
  let logCallCount = 0;
  const variants: DepositsRecoveryVariant[] = [
    "valid",
    "invalid-tile",
    "unsafe-epoch",
    "short-tx",
    "missing-log-index",
  ];
  publicClient.readContract = (async () => 12n) as typeof publicClient.readContract;
  publicClient.getBlockNumber = (async () => 130n) as typeof publicClient.getBlockNumber;
  publicClient.getLogs = (async (request: { topics?: readonly unknown[] }) => {
    activeLogCalls += 1;
    maxActiveLogCalls = Math.max(maxActiveLogCalls, activeLogCalls);
    logCallCount += 1;
    try {
      const userTopic = String(request.topics?.[2] ?? "");
      const user = `0x${userTopic.slice(-40)}` as `0x${string}`;
      await new Promise<void>((resolveDone) => setTimeout(resolveDone, 10));
      return logCallCount === 1 || (options.globalBoundMutant === true && logCallCount === 2)
        ? variants.map((variant, index) => buildRecoveryBetLog(user, variant, logCallCount * 10 + index))
        : [];
    } finally {
      activeLogCalls -= 1;
    }
  }) as typeof publicClient.getLogs;

  const route = await loadRoute("deposits");
  let routes: [RouteModule, RouteModule] = [route, route];
  if (options.globalBoundMutant === true) {
    // Test-only fault: duplicate the route module so each user gets its own recovery state.
    const runtimeRequire = createRequire(import.meta.url);
    const routePath = runtimeRequire.resolve("../../app/api/deposits/route.ts");
    delete runtimeRequire.cache[routePath];
    const first = runtimeRequire(routePath) as RouteModule;
    delete runtimeRequire.cache[routePath];
    const second = runtimeRequire(routePath) as RouteModule;
    routes = [first, second];
  }
  const originalNow = Date.now;
  let fakeNow = originalNow();
  Date.now = () => fakeNow;

  try {
    const urls = [TEST_WALLET, OTHER_WALLET].map(
      (user) => `https://playlore.xyz/api/deposits?user=${user}`,
    );
    const firstInitial = snapshotResponse(await dispatch(
      routes[0],
      "GET",
      urls[0],
      { headers: requestHeaders() },
    ));
    await new Promise<void>((resolveDone) => setImmediate(resolveDone));
    const secondInitial = snapshotResponse(await dispatch(
      routes[1],
      "GET",
      urls[1],
      { headers: requestHeaders() },
    ));
    const initial = await Promise.all([firstInitial, secondInitial]);
    fakeNow += 20_000;
    const cached = await Promise.all(urls.map(async (url, index) => snapshotResponse(await dispatch(
      routes[index],
      "GET",
      url,
      { headers: requestHeaders() },
    ))));
    await new Promise<void>((resolveDone) => setTimeout(resolveDone, 120));
    const settled = await Promise.all(urls.map(async (url, index) => snapshotResponse(await dispatch(
      routes[index],
      "GET",
      url,
      { headers: requestHeaders() },
    ))));
    return {
      scenario: "deposits-recovery",
      initial,
      cached,
      settled,
      logCallCount,
      maxActiveLogCalls,
      activeLogCalls,
      storedRows: {
        first: Object.values(storage.getUserBetsMap(TEST_WALLET, 50)),
        second: Object.values(storage.getUserBetsMap(OTHER_WALLET, 50)),
      },
      mockedFetchUrls: readNetworkFetchUrls(),
    };
  } finally {
    Date.now = originalNow;
    publicClient.readContract = originalReadContract;
    publicClient.getBlockNumber = originalGetBlockNumber;
    publicClient.getLogs = originalGetLogs;
  }
}

async function runRecoveryStorageAllowlistScenario(options: { allowlistMutant?: boolean } = {}) {
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const { db } = await import("../../server/db");
  const storage = await import("../../server/storage");
  const dataBridge = await import("../../app/api/_lib/dataBridge");
  const tableCounts = () => ({
    bets: Number(db.prepare("SELECT COUNT(*) AS count FROM scoped_bets").get()?.count ?? 0),
    epochs: Number(db.prepare("SELECT COUNT(*) AS count FROM scoped_epochs").get()?.count ?? 0),
    jackpots: Number(db.prepare("SELECT COUNT(*) AS count FROM scoped_jackpots").get()?.count ?? 0),
    meta: Number(db.prepare("SELECT COUNT(*) AS count FROM meta").get()?.count ?? 0),
  });
  const before = tableCounts();
  const forbiddenResults = [];
  const forbiddenPaths = [
    "gamedata/_meta/currentEpoch",
    "gamedata/bets/0x1111111111111111111111111111111111111111/extra",
    "gamedata/bets/0x111111111111111111111111111111111111111G",
    "gamedata/bets/0x1111111111111111111111111111111111111111%2fextra",
  ];
  for (const [index, path] of forbiddenPaths.entries()) {
    if (options.allowlistMutant === true && index === 0) {
      try {
        storage.patchJsonPath("gamedata/epochs", {
          99: {
            winningTile: 1,
            totalPool: "1",
            rewardPool: "1",
            isDailyJackpot: false,
            isWeeklyJackpot: false,
          },
        });
        forbiddenResults.push(true);
      } catch {
        forbiddenResults.push(false);
      }
      continue;
    }
    forbiddenResults.push(await dataBridge.patchStorage(path, { sentinel: "must-not-persist" }));
  }
  const afterForbidden = tableCounts();

  const invalidUserPatch = await dataBridge.patchStorage(
    `gamedata/bets/${TEST_WALLET}`,
    {
      malformedEpoch: {
        epoch: "9007199254740992",
        tileIds: [7],
        amounts: ["1"],
        totalAmount: "1",
        totalAmountNum: 1,
        txHash: `0x${"88".repeat(32)}`,
        blockNumber: "120",
      },
      malformedBlock: {
        epoch: "12",
        tileIds: [7],
        amounts: ["1"],
        totalAmount: "1",
        totalAmountNum: 1,
        txHash: `0x${"99".repeat(32)}`,
        blockNumber: "not-a-block",
      },
    },
  );
  const afterMalformed = tableCounts();
  return {
    scenario: "recovery-storage-allowlist",
    before,
    forbiddenResults,
    afterForbidden,
    invalidUserPatch,
    afterMalformed,
    mockedFetchUrls: readNetworkFetchUrls(),
  };
}

async function runHealthSuccessScenario() {
  const fetchState = installRouteFetchMock();
  const storage = await import("../../server/storage");
  const { db } = await import("../../server/db");
  const statusMetadataSentinel = "route-matrix-private-indexer-metadata-secret";
  const now = Date.now();
  storage.putJsonPath("gamedata/_meta/currentEpoch", 10);
  storage.putJsonPath("gamedata/_meta/lastIndexedBlock", "90");
  storage.putJsonPath("gamedata/_meta/repairCursorBlock", "80");
  db.prepare(`
    INSERT INTO scoped_epochs(
      scope, epoch, winning_tile, total_pool, reward_pool, fee,
      jackpot_bonus, is_daily_jackpot, is_weekly_jackpot, resolved_block
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(storage.getCurrentStorageScope(), 1, 1, "1", "1", "0", "0", 0, 0, 90);
  storage.setMetaJson("indexerRunStatus", {
    startedAt: "1",
    completedAt: now,
    lastHeartbeatAt: now,
    fromBlock: "001",
    toBlock: "100",
    totalLogs: 0,
    currentChunk: 0,
    totalChunks: 2,
    lastProcessedBlock: "1e2",
    opaqueProviderMetadata: statusMetadataSentinel,
  });
  storage.setMetaJson("indexerRepairStatus", {
    at: now,
    fromBlock: "001",
    toBlock: "100",
    repairedLogs: "0",
    opaqueProviderMetadata: statusMetadataSentinel,
  });
  storage.setMetaJson("indexerReconcileStatus", {
    at: now,
    currentEpoch: 10,
    missingEpochs: "0",
    repairedEpochs: 0,
    targetEpochs: [1, "2", 2, "01", 1.5],
    opaqueProviderMetadata: statusMetadataSentinel,
  });
  db.prepare(`
    INSERT INTO scoped_reward_claims(
      scope, id, epoch, user, reward, reward_num, tx_hash, block_number
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    storage.getCurrentStorageScope(),
    "malformed-health-block",
    1,
    "0x1111111111111111111111111111111111111111",
    "1",
    1,
    `0x${"77".repeat(32)}`,
    "not-a-block",
  );
  const route = await loadRoute("health");
  const baseUrl = "https://playlore.xyz/api/health/data-sync";
  const captured = await captureRouteLogs(async () => {
    const publicResponse = await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders(),
    }));
    const rpcCountAfterPublic = fetchState.rpcMethods.length;
    const malformedSecret = await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders({ "x-health-diagnostics-secret": "short" }),
    }));
    const privateResponse = await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders({ "x-health-diagnostics-secret": HEALTH_SECRET }),
    }));
    return {
      publicResponse,
      malformedSecret,
      privateResponse,
      rpcCountAfterPublic,
      rpcCountAfterPrivate: fetchState.rpcMethods.length,
      methods: await methodMatrix(route, baseUrl),
    };
  });
  return {
    scenario: "health-success",
    ...captured.value,
    logs: captured.logs,
    rpcMethods: fetchState.rpcMethods,
    statusMetadataSentinel,
  };
}

async function runHealthFailureScenario() {
  installRouteFetchMock("failure");
  const route = await loadRoute("health");
  const baseUrl = "https://playlore.xyz/api/health/data-sync";
  const captured = await captureRouteLogs(async () => ({
    publicResponse: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders(),
    })),
    privateResponse: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders({ "x-health-diagnostics-secret": HEALTH_SECRET }),
    })),
  }));
  return {
    scenario: "health-failure",
    ...captured.value,
    logs: captured.logs,
    errorSentinel: ERROR_SENTINEL,
  };
}

async function runHealthFinalityScenario(options: { rawLagMutant?: boolean } = {}) {
  process.env.INDEXER_FINALITY_BLOCKS = "50";
  process.env.DATA_SYNC_LAG_WARN_BLOCKS = "5";
  process.env.INDEXER_HEARTBEAT_STALE_MS = "1000";
  process.env.INDEXER_START_BLOCK = "1";

  if (options.rawLagMutant === true) {
    const { mock } = await import("node:test");
    mock.module(new URL("../../app/lib/indexerFinality.ts", import.meta.url).href, {
      namedExports: {
        parseIndexerFinalityBlocks: () => 50n,
        getIndexerFinalityTargetBlock: (headBlock: bigint, finalityBlocks: bigint) =>
          headBlock - finalityBlocks,
        // Test-only fault: substitute raw head lag (100 - 55) for target lag.
        getIndexerTargetLagBlocks: () => 45,
      },
    });
  }

  const fetchState = installRouteFetchMock("health-finality");
  const { putJsonPath, setMetaJson } = await import("../../server/storage");
  putJsonPath("gamedata/_meta/currentEpoch", 1);
  putJsonPath("gamedata/_meta/lastIndexedBlock", "55");
  setMetaJson("indexerRepairStatus", {
    at: Date.now() - 10_000,
    fromBlock: "1",
    toBlock: "55",
    repairedLogs: 0,
  });

  const route = await loadRoute("health");
  const baseUrl = "https://playlore.xyz/api/health/data-sync";
  const captured = await captureRouteLogs(async () => ({
    publicResponse: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders(),
    })),
    privateResponse: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders({ "x-health-diagnostics-secret": HEALTH_SECRET }),
    })),
  }));
  return {
    scenario: "health-finality",
    ...captured.value,
    logs: captured.logs,
    rpcMethods: fetchState.rpcMethods,
  };
}

const TEST_WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const FAKE_SIGNATURE = `0x${"11".repeat(65)}`;

async function runAdminAuthScenario() {
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const { APP_CHAIN_ID } = await import("../../app/lib/constants");
  const { buildAdminAuthMessage } = await import("../../app/lib/adminAuth");
  const route = await loadRoute("admin-auth");
  const baseUrl = "https://playlore.xyz/api/admin/auth";
  const before = await persistenceState();
  const wrongOriginBody = JSON.stringify({
    authAddress: TEST_WALLET,
    authMessage: buildAdminAuthMessage({
      address: TEST_WALLET,
      uri: "https://attacker.invalid/admin",
      chainId: APP_CHAIN_ID,
      nonce: "a".repeat(32),
      issuedAt: new Date().toISOString(),
    }),
    authSignature: FAKE_SIGNATURE,
  });
  const captured = await captureRouteLogs(async () => ({
    unsupportedType: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: requestHeaders({ "content-type": "text/plain" }),
      body: "{}",
    })),
    malformed: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: "{",
    })),
    oversized: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ authMessage: "x".repeat(9_000) }),
    })),
    wrongOrigin: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: wrongOriginBody,
    })),
    refreshUnauthenticated: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders({ cookie: "lore_admin_session=hostile.invalid.value" }),
    })),
    logoutUnauthenticated: await snapshotResponse(await dispatch(route, "DELETE", baseUrl, {
      headers: requestHeaders({ cookie: "lore_admin_session=hostile.invalid.value" }),
    })),
    methods: await supportedRouteMethodBoundary(route, baseUrl, "PUT"),
  }));
  return {
    scenario: "admin-auth",
    ...captured.value,
    before,
    after: await persistenceState(),
    mockedFetchUrls: readNetworkFetchUrls(),
    logs: captured.logs,
  };
}

async function runChatAuthScenario() {
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const { APP_CHAIN_ID } = await import("../../app/lib/constants");
  const { buildChatAuthMessage } = await import("../../app/lib/chatAuth");
  const route = await loadRoute("chat-auth");
  const baseUrl = "https://playlore.xyz/api/chat/auth";
  const before = await persistenceState();
  const wrongOriginBody = JSON.stringify({
    authAddress: TEST_WALLET,
    authMessage: buildChatAuthMessage({
      address: TEST_WALLET,
      uri: "https://attacker.invalid/chat",
      chainId: APP_CHAIN_ID,
      nonce: "b".repeat(32),
      issuedAt: new Date().toISOString(),
    }),
    authSignature: FAKE_SIGNATURE,
  });
  const captured = await captureRouteLogs(async () => ({
    unsupportedType: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: requestHeaders({ "content-type": "text/plain" }),
      body: "{}",
    })),
    malformed: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: "{",
    })),
    oversized: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ authMessage: "x".repeat(9_000) }),
    })),
    wrongOrigin: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: wrongOriginBody,
    })),
    refreshUnauthenticated: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders({ cookie: "lore_chat_session=hostile.invalid.value" }),
    })),
    methods: await supportedRouteMethodBoundary(route, baseUrl, "DELETE"),
  }));
  return {
    scenario: "chat-auth",
    ...captured.value,
    before,
    after: await persistenceState(),
    mockedFetchUrls: readNetworkFetchUrls(),
    logs: captured.logs,
  };
}

async function runChatMessagesScenario() {
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const route = await loadRoute("chat-messages");
  const baseUrl = "https://playlore.xyz/api/chat/messages";
  const sessionCookie = chatSessionCookie(TEST_WALLET);
  const canonicalSender = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const canonicalSenderCookie = chatSessionCookie(canonicalSender);
  const before = await persistenceState();
  const captured = await captureRouteLogs(async () => ({
    unsupportedType: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: requestHeaders({ "content-type": "text/plain" }),
      body: "{}",
    })),
    malformed: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: "{",
    })),
    oversized: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ text: "x".repeat(17_000) }),
    })),
    textTooLong: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders({ cookie: sessionCookie }),
      body: JSON.stringify({ text: "x".repeat(281), sender: TEST_WALLET }),
    })),
    senderNameTooLong: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders({ cookie: sessionCookie }),
      body: JSON.stringify({ text: "hello", sender: TEST_WALLET, senderName: "x".repeat(21) }),
    })),
    unauthenticated: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders({ cookie: "lore_chat_session=hostile.invalid.value" }),
      body: JSON.stringify({ text: "must not persist", sender: TEST_WALLET }),
    })),
    afterRejected: await persistenceState(),
    readEmpty: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders(),
    })),
    mixedCaseSender: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders({ cookie: canonicalSenderCookie }),
      body: JSON.stringify({ text: "canonical sender", sender: `0x${canonicalSender.slice(2).toUpperCase()}` }),
    })),
    methods: await supportedRouteMethodBoundary(route, baseUrl, "PUT"),
  }));
  return {
    scenario: "chat-messages",
    ...captured.value,
    before,
    after: await persistenceState(),
    mockedFetchUrls: readNetworkFetchUrls(),
    logs: captured.logs,
  };
}

async function runChatProfileScenario() {
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const route = await loadRoute("chat-profile");
  const baseUrl = "https://playlore.xyz/api/chat/profile";
  const sessionCookie = chatSessionCookie(TEST_WALLET);
  const before = await persistenceState();
  const captured = await captureRouteLogs(async () => ({
    unsupportedType: await snapshotResponse(await dispatch(route, "PUT", baseUrl, {
      headers: requestHeaders({ "content-type": "text/plain" }),
      body: "{}",
    })),
    malformed: await snapshotResponse(await dispatch(route, "PUT", baseUrl, {
      headers: jsonHeaders(),
      body: "{",
    })),
    oversized: await snapshotResponse(await dispatch(route, "PUT", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ customAvatar: "x".repeat(17_000) }),
    })),
    nameTooLong: await snapshotResponse(await dispatch(route, "PUT", baseUrl, {
      headers: jsonHeaders({ cookie: sessionCookie }),
      body: JSON.stringify({ walletAddress: TEST_WALLET, name: "x".repeat(21) }),
    })),
    unauthenticated: await snapshotResponse(await dispatch(route, "PUT", baseUrl, {
      headers: jsonHeaders({ cookie: "lore_chat_session=hostile.invalid.value" }),
      body: JSON.stringify({ walletAddress: TEST_WALLET, name: "must-not-persist" }),
    })),
    getMissing: await snapshotResponse(await dispatch(route, "GET", baseUrl, {
      headers: requestHeaders(),
    })),
    getValid: await snapshotResponse(await dispatch(
      route,
      "GET",
      `${baseUrl}?walletAddress=${OTHER_WALLET}`,
      { headers: requestHeaders() },
    )),
    methods: await supportedRouteMethodBoundary(route, baseUrl, "POST"),
  }));
  return {
    scenario: "chat-profile",
    ...captured.value,
    before,
    after: await persistenceState(),
    mockedFetchUrls: readNetworkFetchUrls(),
    logs: captured.logs,
  };
}

async function runRewardsScenario() {
  const readNetworkFetchUrls = installForbiddenNetworkFetch();
  const route = await loadRoute("rewards");
  const baseUrl = "https://playlore.xyz/api/rewards";
  const before = await persistenceState();
  const captured = await captureRouteLogs(async () => ({
    unsupportedType: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: requestHeaders({ "content-type": "text/plain" }),
      body: "{}",
    })),
    malformed: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: "{",
    })),
    oversized: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ epochs: Array.from({ length: 5_000 }, (_, index) => index + 1) }),
    })),
    invalidUser: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ user: "not-an-address", epochs: [] }),
    })),
    invalidEpochs: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ user: TEST_WALLET, epochs: [0, 1_000_001] }),
    })),
    validEmpty: await snapshotResponse(await dispatch(route, "POST", baseUrl, {
      headers: jsonHeaders(),
      body: JSON.stringify({ user: TEST_WALLET, epochs: [] }),
    })),
    methods: await supportedRouteMethodBoundary(route, baseUrl, "GET"),
  }));
  return {
    scenario: "rewards",
    ...captured.value,
    before,
    after: await persistenceState(),
    mockedFetchUrls: readNetworkFetchUrls(),
    logs: captured.logs,
  };
}

type IpcLimiterResponse = {
  type: "external-rate-limit-response";
  requestId: number;
  status: number;
  payload: unknown;
};

async function runLimiterWorker() {
  process.env.UPSTASH_REDIS_REST_URL = "https://unit-test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = RATE_LIMIT_TOKEN;
  process.env.WEB_REPLICA_COUNT = "2";
  process.env.RATE_LIMIT_EXTERNAL_FAIL_CLOSED = "1";

  let requestSequence = 0;
  let fetchCalls = 0;
  const pending = new Map<number, {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  const onMessage = (raw: unknown) => {
    const message = raw as Partial<IpcLimiterResponse>;
    if (message.type !== "external-rate-limit-response" || !Number.isInteger(message.requestId)) return;
    const entry = pending.get(message.requestId as number);
    if (!entry) return;
    pending.delete(message.requestId as number);
    clearTimeout(entry.timeout);
    entry.resolve(new Response(JSON.stringify(message.payload), {
      status: message.status,
      headers: { "content-type": "application/json" },
    }));
  };
  process.on("message", onMessage);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls += 1;
    const requestId = ++requestSequence;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = await inputBodyText(input, init);
    if (!process.send) throw new Error("limiter worker IPC is unavailable");
    return await new Promise<Response>((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        rejectResponse(new Error("limiter broker response timed out"));
      }, 5_000);
      pending.set(requestId, { resolve: resolveResponse, reject: rejectResponse, timeout });
      process.send?.({
        type: "external-rate-limit-request",
        requestId,
        endpoint: inputUrl(input),
        method: init?.method ?? (input instanceof Request ? input.method : "GET"),
        contentType: headers.get("content-type"),
        authorizationValid: headers.get("authorization") === `Bearer ${RATE_LIMIT_TOKEN}`,
        body,
      });
    });
  }) as typeof fetch;

  const { enforceSharedRateLimit } = await import("../../app/api/_lib/sharedRateLimit");
  Object.assign(process.env, { NODE_ENV: "production" });
  const originalNow = Date.now;
  Date.now = () => 120_001;
  try {
    const response = await enforceSharedRateLimit(
      new Request("https://playlore.xyz/api/jackpots/og", { headers: requestHeaders() }),
      { bucket: "api-jackpots-og", limit: 1, windowMs: 60_000 },
    );
    return {
      scenario: "limiter",
      pid: process.pid,
      fetchCalls,
      allowed: response === null,
      response: response ? await snapshotResponse(response) : null,
    };
  } finally {
    Date.now = originalNow;
    process.off("message", onMessage);
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("limiter worker stopped before broker response"));
    }
    pending.clear();
  }
}

async function main() {
  configureBaseEnvironment();
  const mode = process.argv[2];
  let result: unknown;
  if (mode === "og") result = await runOgScenario();
  else if (mode === "jackpots") result = await runJackpotsScenario();
  else if (mode === "deposits") result = await runDepositsScenario();
  else if (mode === "deposits-persistence") result = await runDepositsPersistenceScenario();
  else if (mode === "deposits-recovery") result = await runDepositsRecoveryScenario();
  else if (mode === "deposits-recovery-global-bound-mutant") {
    result = await runDepositsRecoveryScenario({ globalBoundMutant: true });
  }
  else if (mode === "recovery-storage-allowlist") result = await runRecoveryStorageAllowlistScenario();
  else if (mode === "recovery-storage-allowlist-mutant") {
    result = await runRecoveryStorageAllowlistScenario({ allowlistMutant: true });
  }
  else if (mode === "health-success") result = await runHealthSuccessScenario();
  else if (mode === "health-failure") result = await runHealthFailureScenario();
  else if (mode === "health-finality") result = await runHealthFinalityScenario();
  else if (mode === "health-finality-raw-lag-mutant") {
    result = await runHealthFinalityScenario({ rawLagMutant: true });
  }
  else if (mode === "admin-auth") result = await runAdminAuthScenario();
  else if (mode === "chat-auth") result = await runChatAuthScenario();
  else if (mode === "chat-messages") result = await runChatMessagesScenario();
  else if (mode === "chat-profile") result = await runChatProfileScenario();
  else if (mode === "rewards") result = await runRewardsScenario();
  else if (mode === "limiter") result = await runLimiterWorker();
  else throw new Error(`Unknown API route matrix worker mode: ${mode ?? "<missing>"}`);

  await new Promise<void>((resolveWrite, rejectWrite) => {
    process.stdout.write(`${JSON.stringify(result)}\n`, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
  if (mode === "limiter" && process.connected) process.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  if (process.connected) process.disconnect();
  process.exit(1);
});
