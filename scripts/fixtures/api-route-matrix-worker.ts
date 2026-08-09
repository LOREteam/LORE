import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { toFunctionSelector } from "viem";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";

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
  "vary",
] as const;

function configureBaseEnvironment() {
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.TRUST_PROXY_HEADERS = "1";
  process.env.TRUST_PROXY_SECRET = PROXY_SECRET;
  process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY = "0";
  process.env.API_DEPOSITS_CHAIN_RECOVERY = "0";
  process.env.HEALTH_DIAGNOSTICS_SECRET = HEALTH_SECRET;
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

function installRouteFetchMock(mode: "success" | "failure" = "success") {
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
          result = encodeWords([10n]);
        } else if (data.startsWith(jackpotInfoSelector.toLowerCase())) {
          result = encodeWords([1_000n, 2_000n, 1n, 1n, 8n, 7n, 100n, 200n]);
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

async function loadRoute(name: "og" | "jackpots" | "deposits" | "health") {
  if (name === "og") return await import("../../app/api/jackpots/og/route") as RouteModule;
  if (name === "jackpots") return await import("../../app/api/jackpots/route") as RouteModule;
  if (name === "deposits") return await import("../../app/api/deposits/route") as RouteModule;
  return await import("../../app/api/health/data-sync/route") as RouteModule;
}

async function runOgScenario() {
  const fetchState = installRouteFetchMock();
  const route = await loadRoute("og");
  Object.assign(process.env, { NODE_ENV: "production" });
  const baseUrl = "https://attacker.invalid/api/jackpots/og";
  const headers = requestHeaders({ host: "attacker.invalid" });

  const captured = await captureRouteLogs(async () => {
    const heldFirst = await dispatch(route, "GET", `${baseUrl}?kind=daily`, { headers });
    const heldSecond = await dispatch(route, "GET", `${baseUrl}?kind=daily`, { headers });
    const busy = await snapshotResponse(await dispatch(route, "GET", `${baseUrl}?kind=daily`, { headers }));
    await heldFirst.body?.cancel();
    await heldSecond.body?.cancel();

    const baseline = await snapshotResponse(await dispatch(route, "GET", `${baseUrl}?kind=daily`, { headers }));
    const oversized = await snapshotResponse(await dispatch(
      route,
      "GET",
      `${baseUrl}?amount=${"9".repeat(10_000)}&tile=26&epoch=1000000001`,
      { headers },
    ));

    return {
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

async function runHealthSuccessScenario() {
  const fetchState = installRouteFetchMock();
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
  else if (mode === "health-success") result = await runHealthSuccessScenario();
  else if (mode === "health-failure") result = await runHealthFailureScenario();
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
