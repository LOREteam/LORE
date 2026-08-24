import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BUILD_PROVENANCE_FILENAME,
  REACT_PROFILING_BUILD_PROVENANCE_FILENAME,
  captureCleanGitRevision,
  verifyBuildProvenance,
  verifyReactProfilingBuildProvenance,
} from "./build-provenance.mjs";
import {
  assessPerformanceEvidenceAgainstCurrentBuild,
  assessStrictPerformanceEvidence,
  analyzeNativeBackgroundAudit,
  BUILD_OUTPUT_DIGEST_DOMAIN,
  createDualBuildBinding,
  MARKER_FILE_DIGEST_DOMAIN,
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
import { acquireBuildOutputLock } from "./run-hermetic-build.mjs";
import { resolveNextDistDir } from "./next-dist-dir.mjs";
import { redactProofText } from "./redact-proof-output.mjs";

const PROJECT_ROOT = process.cwd();
const DEFAULT_INPUT = path.join(PROJECT_ROOT, "artifacts", "performance", "p1-evidence.json");
const MAX_INPUT_BYTES = 32 * 1_024 * 1_024;
const SAMPLE_INTERVAL_MS = 60_000;
const MAX_ERROR_CHARS = 500;

function compactVerifierError(value) {
  const raw = redactProofText(value instanceof Error ? value.message : String(value ?? "unknown error"));
  const safe = raw
    .replace(/\bS-\d+(?:-\d+){2,}\b/g, "<redacted-sid>")
    .replace(/\b(owned by|current user is):\s*[^\r\n]+/gi, "$1: <redacted-identity>")
    .replace(/(?:https?|wss):\/\/\S+/gi, "<redacted-url>")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|tmp|var|Users)\/)[^\s'"`]+/g, "<redacted-path>")
    .replace(/\s+/g, " ")
    .trim();
  return safe.length <= MAX_ERROR_CHARS
    ? safe
    : `${safe.slice(0, MAX_ERROR_CHARS - 15)}...<truncated>`;
}

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    selfTest: false,
    summaryOnly: false,
    againstCurrentBuild: false,
    profilingDistDir: null,
    profilingDistDirRelativePath: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--summary-only") options.summaryOnly = true;
    else if (arg === "--against-current-build") options.againstCurrentBuild = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input" || arg === "--profiling-dist-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path`);
      if (arg === "--input") options.input = path.resolve(PROJECT_ROOT, value);
      else {
        const resolved = resolveNextDistDir(value, PROJECT_ROOT);
        if (resolved.relativePath === ".next") {
          throw new Error("--profiling-dist-dir must select an isolated React profiling output");
        }
        options.profilingDistDir = resolved.resolvedPath;
        options.profilingDistDirRelativePath = resolved.relativePath;
      }
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.selfTest && (options.input !== DEFAULT_INPUT || options.againstCurrentBuild || options.profilingDistDir)) {
    throw new Error("--self-test cannot be combined with --input, --against-current-build, or --profiling-dist-dir");
  }
  if (options.againstCurrentBuild !== Boolean(options.profilingDistDir)) {
    throw new Error("--against-current-build requires --profiling-dist-dir, and that directory is only valid with current-build verification");
  }
  return options;
}

function printUsage() {
  console.log([
    "Usage: node scripts/verify-p1-performance-evidence.mjs [--input <path>] [--against-current-build --profiling-dist-dir <.next-name>] [--summary-only]",
    "       node scripts/verify-p1-performance-evidence.mjs --self-test",
    "",
    "Strictly verifies a full schema-4 dual-build P1 performance artifact without browser, network, wallet, or chain access.",
    "--against-current-build additionally binds both canonical .next and the explicit profiling output to the locked current clean Git HEAD.",
  ].join("\n"));
}

function createNativeTimerAuditFixture() {
  const timeOriginMs = 1_700_000_000_000;
  const witnessTimeOriginMs = timeOriginMs + 1_000;
  const observation = (atMs, state, origin = timeOriginMs) => ({
    atMs,
    timeOriginMs: origin,
    nativeState: state,
    nativeHidden: state === "hidden",
    exposedState: state,
    exposedHidden: state === "hidden",
    ownVisibilityState: false,
    ownHidden: false,
  });
  const visibleBeforeStart = 0;
  const visibleBeforeEnd = NATIVE_TIMER_VISIBLE_CONTROL_MS;
  const hiddenStart = visibleBeforeEnd + 100;
  const hiddenEnd = hiddenStart + NATIVE_TIMER_HIDDEN_PHASE_MS;
  const visibleAfterStart = hiddenEnd + 100;
  const visibleAfterEnd = visibleAfterStart + NATIVE_TIMER_VISIBLE_CONTROL_MS;
  const heartbeats = [];
  const appendTicks = (startAtMs, endAtMs, intervalMs, state) => {
    for (let atMs = startAtMs; atMs <= endAtMs; atMs += intervalMs) {
      heartbeats.push(observation(atMs, state));
    }
  };
  appendTicks(visibleBeforeStart, visibleBeforeEnd, NATIVE_TIMER_HEARTBEAT_INTERVAL_MS, "visible");
  appendTicks(hiddenStart, hiddenEnd, 1_000, "hidden");
  appendTicks(visibleAfterStart, visibleAfterEnd, NATIVE_TIMER_HEARTBEAT_INTERVAL_MS, "visible");
  const sequencedHeartbeats = heartbeats.map((heartbeat, seq) => ({ seq, ...heartbeat }));
  return {
    clock: "performance.now",
    heartbeatIntervalMs: NATIVE_TIMER_HEARTBEAT_INTERVAL_MS,
    heartbeatLimit: NATIVE_TIMER_HEARTBEAT_LIMIT,
    transitionLimit: NATIVE_TIMER_TRANSITION_LIMIT,
    longTaskLimit: NATIVE_TIMER_LONG_TASK_LIMIT,
    heartbeatsTruncated: false,
    transitionsTruncated: false,
    longTasksTruncated: false,
    longTasks: [],
    browser: {
      product: "Chrome/fixture",
      version: "fixture-revision",
      commandLineObserved: true,
      effectiveSwitchNames: ["--enable-automation"],
      disabledFeatures: [],
    },
    phases: {
      "native-visible-before": {
        requestedMs: NATIVE_TIMER_VISIBLE_CONTROL_MS,
        controllerDurationMs: NATIVE_TIMER_VISIBLE_CONTROL_MS,
        timeOriginMs,
        startPerformanceMs: visibleBeforeStart,
        endPerformanceMs: visibleBeforeEnd,
        startSnapshot: observation(visibleBeforeStart, "visible"),
        endSnapshot: observation(visibleBeforeEnd, "visible"),
      },
      "native-hidden": {
        requestedMs: NATIVE_TIMER_HIDDEN_PHASE_MS,
        controllerDurationMs: NATIVE_TIMER_HIDDEN_PHASE_MS,
        timeOriginMs,
        startPerformanceMs: hiddenStart,
        endPerformanceMs: hiddenEnd,
        startSnapshot: observation(hiddenStart, "hidden"),
        endSnapshot: observation(hiddenEnd, "hidden"),
        witnessStart: observation(100, "visible", witnessTimeOriginMs),
        witnessEnd: observation(NATIVE_TIMER_HIDDEN_PHASE_MS + 100, "visible", witnessTimeOriginMs),
      },
      "native-visible-after": {
        requestedMs: NATIVE_TIMER_VISIBLE_CONTROL_MS,
        controllerDurationMs: NATIVE_TIMER_VISIBLE_CONTROL_MS,
        timeOriginMs,
        startPerformanceMs: visibleAfterStart,
        endPerformanceMs: visibleAfterEnd,
        startSnapshot: observation(visibleAfterStart, "visible"),
        endSnapshot: observation(visibleAfterEnd, "visible"),
      },
    },
    heartbeats: sequencedHeartbeats,
    transitions: [
      { seq: 0, ...observation(visibleBeforeEnd + 50, "hidden"), isTrusted: true },
      { seq: 1, ...observation(hiddenEnd + 50, "visible"), isTrusted: true },
    ],
  };
}

function createPassingFixture() {
  const headSha = "a".repeat(40);
  const buildDigest = "b".repeat(64);
  const buildId = "fixture-build";
  const cleanStatus = summarizePorcelainStatus("");
  const repository = {
    status: "observed",
    headSha,
    ...cleanStatus,
  };
  const provenanceMarker = {
    status: "observed",
    formatVersion: 1,
    relativePath: ".next/lore-build-provenance.json",
    sourceRevisionSha: headSha,
    buildId,
    outputContentDigestSha256: buildDigest,
    outputDigestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    fileDigestSha256: "c".repeat(64),
    fileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
  };
  const buildIdentity = {
    status: "observed",
    buildId,
    contentDigestSha256: buildDigest,
    digestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    digestAlgorithm: "sha256",
    fileCount: 10,
    totalBytes: 100_000,
    provenanceMarker,
  };
  const canonicalReleaseReference = {
    relativePath: provenanceMarker.relativePath,
    sourceRevisionSha: headSha,
    buildId,
    outputContentDigestSha256: buildDigest,
    outputDigestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    markerFileDigestSha256: provenanceMarker.fileDigestSha256,
    markerFileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
  };
  const profilingMarker = {
    status: "observed",
    formatVersion: 1,
    buildRole: REACT_PROFILING_BUILD_ROLE,
    reactProductionProfiling: true,
    relativePath: `.next-p1-profile/${REACT_PROFILING_BUILD_PROVENANCE_FILENAME}`,
    sourceRevisionSha: headSha,
    buildId: "fixture-profile-build",
    outputContentDigestSha256: "d".repeat(64),
    outputDigestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    fileDigestSha256: "e".repeat(64),
    fileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
    canonicalRelease: canonicalReleaseReference,
  };
  const profilingBuildIdentity = {
    status: "observed",
    buildId: profilingMarker.buildId,
    contentDigestSha256: profilingMarker.outputContentDigestSha256,
    digestDomain: BUILD_OUTPUT_DIGEST_DOMAIN,
    digestAlgorithm: "sha256",
    fileCount: 11,
    totalBytes: 110_000,
    provenanceMarker: profilingMarker,
  };
  const dualBuildBinding = createDualBuildBinding({
    repositoryBefore: repository,
    repositoryAfter: { ...repository },
    canonicalBuildBefore: buildIdentity,
    canonicalBuildAfter: structuredClone(buildIdentity),
    profilingBuildBefore: profilingBuildIdentity,
    profilingBuildAfter: structuredClone(profilingBuildIdentity),
  });
  const samples = Array.from(
    { length: Math.floor(TWO_HOURS_MS / SAMPLE_INTERVAL_MS) + 1 },
    (_, index) => ({
      elapsedMs: index * SAMPLE_INTERVAL_MS,
      jsHeapUsedBytes: 10_000_000 + (index * 1_000),
      domNodes: 500,
    }),
  );
  const expectedHeapSampleCount = samples.length;
  const minimumHeapSampleCount = Math.ceil(expectedHeapSampleCount * 0.8);
  const minimumHeapWindowMs = TWO_HOURS_MS - (2 * SAMPLE_INTERVAL_MS);
  const nativeAudit = createNativeTimerAuditFixture();
  const nativeAuditAnalysis = analyzeNativeBackgroundAudit(nativeAudit);
  return {
    schemaVersion: 4,
    status: "complete",
    provenance: {
      repositoryBefore: repository,
      repositoryAfter: { ...repository },
      artifactRevisionBinding: {
        status: "exact-clean-head-build-sealed",
        exactHeadObserved: true,
        dirtyStatusObserved: true,
        buildIdentityObserved: true,
        repositoryMarkersStableDuringCollection: true,
        buildStableDuringCollection: true,
        exactCleanRevision: true,
        releaseCandidateEligible: true,
        buildDerivationSealed: true,
      },
      buildDerivation: {
        status: "sealed",
        sourceRevisionMarkerPresent: true,
        exactHeadMatch: true,
        sourceRevisionSha: headSha,
        buildId,
        contentDigestSha256: buildDigest,
        marker: {
          ...provenanceMarker,
        },
      },
      dualBuildBinding,
    },
    build: {
      status: "measured",
      buildId,
      outputDirectory: ".next",
      identityAtStart: buildIdentity,
      identityAtEnd: structuredClone(buildIdentity),
      missingRouteManifests: [],
      missingAssets: [],
      routes: [{
        route: "/",
        status: "measured",
        missingAssets: [],
        manifestAssetSet: { rawBytes: 100_000, gzipBytes: 35_000, brotliBytes: 30_000 },
      }],
      largestChunks: [{
        path: "static/chunks/app.js",
        rawBytes: 75_000,
        gzipBytes: 25_000,
        brotliBytes: 20_000,
        owners: {
          appSources: ["app/page.tsx"],
          packages: [],
          framework: [],
          attribution: "fixture manifest attribution",
        },
      }],
    },
    profilingBuild: {
      status: "observed",
      role: REACT_PROFILING_BUILD_ROLE,
      outputDirectory: ".next-p1-profile",
      identityAtStart: profilingBuildIdentity,
      identityAtEnd: structuredClone(profilingBuildIdentity),
    },
    runtime: {
      status: "measured",
      blockers: [],
      safety: {
        headlessTemporaryProfile: false,
        temporaryProfile: true,
        dedicatedProfile: true,
        browserMode: "headed-native-hidden",
        externalBrowserRequestsBlocked: true,
        serverExternalNetworkGuard: "global fetch plus http/https/net/tls loopback-only preload",
        apiWritesFulfilled: false,
      },
      requestedDurationMs: TWO_HOURS_MS,
      actualDurationMs: TWO_HOURS_MS + 1_000,
      requestedDurationCompleted: true,
      idleTwoHourDurationCompleted: true,
      idleTwoHourMemoryObservationCompleted: true,
      memoryCoverage: {
        sampleIntervalMs: SAMPLE_INTERVAL_MS,
        sampleCount: samples.length,
        finiteHeapSampleCount: samples.length,
        expectedHeapSampleCount,
        minimumHeapSampleCount,
        finiteHeapWindowMs: TWO_HOURS_MS,
        minimumHeapWindowMs,
        sufficientForTwoHourObservation: true,
      },
      memory: {
        sampleCount: samples.length,
        trendQualifiedForLeakAssessment: true,
        samples,
      },
      visibility: {
        syntheticCapability: {
          overrideInstalled: true,
          syntheticState: "visible",
          syntheticHidden: false,
          nativeState: "visible",
          nativeHidden: false,
        },
        nativeWhileBackgrounded: {
          overrideInstalled: false,
          syntheticState: "hidden",
          syntheticHidden: true,
          nativeState: "hidden",
          nativeHidden: true,
        },
        nativeHiddenObserved: true,
        nativeAudit,
        timerThrottling: nativeAuditAnalysis.timerThrottling,
        coverage: {
          nativeBrowserBackground: {
            status: "measured",
            nativeHiddenObserved: true,
            timerCadenceMeasured: true,
            apiPollingCountMeasured: true,
            apiPollingObserved: true,
            apiRequestCount: 2,
            measuredDurationMs: NATIVE_TIMER_HIDDEN_PHASE_MS,
            hiddenThroughout: true,
            browserTimerThrottlingMeasured: true,
          },
        },
      },
      polling: {
        blockedExternalRequestCount: 0,
        phases: {
          "native-hidden": {
            requestedMs: NATIVE_TIMER_HIDDEN_PHASE_MS,
            actualMs: NATIVE_TIMER_HIDDEN_PHASE_MS,
            total: 2,
            byPath: { "/api/game-data": 2 },
          },
          "simulated-auto-miner": { actualMs: 120_000, total: 4, byPath: { "/api/game-data": 4 } },
        },
      },
      routeFirstLoad: {
        status: "measured",
        routes: [{
          route: "/",
          httpStatus: 200,
          status: "measured",
          firstLoadModern: { rawBytes: 100_000, gzipBytes: 35_000, brotliBytes: 30_000 },
          missingAssets: [],
        }],
      },
      longTasks: {
        supported: true,
        initialLoad: { count: 1, totalMs: 55, longestMs: 55, p95Ms: 55 },
        experiment: { count: 0, totalMs: 0, longestMs: 0, p95Ms: null },
        byPhase: {
          "native-hidden": { count: 0, totalMs: 0, longestMs: 0, p95Ms: null },
          "simulated-auto-miner": { count: 0, totalMs: 0, longestMs: 0, p95Ms: null },
        },
      },
      reactRerenders: {
        status: "measured",
        rootCommitObserverInstalled: true,
        rendererCount: 1,
        componentProfilerCollected: true,
        componentRerenderCount: 5,
        componentRenderDurationMs: 20,
        profiledComponents: [
          { name: "HubContent", commitCount: 3, actualDurationMs: 12.5 },
          { name: "MiningPanel", commitCount: 2, actualDurationMs: 7.5 },
        ],
      },
      autoMiner: {
        status: "measured",
        mode: "simulated-read-only",
        phaseMeasured: true,
        measuredDurationMs: 120_000,
        simulationTickCount: 4,
        uiStateObserved: true,
        safety: {
          simulationOnly: true,
          walletAuthenticated: false,
          chainWritesAllowed: false,
          transactionSubmissionDisabled: true,
          transactionAttemptCount: 0,
          apiWritesFulfilled: false,
        },
      },
    },
  };
}

function currentObservationFromFixture(fixture) {
  return {
    repositoryBefore: structuredClone(fixture.provenance.repositoryBefore),
    repositoryAfter: structuredClone(fixture.provenance.repositoryAfter),
    buildBefore: structuredClone(fixture.build.identityAtStart),
    buildAfter: structuredClone(fixture.build.identityAtEnd),
    profilingBuildBefore: structuredClone(fixture.profilingBuild.identityAtStart),
    profilingBuildAfter: structuredClone(fixture.profilingBuild.identityAtEnd),
  };
}

async function runSelfTest() {
  let cases = 0;
  const redactedError = compactVerifierError(new Error(
    "SID S-1-5-21-1-2-3-1001 fatal at C:\\Users\\alice\\private\\repo owned by: MACHINE/alice (S-1-5-21-1-2-3-1001) but the current user is: MACHINE/runner (S-1-5-21-4-5-6-1002) https://user:pass@example.test/private?token=abc",
  ));
  assert.match(redactedError, /<redacted-path>/);
  assert.match(redactedError, /<redacted-identity>/);
  assert.match(redactedError, /<redacted-sid>/);
  assert.doesNotMatch(redactedError, /alice|runner|S-1-5|user:pass|token=abc|example\.test/i);
  cases += 1;
  const currentArgs = parseArgs([
    "--against-current-build",
    "--profiling-dist-dir",
    ".next-p1-profile",
  ]);
  assert.equal(currentArgs.againstCurrentBuild, true);
  assert.equal(currentArgs.profilingDistDirRelativePath, ".next-p1-profile");
  cases += 1;
  assert.throws(() => parseArgs(["--against-current-build"]), /requires --profiling-dist-dir/);
  cases += 1;
  assert.throws(() => parseArgs(["--profiling-dist-dir", ".next-p1-profile"]), /only valid/);
  cases += 1;
  assert.throws(
    () => parseArgs(["--self-test", "--against-current-build", "--profiling-dist-dir", ".next-p1-profile"]),
    /cannot be combined/,
  );
  cases += 1;
  const passing = createPassingFixture();
  assert.deepEqual(assessStrictPerformanceEvidence(passing).failures, []);
  cases += 1;
  const zeroApiPollPassing = createPassingFixture();
  zeroApiPollPassing.runtime.polling.phases["native-hidden"].total = 0;
  zeroApiPollPassing.runtime.polling.phases["native-hidden"].byPath = {};
  zeroApiPollPassing.runtime.visibility.coverage.nativeBrowserBackground.apiRequestCount = 0;
  zeroApiPollPassing.runtime.visibility.coverage.nativeBrowserBackground.apiPollingObserved = false;
  assert.deepEqual(assessStrictPerformanceEvidence(zeroApiPollPassing).failures, []);
  cases += 1;

  const expectFailure = (code, mutate) => {
    const fixture = createPassingFixture();
    mutate(fixture);
    const result = assessStrictPerformanceEvidence(fixture);
    assert.equal(result.status, "fail");
    assert.ok(result.failures.includes(code), `${code} was not reported: ${result.failures.join(", ")}`);
    cases += 1;
  };

  expectFailure("schema.version", (fixture) => { fixture.schemaVersion = 3; });
  expectFailure("report.complete", (fixture) => { fixture.status = "partial"; });
  expectFailure("provenance.repository.clean", (fixture) => {
    fixture.provenance.repositoryAfter.dirty = true;
  });
  expectFailure("provenance.repository.stable", (fixture) => {
    fixture.provenance.repositoryAfter.headSha = "c".repeat(40);
  });
  expectFailure("provenance.build.stable", (fixture) => {
    fixture.build.identityAtEnd.contentDigestSha256 = "d".repeat(64);
  });
  expectFailure("provenance.binding.sealed", (fixture) => {
    fixture.provenance.artifactRevisionBinding.buildDerivationSealed = false;
  });
  expectFailure("provenance.derivation.sealed", (fixture) => {
    fixture.provenance.buildDerivation.status = "unsealed";
  });
  expectFailure("provenance.derivation.marker", (fixture) => {
    fixture.provenance.buildDerivation.marker.sourceRevisionSha = "d".repeat(40);
  });
  expectFailure("provenance.build.identity", (fixture) => {
    fixture.build.identityAtStart.provenanceMarker = { status: "blocked" };
  });
  expectFailure("provenance.derivation.marker", (fixture) => {
    fixture.build.identityAtEnd.provenanceMarker.fileDigestSha256 = "d".repeat(64);
  });
  expectFailure("provenance.derivation.sealed", (fixture) => {
    fixture.build.identityAtEnd.provenanceMarker.outputContentDigestSha256 = "d".repeat(64);
  });
  expectFailure("provenance.derivation.sealed", (fixture) => {
    fixture.build.identityAtEnd.provenanceMarker.sourceRevisionSha = "d".repeat(40);
  });
  expectFailure("provenance.derivation.sealed", (fixture) => {
    fixture.build.identityAtEnd.provenanceMarker.buildId = "other-build";
  });
  expectFailure("provenance.profiling.identity", (fixture) => {
    delete fixture.profilingBuild;
  });
  expectFailure("provenance.profiling.identity", (fixture) => {
    fixture.profilingBuild.identityAtStart.provenanceMarker.status = "blocked";
  });
  expectFailure("provenance.profiling.stable", (fixture) => {
    fixture.profilingBuild.identityAtEnd.contentDigestSha256 = "f".repeat(64);
  });
  expectFailure("provenance.dual.sealed", (fixture) => {
    fixture.profilingBuild.identityAtEnd.provenanceMarker.canonicalRelease.markerFileDigestSha256 = "f".repeat(64);
  });
  expectFailure("provenance.dual.sealed", (fixture) => {
    fixture.provenance.dualBuildBinding.reactProfiling.contentDigestSha256 = "f".repeat(64);
  });
  expectFailure("build.measurements.complete", (fixture) => {
    fixture.build.routes[0].status = "partial";
  });
  expectFailure("runtime.complete", (fixture) => {
    fixture.runtime.blockers.push("fixture blocker");
  });
  expectFailure("runtime.safety.read-only", (fixture) => {
    fixture.runtime.safety.apiWritesFulfilled = true;
  });
  expectFailure("runtime.safety.read-only", (fixture) => {
    fixture.runtime.safety.temporaryProfile = false;
  });
  expectFailure("runtime.safety.read-only", (fixture) => {
    fixture.runtime.safety.browserMode = "personal-profile";
  });
  expectFailure("runtime.safety.read-only", (fixture) => {
    fixture.runtime.safety.serverExternalNetworkGuard = "caller-owned server; not process-enforced";
  });
  expectFailure("runtime.measurements.complete", (fixture) => {
    fixture.runtime.routeFirstLoad.routes[0].status = "partial";
  });
  expectFailure("runtime.measurements.complete", (fixture) => {
    fixture.runtime.longTasks.supported = false;
  });
  expectFailure("runtime.memory.two-hour-coverage", (fixture) => {
    fixture.runtime.memory.samples = fixture.runtime.memory.samples.slice(0, 5);
    fixture.runtime.memory.sampleCount = 5;
    fixture.runtime.memoryCoverage.sampleCount = 5;
    fixture.runtime.memoryCoverage.finiteHeapSampleCount = 5;
  });
  expectFailure("runtime.memory.two-hour-coverage", (fixture) => {
    fixture.runtime.memory.samples.at(-1).elapsedMs = 300_000;
    fixture.runtime.memoryCoverage.finiteHeapWindowMs = 300_000;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.coverage.nativeBrowserBackground.status = "probe-only";
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.polling.phases["native-hidden"].actualMs = 1_000;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.safety.browserMode = "headless";
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.safety.headlessTemporaryProfile = true;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeWhileBackgrounded.overrideInstalled = true;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.syntheticCapability.overrideInstalled = false;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeWhileBackgrounded.nativeState = "visible";
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeWhileBackgrounded.nativeHidden = false;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeWhileBackgrounded.syntheticState = "visible";
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeHiddenObserved = false;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.polling.phases["native-hidden"].requestedMs = 60_000;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.polling.phases["native-hidden"].total = 0;
    fixture.runtime.polling.phases["native-hidden"].byPath = {};
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    delete fixture.runtime.visibility.nativeAudit;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.heartbeatsTruncated = true;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.transitionsTruncated = true;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.heartbeats[1].atMs =
      fixture.runtime.visibility.nativeAudit.heartbeats[0].atMs;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    const snapshot = fixture.runtime.visibility.nativeAudit.phases["native-hidden"].startSnapshot;
    snapshot.nativeState = "visible";
    snapshot.nativeHidden = false;
    snapshot.exposedState = "visible";
    snapshot.exposedHidden = false;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    const snapshot = fixture.runtime.visibility.nativeAudit.phases["native-hidden"].endSnapshot;
    snapshot.nativeState = "visible";
    snapshot.nativeHidden = false;
    snapshot.exposedState = "visible";
    snapshot.exposedHidden = false;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.phases["native-hidden"].witnessEnd.nativeState = "hidden";
    fixture.runtime.visibility.nativeAudit.phases["native-hidden"].witnessEnd.nativeHidden = true;
    fixture.runtime.visibility.nativeAudit.phases["native-hidden"].witnessEnd.exposedState = "hidden";
    fixture.runtime.visibility.nativeAudit.phases["native-hidden"].witnessEnd.exposedHidden = true;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    const audit = fixture.runtime.visibility.nativeAudit;
    const hidden = audit.phases["native-hidden"];
    audit.transitions.push({
      seq: audit.transitions.length,
      ...hidden.startSnapshot,
      atMs: hidden.startPerformanceMs + 1_000,
      nativeState: "visible",
      nativeHidden: false,
      exposedState: "visible",
      exposedHidden: false,
      isTrusted: true,
    });
    audit.transitions.sort((left, right) => left.atMs - right.atMs);
    audit.transitions.forEach((transition, seq) => { transition.seq = seq; });
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    const audit = fixture.runtime.visibility.nativeAudit;
    const hidden = audit.phases["native-hidden"];
    audit.transitions.push({
      seq: audit.transitions.length,
      ...hidden.startSnapshot,
      atMs: hidden.startPerformanceMs + 1_000,
      isTrusted: false,
    });
    audit.transitions.sort((left, right) => left.atMs - right.atMs);
    audit.transitions.forEach((transition, seq) => { transition.seq = seq; });
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.browser.effectiveSwitchNames.push(
      "--disable-background-timer-throttling",
    );
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.browser.commandLineObserved = false;
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.browser.disabledFeatures.push("IntensiveWakeUpThrottling");
  });
  expectFailure("runtime.visibility.native-hidden-continuous", (fixture) => {
    fixture.runtime.visibility.nativeAudit.phases["native-hidden"].controllerDurationMs = 120_000;
  });
  expectFailure("runtime.visibility.browser-timer-throttling", (fixture) => {
    const audit = fixture.runtime.visibility.nativeAudit;
    const hidden = audit.phases["native-hidden"];
    const hiddenTicks = audit.heartbeats.filter((heartbeat) =>
      heartbeat.atMs >= hidden.startPerformanceMs && heartbeat.atMs <= hidden.endPerformanceMs);
    hiddenTicks.forEach((heartbeat, index) => {
      heartbeat.atMs = hidden.startPerformanceMs + (index * NATIVE_TIMER_HEARTBEAT_INTERVAL_MS);
    });
  });
  expectFailure("runtime.visibility.browser-timer-throttling", (fixture) => {
    const audit = fixture.runtime.visibility.nativeAudit;
    const before = audit.phases["native-visible-before"];
    audit.heartbeats = audit.heartbeats.filter((heartbeat, index) =>
      heartbeat.atMs < before.startPerformanceMs
        || heartbeat.atMs > before.endPerformanceMs
        || index % 5 === 0);
    audit.heartbeats.forEach((heartbeat, seq) => { heartbeat.seq = seq; });
  });
  expectFailure("runtime.visibility.browser-timer-throttling", (fixture) => {
    const audit = fixture.runtime.visibility.nativeAudit;
    const after = audit.phases["native-visible-after"];
    let visibleAfterIndex = 0;
    audit.heartbeats = audit.heartbeats.filter((heartbeat) => {
      if (heartbeat.atMs < after.startPerformanceMs || heartbeat.atMs > after.endPerformanceMs) return true;
      const keep = visibleAfterIndex % 5 === 0;
      visibleAfterIndex += 1;
      return keep;
    });
    audit.heartbeats.forEach((heartbeat, seq) => { heartbeat.seq = seq; });
  });
  expectFailure("runtime.visibility.browser-timer-throttling", (fixture) => {
    const hidden = fixture.runtime.visibility.nativeAudit.phases["native-hidden"];
    fixture.runtime.visibility.nativeAudit.longTasks.push({
      startTime: hidden.startPerformanceMs + 30_000,
      duration: hidden.endPerformanceMs - hidden.startPerformanceMs - 30_000,
    });
  });
  expectFailure("runtime.visibility.browser-timer-throttling", (fixture) => {
    const audit = fixture.runtime.visibility.nativeAudit;
    const hidden = audit.phases["native-hidden"];
    let keptHiddenTick = false;
    audit.heartbeats = audit.heartbeats.filter((heartbeat) => {
      const inHidden = heartbeat.atMs >= hidden.startPerformanceMs
        && heartbeat.atMs <= hidden.endPerformanceMs;
      if (!inHidden) return true;
      if (keptHiddenTick) return false;
      keptHiddenTick = true;
      return true;
    });
    audit.heartbeats.forEach((heartbeat, seq) => { heartbeat.seq = seq; });
  });
  expectFailure("runtime.visibility.browser-timer-throttling", (fixture) => {
    fixture.runtime.visibility.timerThrottling.hiddenToVisibleMedianRatio = 999;
  });
  expectFailure("runtime.react.component-profiler", (fixture) => {
    fixture.runtime.reactRerenders.componentProfilerCollected = false;
  });
  expectFailure("runtime.react.component-profiler", (fixture) => {
    fixture.runtime.reactRerenders.profiledComponents = [];
  });
  expectFailure("runtime.auto-miner.safe-simulation", (fixture) => {
    fixture.runtime.autoMiner.safety.walletAuthenticated = true;
  });
  expectFailure("runtime.auto-miner.safe-simulation", (fixture) => {
    delete fixture.runtime.polling.phases["simulated-auto-miner"];
  });
  expectFailure("runtime.auto-miner.safe-simulation", (fixture) => {
    fixture.runtime.autoMiner.safety.transactionAttemptCount = 1;
  });

  const currentPassingArtifact = createPassingFixture();
  const currentPassing = currentObservationFromFixture(currentPassingArtifact);
  assert.deepEqual(assessPerformanceEvidenceAgainstCurrentBuild(currentPassingArtifact, currentPassing).failures, []);
  cases += 1;
  const expectCurrentFailure = (code, mutateCurrent, mutateArtifact = () => {}) => {
    const artifact = createPassingFixture();
    const current = currentObservationFromFixture(artifact);
    mutateCurrent(current);
    mutateArtifact(artifact);
    const result = assessPerformanceEvidenceAgainstCurrentBuild(artifact, current);
    assert.equal(result.status, "fail");
    assert.ok(result.failures.includes(code), `${code} was not reported: ${result.failures.join(", ")}`);
    cases += 1;
  };
  expectCurrentFailure("current.repository.clean", (current) => {
    current.repositoryBefore.dirty = true;
    current.repositoryBefore.entryCount = 1;
  });
  expectCurrentFailure("current.repository.stable", (current) => {
    current.repositoryAfter.headSha = "d".repeat(40);
  });
  expectCurrentFailure("current.build.stable", (current) => {
    current.buildAfter.contentDigestSha256 = "d".repeat(64);
    current.buildAfter.provenanceMarker.outputContentDigestSha256 = "d".repeat(64);
  });
  expectCurrentFailure("current.build.stable", (current) => {
    current.buildAfter.buildId = "other-build";
    current.buildAfter.provenanceMarker.buildId = "other-build";
  });
  expectCurrentFailure("current.artifact.repository", () => {}, (artifact) => {
    artifact.provenance.repositoryBefore.headSha = "d".repeat(40);
    artifact.provenance.repositoryAfter.headSha = "d".repeat(40);
  });
  expectCurrentFailure("current.artifact.build", () => {}, (artifact) => {
    artifact.build.identityAtStart.contentDigestSha256 = "d".repeat(64);
    artifact.build.identityAtEnd.contentDigestSha256 = "d".repeat(64);
  });
  expectCurrentFailure("current.artifact.marker", () => {}, (artifact) => {
    artifact.build.identityAtStart.provenanceMarker.fileDigestSha256 = "d".repeat(64);
    artifact.build.identityAtEnd.provenanceMarker.fileDigestSha256 = "d".repeat(64);
    artifact.provenance.buildDerivation.marker.fileDigestSha256 = "d".repeat(64);
  });
  expectCurrentFailure("current.profiling.stable", (current) => {
    current.profilingBuildAfter.contentDigestSha256 = "f".repeat(64);
  });
  expectCurrentFailure("current.artifact.profiling-build", () => {}, (artifact) => {
    artifact.profilingBuild.identityAtStart.contentDigestSha256 = "f".repeat(64);
    artifact.profilingBuild.identityAtEnd.contentDigestSha256 = "f".repeat(64);
  });
  expectCurrentFailure("current.artifact.profiling-marker", () => {}, (artifact) => {
    artifact.profilingBuild.identityAtStart.provenanceMarker.fileDigestSha256 = "f".repeat(64);
    artifact.profilingBuild.identityAtEnd.provenanceMarker.fileDigestSha256 = "f".repeat(64);
  });

  const absentFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lore-p1-verify-"));
  try {
    await assert.rejects(readArtifact(path.join(absentFixtureRoot, "missing.json")), /ENOENT/);
    cases += 1;
    const readableFixturePath = path.join(absentFixtureRoot, "readable.json");
    await fs.writeFile(readableFixturePath, "{\"stable\":true}\n", "utf8");
    assert.deepEqual(await readArtifact(readableFixturePath), { stable: true });
    cases += 1;
    await assert.rejects(readArtifact(absentFixtureRoot), /regular non-symlink/);
    cases += 1;
  } finally {
    await fs.rm(absentFixtureRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ status: "pass", cases, schemaVersion: 4 }));
}

function stableFileStatsEqual(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function readArtifact(inputPath) {
  const pathStats = await fs.lstat(inputPath, { bigint: true });
  if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
    throw new Error("performance artifact must be a regular non-symlink file");
  }
  if (pathStats.size > BigInt(MAX_INPUT_BYTES)) {
    throw new Error(`performance artifact exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  let handle;
  try {
    handle = await fs.open(inputPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !stableFileStatsEqual(pathStats, before)) {
      throw new Error("performance artifact changed before it could be read");
    }
    const byteLength = Number(before.size);
    const contents = Buffer.alloc(byteLength);
    let offset = 0;
    while (offset < byteLength) {
      const { bytesRead } = await handle.read(contents, offset, byteLength - offset, offset);
      if (bytesRead === 0) throw new Error("performance artifact was truncated while it was read");
      offset += bytesRead;
    }
    const probe = Buffer.alloc(1);
    const { bytesRead: trailingBytes } = await handle.read(probe, 0, 1, byteLength);
    const after = await handle.stat({ bigint: true });
    const finalPathStats = await fs.lstat(inputPath, { bigint: true });
    if (trailingBytes !== 0
      || !stableFileStatsEqual(before, after)
      || !stableFileStatsEqual(after, finalPathStats)) {
      throw new Error("performance artifact changed while it was read");
    }
    return JSON.parse(contents.toString("utf8"));
  } finally {
    await handle?.close();
  }
}

function repositoryObservation(cleanRevision) {
  return {
    status: "observed",
    headSha: cleanRevision.headSha,
    ...summarizePorcelainStatus(""),
  };
}

function buildObservation(verified) {
  const outputIdentity = verified.outputIdentity;
  const marker = verified.marker;
  return {
    status: "observed",
    buildId: outputIdentity.buildId,
    contentDigestSha256: outputIdentity.contentDigestSha256,
    digestDomain: outputIdentity.domain,
    digestAlgorithm: outputIdentity.algorithm,
    fileCount: outputIdentity.fileCount,
    totalBytes: outputIdentity.totalBytes,
    scope: outputIdentity.scope,
    provenanceMarker: {
      status: "observed",
      formatVersion: marker.formatVersion,
      relativePath: `.next/${BUILD_PROVENANCE_FILENAME}`,
      sourceRevisionSha: marker.sourceRevisionSha,
      buildId: marker.buildId,
      outputContentDigestSha256: marker.outputIdentity.contentDigestSha256,
      outputDigestDomain: marker.outputIdentity.domain,
      fileDigestSha256: verified.markerFileDigestSha256,
      fileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
    },
  };
}

function profilingBuildObservation(verified, relativeBuildRoot) {
  const outputIdentity = verified.outputIdentity;
  const marker = verified.marker;
  const canonicalRelease = verified.canonicalRelease;
  return {
    status: "observed",
    buildId: outputIdentity.buildId,
    contentDigestSha256: outputIdentity.contentDigestSha256,
    digestDomain: outputIdentity.domain,
    digestAlgorithm: outputIdentity.algorithm,
    fileCount: outputIdentity.fileCount,
    totalBytes: outputIdentity.totalBytes,
    scope: outputIdentity.scope,
    provenanceMarker: {
      status: "observed",
      formatVersion: marker.formatVersion,
      buildRole: marker.buildRole,
      reactProductionProfiling: marker.reactProductionProfiling,
      relativePath: `${relativeBuildRoot}/${REACT_PROFILING_BUILD_PROVENANCE_FILENAME}`,
      sourceRevisionSha: marker.sourceRevisionSha,
      buildId: marker.buildId,
      outputContentDigestSha256: marker.outputIdentity.contentDigestSha256,
      outputDigestDomain: marker.outputIdentity.domain,
      fileDigestSha256: verified.markerFileDigestSha256,
      fileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
      canonicalRelease: {
        relativePath: `.next/${BUILD_PROVENANCE_FILENAME}`,
        sourceRevisionSha: canonicalRelease.marker.sourceRevisionSha,
        buildId: canonicalRelease.outputIdentity.buildId,
        outputContentDigestSha256: canonicalRelease.outputIdentity.contentDigestSha256,
        outputDigestDomain: canonicalRelease.outputIdentity.domain,
        markerFileDigestSha256: canonicalRelease.markerFileDigestSha256,
        markerFileDigestDomain: MARKER_FILE_DIGEST_DOMAIN,
      },
    },
  };
}

async function readArtifactAgainstCurrentBuild(inputPath, profilingDistDir, profilingDistDirRelativePath) {
  const buildOutputLock = acquireBuildOutputLock(PROJECT_ROOT);
  let result;
  let observationFailure = null;
  try {
    const repositoryBefore = repositoryObservation(captureCleanGitRevision(PROJECT_ROOT));
    const verifiedBefore = verifyBuildProvenance({
      projectRoot: PROJECT_ROOT,
      distDir: path.join(PROJECT_ROOT, ".next"),
      expectedSourceRevisionSha: repositoryBefore.headSha,
    });
    const profilingVerifiedBefore = verifyReactProfilingBuildProvenance({
      projectRoot: PROJECT_ROOT,
      distDir: profilingDistDir,
      expectedSourceRevisionSha: repositoryBefore.headSha,
      expectedCanonicalRelease: verifiedBefore,
    });
    const artifact = await readArtifact(inputPath);
    const profilingVerifiedAfter = verifyReactProfilingBuildProvenance({
      projectRoot: PROJECT_ROOT,
      distDir: profilingDistDir,
      expectedSourceRevisionSha: repositoryBefore.headSha,
      expectedOutputIdentity: profilingVerifiedBefore.outputIdentity,
      expectedCanonicalRelease: verifiedBefore,
    });
    const verifiedAfter = verifyBuildProvenance({
      projectRoot: PROJECT_ROOT,
      distDir: path.join(PROJECT_ROOT, ".next"),
      expectedSourceRevisionSha: repositoryBefore.headSha,
      expectedOutputIdentity: verifiedBefore.outputIdentity,
    });
    const repositoryAfter = repositoryObservation(captureCleanGitRevision(PROJECT_ROOT));
    result = {
      artifact,
      current: {
        repositoryBefore,
        repositoryAfter,
        buildBefore: buildObservation(verifiedBefore),
        buildAfter: buildObservation(verifiedAfter),
        profilingBuildBefore: profilingBuildObservation(
          profilingVerifiedBefore,
          profilingDistDirRelativePath,
        ),
        profilingBuildAfter: profilingBuildObservation(
          profilingVerifiedAfter,
          profilingDistDirRelativePath,
        ),
      },
    };
  } catch (error) {
    observationFailure = error;
  }
  try {
    buildOutputLock.release();
  } catch (error) {
    observationFailure = observationFailure
      ? new AggregateError([observationFailure, error], "Current-build observation and lock release failed")
      : error;
  }
  if (observationFailure) throw observationFailure;
  return result;
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
  const observed = options.againstCurrentBuild
    ? await readArtifactAgainstCurrentBuild(
        options.input,
        options.profilingDistDir,
        options.profilingDistDirRelativePath,
      )
    : { artifact: await readArtifact(options.input), current: null };
  const strictResult = assessStrictPerformanceEvidence(observed.artifact);
  const currentResult = observed.current
    ? assessPerformanceEvidenceAgainstCurrentBuild(observed.artifact, observed.current)
    : null;
  const failures = [
    ...strictResult.failures,
    ...(currentResult?.failures ?? []),
  ];
  const result = {
    ...strictResult,
    status: failures.length === 0 ? "pass" : "fail",
    failures,
    againstCurrentBuild: options.againstCurrentBuild,
    currentBuildBound: currentResult ? currentResult.status === "pass" : null,
    currentHeadSha: currentResult?.currentHeadSha ?? null,
    currentBuildId: currentResult?.currentBuildId ?? null,
    currentProfilingBuildId: currentResult?.currentProfilingBuildId ?? null,
  };
  const output = options.summaryOnly
    ? { status: result.status, schemaVersion: result.schemaVersion, failureCount: result.failures.length, failures: result.failures }
    : { ...result, input: path.relative(PROJECT_ROOT, options.input).replaceAll(path.sep, "/") };
  console.log(JSON.stringify(output, null, options.summaryOnly ? 0 : 2));
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: compactVerifierError(error) }));
  process.exitCode = 1;
});
