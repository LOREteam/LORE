import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { findExecutablePath } from "./smoke-browser-lib/core.mjs";
import {
  BUILD_OUTPUT_DIGEST_DOMAIN,
  BUILD_PROVENANCE_FILENAME,
  REACT_PROFILING_BUILD_PROVENANCE_FILENAME,
  captureCleanGitRevision,
  collectBuildOutputIdentity,
  prepareBuildProvenance,
  prepareReactProfilingBuildProvenance,
  resolveTrustedGitExecutable,
  sealBuildProvenance,
  sealReactProfilingBuildProvenance,
  verifyBuildProvenance,
  verifyReactProfilingBuildProvenance,
} from "./build-provenance.mjs";
import {
  assessStrictPerformanceEvidence,
  analyzeNativeBackgroundAudit,
  createArtifactRevisionBinding,
  createBuildDerivation,
  createDualBuildBinding,
  createRuntimeApplicability,
  MARKER_FILE_DIGEST_DOMAIN,
  MIN_NATIVE_HIDDEN_EVIDENCE_MS,
  MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS,
  NATIVE_TIMER_HEARTBEAT_INTERVAL_MS,
  NATIVE_TIMER_HEARTBEAT_LIMIT,
  NATIVE_TIMER_HIDDEN_PHASE_MS,
  NATIVE_TIMER_LONG_TASK_LIMIT,
  NATIVE_TIMER_TRANSITION_LIMIT,
  NATIVE_TIMER_VISIBLE_CONTROL_MS,
  REACT_PROFILING_BUILD_ROLE,
  summarizePorcelainStatus,
  TWO_HOURS_MS,
} from "./p1-performance-evidence-model.mjs";
import {
  acquireBuildOutputLock,
  parseNextBuildArguments,
  runHermeticBuild,
} from "./run-hermetic-build.mjs";
import { resolveNextDistDir } from "./next-dist-dir.mjs";

const PROJECT_ROOT = process.cwd();
const DEFAULT_DIST_DIR = path.join(PROJECT_ROOT, ".next");
const DEFAULT_PROFILING_DIST_DIR = path.join(PROJECT_ROOT, ".next-p1-profile");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "artifacts", "performance", "p1-evidence.json");
const ARTIFACTS_ONLY_OUTPUT_PATH = path.join(PROJECT_ROOT, "artifacts", "performance", "p1-artifacts-only-evidence.json");
const NETWORK_GUARD_PATH = path.join(PROJECT_ROOT, "scripts", "p1-perf-local-network-guard.mjs");
const DEFAULT_DURATION_MS = 30_000;
const MIN_DURATION_MS = 9_000;
const MAX_DURATION_MS = TWO_HOURS_MS;
const MAX_ERROR_CHARS = 600;
const MAX_REQUEST_SAMPLES = 20_000;
const MAX_GIT_OUTPUT_BYTES = 4 * 1_024 * 1_024;
const AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY = "lineaore:auto-mine-debug-override:v1";
const AUTO_MINE_DEBUG_OVERRIDE_EVENT = "lineaore:auto-mine-debug-override-change:v1";
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
    requireSealed: false,
    summaryOnly: false,
    selfTest: false,
    help: false,
    durationMs: DEFAULT_DURATION_MS,
    sampleIntervalMs: null,
    baseUrl: null,
    distDir: DEFAULT_PROFILING_DIST_DIR,
    distDirRelativePath: ".next-p1-profile",
    headless: true,
    simulateAutoMiner: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifacts-only") options.artifactsOnly = true;
    else if (arg === "--require-sealed") options.requireSealed = true;
    else if (arg === "--summary-only") options.summaryOnly = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--headed-native-hidden") options.headless = false;
    else if (arg === "--simulate-auto-miner") options.simulateAutoMiner = true;
    else if (arg === "--dist-dir") {
      throw new Error("--dist-dir was removed; canonical measurements always use .next, so use --profiling-dist-dir for the isolated React profiling output");
    } else if (["--duration", "--sample-interval", "--base-url", "--profiling-dist-dir"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--duration") options.durationMs = parseDuration(value, "--duration");
      else if (arg === "--sample-interval") options.sampleIntervalMs = parseDuration(value, "--sample-interval");
      else if (arg === "--base-url") options.baseUrl = validateLoopbackBaseUrl(value).href;
      else {
        const resolved = resolveNextDistDir(value, PROJECT_ROOT);
        if (resolved.relativePath === ".next") {
          throw new Error(`${arg} must select an isolated React profiling output, not canonical .next`);
        }
        options.distDir = resolved.resolvedPath;
        options.distDirRelativePath = resolved.relativePath;
      }
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
  if (options.simulateAutoMiner && options.durationMs < MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS) {
    throw new Error("--simulate-auto-miner requires --duration of at least 60s");
  }
  return options;
}

function performanceEvidenceOutputPath(options) {
  return options.artifactsOnly ? ARTIFACTS_ONLY_OUTPUT_PATH : OUTPUT_PATH;
}

function printUsage() {
  console.log([
    "Usage: node scripts/collect-p1-performance-evidence.mjs [options]",
    "",
    "Final schema-4 flow (run from one clean immutable checkout):",
    "  1. $env:NEXT_DIST_DIR=''; $env:LORE_P1_REACT_PROFILING='0'; npm run build:sealed",
    "  2. $env:NEXT_DIST_DIR='.next-p1-profile'; $env:LORE_P1_REACT_PROFILING='1'; node scripts/run-hermetic-build.mjs --seal-react-profiling-provenance",
    "  3. node scripts/collect-p1-performance-evidence.mjs --require-sealed --profiling-dist-dir .next-p1-profile --duration 2h --sample-interval 60s --headed-native-hidden --simulate-auto-miner",
    "  4. node scripts/verify-p1-performance-evidence.mjs --against-current-build --profiling-dist-dir .next-p1-profile",
    "",
    "Canonical route/chunk measurements always come from sealed .next; runtime React timings always come from the explicit isolated profiling output.",
    "A caller-owned --base-url remains diagnostic and cannot satisfy strict final read-only server provenance.",
  ].join("\n"));
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

function buildObservation(outputIdentity, provenanceMarker) {
  return {
    status: "observed",
    collectedAt: new Date().toISOString(),
    buildId: outputIdentity.buildId,
    fileCount: outputIdentity.fileCount,
    totalBytes: outputIdentity.totalBytes,
    contentDigestSha256: outputIdentity.contentDigestSha256,
    digestDomain: outputIdentity.domain,
    digestAlgorithm: outputIdentity.algorithm,
    scope: outputIdentity.scope,
    provenanceMarker,
  };
}

function canonicalReleaseReferenceObservation(verified) {
  return {
    relativePath: `.next/${BUILD_PROVENANCE_FILENAME}`,
    sourceRevisionSha: verified.marker.sourceRevisionSha,
    buildId: verified.outputIdentity.buildId,
    outputContentDigestSha256: verified.outputIdentity.contentDigestSha256,
    outputDigestDomain: verified.outputIdentity.domain,
    markerFileDigestSha256: verified.markerFileDigestSha256,
    markerFileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
  };
}

async function collectBuildIdentity(
  distDir = DEFAULT_DIST_DIR,
  expectedSourceRevisionSha = null,
  buildRole = "canonical-release",
) {
  try {
    const verified = buildRole === REACT_PROFILING_BUILD_ROLE
      ? verifyReactProfilingBuildProvenance({
          projectRoot: PROJECT_ROOT,
          distDir,
          expectedSourceRevisionSha: expectedSourceRevisionSha ?? undefined,
        })
      : verifyBuildProvenance({
          projectRoot: PROJECT_ROOT,
          distDir,
          expectedSourceRevisionSha: expectedSourceRevisionSha ?? undefined,
        });
    const marker = verified.marker;
    return buildObservation(verified.outputIdentity, {
      status: "observed",
      formatVersion: marker.formatVersion,
      ...(buildRole === REACT_PROFILING_BUILD_ROLE
        ? {
            buildRole: marker.buildRole,
            reactProductionProfiling: marker.reactProductionProfiling,
          }
        : {}),
      relativePath: `${path.relative(PROJECT_ROOT, distDir).replaceAll(path.sep, "/")}/${
        buildRole === REACT_PROFILING_BUILD_ROLE
          ? REACT_PROFILING_BUILD_PROVENANCE_FILENAME
          : BUILD_PROVENANCE_FILENAME
      }`,
      sourceRevisionSha: marker.sourceRevisionSha,
      buildId: marker.buildId,
      outputContentDigestSha256: marker.outputIdentity.contentDigestSha256,
      outputDigestDomain: marker.outputIdentity.domain,
      fileDigestSha256: verified.markerFileDigestSha256,
      fileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
      ...(buildRole === REACT_PROFILING_BUILD_ROLE
        ? { canonicalRelease: canonicalReleaseReferenceObservation(verified.canonicalRelease) }
        : {}),
    });
  } catch (error) {
    const outputIdentity = collectBuildOutputIdentity(
      PROJECT_ROOT,
      distDir,
      buildRole === REACT_PROFILING_BUILD_ROLE
        ? { provenanceMarkerFilename: REACT_PROFILING_BUILD_PROVENANCE_FILENAME }
        : undefined,
    );
    return buildObservation(outputIdentity, {
      status: "blocked",
      relativePath: `${path.relative(PROJECT_ROOT, distDir).replaceAll(path.sep, "/")}/${
        buildRole === REACT_PROFILING_BUILD_ROLE
          ? REACT_PROFILING_BUILD_PROVENANCE_FILENAME
          : BUILD_PROVENANCE_FILENAME
      }`,
      blocker: compactError(error instanceof Error ? error.message : error),
    });
  }
}

async function collectDualBuildIdentity(profilingDistDir, expectedSourceRevisionSha = null) {
  const canonicalRelease = await collectBuildIdentity(
    DEFAULT_DIST_DIR,
    expectedSourceRevisionSha,
    "canonical-release",
  );
  const reactProfiling = await collectBuildIdentity(
    profilingDistDir,
    expectedSourceRevisionSha,
    REACT_PROFILING_BUILD_ROLE,
  );
  return { canonicalRelease, reactProfiling };
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

async function collectBuildEvidence(identityAtStart, distDir = DEFAULT_DIST_DIR) {
  if (identityAtStart?.status !== "observed") {
    throw new Error("production build identity must be observed before reading manifests");
  }
  const [buildId, buildIdStat, buildManifest, appPathsManifest, reactLoadableManifest] = await Promise.all([
    fs.readFile(path.join(distDir, "BUILD_ID"), "utf8").then((value) => value.trim()),
    fs.stat(path.join(distDir, "BUILD_ID")),
    fs.readFile(path.join(distDir, "build-manifest.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(distDir, "server", "app-paths-manifest.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(distDir, "react-loadable-manifest.json"), "utf8").then(JSON.parse),
  ]);
  if (!buildId) throw new Error(".next/BUILD_ID is empty");
  if (identityAtStart.buildId !== buildId) throw new Error("production build changed while its identity was collected");

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
    identityAtStart,
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

function sameFileSystemPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathIsInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function requireOrdinaryArtifactDirectory(outputPath, trustedRoot, fileSystem = fs) {
  const resolvedRoot = path.resolve(trustedRoot);
  const rootStats = await fileSystem.lstat(resolvedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("performance artifact root must be an ordinary non-reparse directory");
  }
  const canonicalRoot = await fileSystem.realpath(resolvedRoot);
  if (!sameFileSystemPath(canonicalRoot, resolvedRoot)) {
    throw new Error("performance artifact root must not resolve through a symlink, junction, or reparse point");
  }
  const resolvedOutput = path.resolve(outputPath);
  const resolvedDirectory = path.dirname(resolvedOutput);
  if (!pathIsInside(resolvedRoot, resolvedOutput)) {
    throw new Error("performance artifact output must stay inside the trusted repository root");
  }
  const components = path.relative(resolvedRoot, resolvedDirectory).split(path.sep).filter(Boolean);
  let currentPath = resolvedRoot;
  for (const component of components) {
    currentPath = path.join(currentPath, component);
    try {
      await fileSystem.mkdir(currentPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stats = await fileSystem.lstat(currentPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("performance artifact parent must be an ordinary non-reparse directory");
    }
    const canonicalCurrent = await fileSystem.realpath(currentPath);
    if (!sameFileSystemPath(canonicalCurrent, currentPath)) {
      throw new Error("performance artifact parent must not resolve through a symlink, junction, or reparse point");
    }
  }
  return { resolvedOutput, resolvedDirectory };
}

async function writeJsonAtomic(outputPath, value, fileSystem = fs, trustedRoot = PROJECT_ROOT) {
  const initialContext = await requireOrdinaryArtifactDirectory(outputPath, trustedRoot, fileSystem);
  const { resolvedOutput, resolvedDirectory: outputDirectory } = initialContext;
  const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(resolvedOutput)}.${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await fileSystem.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const finalContext = await requireOrdinaryArtifactDirectory(resolvedOutput, trustedRoot, fileSystem);
    if (!sameFileSystemPath(finalContext.resolvedDirectory, outputDirectory)) {
      throw new Error("performance artifact parent changed during publication");
    }
    try {
      const existingStats = await fileSystem.lstat(resolvedOutput);
      if (!existingStats.isFile() || existingStats.isSymbolicLink()) {
        throw new Error("existing performance artifact must be a regular non-symlink file");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fileSystem.rename(temporaryPath, resolvedOutput);
    await requireOrdinaryArtifactDirectory(resolvedOutput, trustedRoot, fileSystem);
    const publishedStats = await fileSystem.lstat(resolvedOutput);
    if (!publishedStats.isFile() || publishedStats.isSymbolicLink()) {
      throw new Error("published performance artifact is not a regular non-symlink file");
    }
    const readback = await fileSystem.readFile(resolvedOutput);
    if (!readback.equals(serialized)) throw new Error("published performance artifact failed exact readback");
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    try {
      await fileSystem.unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        throw new AggregateError([error, cleanupError], "Performance artifact publication and cleanup failed");
      }
    }
    throw error;
  }
}

function trustedGitEnvironment(baseEnvironment = process.env) {
  const environment = { ...baseEnvironment };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function trustedGitPrefix(projectRoot = PROJECT_ROOT) {
  return ["-c", `safe.directory=${path.resolve(projectRoot)}`, "-C", path.resolve(projectRoot)];
}

function runBoundedCommand(command, args, {
  acceptedExitCodes = [0],
  maxOutputBytes = MAX_GIT_OUTPUT_BYTES,
  environment = process.env,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const capture = (target, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        fail(new Error(`${command} output exceeded the bounded ${maxOutputBytes}-byte limit`));
        return target;
      }
      return `${target}${chunk}`;
    };
    child.stdout.on("data", (chunk) => { stdout = capture(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = capture(stderr, chunk); });
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      if (!acceptedExitCodes.includes(code)) {
        fail(new Error(`${command} exited ${code}: ${compactError(stderr)}`));
        return;
      }
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

async function collectRepositoryEvidence() {
  const gitExecutable = resolveTrustedGitExecutable();
  const gitEnvironment = trustedGitEnvironment();
  const prefix = trustedGitPrefix();
  const commandOptions = { environment: gitEnvironment };
  const rootResult = await runBoundedCommand(gitExecutable, [...prefix, "rev-parse", "--show-toplevel"], commandOptions);
  const headBeforeStatus = await runBoundedCommand(
    gitExecutable,
    [...prefix, "rev-parse", "--verify", "HEAD^{commit}"],
    commandOptions,
  );
  const statusResult = await runBoundedCommand(gitExecutable, [
    ...prefix,
    "-c",
    "color.status=false",
    "-c",
    "core.quotepath=true",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ], commandOptions);
  const headAfterStatus = await runBoundedCommand(
    gitExecutable,
    [...prefix, "rev-parse", "--verify", "HEAD^{commit}"],
    commandOptions,
  );
  const repositoryRoot = path.resolve(rootResult.stdout.trim());
  const expectedRoot = path.resolve(PROJECT_ROOT);
  const rootsMatch = process.platform === "win32"
    ? repositoryRoot.toLowerCase() === expectedRoot.toLowerCase()
    : repositoryRoot === expectedRoot;
  if (!rootsMatch) throw new Error("performance evidence must run at the repository root");
  const headSha = headBeforeStatus.stdout.trim().toLowerCase();
  const finalHeadSha = headAfterStatus.stdout.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error("git HEAD is not a full 40-character commit SHA");
  if (headSha !== finalHeadSha) throw new Error("git HEAD changed while worktree status was collected");
  const observation = {
    status: "observed",
    collectedAt: new Date().toISOString(),
    gitExecutableSource: "trusted-absolute-candidate",
    headSha,
    ...summarizePorcelainStatus(statusResult.stdout),
    statusPathsPersisted: false,
    statusScope: "tracked, staged, unstaged, conflicted, and non-ignored untracked entries",
  };
  if (observation.dirty) return observation;
  const cleanRevision = captureCleanGitRevision(PROJECT_ROOT);
  if (cleanRevision.headSha !== headSha) {
    throw new Error("git HEAD changed before the clean worktree could be revalidated");
  }
  return cleanRepositoryObservation(cleanRevision);
}

function cleanRepositoryObservation(cleanRevision) {
  return {
    status: "observed",
    collectedAt: new Date().toISOString(),
    gitExecutableSource: "trusted-absolute-candidate",
    headSha: cleanRevision.headSha,
    ...summarizePorcelainStatus(""),
    statusPathsPersisted: false,
    statusScope: "tracked, staged, unstaged, conflicted, and non-ignored untracked entries including submodules",
  };
}

function assertRequiredSealedPreflight(repository, canonicalBuild, profilingBuild) {
  const marker = canonicalBuild?.provenanceMarker;
  const valid = repository?.status === "observed"
    && repository.dirty === false
    && /^[a-f0-9]{40}$/.test(repository.headSha ?? "")
    && canonicalBuild?.status === "observed"
    && canonicalBuild.digestDomain === BUILD_OUTPUT_DIGEST_DOMAIN
    && canonicalBuild.digestAlgorithm === "sha256"
    && /^[a-f0-9]{64}$/.test(canonicalBuild.contentDigestSha256 ?? "")
    && marker?.status === "observed"
    && marker.fileDigestDomain === MARKER_FILE_DIGEST_DOMAIN
    && /^[a-f0-9]{64}$/.test(marker.fileDigestSha256 ?? "")
    && marker.sourceRevisionSha === repository.headSha
    && marker.buildId === canonicalBuild.buildId
    && marker.outputDigestDomain === BUILD_OUTPUT_DIGEST_DOMAIN
    && marker.outputContentDigestSha256 === canonicalBuild.contentDigestSha256;
  const dualBinding = createDualBuildBinding({
    repositoryBefore: repository,
    repositoryAfter: repository,
    canonicalBuildBefore: canonicalBuild,
    canonicalBuildAfter: canonicalBuild,
    profilingBuildBefore: profilingBuild,
    profilingBuildAfter: profilingBuild,
  });
  if (!valid || dualBinding.status !== "exact-clean-head-dual-build-sealed") {
    throw new Error("--require-sealed requires canonical .next and isolated React profiling outputs sealed to the same clean exact HEAD before measurements start");
  }
}

async function collectRevisionBoundEvidence({
  collectRepositorySnapshot,
  collectBuildIdentitySnapshot,
  collectMeasurements,
}) {
  const repositoryBefore = await collectRepositorySnapshot("before");
  const buildIdentityAtStart = await collectBuildIdentitySnapshot("start", repositoryBefore);
  const measurements = await collectMeasurements(buildIdentityAtStart, repositoryBefore);
  const buildIdentityAtEnd = await collectBuildIdentitySnapshot("end", repositoryBefore);
  const repositoryAfter = await collectRepositorySnapshot("after");
  return {
    repositoryBefore,
    buildIdentityAtStart,
    measurements,
    buildIdentityAtEnd,
    repositoryAfter,
  };
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

async function startLocalNextServer(distDirRelativePath = ".next") {
  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lore-p1-perf-"));
  const nextBin = path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");
  const minimalEnv = {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${pathToFileURL(NETWORK_GUARD_PATH).href}`,
    LORE_DB_PATH: path.join(tempRoot, "perf.sqlite"),
    NEXT_DIST_DIR: distDirRelativePath,
    ...(distDirRelativePath === ".next"
      ? {}
      : { LORE_P1_REACT_PROFILING: "1" }),
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
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
        await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

async function collectRenderedRouteFirstLoad(baseUrl, routes, distDir = DEFAULT_DIST_DIR) {
  const baseOrigin = new URL(baseUrl).origin;
  const measurementCache = new Map();
  const measureAsset = async (assetPath) => {
    if (!measurementCache.has(assetPath)) {
      measurementCache.set(assetPath, measureBuildAssetFile(distDir, assetPath));
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

function nativeHiddenEvidenceDuration(durationMs, nativeHiddenObserved) {
  return nativeHiddenObserved === true && durationMs >= MIN_NATIVE_HIDDEN_EVIDENCE_MS
    ? NATIVE_TIMER_HIDDEN_PHASE_MS
    : 0;
}

function browserLaunchOptions(executablePath, headless) {
  return {
    executablePath,
    headless,
    ignoreDefaultArgs: [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--enable-precise-memory-info",
      "--metrics-recording-only",
      "--no-first-run",
    ],
  };
}

function normalizeBrowserSwitchMetadata(commandLineArguments) {
  const effectiveSwitchNames = new Set();
  const disabledFeatures = new Set();
  for (const argument of Array.isArray(commandLineArguments) ? commandLineArguments : []) {
    if (typeof argument !== "string" || !argument.startsWith("--")) continue;
    const separatorIndex = argument.indexOf("=");
    const switchName = separatorIndex === -1 ? argument : argument.slice(0, separatorIndex);
    effectiveSwitchNames.add(switchName);
    if (switchName === "--disable-features" && separatorIndex !== -1) {
      for (const feature of argument.slice(separatorIndex + 1).split(",")) {
        const normalized = feature.trim().split(/[<:]/, 1)[0];
        if (normalized) disabledFeatures.add(normalized);
      }
    }
  }
  return {
    effectiveSwitchNames: [...effectiveSwitchNames].sort(),
    disabledFeatures: [...disabledFeatures].sort(),
  };
}

async function collectBrowserRuntimeMetadata(browser) {
  let session;
  try {
    session = await browser.newBrowserCDPSession();
    const version = await session.send("Browser.getVersion");
    let commandLineArguments = [];
    let commandLineObserved = false;
    try {
      commandLineArguments = (await session.send("Browser.getBrowserCommandLine")).arguments ?? [];
      commandLineObserved = Array.isArray(commandLineArguments);
    } catch {
      // Missing command-line evidence must remain fail-closed in the strict model.
    }
    return {
      product: typeof version.product === "string" ? version.product : "",
      version: typeof version.revision === "string" ? version.revision : "",
      commandLineObserved,
      ...normalizeBrowserSwitchMetadata(commandLineArguments),
    };
  } catch {
    return {
      product: "",
      version: "",
      commandLineObserved: false,
      effectiveSwitchNames: [],
      disabledFeatures: [],
    };
  } finally {
    if (session) await session.detach().catch(() => {});
  }
}

function createSimulatedAutoMineOverride(tick, now = Date.now()) {
  return {
    phase: "running",
    progress: `Read-only performance simulation tick ${tick}`,
    runningParams: {
      betStr: "0.10",
      blocks: 5,
      rounds: 50,
    },
    updatedAt: now,
  };
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
    const baseUrl = options.baseUrl ?? (ownedServer = await startLocalNextServer(options.distDirRelativePath)).baseUrl;
    const baseOrigin = new URL(baseUrl).origin;
    const routeFirstLoad = await collectRenderedRouteFirstLoad(baseUrl, routePaths, options.distDir);
    const browserCandidates = [
      process.env.SMOKE_BROWSER_EXECUTABLE,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ].filter(Boolean);
    const executablePath = await findExecutablePath(browserCandidates);
    browser = await chromium.launch(browserLaunchOptions(executablePath, options.headless));
    const browserRuntimeMetadata = await collectBrowserRuntimeMetadata(browser);
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
      const reactRenderers = new Map();
      const reactRendererDetails = new Map();
      const reactComponentProfiles = new Map();
      let reactRootCommitCount = 0;
      let reactObserverInstalled = false;
      let reactProfilingFieldsObserved = false;
      const componentTags = new Set([0, 1, 2, 11, 14, 15, 16]);
      const finiteDuration = (value) => Number.isFinite(value) && value >= 0;
      const componentName = (fiber) => {
        const type = fiber?.type ?? fiber?.elementType;
        if (typeof type === "function") return type.displayName || type.name || "anonymous-component";
        if (type && typeof type === "object") {
          const nested = type.render ?? type.type;
          if (typeof nested === "function") {
            return type.displayName || nested.displayName || nested.name || "anonymous-component";
          }
        }
        return null;
      };
      const directChildDuration = (fiber) => {
        let total = 0;
        let child = fiber?.child ?? null;
        while (child) {
          if (finiteDuration(child.actualDuration)) total += child.actualDuration;
          child = child.sibling;
        }
        return total;
      };
      const collectProfiledComponents = (rootFiber) => {
        const stack = rootFiber ? [rootFiber] : [];
        while (stack.length > 0) {
          const fiber = stack.pop();
          if (Object.prototype.hasOwnProperty.call(fiber, "actualDuration")) {
            reactProfilingFieldsObserved = true;
          }
          if (componentTags.has(fiber.tag) && finiteDuration(fiber.actualDuration) && fiber.actualDuration > 0) {
            const name = componentName(fiber);
            if (name) {
              const current = reactComponentProfiles.get(name) ?? { name, commitCount: 0, actualDurationMs: 0 };
              current.commitCount += 1;
              current.actualDurationMs += Math.max(0, fiber.actualDuration - directChildDuration(fiber));
              reactComponentProfiles.set(name, current);
            }
          }
          if (fiber.sibling) stack.push(fiber.sibling);
          if (fiber.child) stack.push(fiber.child);
        }
      };
      try {
        const hook = {
          supportsFiber: true,
          renderers: reactRenderers,
          inject(renderer) {
            const rendererId = reactRenderers.size + 1;
            reactRenderers.set(rendererId, renderer);
            reactRendererDetails.set(rendererId, {
              bundleType: Number.isInteger(renderer?.bundleType) ? renderer.bundleType : null,
              version: typeof renderer?.version === "string" ? renderer.version.slice(0, 100) : null,
              reconcilerVersion: typeof renderer?.reconcilerVersion === "string"
                ? renderer.reconcilerVersion.slice(0, 100)
                : null,
              rendererPackageName: typeof renderer?.rendererPackageName === "string"
                ? renderer.rendererPackageName.slice(0, 100)
                : null,
            });
            return rendererId;
          },
          onCommitFiberRoot(_rendererId, root) {
            reactRootCommitCount += 1;
            collectProfiledComponents(root?.current);
          },
          onCommitFiberUnmount() {},
          onPostCommitFiberRoot() {},
        };
        Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
          configurable: false,
          enumerable: false,
          writable: false,
          value: hook,
        });
        reactObserverInstalled = true;
      } catch {
        reactObserverInstalled = false;
      }
      window.__p1PerfReactCommits = {
        snapshot() {
          return {
            installed: reactObserverInstalled,
            rendererCount: reactRenderers.size,
            rendererDetails: [...reactRendererDetails.values()],
            rootCommitCount: reactRootCommitCount,
            profilingFieldsObserved: reactProfilingFieldsObserved,
            profiledComponents: [...reactComponentProfiles.values()].map((component) => ({
              ...component,
              actualDurationMs: Math.round(component.actualDurationMs * 100) / 100,
            })),
          };
        },
      };
      const nativeVisibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
      const nativeHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
      let syntheticState = "visible";
      let overrideInstalled = false;
      let auditActive = false;
      let auditHeartbeatId = null;
      let auditHeartbeatLimit = 0;
      let auditTransitionLimit = 0;
      let auditHeartbeatSeq = 0;
      let auditTransitionSeq = 0;
      let auditHeartbeats = [];
      let auditTransitions = [];
      let auditHeartbeatsTruncated = false;
      let auditTransitionsTruncated = false;
      const readNative = (descriptor, fallback) => {
        try {
          return descriptor?.get?.call(document) ?? fallback;
        } catch {
          return fallback;
        }
      };
      const nativeAuditObservation = () => ({
        atMs: performance.now(),
        timeOriginMs: performance.timeOrigin,
        nativeState: readNative(nativeVisibilityDescriptor, "unknown"),
        nativeHidden: readNative(nativeHiddenDescriptor, null),
        exposedState: document.visibilityState,
        exposedHidden: document.hidden,
        ownVisibilityState: Object.prototype.hasOwnProperty.call(document, "visibilityState"),
        ownHidden: Object.prototype.hasOwnProperty.call(document, "hidden"),
      });
      const recordAuditHeartbeat = () => {
        if (!auditActive) return;
        if (auditHeartbeats.length >= auditHeartbeatLimit) {
          auditHeartbeatsTruncated = true;
          return;
        }
        auditHeartbeats.push({ seq: auditHeartbeatSeq, ...nativeAuditObservation() });
        auditHeartbeatSeq += 1;
      };
      const recordAuditTransition = (event) => {
        if (!auditActive) return;
        if (auditTransitions.length >= auditTransitionLimit) {
          auditTransitionsTruncated = true;
          return;
        }
        auditTransitions.push({
          seq: auditTransitionSeq,
          ...nativeAuditObservation(),
          isTrusted: event.isTrusted === true,
        });
        auditTransitionSeq += 1;
      };
      document.addEventListener("visibilitychange", recordAuditTransition, true);
      const installSyntheticOverride = () => {
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
      };
      installSyntheticOverride();
      window.__p1PerfVisibility = {
        set(nextState) {
          syntheticState = nextState === "hidden" ? "hidden" : "visible";
          installSyntheticOverride();
          document.dispatchEvent(new Event("visibilitychange"));
        },
        useNative() {
          try {
            delete document.visibilityState;
            delete document.hidden;
            overrideInstalled = false;
          } catch {
            overrideInstalled = true;
          }
          document.dispatchEvent(new Event("visibilitychange"));
        },
        startNativeAudit({ intervalMs, heartbeatLimit, transitionLimit }) {
          if (auditHeartbeatId !== null) clearInterval(auditHeartbeatId);
          auditActive = false;
          auditHeartbeatLimit = heartbeatLimit;
          auditTransitionLimit = transitionLimit;
          auditHeartbeatSeq = 0;
          auditTransitionSeq = 0;
          auditHeartbeats = [];
          auditTransitions = [];
          auditHeartbeatsTruncated = false;
          auditTransitionsTruncated = false;
          auditActive = true;
          recordAuditHeartbeat();
          auditHeartbeatId = setInterval(recordAuditHeartbeat, intervalMs);
        },
        nativeAuditPhaseSnapshot() {
          return nativeAuditObservation();
        },
        stopNativeAudit() {
          if (auditHeartbeatId !== null) clearInterval(auditHeartbeatId);
          auditHeartbeatId = null;
          auditActive = false;
          return {
            heartbeats: auditHeartbeats.map((heartbeat) => ({ ...heartbeat })),
            transitions: auditTransitions.map((transition) => ({ ...transition })),
            heartbeatsTruncated: auditHeartbeatsTruncated,
            transitionsTruncated: auditTransitionsTruncated,
          };
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
      window.__p1PerfLongTasksTruncated = false;
      window.__p1PerfLongTaskSupported = PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
      if (window.__p1PerfLongTaskSupported) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (window.__p1PerfLongTasks.length >= 10_000) {
              window.__p1PerfLongTasksTruncated = true;
              break;
            }
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
    const reactCommitsAtStart = await page.evaluate(() => window.__p1PerfReactCommits.snapshot());

    const syntheticVisibilityCapability = await page.evaluate(() => window.__p1PerfVisibility.snapshot());
    await page.bringToFront();
    await page.evaluate(() => window.__p1PerfVisibility.useNative());
    await page.waitForTimeout(100);
    let nativeBeforeBackground = await page.evaluate(() => window.__p1PerfVisibility.snapshot());
    let nativeWhileBackgrounded = nativeBeforeBackground;
    let nativeHiddenPhase = null;
    let nativeAudit = null;
    let nativeAuditAnalysis = analyzeNativeBackgroundAudit(null);
    const shouldRunNativeAudit = !options.headless
      && nativeHiddenEvidenceDuration(options.durationMs, true) > 0;
    const backgroundProbe = await context.newPage();
    await backgroundProbe.goto("data:text/html,<title>background-probe</title>");
    if (shouldRunNativeAudit) {
      await page.bringToFront();
      await page.waitForTimeout(100);
      await page.evaluate((config) => window.__p1PerfVisibility.startNativeAudit(config), {
        intervalMs: NATIVE_TIMER_HEARTBEAT_INTERVAL_MS,
        heartbeatLimit: NATIVE_TIMER_HEARTBEAT_LIMIT,
        transitionLimit: NATIVE_TIMER_TRANSITION_LIMIT,
      });

      currentPhase = "native-visible-before";
      const visibleBeforeStartSnapshot = await page.evaluate(() =>
        window.__p1PerfVisibility.nativeAuditPhaseSnapshot());
      const visibleBeforeStartWall = Date.now();
      await page.waitForTimeout(NATIVE_TIMER_VISIBLE_CONTROL_MS);
      const visibleBeforeEndSnapshot = await page.evaluate(() =>
        window.__p1PerfVisibility.nativeAuditPhaseSnapshot());
      const visibleBeforeControllerDurationMs = Date.now() - visibleBeforeStartWall;
      nativeBeforeBackground = await page.evaluate(() => window.__p1PerfVisibility.snapshot());
      const visibleBeforePhase = {
        requestedMs: NATIVE_TIMER_VISIBLE_CONTROL_MS,
        controllerDurationMs: visibleBeforeControllerDurationMs,
        timeOriginMs: visibleBeforeStartSnapshot.timeOriginMs,
        startPerformanceMs: visibleBeforeStartSnapshot.atMs,
        endPerformanceMs: visibleBeforeEndSnapshot.atMs,
        startSnapshot: visibleBeforeStartSnapshot,
        endSnapshot: visibleBeforeEndSnapshot,
      };

      await backgroundProbe.bringToFront();
      await page.waitForTimeout(100);
      const hiddenStartSnapshot = await page.evaluate(() =>
        window.__p1PerfVisibility.nativeAuditPhaseSnapshot());
      const witnessSnapshot = () => ({
        atMs: performance.now(),
        timeOriginMs: performance.timeOrigin,
        nativeState: Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")?.get?.call(document)
          ?? document.visibilityState,
        nativeHidden: Object.getOwnPropertyDescriptor(Document.prototype, "hidden")?.get?.call(document)
          ?? document.hidden,
        exposedState: document.visibilityState,
        exposedHidden: document.hidden,
        ownVisibilityState: Object.prototype.hasOwnProperty.call(document, "visibilityState"),
        ownHidden: Object.prototype.hasOwnProperty.call(document, "hidden"),
      });
      const hiddenWitnessStart = await backgroundProbe.evaluate(witnessSnapshot);
      const nativeHiddenAtStart = hiddenStartSnapshot.nativeState === "hidden"
        && hiddenStartSnapshot.nativeHidden === true;
      currentPhase = "native-hidden";
      const hiddenStartWall = Date.now();
      if (nativeHiddenAtStart) {
        while (Date.now() - hiddenStartWall < NATIVE_TIMER_HIDDEN_PHASE_MS) {
          const remaining = NATIVE_TIMER_HIDDEN_PHASE_MS - (Date.now() - hiddenStartWall);
          await page.waitForTimeout(Math.min(options.sampleIntervalMs, Math.max(1, remaining)));
        }
      }
      const hiddenEndSnapshot = await page.evaluate(() =>
        window.__p1PerfVisibility.nativeAuditPhaseSnapshot());
      const hiddenControllerDurationMs = Date.now() - hiddenStartWall;
      const hiddenWitnessEnd = await backgroundProbe.evaluate(witnessSnapshot);
      nativeWhileBackgrounded = await page.evaluate(() => window.__p1PerfVisibility.snapshot());
      const hiddenPhase = {
        requestedMs: NATIVE_TIMER_HIDDEN_PHASE_MS,
        controllerDurationMs: hiddenControllerDurationMs,
        timeOriginMs: hiddenStartSnapshot.timeOriginMs,
        startPerformanceMs: hiddenStartSnapshot.atMs,
        endPerformanceMs: hiddenEndSnapshot.atMs,
        startSnapshot: hiddenStartSnapshot,
        endSnapshot: hiddenEndSnapshot,
        witnessStart: hiddenWitnessStart,
        witnessEnd: hiddenWitnessEnd,
      };
      if (nativeHiddenAtStart) {
        nativeHiddenPhase = {
          name: "native-hidden",
          visibility: "native-hidden",
          requestedMs: NATIVE_TIMER_HIDDEN_PHASE_MS,
          actualMs: hiddenControllerDurationMs,
          startPerformanceMs: hiddenStartSnapshot.atMs,
          endPerformanceMs: hiddenEndSnapshot.atMs,
        };
      }

      await page.bringToFront();
      await page.waitForTimeout(100);
      currentPhase = "native-visible-after";
      const visibleAfterStartSnapshot = await page.evaluate(() =>
        window.__p1PerfVisibility.nativeAuditPhaseSnapshot());
      const visibleAfterStartWall = Date.now();
      await page.waitForTimeout(NATIVE_TIMER_VISIBLE_CONTROL_MS);
      const visibleAfterEndSnapshot = await page.evaluate(() =>
        window.__p1PerfVisibility.nativeAuditPhaseSnapshot());
      const visibleAfterControllerDurationMs = Date.now() - visibleAfterStartWall;
      const visibleAfterPhase = {
        requestedMs: NATIVE_TIMER_VISIBLE_CONTROL_MS,
        controllerDurationMs: visibleAfterControllerDurationMs,
        timeOriginMs: visibleAfterStartSnapshot.timeOriginMs,
        startPerformanceMs: visibleAfterStartSnapshot.atMs,
        endPerformanceMs: visibleAfterEndSnapshot.atMs,
        startSnapshot: visibleAfterStartSnapshot,
        endSnapshot: visibleAfterEndSnapshot,
      };
      const rawAudit = await page.evaluate(() => window.__p1PerfVisibility.stopNativeAudit());
      const rawAuditLongTasks = await page.evaluate(({ startMs, endMs, limit }) => {
        const matching = window.__p1PerfLongTasks
          .filter((entry) => entry.startTime < endMs && entry.startTime + entry.duration > startMs)
          .sort((left, right) => left.startTime - right.startTime);
        return {
          longTasks: matching.slice(0, limit).map((entry) => ({
            startTime: entry.startTime,
            duration: entry.duration,
          })),
          longTasksTruncated: window.__p1PerfLongTasksTruncated === true || matching.length > limit,
        };
      }, {
        startMs: visibleBeforePhase.startPerformanceMs,
        endMs: visibleAfterPhase.endPerformanceMs,
        limit: NATIVE_TIMER_LONG_TASK_LIMIT,
      });
      nativeAudit = {
        clock: "performance.now",
        heartbeatIntervalMs: NATIVE_TIMER_HEARTBEAT_INTERVAL_MS,
        heartbeatLimit: NATIVE_TIMER_HEARTBEAT_LIMIT,
        transitionLimit: NATIVE_TIMER_TRANSITION_LIMIT,
        longTaskLimit: NATIVE_TIMER_LONG_TASK_LIMIT,
        browser: browserRuntimeMetadata,
        phases: {
          "native-visible-before": visibleBeforePhase,
          "native-hidden": hiddenPhase,
          "native-visible-after": visibleAfterPhase,
        },
        ...rawAudit,
        ...rawAuditLongTasks,
      };
      nativeAuditAnalysis = analyzeNativeBackgroundAudit(nativeAudit);
    } else {
      await backgroundProbe.bringToFront();
      await page.waitForTimeout(100);
      nativeWhileBackgrounded = await page.evaluate(() => window.__p1PerfVisibility.snapshot());
    }
    await backgroundProbe.close();
    await page.bringToFront();
    await page.evaluate(() => window.__p1PerfVisibility.set("visible"));
    currentPhase = "setup";

    let simulatedAutoMinerPhase = null;
    let simulationTickCount = 0;
    let simulationUiStateObserved = false;
    if (options.simulateAutoMiner) {
      currentPhase = "simulated-auto-miner";
      const phaseStartWall = Date.now();
      simulatedAutoMinerPhase = {
        name: "simulated-auto-miner",
        visibility: "visible",
        requestedMs: MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS,
        startPerformanceMs: await page.evaluate(() => performance.now()),
      };
      const applySimulationTick = async () => {
        simulationTickCount += 1;
        const override = createSimulatedAutoMineOverride(simulationTickCount);
        await page.evaluate(({ eventName, storageKey, value }) => {
          window.localStorage.setItem(storageKey, JSON.stringify(value));
          window.dispatchEvent(new CustomEvent(eventName));
        }, {
          eventName: AUTO_MINE_DEBUG_OVERRIDE_EVENT,
          storageKey: AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY,
          value: override,
        });
      };
      await applySimulationTick();
      try {
        const action = page.locator('[data-testid="auto-miner-action"]').first();
        await action.waitFor({ state: "visible", timeout: 5_000 });
        simulationUiStateObserved = (await action.innerText()).trim() === "STOP BOT";
      } catch {
        simulationUiStateObserved = false;
      }
      while (Date.now() - phaseStartWall < MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS) {
        const remaining = MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS - (Date.now() - phaseStartWall);
        await page.waitForTimeout(Math.min(1_000, Math.max(1, remaining)));
        if (Date.now() - phaseStartWall < MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS) {
          await applySimulationTick();
        }
      }
      await page.evaluate(({ eventName, storageKey }) => {
        window.localStorage.removeItem(storageKey);
        window.dispatchEvent(new CustomEvent(eventName));
      }, {
        eventName: AUTO_MINE_DEBUG_OVERRIDE_EVENT,
        storageKey: AUTO_MINE_DEBUG_OVERRIDE_STORAGE_KEY,
      });
      simulatedAutoMinerPhase.actualMs = Date.now() - phaseStartWall;
      simulatedAutoMinerPhase.endPerformanceMs = await page.evaluate(() => performance.now());
      currentPhase = "setup";
    }

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
      reactCommits: window.__p1PerfReactCommits.snapshot(),
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
    const preExperimentPhases = [nativeHiddenPhase, simulatedAutoMinerPhase].filter(Boolean);
    const firstTimedPhaseStart = preExperimentPhases[0]?.startPerformanceMs ?? experimentStartPerfNow;
    const initialLoadLongTasks = allLongTasks.filter(
      (entry) => entry.startTime < firstTimedPhaseStart,
    );
    const timedPhases = [...preExperimentPhases, ...phases];
    const longTasksByPhase = Object.fromEntries(timedPhases.map((phase) => [
      phase.name,
      summarizeDurations(
        allLongTasks
          .filter((entry) => entry.startTime >= phase.startPerformanceMs && entry.startTime < phase.endPerformanceMs)
          .map((entry) => entry.duration),
      ),
    ]));
    longTasksByPhase["native-hidden"] ??= summarizeDurations([]);
    longTasksByPhase["simulated-auto-miner"] ??= summarizeDurations([]);
    const finiteHeapSamples = samples.filter((sample) => Number.isFinite(sample.jsHeapUsedBytes));
    const initialHeap = finiteHeapSamples[0]?.jsHeapUsedBytes ?? null;
    const finalHeap = finiteHeapSamples.at(-1)?.jsHeapUsedBytes ?? null;
    const maxHeap = finiteHeapSamples.length > 0 ? Math.max(...finiteHeapSamples.map((sample) => sample.jsHeapUsedBytes)) : null;
    const initialDom = samples[0]?.domNodes ?? null;
    const finalDom = samples.at(-1)?.domNodes ?? null;
    const actualDurationMs = experimentEndedAt - experimentStartedAt;
    const startComponentProfiles = new Map(
      (reactCommitsAtStart.profiledComponents ?? []).map((component) => [component.name, component]),
    );
    const experimentProfiledComponents = (finalPageMetrics.reactCommits.profiledComponents ?? [])
      .map((component) => {
        const start = startComponentProfiles.get(component.name);
        return {
          name: component.name,
          commitCount: Math.max(0, component.commitCount - (start?.commitCount ?? 0)),
          actualDurationMs: Math.max(
            0,
            Math.round((component.actualDurationMs - (start?.actualDurationMs ?? 0)) * 100) / 100,
          ),
        };
      })
      .filter((component) => component.commitCount > 0 || component.actualDurationMs > 0)
      .sort((left, right) => right.actualDurationMs - left.actualDurationMs || left.name.localeCompare(right.name));
    const nativeHiddenObserved = nativeWhileBackgrounded.nativeState === "hidden" || nativeWhileBackgrounded.nativeHidden === true;
    const nativeHiddenApiRequestCount = [...(phaseApiCounts.get("native-hidden") ?? new Map()).values()]
      .reduce((total, count) => total + count, 0);
    const runtimeApplicability = createRuntimeApplicability({
      requestedDurationMs: options.durationMs,
      actualDurationMs,
      memorySampleCount: samples.length,
      finiteHeapSampleCount: finiteHeapSamples.length,
      sampleIntervalMs: options.sampleIntervalMs,
      firstFiniteHeapElapsedMs: finiteHeapSamples[0]?.elapsedMs ?? null,
      lastFiniteHeapElapsedMs: finiteHeapSamples.at(-1)?.elapsedMs ?? null,
      syntheticVisibilityOverrideInstalled: syntheticVisibilityCapability.overrideInstalled,
      nativeHiddenObserved,
      nativeHiddenMeasurementDurationMs: nativeHiddenPhase?.actualMs ?? 0,
      nativeHiddenContinuityMeasured: nativeAuditAnalysis.continuityMeasured,
      browserTimerThrottlingMeasured: nativeAuditAnalysis.timerThrottlingMeasured,
      nativeHiddenApiRequestCount,
      reactCommitObserverInstalled: finalPageMetrics.reactCommits.installed,
      reactRendererCount: finalPageMetrics.reactCommits.rendererCount,
      reactExperimentCommitCount: Math.max(
        0,
        finalPageMetrics.reactCommits.rootCommitCount - reactCommitsAtStart.rootCommitCount,
      ),
      reactProfilingFieldsObserved: finalPageMetrics.reactCommits.profilingFieldsObserved,
      reactProfiledComponents: experimentProfiledComponents,
      reactRendererDetails: finalPageMetrics.reactCommits.rendererDetails,
      simulatedAutoMinerMeasurementDurationMs: simulatedAutoMinerPhase?.actualMs ?? 0,
      simulatedAutoMinerTickCount: simulationTickCount,
      simulatedAutoMinerUiStateObserved: simulationUiStateObserved,
      blockedApiWriteRequestCount,
    });
    const blockers = [...runtimeApplicability.blockers];
    if (!finalPageMetrics.longTaskSupported) blockers.push("Long Task API is unavailable in this browser runtime.");
    if (finiteHeapSamples.length === 0) blockers.push("Chromium performance.memory is unavailable.");

    return {
      status: blockers.length === 0 ? "measured" : "measured-partial",
      target: { kind: "local-loopback", autoStarted: Boolean(ownedServer), origin: baseOrigin },
      workload: runtimeApplicability.workload,
      safety: {
        headlessTemporaryProfile: options.headless,
        temporaryProfile: true,
        dedicatedProfile: true,
        browserMode: options.headless ? "headless" : "headed-native-hidden",
        externalBrowserRequestsBlocked: true,
        serverExternalNetworkGuard: ownedServer ? "global fetch plus http/https/net/tls loopback-only preload" : "caller-owned server; not asserted",
        apiWritesFulfilled: false,
        blockedApiWriteRequestCount,
      },
      requestedDurationMs: options.durationMs,
      actualDurationMs,
      requestedDurationCompleted: runtimeApplicability.duration.requestedDurationCompleted,
      idleTwoHourDurationCompleted: runtimeApplicability.duration.idleTwoHourDurationCompleted,
      idleTwoHourMemoryObservationCompleted: runtimeApplicability.duration.idleTwoHourMemoryObservationCompleted,
      autoMinerTwoHourDurationCompleted: runtimeApplicability.duration.autoMinerTwoHourDurationCompleted,
      autoMinerTwoHourMemoryObservationCompleted: runtimeApplicability.duration.autoMinerTwoHourMemoryObservationCompleted,
      twoHourSoakCompleted: runtimeApplicability.duration.fullTwoHourSoakCompleted,
      durationApplicability: runtimeApplicability.duration.applicability,
      memoryCoverage: runtimeApplicability.duration.memoryCoverage,
      sampleIntervalMs: options.sampleIntervalMs,
      navigation: { wallMsToSettledStart: experimentStartedAt - navigationStartedAt, ...finalPageMetrics.navigation },
      routeFirstLoad,
      visibility: {
        syntheticCapability: syntheticVisibilityCapability,
        nativeBeforeBackground,
        nativeWhileBackgrounded,
        nativeHiddenObserved,
        nativeAudit,
        timerThrottling: nativeAuditAnalysis.timerThrottling,
        coverage: runtimeApplicability.visibility,
        measurementMode: nativeHiddenPhase
          ? "continuous raw native visibility/timer audit plus deterministic synthetic visibility phases"
          : "deterministic synthetic visibility phases plus an unqualified native background probe",
        caveat: nativeHiddenPhase
          ? "Native hidden continuity and timer throttling pass only when the raw headed audit satisfies schema 4."
          : "The browser did not sustain a qualifying native hidden state; no native hidden polling conclusion is claimed.",
      },
      polling: {
        phases: Object.fromEntries(timedPhases.map((phase) => [
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
      reactRerenders: {
        ...runtimeApplicability.reactRerenders,
        rootCommitCountAtStart: reactCommitsAtStart.rootCommitCount,
        rootCommitCountAtEnd: finalPageMetrics.reactCommits.rootCommitCount,
        rendererDetails: finalPageMetrics.reactCommits.rendererDetails,
      },
      autoMiner: runtimeApplicability.autoMiner,
      blockers: [...new Set(blockers)],
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
    provenance: report.provenance,
    profilingBuild: report.profilingBuild,
    build: {
      status: report.build.status,
      buildId: report.build.buildId,
      outputDirectory: report.build.outputDirectory,
      buildCompletedAt: report.build.buildCompletedAt,
      identityAtStart: report.build.identityAtStart,
      identityAtEnd: report.build.identityAtEnd,
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
            idleTwoHourDurationCompleted: report.runtime.idleTwoHourDurationCompleted,
            idleTwoHourMemoryObservationCompleted: report.runtime.idleTwoHourMemoryObservationCompleted,
            autoMinerTwoHourDurationCompleted: report.runtime.autoMinerTwoHourDurationCompleted,
            autoMinerTwoHourMemoryObservationCompleted: report.runtime.autoMinerTwoHourMemoryObservationCompleted,
            twoHourSoakCompleted: report.runtime.twoHourSoakCompleted,
            durationApplicability: report.runtime.durationApplicability,
            memoryCoverage: report.runtime.memoryCoverage,
            workload: report.runtime.workload,
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
            reactRerenders: report.runtime.reactRerenders,
            autoMiner: report.runtime.autoMiner,
            blockers: report.runtime.blockers,
          }
        : null,
  };
}

function derivePerformanceReportStatus({ artifactsOnly, build, runtime, binding, derivation, dualBinding }) {
  if (artifactsOnly) return build?.status === "measured" ? "artifact-only" : "partial";
  return build?.status === "measured"
    && runtime?.status === "measured"
    && binding?.releaseCandidateEligible === true
    && derivation?.status === "sealed"
    && dualBinding?.status === "exact-clean-head-dual-build-sealed"
    ? "complete"
    : "partial";
}

function finalizePerformanceReportStatus(report, artifactsOnly) {
  const derived = derivePerformanceReportStatus({
    artifactsOnly,
    build: report.build,
    runtime: report.runtime,
    binding: report.provenance?.artifactRevisionBinding,
    derivation: report.provenance?.buildDerivation,
    dualBinding: report.provenance?.dualBuildBinding,
  });
  if (derived !== "complete") return derived;
  report.status = "complete";
  return assessStrictPerformanceEvidence(report).status === "pass" ? "complete" : "partial";
}

async function runSelfTest() {
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("2h"), MAX_DURATION_MS);
  assert.throws(() => parseDuration("02h"), /canonical/);
  assert.throws(() => parseDuration("2 hours"), /canonical/);
  assert.equal(parseArgs(["--artifacts-only", "--require-sealed"]).requireSealed, true);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--headed-native-hidden"]).headless, false);
  assert.equal(performanceEvidenceOutputPath({ artifactsOnly: false }), OUTPUT_PATH);
  assert.equal(performanceEvidenceOutputPath({ artifactsOnly: true }), ARTIFACTS_ONLY_OUTPUT_PATH);
  assert.equal(parseArgs(["--duration", "60s", "--simulate-auto-miner"]).simulateAutoMiner, true);
  assert.throws(() => parseArgs(["--dist-dir", ".next-p1-profile"]), /use --profiling-dist-dir/);
  assert.equal(parseArgs(["--profiling-dist-dir", ".next-p1-profile"]).distDirRelativePath, ".next-p1-profile");
  assert.throws(() => parseArgs(["--profiling-dist-dir", ".next"]), /isolated React profiling/);
  assert.throws(() => parseArgs(["--profiling-dist-dir", "../outside"]), /NEXT_DIST_DIR/);
  assert.throws(
    () => parseArgs(["--duration", "30s", "--simulate-auto-miner"]),
    /requires --duration of at least 60s/,
  );
  assert.equal(validateLoopbackBaseUrl("http://127.0.0.1:3000/path").href, "http://127.0.0.1:3000/");
  assert.throws(() => validateLoopbackBaseUrl("https://example.com"), /local http/);
  assert.equal(routeFromManifestKey("/page"), "/");
  assert.equal(routeFromManifestKey("/admin/page"), "/admin");
  const phases = allocatePhases(9_001);
  assert.equal(phases.reduce((sum, phase) => sum + phase.requestedMs, 0), 9_001);
  assert.equal(nativeHiddenEvidenceDuration(30_000, true), 0);
  assert.equal(nativeHiddenEvidenceDuration(TWO_HOURS_MS, false), 0);
  assert.equal(nativeHiddenEvidenceDuration(TWO_HOURS_MS, true), NATIVE_TIMER_HIDDEN_PHASE_MS);
  const headedLaunch = browserLaunchOptions("fixture-browser", false);
  assert.equal(headedLaunch.executablePath, "fixture-browser");
  assert.equal(headedLaunch.headless, false);
  assert.deepEqual(headedLaunch.ignoreDefaultArgs, [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ]);
  assert.deepEqual(normalizeBrowserSwitchMetadata([
    "fixture-browser.exe",
    "--enable-automation",
    "--disable-features=FixtureA,FixtureB",
    "--enable-automation=1",
  ]), {
    effectiveSwitchNames: ["--disable-features", "--enable-automation"],
    disabledFeatures: ["FixtureA", "FixtureB"],
  });
  assert.deepEqual(normalizeBrowserSwitchMetadata(null), {
    effectiveSwitchNames: [],
    disabledFeatures: [],
  });
  assert.deepEqual(createSimulatedAutoMineOverride(3, 1234), {
    phase: "running",
    progress: "Read-only performance simulation tick 3",
    runningParams: { betStr: "0.10", blocks: 5, rounds: 50 },
    updatedAt: 1234,
  });
  assert.equal(derivePerformanceReportStatus({
    artifactsOnly: true,
    build: { status: "measured" },
  }), "artifact-only");
  assert.equal(derivePerformanceReportStatus({
    artifactsOnly: false,
    build: { status: "measured" },
    runtime: { status: "measured" },
    binding: { releaseCandidateEligible: true },
    derivation: { status: "sealed" },
    dualBinding: { status: "exact-clean-head-dual-build-sealed" },
  }), "complete");
  assert.equal(derivePerformanceReportStatus({
    artifactsOnly: false,
    build: { status: "measured" },
    runtime: { status: "measured-partial" },
    binding: { releaseCandidateEligible: true },
    derivation: { status: "sealed" },
  }), "partial");
  const structurallyIncompleteReport = {
    schemaVersion: 4,
    status: "partial",
    provenance: {
      artifactRevisionBinding: { releaseCandidateEligible: true },
      buildDerivation: { status: "sealed" },
      dualBuildBinding: { status: "exact-clean-head-dual-build-sealed" },
    },
    build: { status: "measured" },
    runtime: { status: "measured" },
  };
  assert.equal(finalizePerformanceReportStatus(structurallyIncompleteReport, false), "partial");
  const parsed = parseClientReferenceManifest(
    'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/page"]={"clientModules":{}};',
    "fixture",
  );
  assert.deepEqual(parsed, { routeKey: "/page", payload: { clientModules: {} } });
  const cleanStatus = summarizePorcelainStatus("");
  assert.equal(cleanStatus.dirty, false);
  const dirtyStatus = summarizePorcelainStatus(" M tracked.mjs\n?? untracked.mjs\nUU conflicted.mjs\n");
  assert.equal(dirtyStatus.dirty, true);
  assert.equal(dirtyStatus.trackedEntryCount, 2);
  assert.equal(dirtyStatus.untrackedEntryCount, 1);
  assert.equal(dirtyStatus.conflictedEntryCount, 1);
  assert.match(dirtyStatus.statusDigestSha256, /^[a-f0-9]{64}$/);
  const poisonedGitEnvironment = trustedGitEnvironment({
    PATH: "fixture",
    GIT_DIR: "poison",
    git_work_tree: "poison",
    GIT_CONFIG_COUNT: "1",
  });
  assert.equal(poisonedGitEnvironment.PATH, "fixture");
  assert.equal("GIT_DIR" in poisonedGitEnvironment, false);
  assert.equal("git_work_tree" in poisonedGitEnvironment, false);
  assert.equal("GIT_CONFIG_COUNT" in poisonedGitEnvironment, false);
  assert.deepEqual(trustedGitPrefix("fixture-root"), [
    "-c",
    `safe.directory=${path.resolve("fixture-root")}`,
    "-C",
    path.resolve("fixture-root"),
  ]);
  assert.deepEqual(parseNextBuildArguments(["--seal-react-profiling-provenance"]), {
    sealProvenance: false,
    sealReactProfilingProvenance: true,
    nextArgs: [],
  });
  assert.throws(
    () => parseNextBuildArguments(["--seal-provenance", "--seal-react-profiling-provenance"]),
    /mutually exclusive/,
  );
  const provenanceFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lore-p1-dual-provenance-"));
  try {
    const gitExecutable = resolveTrustedGitExecutable();
    const gitEnvironment = trustedGitEnvironment();
    const runFixtureGit = (args) => runBoundedCommand(gitExecutable, args, {
      environment: gitEnvironment,
      timeoutMs: 30_000,
    });
    await runFixtureGit(["init", "--initial-branch=main", provenanceFixtureRoot]);
    await fs.writeFile(
      path.join(provenanceFixtureRoot, ".gitignore"),
      "/.next/\n/.next-*/\n",
      "utf8",
    );
    await fs.writeFile(path.join(provenanceFixtureRoot, "source.txt"), "fixture source\n", "utf8");
    await runFixtureGit(["-C", provenanceFixtureRoot, "add", "--all"]);
    await runFixtureGit([
      "-C",
      provenanceFixtureRoot,
      "-c",
      "user.name=LORE Test",
      "-c",
      "user.email=lore-test@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "fixture",
    ]);

    const canonicalDistDir = path.join(provenanceFixtureRoot, ".next");
    const profilingDistDir = path.join(provenanceFixtureRoot, ".next-p1-profile");
    const writeFakeBuild = async (distDir, buildId, payload) => {
      await fs.mkdir(path.join(distDir, "static"), { recursive: true });
      await fs.writeFile(path.join(distDir, "BUILD_ID"), `${buildId}\n`, "utf8");
      await fs.writeFile(path.join(distDir, "static", "app.js"), payload, "utf8");
    };
    const canonicalSession = prepareBuildProvenance({
      projectRoot: provenanceFixtureRoot,
      distDir: canonicalDistDir,
      seal: true,
    });
    await writeFakeBuild(canonicalDistDir, "canonical-fixture", "canonical bytes\n");
    const canonicalSealed = sealBuildProvenance(canonicalSession);
    assert.equal(canonicalSealed.status, "sealed");
    const canonicalForeignMarker = path.join(
      canonicalDistDir,
      REACT_PROFILING_BUILD_PROVENANCE_FILENAME,
    );
    await fs.writeFile(canonicalForeignMarker, "{\"foreign\":true}\n", "utf8");
    assert.throws(
      () => verifyBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: canonicalDistDir,
      }),
      /output identity/,
    );
    await fs.unlink(canonicalForeignMarker);
    assert.throws(
      () => prepareReactProfilingBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: canonicalDistDir,
        environment: { ...process.env, LORE_P1_REACT_PROFILING: "1" },
      }),
      /isolated .next-<name>/,
    );
    assert.throws(
      () => prepareReactProfilingBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: profilingDistDir,
        environment: { ...process.env, LORE_P1_REACT_PROFILING: "0" },
      }),
      /LORE_P1_REACT_PROFILING=1/,
    );
    const reparseTarget = path.join(provenanceFixtureRoot, ".next-reparse-target");
    const reparseOutput = path.join(provenanceFixtureRoot, ".next-p1-reparse");
    await fs.mkdir(reparseTarget);
    await fs.symlink(reparseTarget, reparseOutput, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => prepareReactProfilingBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: reparseOutput,
        environment: { ...process.env, LORE_P1_REACT_PROFILING: "1" },
      }),
      /reparse|symbolic link/i,
    );
    await fs.unlink(reparseOutput);
    assert.throws(
      () => runHermeticBuild({
        projectRoot: provenanceFixtureRoot,
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        buildProvenance: {
          distDir: profilingDistDir,
          seal: false,
          role: "unsupported-fixture-role",
        },
      }),
      /Unsupported build provenance role/,
    );
    const profilingEnvironment = { ...process.env, LORE_P1_REACT_PROFILING: "1" };
    const profilingSession = prepareReactProfilingBuildProvenance({
      projectRoot: provenanceFixtureRoot,
      distDir: profilingDistDir,
      environment: profilingEnvironment,
    });
    await writeFakeBuild(profilingDistDir, "profiling-fixture", "profiling bytes\n");
    const profilingSealed = sealReactProfilingBuildProvenance(profilingSession);
    assert.equal(profilingSealed.buildRole, REACT_PROFILING_BUILD_ROLE);
    const verifiedProfiling = verifyReactProfilingBuildProvenance({
      projectRoot: provenanceFixtureRoot,
      distDir: profilingDistDir,
      expectedSourceRevisionSha: canonicalSealed.marker.sourceRevisionSha,
      expectedCanonicalRelease: canonicalSealed,
    });
    assert.equal(
      verifiedProfiling.marker.canonicalRelease.markerFileDigestSha256,
      canonicalSealed.markerFileDigestSha256,
    );
    await fs.writeFile(
      path.join(profilingDistDir, "static", "app.js"),
      "mutated profiling bytes\n",
      "utf8",
    );
    assert.throws(
      () => verifyReactProfilingBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: profilingDistDir,
      }),
      /output identity/,
    );
    await fs.writeFile(path.join(profilingDistDir, "static", "app.js"), "profiling bytes\n", "utf8");
    await fs.writeFile(path.join(canonicalDistDir, "static", "app.js"), "canonical drift\n", "utf8");
    assert.throws(
      () => verifyReactProfilingBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: profilingDistDir,
      }),
      /output identity/,
    );
    await fs.writeFile(path.join(canonicalDistDir, "static", "app.js"), "canonical bytes\n", "utf8");
    assert.equal(
      verifyReactProfilingBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: profilingDistDir,
      }).marker.buildRole,
      REACT_PROFILING_BUILD_ROLE,
    );
    const foreignMarkerPath = path.join(profilingDistDir, BUILD_PROVENANCE_FILENAME);
    await fs.writeFile(foreignMarkerPath, "{\"foreign\":true}\n", "utf8");
    assert.throws(
      () => verifyReactProfilingBuildProvenance({
        projectRoot: provenanceFixtureRoot,
        distDir: profilingDistDir,
      }),
      /output identity/,
    );
    const invalidatedProfiling = prepareReactProfilingBuildProvenance({
      projectRoot: provenanceFixtureRoot,
      distDir: profilingDistDir,
      seal: false,
    });
    assert.equal(invalidatedProfiling.invalidated.removed, true);
    assert.equal(invalidatedProfiling.invalidated.foreignMarkerRemoved, true);
    await assert.rejects(fs.access(foreignMarkerPath));
    const failedChild = runHermeticBuild({
      projectRoot: provenanceFixtureRoot,
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      env: profilingEnvironment,
      stdio: "pipe",
      encoding: "utf8",
      timeoutMs: 30_000,
      buildProvenance: {
        distDir: profilingDistDir,
        seal: true,
        role: REACT_PROFILING_BUILD_ROLE,
      },
    });
    assert.equal(failedChild.result.status, 7);
    await assert.rejects(fs.access(path.join(
      profilingDistDir,
      REACT_PROFILING_BUILD_PROVENANCE_FILENAME,
    )));
    assert.throws(
      () => runHermeticBuild({
        projectRoot: provenanceFixtureRoot,
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60_000)"],
        env: profilingEnvironment,
        stdio: "pipe",
        encoding: "utf8",
        timeoutMs: 250,
        buildProvenance: {
          distDir: profilingDistDir,
          seal: true,
          role: REACT_PROFILING_BUILD_ROLE,
        },
      }),
      /ETIMEDOUT|timed out/i,
    );
    await assert.rejects(fs.access(path.join(
      profilingDistDir,
      REACT_PROFILING_BUILD_PROVENANCE_FILENAME,
    )));
  } finally {
    await fs.rm(provenanceFixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  const headSha = "a".repeat(40);
  const buildIdentity = {
    status: "observed",
    buildId: "fixture-build",
    contentDigestSha256: "b".repeat(64),
    digestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    digestAlgorithm: "sha256",
    fileCount: 10,
    totalBytes: 100_000,
    provenanceMarker: {
      status: "blocked",
      relativePath: ".next/lore-build-provenance.json",
      blocker: "fixture intentionally unsealed",
    },
  };
  const cleanRepository = { status: "observed", headSha, ...cleanStatus };
  const cleanBinding = createArtifactRevisionBinding({
    repositoryBefore: cleanRepository,
    repositoryAfter: { ...cleanRepository },
    buildBefore: buildIdentity,
    buildAfter: { ...buildIdentity },
  });
  assert.equal(cleanBinding.status, "exact-clean-head-build-observed");
  assert.equal(cleanBinding.exactCleanRevision, true);
  assert.equal(cleanBinding.releaseCandidateEligible, false);
  assert.equal(cleanBinding.buildDerivationSealed, false);
  const dirtyRepository = { status: "observed", headSha, ...dirtyStatus };
  const dirtyBinding = createArtifactRevisionBinding({
    repositoryBefore: dirtyRepository,
    repositoryAfter: { ...dirtyRepository },
    buildBefore: buildIdentity,
    buildAfter: { ...buildIdentity },
  });
  assert.equal(dirtyBinding.status, "head-plus-dirty-worktree");
  assert.equal(dirtyBinding.exactCleanRevision, false);
  const changedBinding = createArtifactRevisionBinding({
    repositoryBefore: cleanRepository,
    repositoryAfter: { ...cleanRepository, headSha: "c".repeat(40) },
    buildBefore: buildIdentity,
    buildAfter: { ...buildIdentity },
  });
  assert.equal(changedBinding.status, "changed-during-collection");
  assert.equal(changedBinding.repositoryMarkersStableDuringCollection, false);
  const buildChangedBinding = createArtifactRevisionBinding({
    repositoryBefore: cleanRepository,
    repositoryAfter: { ...cleanRepository },
    buildBefore: buildIdentity,
    buildAfter: { ...buildIdentity, contentDigestSha256: "d".repeat(64) },
  });
  assert.equal(buildChangedBinding.status, "changed-during-collection");
  assert.equal(buildChangedBinding.buildStableDuringCollection, false);
  assert.equal(buildChangedBinding.releaseCandidateEligible, false);
  const unavailableBinding = createArtifactRevisionBinding({
    repositoryBefore: { status: "blocked" },
    repositoryAfter: { status: "blocked" },
    buildBefore: buildIdentity,
    buildAfter: { ...buildIdentity },
  });
  assert.equal(unavailableBinding.status, "unbound");
  assert.equal(unavailableBinding.releaseCandidateEligible, false);
  const buildMutationOrder = [];
  let buildIdentityDuringCollection = { ...buildIdentity };
  const buildMutationEvidence = await collectRevisionBoundEvidence({
    collectRepositorySnapshot: async (phase) => {
      buildMutationOrder.push(`repository-${phase}`);
      return { ...cleanRepository };
    },
    collectBuildIdentitySnapshot: async (phase) => {
      buildMutationOrder.push(`build-${phase}`);
      return { ...buildIdentityDuringCollection };
    },
    collectMeasurements: async () => {
      buildMutationOrder.push("manifest-measurements");
      buildIdentityDuringCollection = { ...buildIdentity, contentDigestSha256: "d".repeat(64) };
      return { status: "fixture" };
    },
  });
  assert.deepEqual(buildMutationOrder, [
    "repository-before",
    "build-start",
    "manifest-measurements",
    "build-end",
    "repository-after",
  ]);
  const manifestMutationBinding = createArtifactRevisionBinding({
    repositoryBefore: buildMutationEvidence.repositoryBefore,
    repositoryAfter: buildMutationEvidence.repositoryAfter,
    buildBefore: buildMutationEvidence.buildIdentityAtStart,
    buildAfter: buildMutationEvidence.buildIdentityAtEnd,
  });
  assert.equal(manifestMutationBinding.status, "changed-during-collection");
  assert.equal(manifestMutationBinding.buildStableDuringCollection, false);
  assert.equal(manifestMutationBinding.releaseCandidateEligible, false);
  const finalBuildHashOrder = [];
  let repositoryDuringFinalBuildHash = { ...cleanRepository };
  const repositoryMutationEvidence = await collectRevisionBoundEvidence({
    collectRepositorySnapshot: async (phase) => {
      finalBuildHashOrder.push(`repository-${phase}`);
      return { ...repositoryDuringFinalBuildHash };
    },
    collectBuildIdentitySnapshot: async (phase) => {
      finalBuildHashOrder.push(`build-${phase}`);
      if (phase === "end") repositoryDuringFinalBuildHash = { ...dirtyRepository };
      return { ...buildIdentity };
    },
    collectMeasurements: async () => {
      finalBuildHashOrder.push("manifest-measurements");
      return { status: "fixture" };
    },
  });
  assert.deepEqual(finalBuildHashOrder, [
    "repository-before",
    "build-start",
    "manifest-measurements",
    "build-end",
    "repository-after",
  ]);
  const finalBuildHashMutationBinding = createArtifactRevisionBinding({
    repositoryBefore: repositoryMutationEvidence.repositoryBefore,
    repositoryAfter: repositoryMutationEvidence.repositoryAfter,
    buildBefore: repositoryMutationEvidence.buildIdentityAtStart,
    buildAfter: repositoryMutationEvidence.buildIdentityAtEnd,
  });
  assert.equal(finalBuildHashMutationBinding.status, "changed-during-collection");
  assert.equal(finalBuildHashMutationBinding.repositoryMarkersStableDuringCollection, false);
  assert.equal(finalBuildHashMutationBinding.releaseCandidateEligible, false);
  const marker = {
    status: "observed",
    formatVersion: 1,
    relativePath: ".next/lore-build-provenance.json",
    sourceRevisionSha: headSha,
    buildId: buildIdentity.buildId,
    outputContentDigestSha256: buildIdentity.contentDigestSha256,
    outputDigestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    fileDigestSha256: "e".repeat(64),
    fileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
  };
  const sealedBuildIdentity = { ...buildIdentity, provenanceMarker: marker };
  const canonicalRelease = {
    relativePath: marker.relativePath,
    sourceRevisionSha: marker.sourceRevisionSha,
    buildId: marker.buildId,
    outputContentDigestSha256: marker.outputContentDigestSha256,
    outputDigestDomain: marker.outputDigestDomain,
    markerFileDigestSha256: marker.fileDigestSha256,
    markerFileDigestDomain: marker.fileDigestDomain,
  };
  const profilingMarker = {
    status: "observed",
    formatVersion: 1,
    buildRole: REACT_PROFILING_BUILD_ROLE,
    reactProductionProfiling: true,
    relativePath: `.next-p1-profile/${REACT_PROFILING_BUILD_PROVENANCE_FILENAME}`,
    sourceRevisionSha: headSha,
    buildId: "fixture-profile-build",
    outputContentDigestSha256: "f".repeat(64),
    outputDigestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    fileDigestSha256: "1".repeat(64),
    fileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
    canonicalRelease,
  };
  const profilingBuildIdentity = {
    ...buildIdentity,
    buildId: profilingMarker.buildId,
    contentDigestSha256: profilingMarker.outputContentDigestSha256,
    provenanceMarker: profilingMarker,
  };
  assert.doesNotThrow(() => assertRequiredSealedPreflight(
    cleanRepository,
    sealedBuildIdentity,
    profilingBuildIdentity,
  ));
  const sealedDualBinding = createDualBuildBinding({
    repositoryBefore: cleanRepository,
    repositoryAfter: { ...cleanRepository },
    canonicalBuildBefore: sealedBuildIdentity,
    canonicalBuildAfter: structuredClone(sealedBuildIdentity),
    profilingBuildBefore: profilingBuildIdentity,
    profilingBuildAfter: structuredClone(profilingBuildIdentity),
  });
  assert.equal(sealedDualBinding.status, "exact-clean-head-dual-build-sealed");
  for (const invalid of [
    [{ ...dirtyRepository }, sealedBuildIdentity, profilingBuildIdentity],
    [cleanRepository, { ...sealedBuildIdentity, provenanceMarker: { status: "blocked" } }, profilingBuildIdentity],
    [cleanRepository, { ...sealedBuildIdentity, provenanceMarker: { ...marker, sourceRevisionSha: "c".repeat(40) } }, profilingBuildIdentity],
    [cleanRepository, { ...sealedBuildIdentity, provenanceMarker: { ...marker, buildId: "other-build" } }, profilingBuildIdentity],
    [cleanRepository, { ...sealedBuildIdentity, provenanceMarker: { ...marker, outputContentDigestSha256: "d".repeat(64) } }, profilingBuildIdentity],
    [cleanRepository, sealedBuildIdentity, undefined],
    [cleanRepository, sealedBuildIdentity, {
      ...profilingBuildIdentity,
      provenanceMarker: {
        ...profilingMarker,
        canonicalRelease: { ...canonicalRelease, markerFileDigestSha256: "2".repeat(64) },
      },
    }],
  ]) {
    assert.throws(() => assertRequiredSealedPreflight(...invalid), /--require-sealed/);
  }
  let longRuntimeEntered = false;
  await assert.rejects(collectRevisionBoundEvidence({
    collectRepositorySnapshot: async () => ({ ...cleanRepository }),
    collectBuildIdentitySnapshot: async () => ({ ...buildIdentity }),
    collectMeasurements: async (identityAtStart, repositoryBefore) => {
      assertRequiredSealedPreflight(repositoryBefore, identityAtStart, undefined);
      longRuntimeEntered = true;
      return { status: "unexpected" };
    },
  }), /--require-sealed/);
  assert.equal(longRuntimeEntered, false);
  const sealedDerivation = createBuildDerivation({
    repositoryBefore: cleanRepository,
    repositoryAfter: { ...cleanRepository },
    buildBefore: sealedBuildIdentity,
    buildAfter: { ...sealedBuildIdentity, provenanceMarker: { ...marker } },
  });
  assert.equal(sealedDerivation.status, "sealed");
  for (const mutation of [
    { provenanceMarker: { ...marker, fileDigestSha256: "f".repeat(64) } },
    { contentDigestSha256: "d".repeat(64), provenanceMarker: { ...marker, outputContentDigestSha256: "d".repeat(64) } },
    { provenanceMarker: { ...marker, sourceRevisionSha: "c".repeat(40) } },
  ]) {
    const derivation = createBuildDerivation({
      repositoryBefore: cleanRepository,
      repositoryAfter: { ...cleanRepository },
      buildBefore: sealedBuildIdentity,
      buildAfter: { ...sealedBuildIdentity, ...mutation },
    });
    assert.equal(derivation.status, "unsealed");
  }
  const atomicFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lore-p1-evidence-"));
  try {
    const atomicOutput = path.join(atomicFixtureRoot, "evidence.json");
    const diagnosticOutput = path.join(atomicFixtureRoot, "artifacts-only-evidence.json");
    await fs.writeFile(atomicOutput, "{\"old\":true}\n", "utf8");
    await writeJsonAtomic(atomicOutput, { status: "new" }, fs, atomicFixtureRoot);
    assert.deepEqual(JSON.parse(await fs.readFile(atomicOutput, "utf8")), { status: "new" });
    await writeJsonAtomic(diagnosticOutput, { status: "artifact-only" }, fs, atomicFixtureRoot);
    assert.deepEqual(JSON.parse(await fs.readFile(atomicOutput, "utf8")), { status: "new" });
    assert.deepEqual(JSON.parse(await fs.readFile(diagnosticOutput, "utf8")), { status: "artifact-only" });
    assert.deepEqual((await fs.readdir(atomicFixtureRoot)).sort(), ["artifacts-only-evidence.json", "evidence.json"]);
    const previousBytes = await fs.readFile(atomicOutput);
    const failingRenameFileSystem = new Proxy(fs, {
      get(target, property, receiver) {
        if (property === "rename") {
          return async () => {
            const error = new Error("fixture Windows rename refusal");
            error.code = "EPERM";
            throw error;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    await assert.rejects(
      writeJsonAtomic(atomicOutput, { status: "must-not-publish" }, failingRenameFileSystem, atomicFixtureRoot),
      /fixture Windows rename refusal/,
    );
    assert.deepEqual(await fs.readFile(atomicOutput), previousBytes);
    assert.deepEqual((await fs.readdir(atomicFixtureRoot)).sort(), ["artifacts-only-evidence.json", "evidence.json"]);
  } finally {
    await fs.rm(atomicFixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  const junctionFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lore-p1-evidence-junction-"));
  try {
    const trustedRoot = path.join(junctionFixtureRoot, "trusted");
    const externalRoot = path.join(junctionFixtureRoot, "external");
    const artifactsRoot = path.join(trustedRoot, "artifacts");
    const redirectedParent = path.join(artifactsRoot, "performance");
    const externalSentinel = path.join(externalRoot, "sentinel.txt");
    await fs.mkdir(artifactsRoot, { recursive: true });
    await fs.mkdir(externalRoot, { recursive: true });
    await fs.writeFile(externalSentinel, "outside-must-survive", "utf8");
    await fs.symlink(externalRoot, redirectedParent, "junction");
    await assert.rejects(
      writeJsonAtomic(path.join(redirectedParent, "evidence.json"), { status: "must-not-escape" }, fs, trustedRoot),
      /ordinary non-reparse|symlink, junction, or reparse/,
    );
    assert.equal(await fs.readFile(externalSentinel, "utf8"), "outside-must-survive");
    assert.deepEqual((await fs.readdir(externalRoot)).sort(), ["sentinel.txt"]);
  } finally {
    await fs.rm(junctionFixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  const applicability = createRuntimeApplicability({
    requestedDurationMs: TWO_HOURS_MS,
    actualDurationMs: TWO_HOURS_MS + 1,
    memorySampleCount: 121,
    finiteHeapSampleCount: 121,
    sampleIntervalMs: 60_000,
    firstFiniteHeapElapsedMs: 0,
    lastFiniteHeapElapsedMs: TWO_HOURS_MS,
    syntheticVisibilityOverrideInstalled: true,
    nativeHiddenObserved: true,
    nativeHiddenMeasurementDurationMs: 0,
    reactCommitObserverInstalled: true,
    reactRendererCount: 1,
    reactExperimentCommitCount: 7,
    simulatedAutoMinerMeasurementDurationMs: MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS,
    simulatedAutoMinerTickCount: 60,
    simulatedAutoMinerUiStateObserved: true,
    blockedApiWriteRequestCount: 0,
  });
  assert.equal(applicability.duration.idleTwoHourDurationCompleted, true);
  assert.equal(applicability.duration.idleTwoHourMemoryObservationCompleted, true);
  assert.equal(applicability.duration.memoryCoverage.expectedHeapSampleCount, 121);
  assert.equal(applicability.duration.memoryCoverage.minimumHeapSampleCount, 97);
  assert.equal(applicability.duration.memoryCoverage.sufficientForTwoHourObservation, true);
  assert.equal(applicability.duration.autoMinerTwoHourDurationCompleted, false);
  assert.equal(applicability.duration.autoMinerTwoHourMemoryObservationCompleted, false);
  assert.equal(applicability.duration.fullTwoHourSoakCompleted, false);
  assert.equal(applicability.visibility.nativeBrowserBackground.status, "probe-only");
  assert.equal(applicability.visibility.nativeBrowserBackground.timerCadenceMeasured, false);
  assert.equal(applicability.reactRerenders.status, "root-commits-measured");
  assert.equal(applicability.reactRerenders.componentProfilerCollected, false);
  assert.equal(applicability.autoMiner.status, "measured");
  assert.equal(applicability.autoMiner.uiStateObserved, true);
  assert.equal(applicability.autoMiner.twoHourApplicable, false);
  assert.equal(applicability.blockers.some((value) => value.includes("continuous raw visibility")), true);
  assert.equal(applicability.blockers.some((value) => value.includes("production React renderer")), true);
  const profiledApplicability = createRuntimeApplicability({
    requestedDurationMs: 9_000,
    actualDurationMs: 9_001,
    syntheticVisibilityOverrideInstalled: true,
    nativeHiddenObserved: false,
    reactCommitObserverInstalled: true,
    reactRendererCount: 1,
    reactExperimentCommitCount: 4,
    reactProfilingFieldsObserved: true,
    reactRendererDetails: [{ bundleType: 0, rendererPackageName: "react-dom" }],
    reactProfiledComponents: [
      { name: "HubContent", commitCount: 3, actualDurationMs: 12.5 },
      { name: "MiningPanel", commitCount: 2, actualDurationMs: 7.5 },
    ],
  });
  assert.equal(profiledApplicability.reactRerenders.status, "measured");
  assert.equal(profiledApplicability.reactRerenders.componentProfilerCollected, true);
  assert.equal(profiledApplicability.reactRerenders.componentRerenderCount, 5);
  assert.equal(profiledApplicability.reactRerenders.componentRenderDurationMs, 20);
  assert.equal(profiledApplicability.blockers.some((value) => value.includes("profiling")), false);
  const noHeapApplicability = createRuntimeApplicability({
    requestedDurationMs: TWO_HOURS_MS,
    actualDurationMs: TWO_HOURS_MS + 1,
    memorySampleCount: 121,
    finiteHeapSampleCount: 0,
    sampleIntervalMs: 60_000,
    firstFiniteHeapElapsedMs: null,
    lastFiniteHeapElapsedMs: null,
    syntheticVisibilityOverrideInstalled: true,
    nativeHiddenObserved: false,
    nativeHiddenMeasurementDurationMs: 1_000,
    reactCommitObserverInstalled: false,
  });
  assert.equal(noHeapApplicability.duration.idleTwoHourDurationCompleted, true);
  assert.equal(noHeapApplicability.duration.idleTwoHourMemoryObservationCompleted, false);
  assert.equal(noHeapApplicability.visibility.nativeBrowserBackground.timerCadenceMeasured, false);
  const clusteredHeapApplicability = createRuntimeApplicability({
    requestedDurationMs: TWO_HOURS_MS,
    actualDurationMs: TWO_HOURS_MS + 1,
    memorySampleCount: 121,
    finiteHeapSampleCount: 121,
    sampleIntervalMs: 60_000,
    firstFiniteHeapElapsedMs: 0,
    lastFiniteHeapElapsedMs: 5 * 60_000,
    syntheticVisibilityOverrideInstalled: true,
    nativeHiddenObserved: false,
    nativeHiddenMeasurementDurationMs: Number.POSITIVE_INFINITY,
    reactCommitObserverInstalled: false,
  });
  assert.equal(clusteredHeapApplicability.duration.idleTwoHourDurationCompleted, true);
  assert.equal(clusteredHeapApplicability.duration.idleTwoHourMemoryObservationCompleted, false);
  assert.equal(clusteredHeapApplicability.duration.memoryCoverage.finiteHeapWindowMs, 5 * 60_000);
  assert.equal(clusteredHeapApplicability.visibility.nativeBrowserBackground.timerCadenceMeasured, false);
  assert.equal(clusteredHeapApplicability.visibility.nativeBrowserBackground.measuredDurationMs, 0);
  console.log(JSON.stringify({ status: "pass", cases: 87, schemaVersion: 4, maxDurationMs: MAX_DURATION_MS }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.selfTest) {
    await runSelfTest();
    return;
  }
  const buildOutputLock = acquireBuildOutputLock(PROJECT_ROOT);
  let boundedEvidence;
  let collectionFailure = null;
  try {
    boundedEvidence = await collectRevisionBoundEvidence({
      collectRepositorySnapshot: async () => {
        if (options.requireSealed) {
          return cleanRepositoryObservation(captureCleanGitRevision(PROJECT_ROOT));
        }
        try {
          return await collectRepositoryEvidence();
        } catch (error) {
          return { status: "blocked", blocker: compactError(error instanceof Error ? error.message : error) };
        }
      },
      collectBuildIdentitySnapshot: async (phase, repositoryBefore) => {
        try {
          return await collectDualBuildIdentity(
            options.distDir,
            repositoryBefore?.status === "observed" ? repositoryBefore.headSha : null,
          );
        } catch (error) {
          if (phase === "start" || options.requireSealed) throw error;
          return { status: "blocked", blocker: compactError(error instanceof Error ? error.message : error) };
        }
      },
      collectMeasurements: async (identityAtStart, repositoryBefore) => {
        if (options.requireSealed) {
          assertRequiredSealedPreflight(
            repositoryBefore,
            identityAtStart.canonicalRelease,
            identityAtStart.reactProfiling,
          );
        }
        const build = await collectBuildEvidence(
          identityAtStart.canonicalRelease,
          DEFAULT_DIST_DIR,
        );
        build.outputDirectory = ".next";
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
        return { build, runtime };
      },
    });
  } catch (error) {
    collectionFailure = error;
  }
  try {
    buildOutputLock.release();
  } catch (error) {
    collectionFailure = collectionFailure
      ? new AggregateError([collectionFailure, error], "P1 evidence collection and build-output lock release failed")
      : error;
  }
  if (collectionFailure) throw collectionFailure;
  const {
    repositoryBefore,
    buildIdentityAtStart,
    measurements: { build, runtime },
    buildIdentityAtEnd,
    repositoryAfter,
  } = boundedEvidence;
  build.identityAtStart = buildIdentityAtStart.canonicalRelease;
  build.identityAtEnd = buildIdentityAtEnd.canonicalRelease;
  const profilingBuild = {
    status: "observed",
    role: REACT_PROFILING_BUILD_ROLE,
    outputDirectory: options.distDirRelativePath,
    identityAtStart: buildIdentityAtStart.reactProfiling,
    identityAtEnd: buildIdentityAtEnd.reactProfiling,
  };
  const artifactRevisionBinding = createArtifactRevisionBinding({
    repositoryBefore,
    repositoryAfter,
    buildBefore: build.identityAtStart,
    buildAfter: build.identityAtEnd,
  });
  const buildDerivation = createBuildDerivation({
    repositoryBefore,
    repositoryAfter,
    buildBefore: build.identityAtStart,
    buildAfter: build.identityAtEnd,
  });
  const dualBuildBinding = createDualBuildBinding({
    repositoryBefore,
    repositoryAfter,
    canonicalBuildBefore: build.identityAtStart,
    canonicalBuildAfter: build.identityAtEnd,
    profilingBuildBefore: profilingBuild.identityAtStart,
    profilingBuildAfter: profilingBuild.identityAtEnd,
  });
  if (
    options.requireSealed
    && (
      buildDerivation.status !== "sealed"
      || dualBuildBinding.status !== "exact-clean-head-dual-build-sealed"
    )
  ) {
    throw new Error("--require-sealed rejected repository, canonical build, profiling build, or provenance drift during collection");
  }
  const report = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    scope: "local-only P1 performance evidence; no wallet or chain writes",
    status: "partial",
    provenance: {
      repositoryBefore,
      repositoryAfter,
      artifactRevisionBinding,
      buildDerivation,
      dualBuildBinding,
    },
    build,
    profilingBuild,
    runtime,
  };
  report.status = finalizePerformanceReportStatus(report, options.artifactsOnly);
  const output = options.summaryOnly ? summaryView(report) : report;
  console.log(JSON.stringify(output, null, 2));
  if (!options.summaryOnly) {
    const outputPath = performanceEvidenceOutputPath(options);
    await writeJsonAtomic(outputPath, report);
    console.log(`P1 performance evidence written: ${path.relative(PROJECT_ROOT, outputPath)}`);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: compactError(error instanceof Error ? error.message : error) }));
  process.exitCode = 1;
});
