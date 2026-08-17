import { createHash } from "node:crypto";
import {
  BUILD_OUTPUT_DIGEST_DOMAIN,
  BUILD_PROVENANCE_FILENAME,
  REACT_PROFILING_BUILD_PROVENANCE_FILENAME,
} from "./build-provenance.mjs";

export { BUILD_OUTPUT_DIGEST_DOMAIN };

export const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;
export const MIN_NATIVE_HIDDEN_EVIDENCE_MS = 60_000;
export const MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS = 60_000;

const CLEAN_PORCELAIN_DIGEST_SHA256 = createHash("sha256").update("", "utf8").digest("hex");
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const BUILD_PROVENANCE_RELATIVE_PATH = `.next/${BUILD_PROVENANCE_FILENAME}`;
export const REACT_PROFILING_BUILD_ROLE = "react-production-profiling";
export const MARKER_FILE_DIGEST_DOMAIN = "marker-file-bytes";

export function summarizePorcelainStatus(rawStatus) {
  if (typeof rawStatus !== "string") throw new TypeError("rawStatus must be a string");
  const entries = rawStatus.split(/\r?\n/).filter(Boolean);
  let trackedEntryCount = 0;
  let untrackedEntryCount = 0;
  let conflictedEntryCount = 0;
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    if (code === "??") untrackedEntryCount += 1;
    else trackedEntryCount += 1;
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code)) {
      conflictedEntryCount += 1;
    }
  }
  return {
    dirty: entries.length > 0,
    entryCount: entries.length,
    trackedEntryCount,
    untrackedEntryCount,
    conflictedEntryCount,
    statusDigestSha256: createHash("sha256").update(rawStatus, "utf8").digest("hex"),
  };
}

function repositoryObservationIsComplete(repository) {
  return repository?.status === "observed"
    && /^[a-f0-9]{40}$/.test(repository.headSha ?? "")
    && typeof repository.dirty === "boolean"
    && /^[a-f0-9]{64}$/.test(repository.statusDigestSha256 ?? "");
}

function buildOutputObservationIsComplete(build) {
  return build?.status === "observed"
    && typeof build.buildId === "string"
    && build.buildId.length > 0
    && build.digestDomain === BUILD_OUTPUT_DIGEST_DOMAIN
    && build.digestAlgorithm === "sha256"
    && DIGEST_PATTERN.test(build.contentDigestSha256 ?? "")
    && Number.isSafeInteger(build.fileCount)
    && build.fileCount > 0
    && Number.isSafeInteger(build.totalBytes)
    && build.totalBytes > 0;
}

function markerObservationIsComplete(marker) {
  return marker?.status === "observed"
    && marker.formatVersion === 1
    && marker.relativePath === BUILD_PROVENANCE_RELATIVE_PATH
    && FULL_SHA_PATTERN.test(marker.sourceRevisionSha ?? "")
    && typeof marker.buildId === "string"
    && marker.buildId.length > 0
    && DIGEST_PATTERN.test(marker.outputContentDigestSha256 ?? "")
    && marker.outputDigestDomain === BUILD_OUTPUT_DIGEST_DOMAIN
    && DIGEST_PATTERN.test(marker.fileDigestSha256 ?? "")
    && marker.fileDigestDomain === MARKER_FILE_DIGEST_DOMAIN;
}

function outputIdentitiesEqual(left, right) {
  return buildOutputObservationIsComplete(left)
    && buildOutputObservationIsComplete(right)
    && left.buildId === right.buildId
    && left.digestDomain === right.digestDomain
    && left.digestAlgorithm === right.digestAlgorithm
    && left.contentDigestSha256 === right.contentDigestSha256
    && left.fileCount === right.fileCount
    && left.totalBytes === right.totalBytes;
}

function markerIdentitiesEqual(left, right) {
  return markerObservationIsComplete(left)
    && markerObservationIsComplete(right)
    && left.formatVersion === right.formatVersion
    && left.relativePath === right.relativePath
    && left.sourceRevisionSha === right.sourceRevisionSha
    && left.buildId === right.buildId
    && left.outputContentDigestSha256 === right.outputContentDigestSha256
    && left.outputDigestDomain === right.outputDigestDomain
    && left.fileDigestSha256 === right.fileDigestSha256
    && left.fileDigestDomain === right.fileDigestDomain;
}

function canonicalReleaseReferenceIsComplete(reference) {
  return reference?.relativePath === BUILD_PROVENANCE_RELATIVE_PATH
    && FULL_SHA_PATTERN.test(reference.sourceRevisionSha ?? "")
    && typeof reference.buildId === "string"
    && reference.buildId.length > 0
    && DIGEST_PATTERN.test(reference.outputContentDigestSha256 ?? "")
    && reference.outputDigestDomain === BUILD_OUTPUT_DIGEST_DOMAIN
    && DIGEST_PATTERN.test(reference.markerFileDigestSha256 ?? "")
    && reference.markerFileDigestDomain === MARKER_FILE_DIGEST_DOMAIN;
}

function canonicalReleaseReferenceMatchesMarker(reference, marker) {
  return canonicalReleaseReferenceIsComplete(reference)
    && markerObservationIsComplete(marker)
    && reference.relativePath === marker.relativePath
    && reference.sourceRevisionSha === marker.sourceRevisionSha
    && reference.buildId === marker.buildId
    && reference.outputContentDigestSha256 === marker.outputContentDigestSha256
    && reference.outputDigestDomain === marker.outputDigestDomain
    && reference.markerFileDigestSha256 === marker.fileDigestSha256
    && reference.markerFileDigestDomain === marker.fileDigestDomain;
}

function canonicalReleaseReferencesEqual(left, right) {
  return canonicalReleaseReferenceIsComplete(left)
    && canonicalReleaseReferenceIsComplete(right)
    && left.relativePath === right.relativePath
    && left.sourceRevisionSha === right.sourceRevisionSha
    && left.buildId === right.buildId
    && left.outputContentDigestSha256 === right.outputContentDigestSha256
    && left.outputDigestDomain === right.outputDigestDomain
    && left.markerFileDigestSha256 === right.markerFileDigestSha256
    && left.markerFileDigestDomain === right.markerFileDigestDomain;
}

function profilingMarkerObservationIsComplete(marker) {
  const relativePath = marker?.relativePath;
  return marker?.status === "observed"
    && marker.formatVersion === 1
    && marker.buildRole === REACT_PROFILING_BUILD_ROLE
    && marker.reactProductionProfiling === true
    && typeof relativePath === "string"
    && relativePath !== BUILD_PROVENANCE_RELATIVE_PATH
    && relativePath.endsWith(`/${REACT_PROFILING_BUILD_PROVENANCE_FILENAME}`)
    && /^\.next-[a-z0-9]+(?:[._-][a-z0-9]+)*\//i.test(relativePath)
    && FULL_SHA_PATTERN.test(marker.sourceRevisionSha ?? "")
    && typeof marker.buildId === "string"
    && marker.buildId.length > 0
    && DIGEST_PATTERN.test(marker.outputContentDigestSha256 ?? "")
    && marker.outputDigestDomain === BUILD_OUTPUT_DIGEST_DOMAIN
    && DIGEST_PATTERN.test(marker.fileDigestSha256 ?? "")
    && marker.fileDigestDomain === MARKER_FILE_DIGEST_DOMAIN
    && canonicalReleaseReferenceIsComplete(marker.canonicalRelease)
    && marker.canonicalRelease.sourceRevisionSha === marker.sourceRevisionSha;
}

function profilingMarkerIdentitiesEqual(left, right) {
  return profilingMarkerObservationIsComplete(left)
    && profilingMarkerObservationIsComplete(right)
    && left.formatVersion === right.formatVersion
    && left.buildRole === right.buildRole
    && left.reactProductionProfiling === right.reactProductionProfiling
    && left.relativePath === right.relativePath
    && left.sourceRevisionSha === right.sourceRevisionSha
    && left.buildId === right.buildId
    && left.outputContentDigestSha256 === right.outputContentDigestSha256
    && left.outputDigestDomain === right.outputDigestDomain
    && left.fileDigestSha256 === right.fileDigestSha256
    && left.fileDigestDomain === right.fileDigestDomain
    && canonicalReleaseReferencesEqual(left.canonicalRelease, right.canonicalRelease);
}

export function createBuildDerivation({ repositoryBefore, repositoryAfter, buildBefore, buildAfter }) {
  const repositoryObserved = repositoryObservationIsComplete(repositoryBefore)
    && repositoryObservationIsComplete(repositoryAfter);
  const outputObserved = buildOutputObservationIsComplete(buildBefore)
    && buildOutputObservationIsComplete(buildAfter);
  const markerBefore = buildBefore?.provenanceMarker;
  const markerAfter = buildAfter?.provenanceMarker;
  const sourceRevisionMarkerPresent = markerObservationIsComplete(markerBefore)
    && markerObservationIsComplete(markerAfter);
  const repositoryStable = repositoryObserved
    && repositoryBefore.headSha === repositoryAfter.headSha
    && repositoryBefore.statusDigestSha256 === repositoryAfter.statusDigestSha256
    && repositoryBefore.dirty === repositoryAfter.dirty;
  const outputStable = outputIdentitiesEqual(buildBefore, buildAfter);
  const markerStable = markerIdentitiesEqual(markerBefore, markerAfter);
  const exactHeadMatch = sourceRevisionMarkerPresent && repositoryObserved
    ? markerBefore.sourceRevisionSha === repositoryBefore.headSha
      && markerAfter.sourceRevisionSha === repositoryAfter.headSha
    : null;
  const markerMatchesOutput = sourceRevisionMarkerPresent && outputObserved
    && markerBefore.buildId === buildBefore.buildId
    && markerAfter.buildId === buildAfter.buildId
    && markerBefore.outputContentDigestSha256 === buildBefore.contentDigestSha256
    && markerAfter.outputContentDigestSha256 === buildAfter.contentDigestSha256;
  const sealed = repositoryStable
    && repositoryBefore.dirty === false
    && repositoryAfter.dirty === false
    && outputStable
    && markerStable
    && exactHeadMatch === true
    && markerMatchesOutput;

  if (!sealed) {
    return {
      status: "unsealed",
      sourceRevisionMarkerPresent,
      exactHeadMatch,
      caveat: "No stable sealed marker binds one clean Git HEAD to the unchanged build output and exact marker-file bytes.",
    };
  }
  return {
    status: "sealed",
    sourceRevisionMarkerPresent: true,
    exactHeadMatch: true,
    sourceRevisionSha: repositoryBefore.headSha,
    buildId: buildBefore.buildId,
    contentDigestSha256: buildBefore.contentDigestSha256,
    marker: { ...markerBefore },
  };
}

export function createArtifactRevisionBinding({ repositoryBefore, repositoryAfter, buildBefore, buildAfter }) {
  const exactHeadObserved = repositoryObservationIsComplete(repositoryBefore)
    && repositoryObservationIsComplete(repositoryAfter);
  const dirtyStatusObserved = exactHeadObserved;
  const buildIdentityObserved = buildOutputObservationIsComplete(buildBefore)
    && buildOutputObservationIsComplete(buildAfter);
  if (!exactHeadObserved || !buildIdentityObserved) {
    return {
      status: "unbound",
      exactHeadObserved,
      dirtyStatusObserved,
      buildIdentityObserved,
      repositoryMarkersStableDuringCollection: false,
      buildStableDuringCollection: false,
      exactCleanRevision: false,
      releaseCandidateEligible: false,
      buildDerivationSealed: false,
      caveat: "Git HEAD, worktree state, and build identity were not all observed before and after collection; this artifact is not exact-revision evidence.",
    };
  }
  const repositoryMarkersStableDuringCollection = repositoryBefore.headSha === repositoryAfter.headSha
    && repositoryBefore.statusDigestSha256 === repositoryAfter.statusDigestSha256
    && repositoryBefore.dirty === repositoryAfter.dirty;
  const buildStableDuringCollection = outputIdentitiesEqual(buildBefore, buildAfter);
  if (!repositoryMarkersStableDuringCollection || !buildStableDuringCollection) {
    return {
      status: "changed-during-collection",
      exactHeadObserved: true,
      dirtyStatusObserved: true,
      buildIdentityObserved: true,
      repositoryMarkersStableDuringCollection,
      buildStableDuringCollection,
      exactCleanRevision: false,
      releaseCandidateEligible: false,
      buildDerivationSealed: false,
      caveat: "The source checkout or production build changed during collection; measurements cannot be bound to one stable candidate.",
    };
  }
  if (repositoryBefore.dirty) {
    return {
      status: "head-plus-dirty-worktree",
      exactHeadObserved: true,
      dirtyStatusObserved: true,
      buildIdentityObserved: true,
      repositoryMarkersStableDuringCollection: true,
      buildStableDuringCollection: true,
      exactCleanRevision: false,
      releaseCandidateEligible: false,
      buildDerivationSealed: false,
      caveat: "The artifact records the base HEAD and a digest of dirty status, but is not evidence for that commit alone.",
    };
  }
  const buildDerivation = createBuildDerivation({ repositoryBefore, repositoryAfter, buildBefore, buildAfter });
  const buildDerivationSealed = buildDerivation.status === "sealed";
  return {
    status: buildDerivationSealed ? "exact-clean-head-build-sealed" : "exact-clean-head-build-observed",
    exactHeadObserved: true,
    dirtyStatusObserved: true,
    buildIdentityObserved: true,
    repositoryMarkersStableDuringCollection: true,
    buildStableDuringCollection: true,
    exactCleanRevision: true,
    releaseCandidateEligible: buildDerivationSealed,
    buildDerivationSealed,
    caveat: buildDerivationSealed
      ? "The marker, exact clean Git HEAD, and build output identity stayed equal throughout collection."
      : "The clean source and build bytes stayed stable during collection, but no sealed marker proves those build bytes were produced from this HEAD.",
  };
}

function profilingBuildObservationIsComplete(build) {
  return buildOutputObservationIsComplete(build)
    && profilingMarkerObservationIsComplete(build.provenanceMarker);
}

export function createDualBuildBinding({
  repositoryBefore,
  repositoryAfter,
  canonicalBuildBefore,
  canonicalBuildAfter,
  profilingBuildBefore,
  profilingBuildAfter,
}) {
  const canonicalDerivation = createBuildDerivation({
    repositoryBefore,
    repositoryAfter,
    buildBefore: canonicalBuildBefore,
    buildAfter: canonicalBuildAfter,
  });
  const repositoryStable = repositoryObservationIsComplete(repositoryBefore)
    && repositoryObservationIsComplete(repositoryAfter)
    && repositoryBefore.dirty === false
    && repositoryAfter.dirty === false
    && repositoryBefore.headSha === repositoryAfter.headSha
    && repositoryBefore.statusDigestSha256 === repositoryAfter.statusDigestSha256;
  const profilingObserved = profilingBuildObservationIsComplete(profilingBuildBefore)
    && profilingBuildObservationIsComplete(profilingBuildAfter);
  const profilingOutputStable = outputIdentitiesEqual(profilingBuildBefore, profilingBuildAfter);
  const profilingMarkerStable = profilingMarkerIdentitiesEqual(
    profilingBuildBefore?.provenanceMarker,
    profilingBuildAfter?.provenanceMarker,
  );
  const profilingMarkerMatchesOutput = profilingObserved
    && profilingBuildBefore.provenanceMarker.buildId === profilingBuildBefore.buildId
    && profilingBuildAfter.provenanceMarker.buildId === profilingBuildAfter.buildId
    && profilingBuildBefore.provenanceMarker.outputContentDigestSha256
      === profilingBuildBefore.contentDigestSha256
    && profilingBuildAfter.provenanceMarker.outputContentDigestSha256
      === profilingBuildAfter.contentDigestSha256;
  const sameSourceRevision = profilingObserved && repositoryStable
    && profilingBuildBefore.provenanceMarker.sourceRevisionSha === repositoryBefore.headSha
    && profilingBuildAfter.provenanceMarker.sourceRevisionSha === repositoryAfter.headSha;
  const canonicalReferenceMatches = profilingObserved
    && canonicalReleaseReferenceMatchesMarker(
      profilingBuildBefore.provenanceMarker.canonicalRelease,
      canonicalBuildBefore?.provenanceMarker,
    )
    && canonicalReleaseReferenceMatchesMarker(
      profilingBuildAfter.provenanceMarker.canonicalRelease,
      canonicalBuildAfter?.provenanceMarker,
    );
  const sealed = repositoryStable
    && canonicalDerivation.status === "sealed"
    && profilingObserved
    && profilingOutputStable
    && profilingMarkerStable
    && profilingMarkerMatchesOutput
    && sameSourceRevision
    && canonicalReferenceMatches;

  if (!sealed) {
    return {
      status: "unsealed",
      canonicalReleaseSealed: canonicalDerivation.status === "sealed",
      profilingBuildObserved: profilingObserved,
      profilingOutputStable,
      profilingMarkerStable,
      profilingMarkerMatchesOutput,
      sameSourceRevision,
      canonicalReferenceMatches,
      releaseCandidateEligible: false,
      caveat: "Canonical release and React profiling outputs are not both sealed to one unchanged clean Git revision.",
    };
  }
  return {
    status: "exact-clean-head-dual-build-sealed",
    canonicalReleaseSealed: true,
    profilingBuildObserved: true,
    profilingOutputStable: true,
    profilingMarkerStable: true,
    profilingMarkerMatchesOutput: true,
    sameSourceRevision: true,
    canonicalReferenceMatches: true,
    releaseCandidateEligible: true,
    sourceRevisionSha: repositoryBefore.headSha,
    canonicalRelease: {
      buildId: canonicalBuildBefore.buildId,
      contentDigestSha256: canonicalBuildBefore.contentDigestSha256,
      marker: { ...canonicalBuildBefore.provenanceMarker },
    },
    reactProfiling: {
      buildId: profilingBuildBefore.buildId,
      contentDigestSha256: profilingBuildBefore.contentDigestSha256,
      marker: { ...profilingBuildBefore.provenanceMarker },
    },
  };
}

export function createRuntimeApplicability({
  requestedDurationMs,
  actualDurationMs,
  memorySampleCount = 0,
  finiteHeapSampleCount = 0,
  sampleIntervalMs = null,
  firstFiniteHeapElapsedMs = null,
  lastFiniteHeapElapsedMs = null,
  syntheticVisibilityOverrideInstalled,
  nativeHiddenObserved,
  nativeHiddenMeasurementDurationMs = 0,
  reactCommitObserverInstalled,
  reactRendererCount = 0,
  reactExperimentCommitCount = 0,
  reactProfilingFieldsObserved = false,
  reactProfiledComponents = [],
  reactRendererDetails = [],
  simulatedAutoMinerMeasurementDurationMs = 0,
  simulatedAutoMinerTickCount = 0,
  simulatedAutoMinerUiStateObserved = false,
  blockedApiWriteRequestCount = 0,
}) {
  const requestedDurationCompleted = actualDurationMs >= requestedDurationMs;
  const idleTwoHourDurationCompleted = requestedDurationMs === TWO_HOURS_MS
    && actualDurationMs >= TWO_HOURS_MS;
  const validSampleInterval = Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0;
  const expectedHeapSampleCount = validSampleInterval
    ? Math.floor(requestedDurationMs / sampleIntervalMs) + 1
    : null;
  const minimumHeapSampleCount = expectedHeapSampleCount == null
    ? null
    : Math.max(2, Math.ceil(expectedHeapSampleCount * 0.8));
  const finiteHeapWindowMs = Number.isFinite(firstFiniteHeapElapsedMs)
    && Number.isFinite(lastFiniteHeapElapsedMs)
    && lastFiniteHeapElapsedMs >= firstFiniteHeapElapsedMs
    ? lastFiniteHeapElapsedMs - firstFiniteHeapElapsedMs
    : 0;
  const minimumHeapWindowMs = validSampleInterval
    ? Math.max(0, requestedDurationMs - (2 * sampleIntervalMs))
    : null;
  const idleTwoHourMemoryObservationCompleted = idleTwoHourDurationCompleted
    && minimumHeapSampleCount != null
    && minimumHeapWindowMs != null
    && memorySampleCount >= minimumHeapSampleCount
    && finiteHeapSampleCount >= minimumHeapSampleCount
    && finiteHeapWindowMs >= minimumHeapWindowMs;
  const nativeHiddenPhaseMeasured = nativeHiddenObserved === true
    && Number.isFinite(nativeHiddenMeasurementDurationMs)
    && nativeHiddenMeasurementDurationMs > 0;
  const simulatedAutoMinerPhaseMeasured = Number.isFinite(simulatedAutoMinerMeasurementDurationMs)
    && simulatedAutoMinerMeasurementDurationMs >= MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS
    && Number.isInteger(simulatedAutoMinerTickCount)
    && simulatedAutoMinerTickCount > 0
    && simulatedAutoMinerUiStateObserved === true
    && blockedApiWriteRequestCount === 0;
  const blockers = [];
  if (!syntheticVisibilityOverrideInstalled) {
    blockers.push("Synthetic visibility branching was not measured because the document override was unavailable.");
  }
  if (!nativeHiddenPhaseMeasured) {
    blockers.push(nativeHiddenObserved
      ? "A native hidden state was observed only during the background probe; no native hidden polling/throttling phase was measured."
      : "No native hidden state or native hidden polling/throttling phase was measured.");
  }
  if (!reactCommitObserverInstalled) {
    blockers.push("The React root-commit observer was unavailable; rerender activity was not measured.");
  } else if (reactRendererCount === 0) {
    blockers.push("No React renderer registered with the root-commit observer; its commit counts are not usable evidence.");
  }
  const validProfiledComponents = Array.isArray(reactProfiledComponents)
    && reactProfiledComponents.length > 0
    && reactProfiledComponents.every((component) => isRecord(component)
      && typeof component.name === "string"
      && component.name.length > 0
      && Number.isInteger(component.commitCount)
      && component.commitCount >= 0
      && isFiniteNonNegative(component.actualDurationMs));
  const componentProfilerCollected = reactProfilingFieldsObserved === true && validProfiledComponents;
  if (!componentProfilerCollected) {
    blockers.push(reactProfilingFieldsObserved
      ? "React profiling fields were observed, but no component-level timings were collected during the measured window."
      : "The standard production React renderer exposes no profiling duration fields; a separate opt-in profiling build is required for component-level timings.");
  }
  if (!simulatedAutoMinerPhaseMeasured) {
    blockers.push("The read-only Auto-Miner UI simulation did not complete a verified >=60s phase with zero API-write attempts.");
  }
  if (!idleTwoHourDurationCompleted) {
    blockers.push("This run did not complete a two-hour idle duration.");
  } else if (!idleTwoHourMemoryObservationCompleted) {
    blockers.push("The idle phase reached two hours, but finite heap samples did not cover almost the full window at sufficient density; no two-hour memory observation is claimed.");
  }

  return {
    workload: {
      kind: simulatedAutoMinerPhaseMeasured ? "idle-plus-simulated-auto-miner-ui" : "idle-read-only",
      walletAuthenticated: false,
      chainWritesAllowed: false,
    },
    duration: {
      requestedDurationMs,
      actualDurationMs,
      requestedDurationCompleted,
      idleTwoHourDurationCompleted,
      idleTwoHourMemoryObservationCompleted,
      autoMinerTwoHourDurationCompleted: false,
      autoMinerTwoHourMemoryObservationCompleted: false,
      fullTwoHourSoakCompleted: false,
      applicability: idleTwoHourMemoryObservationCompleted
        ? "two-hour idle memory observation only"
        : idleTwoHourDurationCompleted
          ? "two-hour idle duration only; memory observation incomplete"
        : "bounded idle observation only",
      memoryCoverage: {
        sampleIntervalMs: validSampleInterval ? sampleIntervalMs : null,
        sampleCount: memorySampleCount,
        finiteHeapSampleCount,
        expectedHeapSampleCount,
        minimumHeapSampleCount,
        finiteHeapWindowMs,
        minimumHeapWindowMs,
        sufficientForTwoHourObservation: idleTwoHourMemoryObservationCompleted,
      },
    },
    visibility: {
      syntheticAppBranching: {
        status: syntheticVisibilityOverrideInstalled ? "measured" : "not-measured",
        pollingMeasured: syntheticVisibilityOverrideInstalled,
        applicability: "application visibilitychange branches only; not browser background throttling",
      },
      nativeBrowserBackground: {
        status: nativeHiddenPhaseMeasured
          ? "measured"
          : nativeHiddenObserved
            ? "probe-only"
            : "not-observed",
        nativeHiddenObserved,
        pollingMeasured: nativeHiddenPhaseMeasured,
        measuredDurationMs: nativeHiddenPhaseMeasured ? nativeHiddenMeasurementDurationMs : 0,
        applicability: nativeHiddenPhaseMeasured
          ? "native browser hidden-state polling/throttling"
          : "no native hidden-state polling/throttling conclusion",
      },
    },
    reactRerenders: {
      status: componentProfilerCollected
        ? "measured"
        : reactCommitObserverInstalled && reactRendererCount > 0
          ? "root-commits-measured"
          : "not-collected",
      rootCommitObserverInstalled: reactCommitObserverInstalled,
      rendererCount: reactCommitObserverInstalled ? reactRendererCount : null,
      experimentRootCommitCount: reactCommitObserverInstalled ? reactExperimentCommitCount : null,
      rendererDetails: Array.isArray(reactRendererDetails) ? reactRendererDetails : [],
      profilingFieldsObserved: reactProfilingFieldsObserved === true,
      componentProfilerCollected,
      componentRerenderCount: componentProfilerCollected
        ? sum(reactProfiledComponents.map((component) => component.commitCount))
        : null,
      componentRenderDurationMs: componentProfilerCollected
        ? Math.round(sum(reactProfiledComponents.map((component) => component.actualDurationMs)) * 100) / 100
        : null,
      profiledComponents: componentProfilerCollected ? reactProfiledComponents : [],
      applicability: componentProfilerCollected
        ? "component-level rerender counts and exclusive render durations from a React production profiling renderer"
        : reactCommitObserverInstalled
          ? "root commit diagnostics only; does not satisfy component rerender attribution or React Profiler duration evidence"
          : "no React rerender conclusion",
    },
    autoMiner: {
      status: simulatedAutoMinerPhaseMeasured ? "measured" : "not-collected",
      mode: simulatedAutoMinerPhaseMeasured ? "simulated-read-only" : null,
      phaseMeasured: simulatedAutoMinerPhaseMeasured,
      measuredDurationMs: simulatedAutoMinerPhaseMeasured ? simulatedAutoMinerMeasurementDurationMs : 0,
      simulationTickCount: simulatedAutoMinerPhaseMeasured ? simulatedAutoMinerTickCount : 0,
      uiStateObserved: simulatedAutoMinerPhaseMeasured && simulatedAutoMinerUiStateObserved,
      twoHourApplicable: false,
      twoHourCompleted: false,
      safety: {
        simulationOnly: true,
        walletAuthenticated: false,
        chainWritesAllowed: false,
        transactionSubmissionDisabled: true,
        transactionAttemptCount: 0,
        apiWritesFulfilled: false,
      },
      applicability: simulatedAutoMinerPhaseMeasured
        ? "local-only Auto-Miner presentation override; real mining runner, wallet, and transaction paths remain disabled"
        : "idle shell only; no wallet authentication, Auto-Miner start, or transaction path",
    },
    blockers,
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function validateRepositoryObservation(repository) {
  return isRecord(repository)
    && repository.status === "observed"
    && FULL_SHA_PATTERN.test(repository.headSha ?? "")
    && repository.dirty === false
    && repository.entryCount === 0
    && repository.trackedEntryCount === 0
    && repository.untrackedEntryCount === 0
    && repository.conflictedEntryCount === 0
    && repository.statusDigestSha256 === CLEAN_PORCELAIN_DIGEST_SHA256;
}

function validateBuildObservation(build) {
  return isRecord(build)
    && buildOutputObservationIsComplete(build)
    && markerObservationIsComplete(build.provenanceMarker);
}

function validateProfilingBuildContainer(profilingBuild) {
  const outputDirectory = profilingBuild?.outputDirectory;
  const expectedMarkerPath = typeof outputDirectory === "string"
    ? `${outputDirectory}/${REACT_PROFILING_BUILD_PROVENANCE_FILENAME}`
    : "";
  return isRecord(profilingBuild)
    && profilingBuild.status === "observed"
    && profilingBuild.role === REACT_PROFILING_BUILD_ROLE
    && typeof outputDirectory === "string"
    && /^\.next-[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(outputDirectory)
    && profilingBuildObservationIsComplete(profilingBuild.identityAtStart)
    && profilingBuildObservationIsComplete(profilingBuild.identityAtEnd)
    && profilingBuild.identityAtStart.provenanceMarker.relativePath === expectedMarkerPath
    && profilingBuild.identityAtEnd.provenanceMarker.relativePath === expectedMarkerPath;
}

function validateCompressionMeasurement(measurement) {
  return isRecord(measurement)
    && isFiniteNonNegative(measurement.rawBytes)
    && isFiniteNonNegative(measurement.gzipBytes)
    && isFiniteNonNegative(measurement.brotliBytes);
}

function validateOwnerAttribution(owners) {
  if (!isRecord(owners)) return false;
  const labels = [owners.appSources, owners.packages, owners.framework]
    .filter(Array.isArray)
    .flat();
  return labels.length > 0
    && labels.every((label) => typeof label === "string" && label.length > 0)
    && typeof owners.attribution === "string"
    && owners.attribution.length > 0;
}

function validateMemoryCoverage(runtime) {
  const coverage = runtime?.memoryCoverage;
  const memory = runtime?.memory;
  const samples = memory?.samples;
  if (!isRecord(coverage) || !isRecord(memory) || !Array.isArray(samples)) return false;
  const intervalMs = coverage.sampleIntervalMs;
  if (!isFinitePositive(intervalMs) || intervalMs > 60_000) return false;
  const expectedSampleCount = Math.floor(TWO_HOURS_MS / intervalMs) + 1;
  const minimumSampleCount = Math.max(2, Math.ceil(expectedSampleCount * 0.8));
  const finiteSamples = samples.filter((sample) => isRecord(sample)
    && isFiniteNonNegative(sample.elapsedMs)
    && isFiniteNonNegative(sample.jsHeapUsedBytes));
  const monotonic = finiteSamples.every((sample, index) => index === 0
    || sample.elapsedMs > finiteSamples[index - 1].elapsedMs);
  const firstElapsedMs = finiteSamples[0]?.elapsedMs ?? Number.POSITIVE_INFINITY;
  const lastElapsedMs = finiteSamples.at(-1)?.elapsedMs ?? Number.NEGATIVE_INFINITY;
  const finiteWindowMs = lastElapsedMs - firstElapsedMs;
  const minimumWindowMs = Math.max(0, TWO_HOURS_MS - (2 * intervalMs));
  return runtime.requestedDurationMs === TWO_HOURS_MS
    && runtime.actualDurationMs >= TWO_HOURS_MS
    && runtime.requestedDurationCompleted === true
    && runtime.idleTwoHourDurationCompleted === true
    && runtime.idleTwoHourMemoryObservationCompleted === true
    && memory.sampleCount === samples.length
    && samples.length >= minimumSampleCount
    && finiteSamples.length >= minimumSampleCount
    && monotonic
    && firstElapsedMs <= intervalMs
    && finiteWindowMs >= minimumWindowMs
    && coverage.sampleCount === samples.length
    && coverage.finiteHeapSampleCount === finiteSamples.length
    && coverage.expectedHeapSampleCount === expectedSampleCount
    && coverage.minimumHeapSampleCount === minimumSampleCount
    && coverage.finiteHeapWindowMs === finiteWindowMs
    && coverage.minimumHeapWindowMs === minimumWindowMs
    && coverage.sufficientForTwoHourObservation === true
    && memory.trendQualifiedForLeakAssessment === true;
}

function validateNativeHiddenEvidence(runtime) {
  const hidden = runtime?.visibility?.coverage?.nativeBrowserBackground;
  const phase = runtime?.polling?.phases?.["native-hidden"];
  return isRecord(hidden)
    && hidden.status === "measured"
    && hidden.nativeHiddenObserved === true
    && hidden.pollingMeasured === true
    && hidden.measuredDurationMs >= MIN_NATIVE_HIDDEN_EVIDENCE_MS
    && isRecord(phase)
    && phase.actualMs === hidden.measuredDurationMs
    && phase.actualMs >= MIN_NATIVE_HIDDEN_EVIDENCE_MS
    && isFiniteNonNegative(phase.total)
    && isRecord(phase.byPath);
}

function validateComponentProfilerEvidence(runtime) {
  const profiler = runtime?.reactRerenders;
  const components = profiler?.profiledComponents;
  if (!isRecord(profiler) || !Array.isArray(components) || components.length === 0) return false;
  const validComponents = components.every((component) => isRecord(component)
    && typeof component.name === "string"
    && component.name.length > 0
    && Number.isInteger(component.commitCount)
    && component.commitCount >= 0
    && isFiniteNonNegative(component.actualDurationMs));
  if (!validComponents) return false;
  const componentDurationMs = sum(components.map((component) => component.actualDurationMs));
  return profiler.status === "measured"
    && profiler.rootCommitObserverInstalled === true
    && Number.isInteger(profiler.rendererCount)
    && profiler.rendererCount > 0
    && profiler.componentProfilerCollected === true
    && profiler.componentRerenderCount === sum(components.map((component) => component.commitCount))
    && isFiniteNonNegative(profiler.componentRenderDurationMs)
    && Math.abs(profiler.componentRenderDurationMs - componentDurationMs) <= 0.01;
}

function validateSimulatedAutoMinerEvidence(runtime) {
  const autoMiner = runtime?.autoMiner;
  const safety = autoMiner?.safety;
  const phase = runtime?.polling?.phases?.["simulated-auto-miner"];
  return isRecord(autoMiner)
    && autoMiner.status === "measured"
    && autoMiner.mode === "simulated-read-only"
    && autoMiner.phaseMeasured === true
    && autoMiner.measuredDurationMs >= MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS
    && Number.isInteger(autoMiner.simulationTickCount)
    && autoMiner.simulationTickCount > 0
    && autoMiner.uiStateObserved === true
    && isRecord(safety)
    && safety.simulationOnly === true
    && safety.walletAuthenticated === false
    && safety.chainWritesAllowed === false
    && safety.transactionSubmissionDisabled === true
    && safety.transactionAttemptCount === 0
    && safety.apiWritesFulfilled === false
    && isRecord(phase)
    && phase.actualMs === autoMiner.measuredDurationMs
    && phase.actualMs >= MIN_SIMULATED_AUTO_MINER_EVIDENCE_MS
    && isFiniteNonNegative(phase.total)
    && isRecord(phase.byPath);
}

function validateBuildMeasurements(build) {
  if (!isRecord(build)
    || build.status !== "measured"
    || !Array.isArray(build.routes)
    || build.routes.length === 0
    || !Array.isArray(build.largestChunks)
    || build.largestChunks.length === 0
    || !Array.isArray(build.missingRouteManifests)
    || build.missingRouteManifests.length !== 0
    || !Array.isArray(build.missingAssets)
    || build.missingAssets.length !== 0) {
    return false;
  }
  const routesValid = build.routes.every((route) => isRecord(route)
    && typeof route.route === "string"
    && route.route.startsWith("/")
    && route.status === "measured"
    && Array.isArray(route.missingAssets)
    && route.missingAssets.length === 0
    && validateCompressionMeasurement(route.manifestAssetSet));
  const chunksValid = build.largestChunks.every((chunk) => validateCompressionMeasurement(chunk)
    && validateOwnerAttribution(chunk.owners));
  return routesValid && chunksValid;
}

function validateDurationSummary(summary) {
  return isRecord(summary)
    && Number.isInteger(summary.count)
    && summary.count >= 0
    && isFiniteNonNegative(summary.totalMs)
    && isFiniteNonNegative(summary.longestMs)
    && (summary.p95Ms === null || isFiniteNonNegative(summary.p95Ms));
}

function validateRuntimeMeasurements(runtime, build) {
  const firstLoad = runtime?.routeFirstLoad;
  const longTasks = runtime?.longTasks;
  if (!isRecord(firstLoad)
    || firstLoad.status !== "measured"
    || !Array.isArray(firstLoad.routes)
    || firstLoad.routes.length === 0
    || !isRecord(longTasks)
    || longTasks.supported !== true
    || !validateDurationSummary(longTasks.initialLoad)
    || !validateDurationSummary(longTasks.experiment)
    || !isRecord(longTasks.byPhase)) {
    return false;
  }
  const expectedRoutes = new Set(build?.routes?.map((route) => route.route) ?? []);
  const observedRoutes = new Set(firstLoad.routes.map((route) => route.route));
  const routesMatch = expectedRoutes.size === observedRoutes.size
    && [...expectedRoutes].every((route) => observedRoutes.has(route));
  const routesValid = firstLoad.routes.every((route) => isRecord(route)
    && typeof route.route === "string"
    && route.route.startsWith("/")
    && route.status === "measured"
    && Number.isInteger(route.httpStatus)
    && route.httpStatus >= 200
    && route.httpStatus < 400
    && Array.isArray(route.missingAssets)
    && route.missingAssets.length === 0
    && validateCompressionMeasurement(route.firstLoadModern));
  const phaseSummariesValid = ["native-hidden", "simulated-auto-miner"].every(
    (phase) => validateDurationSummary(longTasks.byPhase[phase]),
  );
  return routesMatch
    && routesValid
    && phaseSummariesValid
    && isFiniteNonNegative(runtime?.polling?.blockedExternalRequestCount);
}

export function assessStrictPerformanceEvidence(report) {
  const failures = [];
  const requireCheck = (condition, code) => {
    if (!condition) failures.push(code);
  };
  const repositoryBefore = report?.provenance?.repositoryBefore;
  const repositoryAfter = report?.provenance?.repositoryAfter;
  const binding = report?.provenance?.artifactRevisionBinding;
  const derivation = report?.provenance?.buildDerivation;
  const dualBinding = report?.provenance?.dualBuildBinding;
  const build = report?.build;
  const buildBefore = build?.identityAtStart;
  const buildAfter = build?.identityAtEnd;
  const profilingBuild = report?.profilingBuild;
  const profilingBuildBefore = profilingBuild?.identityAtStart;
  const profilingBuildAfter = profilingBuild?.identityAtEnd;
  const runtime = report?.runtime;
  const expectedDerivation = createBuildDerivation({
    repositoryBefore,
    repositoryAfter,
    buildBefore,
    buildAfter,
  });
  const expectedBinding = createArtifactRevisionBinding({
    repositoryBefore,
    repositoryAfter,
    buildBefore,
    buildAfter,
  });
  const expectedDualBinding = createDualBuildBinding({
    repositoryBefore,
    repositoryAfter,
    canonicalBuildBefore: buildBefore,
    canonicalBuildAfter: buildAfter,
    profilingBuildBefore,
    profilingBuildAfter,
  });

  requireCheck(isRecord(report) && report.schemaVersion === 3, "schema.version");
  requireCheck(report?.status === "complete", "report.complete");
  requireCheck(validateRepositoryObservation(repositoryBefore)
    && validateRepositoryObservation(repositoryAfter), "provenance.repository.clean");
  requireCheck(repositoryBefore?.headSha === repositoryAfter?.headSha
    && repositoryBefore?.statusDigestSha256 === repositoryAfter?.statusDigestSha256,
  "provenance.repository.stable");
  requireCheck(validateBuildObservation(buildBefore)
    && validateBuildObservation(buildAfter), "provenance.build.identity");
  requireCheck(outputIdentitiesEqual(buildBefore, buildAfter),
  "provenance.build.stable");
  requireCheck(isRecord(binding)
    && expectedBinding.status === "exact-clean-head-build-sealed"
    && binding.status === expectedBinding.status
    && binding.exactHeadObserved === true
    && binding.dirtyStatusObserved === true
    && binding.buildIdentityObserved === true
    && binding.repositoryMarkersStableDuringCollection === true
    && binding.buildStableDuringCollection === true
    && binding.exactCleanRevision === true
    && binding.buildDerivationSealed === true
    && binding.releaseCandidateEligible === true, "provenance.binding.sealed");
  requireCheck(isRecord(derivation)
    && expectedDerivation.status === "sealed"
    && derivation.status === expectedDerivation.status
    && derivation.sourceRevisionMarkerPresent === true
    && derivation.exactHeadMatch === true
    && derivation.sourceRevisionSha === expectedDerivation.sourceRevisionSha
    && derivation.buildId === expectedDerivation.buildId
    && derivation.contentDigestSha256 === expectedDerivation.contentDigestSha256,
  "provenance.derivation.sealed");
  requireCheck(markerIdentitiesEqual(buildBefore?.provenanceMarker, buildAfter?.provenanceMarker)
    && markerIdentitiesEqual(derivation?.marker, expectedDerivation.marker),
  "provenance.derivation.marker");
  requireCheck(build?.outputDirectory === ".next", "provenance.canonical.output");
  requireCheck(validateProfilingBuildContainer(profilingBuild), "provenance.profiling.identity");
  requireCheck(outputIdentitiesEqual(profilingBuildBefore, profilingBuildAfter)
    && profilingMarkerIdentitiesEqual(
      profilingBuildBefore?.provenanceMarker,
      profilingBuildAfter?.provenanceMarker,
    ), "provenance.profiling.stable");
  requireCheck(isRecord(dualBinding)
    && expectedDualBinding.status === "exact-clean-head-dual-build-sealed"
    && dualBinding.status === expectedDualBinding.status
    && dualBinding.canonicalReleaseSealed === true
    && dualBinding.profilingBuildObserved === true
    && dualBinding.profilingOutputStable === true
    && dualBinding.profilingMarkerStable === true
    && dualBinding.profilingMarkerMatchesOutput === true
    && dualBinding.sameSourceRevision === true
    && dualBinding.canonicalReferenceMatches === true
    && dualBinding.releaseCandidateEligible === true
    && dualBinding.sourceRevisionSha === expectedDualBinding.sourceRevisionSha
    && dualBinding.canonicalRelease?.buildId === expectedDualBinding.canonicalRelease?.buildId
    && dualBinding.canonicalRelease?.contentDigestSha256
      === expectedDualBinding.canonicalRelease?.contentDigestSha256
    && markerIdentitiesEqual(
      dualBinding.canonicalRelease?.marker,
      expectedDualBinding.canonicalRelease?.marker,
    )
    && dualBinding.reactProfiling?.buildId === expectedDualBinding.reactProfiling?.buildId
    && dualBinding.reactProfiling?.contentDigestSha256
      === expectedDualBinding.reactProfiling?.contentDigestSha256
    && profilingMarkerIdentitiesEqual(
      dualBinding.reactProfiling?.marker,
      expectedDualBinding.reactProfiling?.marker,
    ), "provenance.dual.sealed");
  requireCheck(build?.buildId === buildBefore?.buildId, "build.identity.match");
  requireCheck(validateBuildMeasurements(build), "build.measurements.complete");
  requireCheck(isRecord(runtime)
    && runtime.status === "measured"
    && Array.isArray(runtime.blockers)
    && runtime.blockers.length === 0, "runtime.complete");
  requireCheck(runtime?.safety?.temporaryProfile === true
    && runtime?.safety?.dedicatedProfile === true
    && ["headless", "headed-native-hidden"].includes(runtime?.safety?.browserMode)
    && runtime?.safety?.externalBrowserRequestsBlocked === true
    && typeof runtime?.safety?.serverExternalNetworkGuard === "string"
    && runtime.safety.serverExternalNetworkGuard.startsWith("global fetch")
    && runtime?.safety?.apiWritesFulfilled === false, "runtime.safety.read-only");
  requireCheck(validateRuntimeMeasurements(runtime, build), "runtime.measurements.complete");
  requireCheck(validateMemoryCoverage(runtime), "runtime.memory.two-hour-coverage");
  requireCheck(validateNativeHiddenEvidence(runtime), "runtime.visibility.native-hidden-timed");
  requireCheck(validateComponentProfilerEvidence(runtime), "runtime.react.component-profiler");
  requireCheck(validateSimulatedAutoMinerEvidence(runtime), "runtime.auto-miner.safe-simulation");

  return {
    status: failures.length === 0 ? "pass" : "fail",
    schemaVersion: report?.schemaVersion ?? null,
    exactHeadSha: FULL_SHA_PATTERN.test(repositoryBefore?.headSha ?? "")
      ? repositoryBefore.headSha
      : null,
    buildId: typeof buildBefore?.buildId === "string" ? buildBefore.buildId : null,
    failures,
  };
}

export function assessPerformanceEvidenceAgainstCurrentBuild(report, current) {
  const failures = [];
  const requireCheck = (condition, code) => {
    if (!condition) failures.push(code);
  };
  const repositoryBefore = current?.repositoryBefore;
  const repositoryAfter = current?.repositoryAfter;
  const buildBefore = current?.buildBefore;
  const buildAfter = current?.buildAfter;
  const profilingBuildBefore = current?.profilingBuildBefore;
  const profilingBuildAfter = current?.profilingBuildAfter;
  const currentDerivation = createBuildDerivation({
    repositoryBefore,
    repositoryAfter,
    buildBefore,
    buildAfter,
  });
  const artifactRepositoryBefore = report?.provenance?.repositoryBefore;
  const artifactRepositoryAfter = report?.provenance?.repositoryAfter;
  const artifactBuildBefore = report?.build?.identityAtStart;
  const artifactBuildAfter = report?.build?.identityAtEnd;
  const artifactMarker = report?.provenance?.buildDerivation?.marker;
  const artifactProfilingBuildBefore = report?.profilingBuild?.identityAtStart;
  const artifactProfilingBuildAfter = report?.profilingBuild?.identityAtEnd;
  const currentDualBinding = createDualBuildBinding({
    repositoryBefore,
    repositoryAfter,
    canonicalBuildBefore: buildBefore,
    canonicalBuildAfter: buildAfter,
    profilingBuildBefore,
    profilingBuildAfter,
  });

  requireCheck(validateRepositoryObservation(repositoryBefore)
    && validateRepositoryObservation(repositoryAfter), "current.repository.clean");
  requireCheck(repositoryBefore?.headSha === repositoryAfter?.headSha
    && repositoryBefore?.statusDigestSha256 === repositoryAfter?.statusDigestSha256,
  "current.repository.stable");
  requireCheck(validateBuildObservation(buildBefore)
    && validateBuildObservation(buildAfter)
    && currentDerivation.status === "sealed", "current.build.identity");
  requireCheck(outputIdentitiesEqual(buildBefore, buildAfter)
    && markerIdentitiesEqual(buildBefore?.provenanceMarker, buildAfter?.provenanceMarker),
  "current.build.stable");
  requireCheck(validateRepositoryObservation(artifactRepositoryBefore)
    && validateRepositoryObservation(artifactRepositoryAfter)
    && artifactRepositoryBefore.headSha === repositoryBefore?.headSha
    && artifactRepositoryAfter.headSha === repositoryAfter?.headSha
    && artifactRepositoryBefore.statusDigestSha256 === repositoryBefore?.statusDigestSha256
    && artifactRepositoryAfter.statusDigestSha256 === repositoryAfter?.statusDigestSha256,
  "current.artifact.repository");
  requireCheck(outputIdentitiesEqual(artifactBuildBefore, buildBefore)
    && outputIdentitiesEqual(artifactBuildAfter, buildAfter), "current.artifact.build");
  requireCheck(markerIdentitiesEqual(artifactBuildBefore?.provenanceMarker, buildBefore?.provenanceMarker)
    && markerIdentitiesEqual(artifactBuildAfter?.provenanceMarker, buildAfter?.provenanceMarker)
    && markerIdentitiesEqual(artifactMarker, buildAfter?.provenanceMarker),
  "current.artifact.marker");
  requireCheck(profilingBuildObservationIsComplete(profilingBuildBefore)
    && profilingBuildObservationIsComplete(profilingBuildAfter)
    && currentDualBinding.status === "exact-clean-head-dual-build-sealed",
  "current.profiling.identity");
  requireCheck(outputIdentitiesEqual(profilingBuildBefore, profilingBuildAfter)
    && profilingMarkerIdentitiesEqual(
      profilingBuildBefore?.provenanceMarker,
      profilingBuildAfter?.provenanceMarker,
    ), "current.profiling.stable");
  requireCheck(outputIdentitiesEqual(artifactProfilingBuildBefore, profilingBuildBefore)
    && outputIdentitiesEqual(artifactProfilingBuildAfter, profilingBuildAfter),
  "current.artifact.profiling-build");
  requireCheck(profilingMarkerIdentitiesEqual(
    artifactProfilingBuildBefore?.provenanceMarker,
    profilingBuildBefore?.provenanceMarker,
  ) && profilingMarkerIdentitiesEqual(
    artifactProfilingBuildAfter?.provenanceMarker,
    profilingBuildAfter?.provenanceMarker,
  ), "current.artifact.profiling-marker");

  return {
    status: failures.length === 0 ? "pass" : "fail",
    currentHeadSha: FULL_SHA_PATTERN.test(repositoryBefore?.headSha ?? "")
      ? repositoryBefore.headSha
      : null,
    currentBuildId: typeof buildBefore?.buildId === "string" ? buildBefore.buildId : null,
    currentProfilingBuildId: typeof profilingBuildBefore?.buildId === "string"
      ? profilingBuildBefore.buildId
      : null,
    failures,
  };
}
