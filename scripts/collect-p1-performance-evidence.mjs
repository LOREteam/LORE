import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { findExecutablePath } from "./smoke-browser-lib/core.mjs";

const PROJECT_ROOT = process.cwd();
const DEFAULT_DIST_DIR = path.join(PROJECT_ROOT, ".next");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "artifacts", "performance", "p1-evidence.json");
const NETWORK_GUARD_PATH = path.join(PROJECT_ROOT, "scripts", "p1-perf-local-network-guard.mjs");
const DEFAULT_DURATION_MS = 30_000;
const MIN_DURATION_MS = 9_000;
const MAX_DURATION_MS = 2 * 60 * 60 * 1_000;
const MAX_ERROR_CHARS = 600;
const MAX_REQUEST_SAMPLES = 20_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parseDuration(value, label = "duration") {
  const match = /^((?:0|[1-9]\d*))(ms|s|m|h)$/.exec(value ?? "");
  if (!match) throw new Error(`${label} must use a canonical value such as 30s, 15m, or 2h`);
  const units = { ms: 1n, s: 1_000n, m: 60_000n, h: 3_600_000n };
  const milliseconds = BigInt(match[1]) * units[match[2]];
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is too large`);
  return Number(milliseconds);
}

function parseArgs(argv) {
  const options = {
    artifactsOnly: false,
    summaryOnly: false,
    selfTest: false,
    durationMs: DEFAULT_DURATION_MS,
    sampleIntervalMs: null,
    baseUrl: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifacts-only") options.artifactsOnly = true;
    else if (arg === "--summary-only") options.summaryOnly = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (["--duration", "--sample-interval", "--base-url"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--duration") options.durationMs = parseDuration(value, "--duration");
      else if (arg === "--sample-interval") options.sampleIntervalMs = parseDuration(value, "--sample-interval");
      else options.baseUrl = validateLoopbackBaseUrl(value).href;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!options.artifactsOnly && (options.durationMs < MIN_DURATION_MS || options.durationMs > MAX_DURATION_MS)) {
    throw new Error(`--duration must be between ${MIN_DURATION_MS}ms and 2h`);
  }
  const automaticSampleMs = Math.max(1_000, Math.min(30_000, Math.floor(options.durationMs / 12)));
  options.sampleIntervalMs ??= automaticSampleMs;
  if (options.sampleIntervalMs < 250 || options.sampleIntervalMs > 60_000) {
    throw new Error("--sample-interval must be between 250ms and 60s");
  }
  return options;
}

function validateLoopbackBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:") throw new Error("--base-url must use local http://");
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new Error("--base-url must use a loopback host");
  if (url.username || url.password || url.search || url.hash) throw new Error("--base-url must not contain credentials, query, or hash");
  url.pathname = "/";
  return url;
}

function routeFromManifestKey(key) {
  if (key === "/page") return "/";
  if (key.endsWith("/page")) return key.slice(0, -"/page".length) || "/";
  return key;
}

function normalizeAssetPath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\/+/, "");
}

function resolveBuildAsset(distDir, assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  const absolutePath = path.resolve(distDir, normalized);
  const relative = path.relative(distDir, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`unsafe build asset path: ${normalized}`);
  }
  return { normalized, absolutePath };
}

function parseClientReferenceManifest(text, sourceLabel) {
  const marker = "globalThis.__RSC_MANIFEST[";
  const markerIndex = text.indexOf(marker);
  const assignmentIndex = markerIndex < 0 ? -1 : text.indexOf("]=", markerIndex);
  if (assignmentIndex < 0) throw new Error(`${sourceLabel} has no RSC manifest assignment`);
  const serializedRouteKey = text.slice(markerIndex + marker.length, assignmentIndex);
  const routeKey = JSON.parse(serializedRouteKey);
  if (typeof routeKey !== "string") throw new Error(`${sourceLabel} has an invalid route key`);
  const serialized = text.slice(assignmentIndex + 2).trim().replace(/;\s*$/, "");
  return { routeKey, payload: JSON.parse(serialized) };
}

async function listFiles(root, predicate = () => true) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile() && predicate(absolutePath)) files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function ownerLabel(rawOwner) {
  if (rawOwner === "next-runtime") return { kind: "framework", label: "next-runtime" };
  const normalized = String(rawOwner).replaceAll("\\", "/").split("?")[0];
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = normalized.lastIndexOf(nodeModulesMarker);
  if (nodeModulesIndex >= 0 || normalized.startsWith("node_modules/")) {
    const packagePath = nodeModulesIndex >= 0
      ? normalized.slice(nodeModulesIndex + nodeModulesMarker.length)
      : normalized.slice("node_modules/".length);
    const segments = packagePath.split("/");
    const packageName = segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
    return { kind: "package", label: packageName || "unknown-package" };
  }
  const relative = path.relative(PROJECT_ROOT, normalized.replaceAll("/", path.sep));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return { kind: "source", label: relative.replaceAll(path.sep, "/") };
  }
  return { kind: "framework", label: "next-runtime" };
}

function summarizeOwners(rawOwners) {
  const sources = new Set();
  const packages = new Set();
  const framework = new Set();
  for (const rawOwner of rawOwners) {
    const owner = ownerLabel(rawOwner);
    if (owner.kind === "source") sources.add(owner.label);
    else if (owner.kind === "package") packages.add(owner.label);
    else framework.add(owner.label);
  }
  return {
    appSources: [...sources].sort().slice(0, 12),
    packages: [...packages].sort().slice(0, 12),
    framework: [...framework].sort(),
    attribution: "client-reference manifest membership; not byte-level module attribution",
  };
}

async function measureBuildAssetFile(distDir, assetPath) {
  const { normalized, absolutePath } = resolveBuildAsset(distDir, assetPath);
  let buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { path: normalized, missing: true, rawBytes: 0, gzipBytes: 0, brotliBytes: 0 };
    }
    throw error;
  }
  return {
    path: normalized,
    missing: false,
    rawBytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(buffer, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

async function collectBuildEvidence(distDir = DEFAULT_DIST_DIR) {
  const [buildId, buildIdStat, buildManifest, appPathsManifest, reactLoadableManifest] = await Promise.all([
    fs.readFile(path.join(distDir, "BUILD_ID"), "utf8").then((value) => value.trim()),
    fs.stat(path.join(distDir, "BUILD_ID")),
    fs.readFile(path.join(distDir, "build-manifest.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(distDir, "server", "app-paths-manifest.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(distDir, "react-loadable-manifest.json"), "utf8").then(JSON.parse),
  ]);
  if (!buildId) throw new Error(".next/BUILD_ID is empty");

  const publicRoutes = new Set(
    Object.keys(appPathsManifest)
      .filter((key) => key.endsWith("/page"))
      .map(routeFromManifestKey)
      .filter((route) => !route.startsWith("/_")),
  );
  const manifestFiles = await listFiles(
    path.join(distDir, "server", "app"),
    (file) => file.endsWith(`${path.sep}page_client-reference-manifest.js`),
  );
  const routeManifests = new Map();
  const ownersByAsset = new Map();
  const addOwner = (assetPath, owner) => {
    const normalized = normalizeAssetPath(assetPath);
    const owners = ownersByAsset.get(normalized) ?? new Set();
    owners.add(owner);
    ownersByAsset.set(normalized, owners);
  };

  for (const manifestFile of manifestFiles) {
    const manifest = parseClientReferenceManifest(
      await fs.readFile(manifestFile, "utf8"),
      path.relative(distDir, manifestFile),
    );
    const route = routeFromManifestKey(manifest.routeKey);
    const payload = manifest.payload;
    routeManifests.set(route, payload);
    for (const [owner, moduleInfo] of Object.entries(payload.clientModules ?? {})) {
      const chunks = Array.isArray(moduleInfo?.chunks) ? moduleInfo.chunks : [];
      for (const chunk of chunks) {
        if (typeof chunk === "string" && /^static\/.+\.(?:js|css)$/.test(chunk)) addOwner(chunk, owner);
      }
    }
    for (const [owner, cssFiles] of Object.entries(payload.entryCSSFiles ?? {})) {
      for (const cssFile of Array.isArray(cssFiles) ? cssFiles : []) {
        const cssPath = typeof cssFile === "string" ? cssFile : cssFile?.path;
        if (cssPath) addOwner(cssPath, owner);
      }
    }
  }

  for (const rootAsset of buildManifest.rootMainFiles ?? []) addOwner(rootAsset, "next-runtime");
  for (const [owner, loadable] of Object.entries(reactLoadableManifest)) {
    for (const assetPath of Array.isArray(loadable?.files) ? loadable.files : []) {
      if (/^static\/.+\.(?:js|css)$/.test(assetPath)) addOwner(assetPath, owner);
    }
  }
  const assetMeasurementCache = new Map();
  async function measureAsset(assetPath) {
    const { normalized, absolutePath } = resolveBuildAsset(distDir, assetPath);
    if (assetMeasurementCache.has(normalized)) return assetMeasurementCache.get(normalized);
    void absolutePath;
    const measured = await measureBuildAssetFile(distDir, normalized);
    assetMeasurementCache.set(normalized, measured);
    return measured;
  }

  const rootAssets = (buildManifest.rootMainFiles ?? []).map(normalizeAssetPath);
  const legacyPolyfillAssets = (buildManifest.polyfillFiles ?? []).map(normalizeAssetPath);
  const routes = [];
  for (const route of [...publicRoutes].sort((left, right) => left.localeCompare(right))) {
    const payload = routeManifests.get(route);
    if (!payload) {
      routes.push({ route, status: "missing-manifest", assets: [], missingAssets: [] });
      continue;
    }
    const routeAssets = new Set(rootAssets);
    for (const moduleInfo of Object.values(payload.clientModules ?? {})) {
      const chunks = Array.isArray(moduleInfo?.chunks) ? moduleInfo.chunks : [];
      for (const chunk of chunks) {
        if (typeof chunk === "string" && /^static\/.+\.(?:js|css)$/.test(chunk)) {
          routeAssets.add(normalizeAssetPath(chunk));
        }
      }
    }
    for (const cssFiles of Object.values(payload.entryCSSFiles ?? {})) {
      for (const cssFile of Array.isArray(cssFiles) ? cssFiles : []) {
        const cssPath = typeof cssFile === "string" ? cssFile : cssFile?.path;
        if (cssPath) routeAssets.add(normalizeAssetPath(cssPath));
      }
    }
    const assets = await Promise.all([...routeAssets].sort().map(measureAsset));
    const presentAssets = assets.filter((asset) => !asset.missing);
    const totals = presentAssets.reduce(
      (sum, asset) => ({
        rawBytes: sum.rawBytes + asset.rawBytes,
        gzipBytes: sum.gzipBytes + asset.gzipBytes,
        brotliBytes: sum.brotliBytes + asset.brotliBytes,
      }),
      { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
    );
    routes.push({
      route,
      status: assets.some((asset) => asset.missing) ? "partial" : "measured",
      derivation: "rootMainFiles plus route client-reference chunks and entry CSS",
      manifestAssetSet: { assetCount: presentAssets.length, ...totals },
      missingAssets: assets.filter((asset) => asset.missing).map((asset) => asset.path),
      largestAssets: [...presentAssets]
        .sort((left, right) => right.rawBytes - left.rawBytes)
        .slice(0, 12)
        .map((asset) => ({ ...asset, owners: summarizeOwners(ownersByAsset.get(asset.path) ?? []) })),
      assets,
    });
  }

  const legacyPolyfills = await Promise.all(legacyPolyfillAssets.map(measureAsset));
  const allStaticChunks = await listFiles(
    path.join(distDir, "static", "chunks"),
    (file) => file.endsWith(".js"),
  );
  const allChunkMeasurements = await Promise.all(
    allStaticChunks.map((file) => measureAsset(path.relative(distDir, file))),
  );
  const largestChunks = allChunkMeasurements
    .filter((asset) => !asset.missing)
    .sort((left, right) => right.rawBytes - left.rawBytes)
    .slice(0, 20)
    .map((asset) => {
      const owners = ownersByAsset.get(asset.path) ?? new Set();
      if (owners.size === 0 && /(?:^|\/)(?:main|main-app|webpack|polyfills)-/.test(asset.path)) {
        owners.add("next-runtime");
      }
      return { ...asset, owners: summarizeOwners(owners) };
    });
  const missingRouteManifests = [...publicRoutes].filter((route) => !routeManifests.has(route));
  const missingAssets = [...assetMeasurementCache.values()].filter((asset) => asset.missing).map((asset) => asset.path);

  return {
    status: missingRouteManifests.length === 0 && missingAssets.length === 0 ? "measured" : "partial",
    scope: "existing Next production build artifacts; no rebuild",
    buildId,
    buildCompletedAt: buildIdStat.mtime.toISOString(),
    compressionMethod: "deterministic gzip level 9 and Brotli quality 11 over emitted bytes",
    routeAssetCaveat: "The deterministic manifest-derived set may include chunks not referenced by a rendered route and omit non-client-reference assets; runtime.routeFirstLoad records emitted initial tags when available.",
    routes,
    legacyPolyfills,
    largestChunks,
    missingRouteManifests,
    missingAssets: [...new Set(missingAssets)].sort(),
  };
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("could not reserve a loopback port"));
        else resolve(port);
      });
    });
  });
}

function compactError(value, tempPath = "") {
  const raw = String(value ?? "unknown error");
  return (tempPath ? raw.replaceAll(tempPath, "<temp>") : raw)
    .replace(/(?:https?|wss?):\/\/\S+/gi, "<url>")
    .replace(/0x[a-f0-9]{40,64}/gi, "<hex>")
    .replace(/\b[a-f0-9]{64}\b/gi, "<hex>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_CHARS);
}

async function waitForLoopbackServer(baseUrl, child, getLog, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`local Next server exited (${child.exitCode}): ${getLog()}`);
    try {
      const response = await fetch(new URL("/robots.txt", baseUrl), { signal: AbortSignal.timeout(1_500) });
      if (response.status < 500) return;
    } catch {
      // Local startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local Next server did not become ready: ${getLog()}`);
}

async function startLocalNextServer() {
  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lore-p1-perf-"));
  const nextBin = path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");
  const minimalEnv = {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${pathToFileURL(NETWORK_GUARD_PATH).href}`,
    LORE_DB_PATH: path.join(tempRoot, "perf.sqlite"),
    LINEA_NETWORK: "sepolia",
    KEEPER_RPC_URL: "http://127.0.0.1:9",
    ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
    TEMP: tempRoot,
    TMP: tempRoot,
  };
  for (const name of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "COMSPEC"]) {
    if (process.env[name]) minimalEnv[name] = process.env[name];
  }
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: PROJECT_ROOT,
    env: minimalEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let boundedLog = "";
  const capture = (chunk) => {
    boundedLog = `${boundedLog}${chunk}`.slice(-8_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  try {
    await waitForLoopbackServer(baseUrl, child, () => compactError(boundedLog, tempRoot));
  } catch (error) {
    child.kill();
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    baseUrl,
    child,
    tempRoot,
    getLog: () => compactError(boundedLog, tempRoot),
    async close() {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 3_000)),
        ]);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
      const relative = path.relative(os.tmpdir(), tempRoot);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

function mockApiPayload(pathname) {
  if (pathname === "/api/live-state") {
    return {
      currentEpoch: "1",
      epochEndTime: String(Math.floor(Date.now() / 1_000) + 3_600),
      jackpotInfo: ["0", "0", "0", "0", "0", "0", "0", "0"],
      rolloverPool: "0",
      currentEpochData: ["0", "0", "0", false, false, false],
      tileData: { pools: Array(25).fill("0"), users: Array(25).fill("0") },
      tileUserCounts: Array(25).fill(0),
      indexedTilePools: Array(25).fill("0"),
      epochDuration: "60",
      pendingEpochDuration: null,
      pendingEpochDurationEta: null,
      pendingEpochDurationEffectiveFromEpoch: null,
      fetchedAt: Date.now(),
    };
  }
  if (pathname === "/api/recent-wins") return { wins: [] };
  if (pathname === "/api/chat/messages") return { messages: [] };
  if (pathname === "/api/jackpots") return { jackpots: [] };
  if (pathname === "/api/leaderboards") {
    return { biggestSingleWin: [], luckiest: [], oneTileWonder: [], mostWins: [], whales: [], underdog: [], luckyTile: [] };
  }
  if (pathname === "/api/global-stats") return { stats: null };
  return {};
}

function compressionTotals(assets) {
  return assets
    .filter((asset) => !asset.missing)
    .reduce(
      (sum, asset) => ({
        rawBytes: sum.rawBytes + asset.rawBytes,
        gzipBytes: sum.gzipBytes + asset.gzipBytes,
        brotliBytes: sum.brotliBytes + asset.brotliBytes,
      }),
      { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
    );
}

async function collectRenderedRouteFirstLoad(baseUrl, routes) {
  const baseOrigin = new URL(baseUrl).origin;
  const measurementCache = new Map();
  const measureAsset = async (assetPath) => {
    if (!measurementCache.has(assetPath)) {
      measurementCache.set(assetPath, measureBuildAssetFile(DEFAULT_DIST_DIR, assetPath));
    }
    return measurementCache.get(assetPath);
  };
  const results = [];
  for (const routePath of routes) {
    const response = await fetch(new URL(routePath, baseUrl), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(30_000),
    });
    const htmlBuffer = Buffer.from(await response.arrayBuffer());
    if (htmlBuffer.byteLength > 10 * 1_024 * 1_024) throw new Error(`rendered route ${routePath} exceeded 10 MiB`);
    const html = htmlBuffer.toString("utf8");
    const modernAssetPaths = new Set();
    const legacyAssetPaths = new Set();
    for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
      const sourceMatch = /\b(?:src|href)=["']([^"']+)["']/i.exec(tag);
      if (!sourceMatch) continue;
      let assetUrl;
      try {
        assetUrl = new URL(sourceMatch[1].replaceAll("&amp;", "&"), baseUrl);
      } catch {
        continue;
      }
      if (assetUrl.origin !== baseOrigin || !assetUrl.pathname.startsWith("/_next/static/")) continue;
      const assetPath = normalizeAssetPath(assetUrl.pathname.slice("/_next/".length));
      if (/\bnomodule\b/i.test(tag)) legacyAssetPaths.add(assetPath);
      else modernAssetPaths.add(assetPath);
    }
    const modernAssets = await Promise.all([...modernAssetPaths].sort().map(measureAsset));
    const legacyAssets = await Promise.all([...legacyAssetPaths].sort().map(measureAsset));
    results.push({
      route: routePath,
      httpStatus: response.status,
      status: response.ok && modernAssets.every((asset) => !asset.missing) ? "measured" : "partial",
      derivation: "initial script/link tags emitted by the local production Next server",
      routeHtmlRawBytes: htmlBuffer.byteLength,
      firstLoadModern: {
        assetCount: modernAssets.filter((asset) => !asset.missing).length,
        ...compressionTotals(modernAssets),
      },
      legacyNomodule: {
        assetCount: legacyAssets.filter((asset) => !asset.missing).length,
        ...compressionTotals(legacyAssets),
      },
      missingAssets: [...modernAssets, ...legacyAssets].filter((asset) => asset.missing).map((asset) => asset.path),
      largestModernAssets: modernAssets
        .filter((asset) => !asset.missing)
        .sort((left, right) => right.rawBytes - left.rawBytes)
        .slice(0, 10),
      modernAssets,
      legacyAssets,
    });
  }
  return {
    status: results.every((route) => route.status === "measured") ? "measured" : "partial",
    compressionMethod: "deterministic gzip level 9 and Brotli quality 11 over emitted build assets",
    caveat: "This measures emitted initial static references for a local production render, not CDN headers, cache state, or negotiated transfer encoding.",
    routes: results,
  };
}

function allocatePhases(durationMs) {
  const visibleBeforeMs = Math.floor(durationMs / 3);
  const hiddenMs = Math.floor(durationMs / 3);
  return [
    { name: "visible-before", visibility: "visible", requestedMs: visibleBeforeMs },
    { name: "synthetic-hidden", visibility: "hidden", requestedMs: hiddenMs },
    { name: "visible-after", visibility: "visible", requestedMs: durationMs - visibleBeforeMs - hiddenMs },
  ];
}

function summarizeDurations(values) {
  if (values.length === 0) return { count: 0, totalMs: 0, longestMs: 0, p95Ms: null };
  const sorted = [...values].sort((left, right) => left - right);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    count: values.length,
    totalMs: Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100,
    longestMs: Math.round(sorted.at(-1) * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
  };
}

function linearSlopePerHour(samples, valueKey) {
  const points = samples
    .filter((sample) => Number.isFinite(sample[valueKey]))
    .map((sample) => [sample.elapsedMs, sample[valueKey]]);
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point[0] - meanX) ** 2, 0);
  if (denominator === 0) return null;
  const numerator = points.reduce((sum, point) => sum + (point[0] - meanX) * (point[1] - meanY), 0);
  return Math.round((numerator / denominator) * 3_600_000);
}

function phaseRequestSummary(phase, phaseCounts) {
  const byPath = Object.fromEntries([...phaseCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const total = [...phaseCounts.values()].reduce((sum, count) => sum + count, 0);
  return {
    requestedMs: phase.requestedMs,
    actualMs: phase.actualMs,
    total,
    perMinute: phase.actualMs > 0 ? Math.round((total * 60_000 / phase.actualMs) * 100) / 100 : null,
    byPath,
  };
}

async function collectRuntimeEvidence(options, routePaths) {
  let ownedServer = null;
  let browser = null;
  try {
    const baseUrl = options.baseUrl ?? (ownedServer = await startLocalNextServer()).baseUrl;
    const baseOrigin = new URL(baseUrl).origin;
    const routeFirstLoad = await collectRenderedRouteFirstLoad(baseUrl, routePaths);
    const browserCandidates = [
      process.env.SMOKE_BROWSER_EXECUTABLE,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ].filter(Boolean);
    const executablePath = await findExecutablePath(browserCandidates);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-sync",
        "--enable-precise-memory-info",
        "--metrics-recording-only",
        "--no-first-run",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
    });
    let currentPhase = "setup";
    const phaseApiCounts = new Map();
    const requestSamples = [];
    let blockedExternalRequestCount = 0;
    let blockedApiWriteRequestCount = 0;
    const countApi = (phase, pathname) => {
      const counts = phaseApiCounts.get(phase) ?? new Map();
      counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
      phaseApiCounts.set(phase, counts);
      if (requestSamples.length < MAX_REQUEST_SAMPLES) {
        requestSamples.push({ phase, pathname, at: Date.now() });
      }
    };
    await context.route("**/*", async (route) => {
      const request = route.request();
      let url;
      try {
        url = new URL(request.url());
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      if (url.origin !== baseOrigin) {
        blockedExternalRequestCount += 1;
        await route.abort("blockedbyclient");
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        await route.continue();
        return;
      }
      countApi(currentPhase, url.pathname);
      if (!["GET", "HEAD"].includes(request.method())) {
        blockedApiWriteRequestCount += 1;
        await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ error: "read-only perf harness" }) });
        return;
      }
      await route.fulfill({
        status: request.method() === "HEAD" ? 204 : 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: request.method() === "HEAD" ? "" : JSON.stringify(mockApiPayload(url.pathname)),
      });
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
      const nativeVisibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
      const nativeHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
      let syntheticState = "visible";
      let overrideInstalled = false;
      const readNative = (descriptor, fallback) => {
        try {
          return descriptor?.get?.call(document) ?? fallback;
        } catch {
          return fallback;
        }
      };
      try {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => syntheticState,
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => syntheticState === "hidden",
        });
        overrideInstalled = true;
      } catch {
        overrideInstalled = false;
      }
      window.__p1PerfVisibility = {
        set(nextState) {
          syntheticState = nextState === "hidden" ? "hidden" : "visible";
          document.dispatchEvent(new Event("visibilitychange"));
        },
        snapshot() {
          return {
            overrideInstalled,
            syntheticState: document.visibilityState,
            syntheticHidden: document.hidden,
            nativeState: readNative(nativeVisibilityDescriptor, "unknown"),
            nativeHidden: readNative(nativeHiddenDescriptor, null),
          };
        },
      };
      window.__p1PerfLongTasks = [];
      window.__p1PerfLongTaskSupported = PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
      if (window.__p1PerfLongTaskSupported) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (window.__p1PerfLongTasks.length >= 10_000) break;
            window.__p1PerfLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        }).observe({ type: "longtask", buffered: true });
      }
      try {
        window.localStorage.setItem("lore:first-visit-tutorial:v1", "1");
      } catch {
        // Storage can be unavailable in hardened browser configurations.
      }
    });
    const navigationStartedAt = Date.now();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2_000);

    const nativeBeforeBackground = await page.evaluate(() => window.__p1PerfVisibility.snapshot());
    const backgroundProbe = await context.newPage();
    await backgroundProbe.goto("data:text/html,<title>background-probe</title>");
    await backgroundProbe.bringToFront();
    await page.waitForTimeout(100);
    const nativeWhileBackgrounded = await page.evaluate(() => window.__p1PerfVisibility.snapshot());
    await backgroundProbe.close();
    await page.bringToFront();

    const phases = allocatePhases(options.durationMs);
    const samples = [];
    const experimentStartedAt = Date.now();
    const experimentStartPerfNow = await page.evaluate(() => performance.now());
    async function sampleRuntime(phaseName) {
      const snapshot = await page.evaluate(() => ({
        performanceNow: performance.now(),
        domNodes: document.getElementsByTagName("*").length,
        jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
        jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
        jsHeapLimitBytes: performance.memory?.jsHeapSizeLimit ?? null,
      }));
      samples.push({ phase: phaseName, elapsedMs: Date.now() - experimentStartedAt, ...snapshot });
    }

    for (const phase of phases) {
      currentPhase = phase.name;
      const phaseStartWall = Date.now();
      const phaseStartPerf = await page.evaluate((visibility) => {
        window.__p1PerfVisibility.set(visibility);
        return performance.now();
      }, phase.visibility);
      phase.startPerformanceMs = phaseStartPerf;
      await sampleRuntime(phase.name);
      while (Date.now() - phaseStartWall < phase.requestedMs) {
        const remaining = phase.requestedMs - (Date.now() - phaseStartWall);
        await page.waitForTimeout(Math.min(options.sampleIntervalMs, Math.max(1, remaining)));
        await sampleRuntime(phase.name);
      }
      phase.actualMs = Date.now() - phaseStartWall;
      phase.endPerformanceMs = await page.evaluate(() => performance.now());
    }
    currentPhase = "complete";
    const experimentEndedAt = Date.now();
    const finalPageMetrics = await page.evaluate(() => ({
      longTasks: window.__p1PerfLongTasks,
      longTaskSupported: window.__p1PerfLongTaskSupported,
      visibility: window.__p1PerfVisibility.snapshot(),
      navigation: (() => {
        const entry = performance.getEntriesByType("navigation")[0];
        return entry ? {
          ttfbMs: entry.responseStart,
          domContentLoadedMs: entry.domContentLoadedEventEnd,
          loadMs: entry.loadEventEnd,
          transferredBytes: entry.transferSize,
          decodedBytes: entry.decodedBodySize,
        } : null;
      })(),
    }));
    const allLongTasks = finalPageMetrics.longTasks ?? [];
    const experimentLongTasks = allLongTasks.filter(
      (entry) => entry.startTime >= experimentStartPerfNow,
    );
    const initialLoadLongTasks = allLongTasks.filter(
      (entry) => entry.startTime < experimentStartPerfNow,
    );
    const longTasksByPhase = Object.fromEntries(phases.map((phase) => [
      phase.name,
      summarizeDurations(
        experimentLongTasks
          .filter((entry) => entry.startTime >= phase.startPerformanceMs && entry.startTime < phase.endPerformanceMs)
          .map((entry) => entry.duration),
      ),
    ]));
    const finiteHeapSamples = samples.filter((sample) => Number.isFinite(sample.jsHeapUsedBytes));
    const initialHeap = finiteHeapSamples[0]?.jsHeapUsedBytes ?? null;
    const finalHeap = finiteHeapSamples.at(-1)?.jsHeapUsedBytes ?? null;
    const maxHeap = finiteHeapSamples.length > 0 ? Math.max(...finiteHeapSamples.map((sample) => sample.jsHeapUsedBytes)) : null;
    const initialDom = samples[0]?.domNodes ?? null;
    const finalDom = samples.at(-1)?.domNodes ?? null;
    const actualDurationMs = experimentEndedAt - experimentStartedAt;
    const nativeHiddenObserved = nativeWhileBackgrounded.nativeState === "hidden" || nativeWhileBackgrounded.nativeHidden === true;
    const blockers = [];
    if (!nativeHiddenObserved) {
      blockers.push("Headless Chromium kept the backgrounded page natively visible; synthetic visibility measures app branching, not browser background throttling.");
    }
    if (!nativeBeforeBackground.overrideInstalled) blockers.push("Document visibility override could not be installed.");
    if (!finalPageMetrics.longTaskSupported) blockers.push("Long Task API is unavailable in this browser runtime.");
    if (finiteHeapSamples.length === 0) blockers.push("Chromium performance.memory is unavailable.");
    if (actualDurationMs < 2 * 60 * 60 * 1_000) {
      blockers.push("This is a bounded smoke/idle sample, not the requested eventual two-hour soak; rerun with --duration 2h.");
    }

    return {
      status: "measured-partial",
      target: { kind: "local-loopback", autoStarted: Boolean(ownedServer), origin: baseOrigin },
      safety: {
        headlessTemporaryProfile: true,
        externalBrowserRequestsBlocked: true,
        serverExternalNetworkGuard: ownedServer ? "global fetch plus http/https/net/tls loopback-only preload" : "caller-owned server; not asserted",
        apiWritesFulfilled: false,
        blockedApiWriteRequestCount,
      },
      requestedDurationMs: options.durationMs,
      actualDurationMs,
      requestedDurationCompleted: actualDurationMs >= options.durationMs,
      twoHourSoakCompleted: options.durationMs === MAX_DURATION_MS && actualDurationMs >= MAX_DURATION_MS,
      sampleIntervalMs: options.sampleIntervalMs,
      navigation: { wallMsToSettledStart: experimentStartedAt - navigationStartedAt, ...finalPageMetrics.navigation },
      routeFirstLoad,
      visibility: {
        nativeBeforeBackground,
        nativeWhileBackgrounded,
        nativeHiddenObserved,
        measurementMode: "synthetic document.visibilityState plus visibilitychange event",
        caveat: nativeHiddenObserved
          ? "Native hidden state was observed, but phase switching still uses a deterministic synthetic override."
          : "Headless background switching did not create a native hidden tab; browser timer throttling is unproven.",
      },
      polling: {
        phases: Object.fromEntries(phases.map((phase) => [
          phase.name,
          phaseRequestSummary(phase, phaseApiCounts.get(phase.name) ?? new Map()),
        ])),
        blockedExternalRequestCount,
        requestSampleCount: requestSamples.length,
        requestSamplesTruncated: requestSamples.length >= MAX_REQUEST_SAMPLES,
        requestSamples,
      },
      memory: {
        sampleCount: samples.length,
        initialJsHeapUsedBytes: initialHeap,
        finalJsHeapUsedBytes: finalHeap,
        jsHeapDeltaBytes: initialHeap == null || finalHeap == null ? null : finalHeap - initialHeap,
        maxJsHeapUsedBytes: maxHeap,
        jsHeapPeakDeltaBytes: initialHeap == null || maxHeap == null ? null : maxHeap - initialHeap,
        jsHeapLinearSlopeBytesPerHour: linearSlopePerHour(samples, "jsHeapUsedBytes"),
        trendQualifiedForLeakAssessment: actualDurationMs >= 30 * 60 * 1_000,
        initialDomNodes: initialDom,
        finalDomNodes: finalDom,
        domNodeDelta: initialDom == null || finalDom == null ? null : finalDom - initialDom,
        domNodeLinearSlopePerHour: linearSlopePerHour(samples, "domNodes"),
        caveat: "Heap samples include garbage-collection noise; a short positive slope is not proof of a leak.",
        samples,
      },
      longTasks: {
        supported: finalPageMetrics.longTaskSupported,
        initialLoad: summarizeDurations(initialLoadLongTasks.map((entry) => entry.duration)),
        experiment: summarizeDurations(experimentLongTasks.map((entry) => entry.duration)),
        byPhase: longTasksByPhase,
      },
      blockers,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (ownedServer) await ownedServer.close().catch(() => {});
  }
}

function summaryView(report) {
  return {
    schemaVersion: report.schemaVersion,
    status: report.status,
    generatedAt: report.generatedAt,
    build: {
      status: report.build.status,
      buildId: report.build.buildId,
      buildCompletedAt: report.build.buildCompletedAt,
      routes: report.build.routes.map((route) => ({
        route: route.route,
        status: route.status,
        manifestAssetSet: route.manifestAssetSet ?? null,
        missingAssets: route.missingAssets,
      })),
      largestChunks: report.build.largestChunks.slice(0, 8),
      caveat: report.build.routeAssetCaveat,
    },
    runtime: report.runtime?.status === "blocked"
      ? report.runtime
      : report.runtime
        ? {
            status: report.runtime.status,
            target: report.runtime.target,
            requestedDurationMs: report.runtime.requestedDurationMs,
            actualDurationMs: report.runtime.actualDurationMs,
            requestedDurationCompleted: report.runtime.requestedDurationCompleted,
            twoHourSoakCompleted: report.runtime.twoHourSoakCompleted,
            safety: report.runtime.safety,
            routeFirstLoad: {
              status: report.runtime.routeFirstLoad.status,
              routes: report.runtime.routeFirstLoad.routes.map((route) => ({
                route: route.route,
                httpStatus: route.httpStatus,
                status: route.status,
                firstLoadModern: route.firstLoadModern,
                legacyNomodule: route.legacyNomodule,
                missingAssets: route.missingAssets,
              })),
              caveat: report.runtime.routeFirstLoad.caveat,
            },
            visibility: report.runtime.visibility,
            polling: { phases: report.runtime.polling.phases, blockedExternalRequestCount: report.runtime.polling.blockedExternalRequestCount },
            memory: {
              sampleCount: report.runtime.memory.sampleCount,
              jsHeapDeltaBytes: report.runtime.memory.jsHeapDeltaBytes,
              jsHeapPeakDeltaBytes: report.runtime.memory.jsHeapPeakDeltaBytes,
              jsHeapLinearSlopeBytesPerHour: report.runtime.memory.jsHeapLinearSlopeBytesPerHour,
              trendQualifiedForLeakAssessment: report.runtime.memory.trendQualifiedForLeakAssessment,
              domNodeDelta: report.runtime.memory.domNodeDelta,
              domNodeLinearSlopePerHour: report.runtime.memory.domNodeLinearSlopePerHour,
              caveat: report.runtime.memory.caveat,
            },
            longTasks: report.runtime.longTasks,
            blockers: report.runtime.blockers,
          }
        : null,
  };
}

function runSelfTest() {
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("2h"), MAX_DURATION_MS);
  assert.throws(() => parseDuration("02h"), /canonical/);
  assert.throws(() => parseDuration("2 hours"), /canonical/);
  assert.equal(validateLoopbackBaseUrl("http://127.0.0.1:3000/path").href, "http://127.0.0.1:3000/");
  assert.throws(() => validateLoopbackBaseUrl("https://example.com"), /local http/);
  assert.equal(routeFromManifestKey("/page"), "/");
  assert.equal(routeFromManifestKey("/admin/page"), "/admin");
  const phases = allocatePhases(9_001);
  assert.equal(phases.reduce((sum, phase) => sum + phase.requestedMs, 0), 9_001);
  const parsed = parseClientReferenceManifest(
    'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/page"]={"clientModules":{}};',
    "fixture",
  );
  assert.deepEqual(parsed, { routeKey: "/page", payload: { clientModules: {} } });
  console.log(JSON.stringify({ status: "pass", cases: 10, maxDurationMs: MAX_DURATION_MS }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  const build = await collectBuildEvidence();
  let runtime = null;
  if (!options.artifactsOnly) {
    try {
      runtime = await collectRuntimeEvidence(options, build.routes.map((route) => route.route));
    } catch (error) {
      runtime = {
        status: "blocked",
        blocker: compactError(error instanceof Error ? error.message : error),
        requestedDurationMs: options.durationMs,
        twoHourSoakCompleted: false,
      };
    }
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "local-only P1 performance evidence; no wallet or chain writes",
    status: build.status === "measured" && (options.artifactsOnly || runtime?.status === "measured-partial")
      ? (options.artifactsOnly ? "artifact-only" : "partial")
      : "partial",
    build,
    runtime,
  };
  const output = options.summaryOnly ? summaryView(report) : report;
  console.log(JSON.stringify(output, null, 2));
  if (!options.summaryOnly) {
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`P1 performance evidence written: ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}`);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: compactError(error instanceof Error ? error.message : error) }));
  process.exitCode = 1;
});
