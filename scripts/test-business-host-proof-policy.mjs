import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  formatHostLaunchGateSummary,
  formatMissingHostArtifactRefs,
  hasHostProofIsoTimestamp,
  hasNonFutureHostProofIsoTimestamp,
  hostProofFileSummaryStatus,
  hostProofRegularFileStat,
} from "./host-proof-policy.mjs";

export function runHostProofPolicyTests() {
  const nowMs = Date.parse("2026-08-14T05:00:00.000Z");
  assert.equal(hasHostProofIsoTimestamp("2026-08-14T05:00:00.000Z"), true);
  assert.equal(hasHostProofIsoTimestamp("2026-08-14T05:00:00Z"), true);
  assert.equal(hasHostProofIsoTimestamp(" 2026-08-14T05:00:00.000Z "), true);
  for (const value of [
    "2026-08-14T05:00:00.00Z",
    "2026-08-14T05:00:00+00:00",
    "2026-02-30T05:00:00.000Z",
    "TODO",
    "",
    null,
  ]) {
    assert.equal(hasHostProofIsoTimestamp(value), false, `invalid host timestamp must fail: ${String(value)}`);
  }
  assert.equal(hasNonFutureHostProofIsoTimestamp("2026-08-14T05:05:00.000Z", nowMs), true);
  assert.equal(hasNonFutureHostProofIsoTimestamp("2026-08-14T05:05:00.001Z", nowMs), false);
  assert.equal(hasNonFutureHostProofIsoTimestamp("2026-08-13T05:00:00.000Z", nowMs), true);
  assert.equal(hasNonFutureHostProofIsoTimestamp("2026-08-14T05:00:00.000Z", Number.NaN), false);
  const broadTimestampMutant = (value) => Number.isFinite(Date.parse(String(value)));
  assert.equal(broadTimestampMutant("2026-08-14T05:05:00.001Z"), true);
  assert.equal(
    hasNonFutureHostProofIsoTimestamp("2026-08-14T05:05:00.001Z", nowMs),
    false,
    "future-only parser mutant must be rejected",
  );

  const calls = [];
  const fileStats = { isFile: () => true, size: 12 };
  const directoryStats = { isFile: () => false, size: 0 };
  assert.equal(hostProofRegularFileStat("proof.json", (path) => {
    calls.push(path);
    return fileStats;
  }), fileStats);
  assert.deepEqual(calls, ["proof.json"]);
  assert.equal(hostProofRegularFileStat("proof-dir", () => directoryStats), null);
  assert.equal(hostProofRegularFileStat("missing", () => { throw new Error("missing"); }), null);
  assert.equal(hostProofFileSummaryStatus("proof.json", () => fileStats), "present");
  assert.equal(hostProofFileSummaryStatus("proof-dir", () => directoryStats), "missing");

  const findings = [
    "$.processModel.site -> C:\\sensitive\\site.json",
    "$.processModel.bot -> C:\\sensitive\\bot.json",
    "$.persistentDb -> C:\\sensitive\\db.json",
    "$.healthProd -> C:\\sensitive\\health.log",
    "$.loadHttp -> C:\\sensitive\\load.log",
    "$.externalRateLimit -> C:\\sensitive\\rate.json",
  ];
  assert.equal(
    formatMissingHostArtifactRefs(findings, true),
    "$.processModel.site, $.processModel.bot, $.persistentDb, $.healthProd, $.loadHttp",
  );
  assert.equal(formatMissingHostArtifactRefs(findings, true).includes("sensitive"), false);
  assert.equal(formatMissingHostArtifactRefs(findings, false).split(", ").length, 5);
  assert.equal(formatMissingHostArtifactRefs(null, true), "");
  const rawPathMutant = (entries) => entries.slice(0, 5).join(", ");
  assert.equal(rawPathMutant(findings).includes("sensitive"), true);
  assert.equal(formatMissingHostArtifactRefs(findings, true).includes("sensitive"), false);

  assert.equal(formatHostLaunchGateSummary(0), "covered gates: G5, G6; groups: host=2");
  assert.equal(formatHostLaunchGateSummary(1), "blocked gates: G5, G6; groups: host=2");
  assert.equal(formatHostLaunchGateSummary(-1), "blocked gates: G5, G6; groups: host=2");
  assert.equal(formatHostLaunchGateSummary(Number.NaN), "blocked gates: G5, G6; groups: host=2");

  const missingManifest = `.tmp/host-proof-policy-missing-${process.pid}-${Date.now()}.json`;
  const child = spawnSync(
    process.execPath,
    ["scripts/check-host-proof.mjs", "--summary-only", "--strict", `--file=${missingManifest}`],
    {
      cwd: process.cwd(),
      env: { ...process.env, HOST_PROOF_PATH: "", PROOF_STRICT: "" },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    },
  );
  assert.equal(child.status, 1, child.stderr || child.stdout);
  assert.equal(child.stderr, "");
  assert.match(child.stdout, /Manifest: missing/);
  assert.match(child.stdout, /blocked gates: G5, G6; groups: host=2/);
  assert.doesNotMatch(child.stdout, /host-proof-policy-missing|\.tmp[\\/]/);
  const hostDraftSource = readFileSync("scripts/create-host-proof-draft.mjs", "utf8");
  const hostCollectSource = readFileSync("scripts/collect-host-evidence.mjs", "utf8");
  const hostEvidenceBindingCounts = (source) => ({
    sharedModule: [...source.matchAll(/from "\.\/host-evidence-policy\.mjs"/g)].length,
    regularFile: [...source.matchAll(/hostEvidenceRegularFileStat\(resolved\)/g)].length,
    distinctInputs: [...source.matchAll(/requireDistinctHostEvidenceArtifacts\(\[\[/g)].length,
    healthLog: [...source.matchAll(/readHostEvidenceLog\("health-log"/g)].length,
    loadLog: [...source.matchAll(/readHostEvidenceLog\("load-log"/g)].length,
    keyValues: [...source.matchAll(/parseKeyValues\(/g)].length,
    loadErrorRate: [...source.matchAll(/parseLoadMaxErrorRate\(\)/g)].length,
    loadP95: [...source.matchAll(/parseLoadMaxP95Ms\(\)/g)].length,
    localReimplementations: [...source.matchAll(/function (?:regularFileStat|readRequiredLog|readOptionalLog|requireDistinctArtifactInputs|parseKeyValues|parseNonNegativeInteger|parseNonNegativeDecimal|parseLoadMaxErrorRate|parseLoadMaxP95Ms)\(/g)].length,
  });
  assert.deepEqual(
    [hostEvidenceBindingCounts(hostDraftSource), hostEvidenceBindingCounts(hostCollectSource)],
    [
      { sharedModule: 1, regularFile: 1, distinctInputs: 1, healthLog: 1, loadLog: 1, keyValues: 1, loadErrorRate: 1, loadP95: 1, localReimplementations: 0 },
      { sharedModule: 1, regularFile: 1, distinctInputs: 1, healthLog: 1, loadLog: 1, keyValues: 1, loadErrorRate: 1, loadP95: 1, localReimplementations: 0 },
    ],
    "host proof draft and collector must bind every tested artifact, parser, and threshold policy boundary",
  );
  const hostProofTempDir = mkdtempSync(join(tmpdir(), "lore-host-proof-"));
  const hostProofCheckedAt = "2026-07-09T00:00:00.000Z";
  const baseHostProof = {
    origin: "https://playlore.xyz",
    hostType: "production",
    processModel: {
      supervisor: "pm2",
      "lore-site": { status: "running", running: true, supervised: true, command: "npm.cmd run start", checkedAt: hostProofCheckedAt, evidence: "pm2 lore-site online docs/host-process-model.log" },
      "lore-bot": { status: "running", running: true, supervised: true, command: "npm.cmd run bot", checkedAt: hostProofCheckedAt, evidence: "pm2 lore-bot online docs/host-process-model.log" },
      "lore-indexer": { status: "running", running: true, supervised: true, command: "npm.cmd run indexer", checkedAt: hostProofCheckedAt, evidence: "pm2 lore-indexer online docs/host-process-model.log" },
    },
    persistentDb: {
      path: join(hostProofTempDir, "lore-mainnet.sqlite"),
      absolutePathOutsideRepo: true,
      restartSurvived: true,
      rebootSurvived: true,
      checkedAt: hostProofCheckedAt,
      evidence: "npm.cmd run proof:host persistentDb restartSurvived=true rebootSurvived=true",
    },
    healthProd: {
      status: "pass",
      command: "npm.cmd run health:prod",
      url: "https://playlore.xyz/api/health/runtime",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      diagnosticsAuthPassed: true,
      finalityLagChecked: true,
      jackpotRowsChecked: true,
      timestamp: hostProofCheckedAt,
      evidence: "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=3",
    },
    loadHttp: {
      status: "pass",
      command: "npm.cmd run load:http",
      hostType: "canary",
      url: "https://canary.playlore.xyz",
      requestCount: 120,
      errorRate: 0,
      maxErrorRate: 0.01,
      p95Ms: 250,
      maxP95Ms: 1000,
      durationMs: 60000,
      concurrency: 10,
      timestamp: hostProofCheckedAt,
      evidence: "Load base URL: https://canary.playlore.xyz | TOTAL requestCount=120 p95=250ms",
    },
    externalRateLimit: {
      status: "pass",
      webReplicaCount: 2,
      distinctReplicas: 2,
      failClosed: true,
      sharedBucketVerified: true,
      checkedAt: hostProofCheckedAt,
      evidence: "npm.cmd run load:http redacted shared rate-limit bucket proof across replica-a and replica-b",
    },
  };
  const runHostProof = (manifest, name) => {
    const manifestPath = join(hostProofTempDir, `${name}.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return spawnSync(process.execPath, ["scripts/check-host-proof.mjs", "--strict", `--file=${manifestPath}`], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  };
  const canaryHostProof = runHostProof(baseHostProof, "canary-host-proof");
  assert.equal(canaryHostProof.status, 0, canaryHostProof.stdout || canaryHostProof.stderr);
  assert.match(
    canaryHostProof.stdout,
    /\| loadHttp \| checked \|/,
    "valid strict host proof must mark load evidence checked in the section table",
  );
  const missingRateLimitProof = JSON.parse(JSON.stringify(baseHostProof));
  delete missingRateLimitProof.externalRateLimit;
  const missingRateLimitResult = runHostProof(missingRateLimitProof, "missing-rate-limit-proof");
  assert.equal(missingRateLimitResult.status, 1, "host proof must reject manifests without two-replica shared limiter evidence");
  assert.match(
    missingRateLimitResult.stdout,
    /externalRateLimit section is missing/,
    "host proof must explain that shared rate-limit evidence is missing",
  );
  const fractionalHealthLagProof = JSON.parse(JSON.stringify(baseHostProof));
  fractionalHealthLagProof.healthProd.evidence = "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=3.5";
  const fractionalHealthLagResult = runHostProof(fractionalHealthLagProof, "fractional-health-lag-proof");
  assert.equal(fractionalHealthLagResult.status, 1, "host proof must reject fractional health finality lag evidence");
  assert.match(
    fractionalHealthLagResult.stdout,
    /healthProd evidence must include canonical non-negative decimal finalityLagBlocks from health:prod/,
    "host proof must explain that health finality lag evidence is non-canonical",
  );
  const leadingZeroHealthLagProof = JSON.parse(JSON.stringify(baseHostProof));
  leadingZeroHealthLagProof.healthProd.evidence = "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=03";
  const leadingZeroHealthLagResult = runHostProof(leadingZeroHealthLagProof, "leading-zero-health-lag-proof");
  assert.equal(leadingZeroHealthLagResult.status, 1, "host proof must reject leading-zero health finality lag evidence");
  assert.match(
    leadingZeroHealthLagResult.stdout,
    /healthProd evidence must include canonical non-negative decimal finalityLagBlocks from health:prod/,
    "host proof must explain that leading-zero health finality lag evidence is non-canonical",
  );
  const unsafeHealthArtifact = join(hostProofTempDir, "unsafe-health-finality.log");
  writeFileSync(
    unsafeHealthArtifact,
    "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=9999999999999999\n",
    "utf8",
  );
  const unsafeHealthArtifactProof = JSON.parse(JSON.stringify(baseHostProof));
  unsafeHealthArtifactProof.healthProd.evidencePath = unsafeHealthArtifact;
  unsafeHealthArtifactProof.healthProd.summary = "npm.cmd run health:prod [prod-health] OK base=https://playlore.xyz runtime=ok dataSync=healthy finalityLagBlocks=3";
  const unsafeHealthArtifactResult = runHostProof(unsafeHealthArtifactProof, "unsafe-health-artifact-proof");
  assert.equal(unsafeHealthArtifactResult.status, 1, "host proof must reject unsafe finality lag inside local health artifact even when inline summary is safe");
  assert.match(
    unsafeHealthArtifactResult.stdout,
    /healthProd evidence artifact must include \[prod-health\] OK, base, and canonical non-negative decimal finalityLagBlocks/,
    "host proof must explain that local health artifact finality lag evidence is unsafe",
  );
  const fractionalLoadCountProof = JSON.parse(JSON.stringify(baseHostProof));
  fractionalLoadCountProof.loadHttp.requestCount = "120.5";
  const fractionalLoadCountResult = runHostProof(fractionalLoadCountProof, "fractional-load-count-proof");
  assert.equal(fractionalLoadCountResult.status, 1, "host proof must reject fractional load request counts");
  assert.match(
    fractionalLoadCountResult.stdout,
    /loadHttp\.requestCount must be positive/,
    "host proof must explain that fractional load request count evidence is invalid",
  );
  assert.match(
    fractionalLoadCountResult.stdout,
    /\| loadHttp \| issue \|/,
    "host proof section status must report issue when load evidence has strict validation failures",
  );
  const leadingZeroLoadP95Proof = JSON.parse(JSON.stringify(baseHostProof));
  leadingZeroLoadP95Proof.loadHttp.p95Ms = "0250";
  const leadingZeroLoadP95Result = runHostProof(leadingZeroLoadP95Proof, "leading-zero-load-p95-proof");
  assert.equal(leadingZeroLoadP95Result.status, 1, "host proof must reject leading-zero p95 load evidence");
  assert.match(
    leadingZeroLoadP95Result.stdout,
    /loadHttp\.p95Ms must be positive/,
    "host proof must explain that leading-zero load p95 evidence is invalid",
  );
  const exponentLoadErrorRateProof = JSON.parse(JSON.stringify(baseHostProof));
  exponentLoadErrorRateProof.loadHttp.errorRate = "1e-3";
  const exponentLoadErrorRateResult = runHostProof(exponentLoadErrorRateProof, "exponent-load-error-rate-proof");
  assert.equal(exponentLoadErrorRateResult.status, 1, "host proof must reject exponent-form load error rates");
  assert.match(
    exponentLoadErrorRateResult.stdout,
    /loadHttp\.errorRate must be between 0 and 1/,
    "host proof must explain that exponent-form load error rate evidence is invalid",
  );
  const overPreciseLoadMaxErrorRateProof = JSON.parse(JSON.stringify(baseHostProof));
  overPreciseLoadMaxErrorRateProof.loadHttp.maxErrorRate = "0.1234567";
  const overPreciseLoadMaxErrorRateResult = runHostProof(overPreciseLoadMaxErrorRateProof, "overprecise-load-max-error-rate-proof");
  assert.equal(overPreciseLoadMaxErrorRateResult.status, 1, "host proof must reject over-precise max error rates");
  assert.match(
    overPreciseLoadMaxErrorRateResult.stdout,
    /loadHttp\.maxErrorRate must be between 0 and 1/,
    "host proof must explain that over-precise max error rate evidence is invalid",
  );
  const fractionalReplicaCountProof = JSON.parse(JSON.stringify(baseHostProof));
  fractionalReplicaCountProof.externalRateLimit.webReplicaCount = "2.5";
  const fractionalReplicaCountResult = runHostProof(fractionalReplicaCountProof, "fractional-replica-count-proof");
  assert.equal(fractionalReplicaCountResult.status, 1, "host proof must reject fractional web replica counts");
  assert.match(
    fractionalReplicaCountResult.stdout,
    /externalRateLimit\.webReplicaCount must be at least 2/,
    "host proof must explain that fractional web replica count evidence is invalid",
  );
  const leadingZeroReplicaProof = JSON.parse(JSON.stringify(baseHostProof));
  leadingZeroReplicaProof.externalRateLimit.distinctReplicas = "02";
  const leadingZeroReplicaResult = runHostProof(leadingZeroReplicaProof, "leading-zero-replica-proof");
  assert.equal(leadingZeroReplicaResult.status, 1, "host proof must reject leading-zero distinct replica counts");
  assert.match(
    leadingZeroReplicaResult.stdout,
    /externalRateLimit\.distinctReplicas must be at least 2/,
    "host proof must explain that leading-zero distinct replica count evidence is invalid",
  );
  const singleReplicaIdentityProof = JSON.parse(JSON.stringify(baseHostProof));
  singleReplicaIdentityProof.externalRateLimit.distinctReplicas = 1;
  const singleReplicaIdentityResult = runHostProof(singleReplicaIdentityProof, "single-replica-identity-proof");
  assert.equal(singleReplicaIdentityResult.status, 1, "host proof must reject shared limiter proof from only one distinct replica");
  assert.match(
    singleReplicaIdentityResult.stdout,
    /externalRateLimit\.distinctReplicas must be at least 2/,
    "host proof must explain that distinct replica evidence is missing",
  );
  const missingReplicaNamesProof = JSON.parse(JSON.stringify(baseHostProof));
  missingReplicaNamesProof.externalRateLimit.evidence = "npm.cmd run load:http redacted shared rate-limit bucket proof across replicas";
  const missingReplicaNamesResult = runHostProof(missingReplicaNamesProof, "missing-replica-names-proof");
  assert.equal(missingReplicaNamesResult.status, 1, "host proof must reject shared limiter proof that does not identify two replicas");
  assert.match(
    missingReplicaNamesResult.stdout,
    /externalRateLimit evidence must identify at least two distinct web replicas/,
    "host proof must explain that replica identity evidence is missing",
  );
  const finalOriginLoadProof = JSON.parse(JSON.stringify(baseHostProof));
  finalOriginLoadProof.loadHttp.url = finalOriginLoadProof.origin;
  const finalOriginLoadResult = runHostProof(finalOriginLoadProof, "final-origin-load-proof");
  assert.equal(finalOriginLoadResult.status, 1, "host proof must reject load:http evidence collected against the final production origin");
  assert.match(
    finalOriginLoadResult.stdout,
    /loadHttp\.url must not be the final production origin/,
    "host proof must explain why final-origin load evidence is rejected",
  );
  rmSync(hostProofTempDir, { recursive: true, force: true });
}
