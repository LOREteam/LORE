import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const summaryOnly = process.argv.includes("--summary-only");
const tempDir = mkdtempSync(join(tmpdir(), "lore-host-proof-load-"));
const fixtureCount = 5;

function baseManifest() {
  const timestamp = new Date().toISOString();
  return {
    origin: "https://playlore.xyz",
    hostType: "production",
    processModel: {
      supervisor: "pm2",
      "lore-site": {
        status: "running",
        running: true,
        supervised: true,
        command: "npm.cmd run start",
        evidence: "pm2 lore-site online .tmp/pm2-process-list.log",
        checkedAt: timestamp,
      },
      "lore-bot": {
        status: "running",
        running: true,
        supervised: true,
        command: "npm.cmd run bot",
        evidence: "pm2 lore-bot online .tmp/pm2-process-list.log",
        checkedAt: timestamp,
      },
      "lore-indexer": {
        status: "running",
        running: true,
        supervised: true,
        command: "npm.cmd run indexer",
        evidence: "pm2 lore-indexer online .tmp/pm2-process-list.log",
        checkedAt: timestamp,
      },
    },
    persistentDb: {
      path: join(tempDir, "lore-mainnet.sqlite"),
      absolutePathOutsideRepo: true,
      restartSurvived: true,
      rebootSurvived: true,
      evidence: ".tmp/db-restart-reboot-check.log",
      checkedAt: timestamp,
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
      evidence: "npm.cmd run health:prod base=https://playlore.xyz finalityLagBlocks=3 .tmp/health-prod.log",
      timestamp,
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
      evidence: "Load base URL: https://canary.playlore.xyz | TOTAL count= 120 fail= 0 err= 0.00% p95=250ms .tmp/load-http.log",
      timestamp,
    },
    externalRateLimit: {
      status: "pass",
      webReplicaCount: 2,
      distinctReplicas: 2,
      failClosed: true,
      sharedBucketVerified: true,
      checkedAt: timestamp,
      evidence: "synthetic shared rate-limit bucket proof across replica-a and replica-b with fail-closed store behavior .tmp/rate-limit-shared.log",
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runHostProof(manifest, name) {
  const manifestPath = join(tempDir, `${name}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return spawnSync(process.execPath, ["scripts/check-host-proof.mjs", "--strict", `--file=${manifestPath}`], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function outputOf(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

const issues = [];

const canaryResult = runHostProof(baseManifest(), "canary-host-proof");
if (canaryResult.status !== 0) {
  issues.push("production host proof with canary load fixture should pass");
}

const missingHealthBaseManifest = clone(baseManifest());
missingHealthBaseManifest.healthProd.evidence = "npm.cmd run health:prod finalityLagBlocks=3 .tmp/health-prod.log";
const missingHealthBaseResult = runHostProof(missingHealthBaseManifest, "missing-health-base-proof");
if (missingHealthBaseResult.status !== 1) {
  issues.push("missing healthProd base origin fixture should fail");
}
if (!/healthProd evidence must include base=<production origin> from health:prod/.test(outputOf(missingHealthBaseResult))) {
  issues.push("missing healthProd base origin failure reason is missing");
}

const finalOriginManifest = clone(baseManifest());
finalOriginManifest.loadHttp.url = finalOriginManifest.origin;
const finalOriginResult = runHostProof(finalOriginManifest, "final-origin-load-proof");
if (finalOriginResult.status !== 1) {
  issues.push("final production origin load proof fixture should fail");
}
if (!/loadHttp\.url must not be the final production origin/.test(outputOf(finalOriginResult))) {
  issues.push("final production origin load proof failure reason is missing");
}

const missingLoadBaseManifest = clone(baseManifest());
missingLoadBaseManifest.loadHttp.evidence = "TOTAL count= 120 fail= 0 err= 0.00% p95=250ms .tmp/load-http.log";
const missingLoadBaseResult = runHostProof(missingLoadBaseManifest, "missing-load-base-proof");
if (missingLoadBaseResult.status !== 1) {
  issues.push("missing loadHttp Load base URL fixture should fail");
}
if (!/loadHttp evidence must include Load base URL matching loadHttp\.url from load:http/.test(outputOf(missingLoadBaseResult))) {
  issues.push("missing loadHttp Load base URL failure reason is missing");
}
const missingHostTypeManifest = clone(baseManifest());
delete missingHostTypeManifest.loadHttp.hostType;
const missingHostTypeResult = runHostProof(missingHostTypeManifest, "missing-host-type-proof");
if (missingHostTypeResult.status !== 1) {
  issues.push("missing loadHttp.hostType fixture should fail");
}
if (!/loadHttp\.hostType must be staging or canary/.test(outputOf(missingHostTypeResult))) {
  issues.push("missing loadHttp.hostType failure reason is missing");
}

if (summaryOnly) {
  console.log(
    JSON.stringify({
      status: issues.length === 0 ? "pass" : "fail",
      fixtures: fixtureCount,
      issues: issues.length,
      launchGate: "host",
    }),
  );
} else {
  console.log("# Host Proof Load Target Guard");
  console.log("");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("");
  console.log(`Summary: ${issues.length === 0 ? "host proof load target guard passed" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
}

try {
  rmSync(tempDir, { recursive: true, force: true });
} catch {
  // Best-effort temp cleanup; validation status is already captured.
}

if (issues.length > 0) {
  process.exitCode = 1;
}
