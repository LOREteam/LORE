import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  MAX_HOST_EVIDENCE_BYTES,
  hostEvidenceRegularFileStat,
  parseHostEvidenceKeyValues,
  parseHostEvidenceNonNegativeDecimal,
  parseHostEvidenceNonNegativeInteger,
  parseHostLoadMaxErrorRate,
  parseHostLoadMaxP95Ms,
  readHostEvidenceLog,
  requireDistinctHostEvidenceArtifacts,
} from "./host-evidence-policy.mjs";

export function runHostEvidencePolicyTests() {
  const hostProofRoot = resolve("proof");
  const fileStats = { isFile: () => true, size: MAX_HOST_EVIDENCE_BYTES };
  const directoryStats = { isFile: () => false, size: 0 };
  assert.equal(hostEvidenceRegularFileStat("evidence.log", () => fileStats), fileStats);
  assert.equal(hostEvidenceRegularFileStat("evidence-dir", () => directoryStats), null);
  assert.equal(hostEvidenceRegularFileStat("missing", () => { throw new Error("missing"); }), null);

  const readCalls = [];
  assert.equal(
    readHostEvidenceLog("health-log", "logs/health.log", {
      cwd: hostProofRoot,
      statFile: () => fileStats,
      readText: (path, encoding) => {
        readCalls.push({ path, encoding });
        return "health=ok";
      },
    }),
    "health=ok",
  );
  assert.equal(readCalls.length, 1);
  assert.equal(readCalls[0].path.replaceAll("\\", "/"), resolve(hostProofRoot, "logs/health.log").replaceAll("\\", "/"));
  assert.equal(readCalls[0].encoding, "utf8");
  assert.equal(readHostEvidenceLog("load-log", "", { statFile: () => { throw new Error("must not stat"); } }), "");
  assert.throws(
    () => readHostEvidenceLog("health-log", "", { required: true }),
    /--health-log must point to an existing redacted artifact/,
  );
  assert.throws(
    () => readHostEvidenceLog("health-log", "health-dir", { statFile: () => directoryStats }),
    /--health-log must point to an existing redacted artifact/,
  );
  assert.throws(
    () => readHostEvidenceLog("load-log", "load.log", {
      statFile: () => ({ isFile: () => true, size: MAX_HOST_EVIDENCE_BYTES + 1 }),
      readText: () => { throw new Error("must not read"); },
    }),
    /artifact is too large to validate safely/,
  );
  assert.throws(
    () => readHostEvidenceLog("load-log", "load.log", {
      statFile: () => ({ isFile: () => true, size: 1.5 }),
    }),
    /artifact is too large to validate safely/,
  );
  const oversizeReadMutant = (_name, _path, { readText }) => readText("load.log", "utf8");
  assert.equal(oversizeReadMutant("load-log", "load.log", { readText: () => "unsafe" }), "unsafe");
  assert.throws(
    () => readHostEvidenceLog("load-log", "load.log", {
      statFile: () => ({ isFile: () => true, size: MAX_HOST_EVIDENCE_BYTES + 1 }),
      readText: () => "unsafe",
    }),
    /too large/,
  );

  const distinctInputs = [
    ["process-evidence", "logs/process.json"],
    ["health-log", "logs/health.log"],
    ["load-log", "logs/load.log"],
  ];
  assert.doesNotThrow(() => requireDistinctHostEvidenceArtifacts(distinctInputs, { cwd: hostProofRoot }));
  assert.throws(
    () => requireDistinctHostEvidenceArtifacts([
      ["process-evidence", "logs/../shared.log"],
      ["health-log", "shared.log"],
    ], { cwd: hostProofRoot }),
    /--process-evidence and --health-log must point to distinct host evidence files/,
  );
  assert.throws(
    () => requireDistinctHostEvidenceArtifacts([
      ["health-log", "HEALTH.LOG"],
      ["load-log", "health.log"],
    ], { cwd: hostProofRoot }),
    /distinct host evidence files/,
  );
  assert.doesNotThrow(() => requireDistinctHostEvidenceArtifacts([
    ["health-log", "same.log"],
    ["load-log", "same.log"],
  ], { skip: true }));
  const caseSensitiveDistinctMutant = (left, right) => left !== right;
  assert.equal(caseSensitiveDistinctMutant("HEALTH.LOG", "health.log"), true);

  assert.deepEqual(parseHostEvidenceKeyValues("base=ok runtime=ready finalityLagBlocks=12"), {
    base: "ok",
    runtime: "ready",
    finalityLagBlocks: "12",
  });
  assert.deepEqual(parseHostEvidenceKeyValues("key=first key=second"), { key: "second" });
  assert.deepEqual(parseHostEvidenceKeyValues("_bad=1 1bad=2 good=3"), { bad: "2", good: "3" });
  const sixtyFourMarkers = Array.from({ length: 64 }, (_, index) => `k${index}=v${index}`).join(" ");
  assert.equal(Object.keys(parseHostEvidenceKeyValues(sixtyFourMarkers)).length, 64);
  const sixtyFiveMarkers = `${sixtyFourMarkers} k64=v64`;
  assert.throws(() => parseHostEvidenceKeyValues(sixtyFiveMarkers), /too many key\/value markers/);
  const unboundedKeyValueMutant = (line) => Object.fromEntries(line.split(" ").map((entry) => entry.split("=")));
  assert.equal(Object.keys(unboundedKeyValueMutant(sixtyFiveMarkers)).length, 65);

  for (const [value, expected] of [["0", 0], ["1", 1], ["9007199254740991", Number.MAX_SAFE_INTEGER], [" 12 ", 12]]) {
    assert.equal(parseHostEvidenceNonNegativeInteger(value, null), expected);
  }
  for (const value of ["01", "+1", "-1", "1.0", "1e2", "9007199254740992", "12345678901234567", ""]) {
    assert.equal(parseHostEvidenceNonNegativeInteger(value, null), null, `invalid integer must fail: ${value}`);
  }
  for (const [value, expected] of [["0", 0], ["0.01", 0.01], ["1.000000", 1], [" 12.5 ", 12.5]]) {
    assert.equal(parseHostEvidenceNonNegativeDecimal(value, null), expected);
  }
  for (const value of ["01", ".5", "1.", "1.0000001", "+1", "-1", "1e-2", "12345678901234567"] ) {
    assert.equal(parseHostEvidenceNonNegativeDecimal(value, null), null, `invalid decimal must fail: ${value}`);
  }
  assert.equal(Number("01"), 1);
  assert.equal(parseHostEvidenceNonNegativeInteger("01", null), null, "broad Number coercion mutant must be rejected");

  assert.equal(parseHostLoadMaxErrorRate(undefined), 0.01);
  assert.equal(parseHostLoadMaxErrorRate("0"), 0);
  assert.equal(parseHostLoadMaxErrorRate("1.000000"), 1);
  for (const value of ["1.000001", "01", "1e-2", "-1"]) {
    assert.throws(() => parseHostLoadMaxErrorRate(value), /canonical decimal rate between 0 and 1/);
  }
  assert.equal(parseHostLoadMaxP95Ms(undefined), 1500);
  assert.equal(parseHostLoadMaxP95Ms("1"), 1);
  assert.equal(parseHostLoadMaxP95Ms("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const value of ["0", "01", "1.5", "1e3", "9007199254740992"]) {
    assert.throws(() => parseHostLoadMaxP95Ms(value), /canonical positive integer of milliseconds/);
  }

  const loadTargetPrefix = "lore-host-proof-load-";
  const loadTargetBefore = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(loadTargetPrefix)));
  const loadTargetChild = spawnSync(
    process.execPath,
    ["scripts/check-host-proof-load-target.mjs", "--summary-only"],
    {
      cwd: process.cwd(),
      env: { ...process.env, HOST_PROOF_PATH: "", PROOF_STRICT: "" },
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 256 * 1024,
    },
  );
  assert.equal(loadTargetChild.status, 0, loadTargetChild.stderr || loadTargetChild.stdout);
  assert.equal(loadTargetChild.stderr, "");
  assert.deepEqual(JSON.parse(loadTargetChild.stdout), {
    status: "pass",
    fixtures: 5,
    issues: 0,
    launchGate: "host",
  });
  const loadTargetAfter = readdirSync(tmpdir()).filter(
    (name) => name.startsWith(loadTargetPrefix) && !loadTargetBefore.has(name),
  );
  assert.deepEqual(loadTargetAfter, [], "host load-target self-test must remove every owned temporary fixture");

  const planOut = `.tmp/host-evidence-plan-${process.pid}-${Date.now()}.json`;
  assert.equal(existsSync(planOut), false);
  const collectorChild = spawnSync(
    process.execPath,
    [
      "scripts/collect-host-evidence.mjs",
      "--print-plan",
      "--origin=https://playlore.xyz",
      "--host-type=production",
      "--load-origin=https://canary.playlore.xyz",
      "--load-host-type=canary",
      `--out=${planOut}`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LORE_DB_PATH: "",
        LOAD_MAX_ERROR_RATE: "",
        LOAD_MAX_P95_MS: "",
      },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    },
  );
  assert.equal(collectorChild.status, 0, collectorChild.stderr || collectorChild.stdout);
  assert.equal(collectorChild.stderr, "");
  assert.equal(existsSync(planOut), false, "collector print-plan must not publish a draft artifact");
  const planStart = collectorChild.stdout.indexOf("{");
  assert.ok(planStart > 0, "collector print-plan must emit its structured manifest");
  const plan = JSON.parse(collectorChild.stdout.slice(planStart));
  assert.deepEqual(plan.externalRateLimit, {
    status: "TODO",
    webReplicaCount: 2,
    distinctReplicas: 2,
    failClosed: false,
    sharedBucketVerified: false,
    evidence: "TODO: paste redacted two-replica shared rate-limit bucket proof",
    checkedAt: plan.externalRateLimit.checkedAt,
  });
  assert.equal(plan.requiredManualEvidence.at(-1), "prove two web replicas consume one shared external rate-limit bucket and fail closed when the store is unavailable");
}
