import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildMainnetProofOutputLines,
  compactFailingGateTokens,
  failingGateGroups,
  failingGateTokens,
  gateGroup,
  gateToken,
  isFinalHttpsOrigin,
  isHttpsUrl,
  mainnetProofGateCoverageIssues,
  parsePositiveInteger,
  REQUIRED_MAINNET_SECURITY_GATES,
  withMainnetProofGateCoverage,
} from "./mainnet-proof-policy.mjs";

const projectRoot = process.cwd();
const collectorPath = join(projectRoot, "scripts", "collect-mainnet-proof.mjs");

function isolatedEnv(overrides = {}) {
  const env = {};
  for (const name of ["ComSpec", "PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, ...overrides };
}

function runCollector(root, mode, outputPath) {
  return spawnSync(process.execPath, [collectorPath, "--strict", mode, `--out=${outputPath}`], {
    cwd: root,
    env: isolatedEnv({
      INDEXER_START_BLOCK: "0",
      KEEPER_RPC_URL: "https://user:mainnet-proof-secret@rpc.playlore.xyz",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "0",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "",
      NEXT_PUBLIC_SITE_URL: "https://localhost",
      WEB_REPLICA_COUNT: "01",
    }),
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

export function runMainnetProofPolicyTests() {
  assert.deepEqual(REQUIRED_MAINNET_SECURITY_GATES, [
    "trusted proxy secret length",
    "health diagnostics secret length",
    "chat auth secret length",
    "purpose-separated runtime secrets",
    "admin auth secret length",
    "admin wallet address shape",
    "bootstrap resolve secret length",
    "bootstrap keeper key shape",
    "keeper key shape",
    "web replica count",
    "external rate limit for multi-replica web",
    "server backup monitoring directory",
  ]);
  const requiredGateChecks = REQUIRED_MAINNET_SECURITY_GATES.map((gate) => ({ gate, ok: true }));
  assert.deepEqual(mainnetProofGateCoverageIssues(requiredGateChecks), []);
  assert.deepEqual(
    mainnetProofGateCoverageIssues(requiredGateChecks.slice(1)),
    ["trusted proxy secret length:missing"],
  );
  assert.deepEqual(
    mainnetProofGateCoverageIssues([...requiredGateChecks, requiredGateChecks[0]]),
    ["trusted proxy secret length:duplicate"],
  );
  const missingCoverageOutput = buildMainnetProofOutputLines({
    checks: withMainnetProofGateCoverage(requiredGateChecks.slice(1)),
    compactOnly: false,
    strict: true,
    summaryOnly: true,
    timestamp: "2026-08-14T00:00:00.000Z",
  }).join("\n");
  assert.match(missingCoverageOutput, /required mainnet security gate coverage/);
  assert.equal(withMainnetProofGateCoverage(requiredGateChecks).length, requiredGateChecks.length);
  assert.equal(withMainnetProofGateCoverage(requiredGateChecks.slice(1)).at(-1)?.ok, false);

  assert.equal(parsePositiveInteger("1"), 1);
  assert.equal(parsePositiveInteger(" 9007199254740991 "), Number.MAX_SAFE_INTEGER);
  for (const invalid of [null, "", "0", "01", "+1", "1.0", "1e2", "9007199254740992", "9999999999999999"]) {
    assert.equal(parsePositiveInteger(invalid), null, `noncanonical integer must fail: ${String(invalid)}`);
  }
  assert.equal(Number("1.0") > 0, true, "precision fixture must distinguish broad Number coercion");

  assert.equal(isHttpsUrl("https://rpc.playlore.xyz/path"), true);
  for (const invalid of ["http://rpc.playlore.xyz", "https://user:secret@rpc.playlore.xyz", "https://", "not-a-url"]) {
    assert.equal(isHttpsUrl(invalid), false, `unsafe HTTPS URL must fail: ${invalid}`);
  }

  assert.equal(isFinalHttpsOrigin("https://playlore.xyz"), true);
  for (const invalid of [
    "https://playlore.xyz/path",
    "https://playlore.xyz/?query=1",
    "https://user:secret@playlore.xyz",
    "https://localhost",
    "https://service.example",
    "https://192.168.1.1",
    "https://203.0.113.4",
  ]) {
    assert.equal(isFinalHttpsOrigin(invalid), false, `non-final origin must fail: ${invalid}`);
  }

  const failedChecks = [
    { gate: "network is mainnet", ok: false },
    { gate: "V10 protected bets required", ok: false },
    { gate: "deploy block shape", ok: false },
    { gate: "external rate limit for multi-replica web", ok: false },
    { gate: "backup directories outside repo", ok: false },
  ];
  assert.equal(gateGroup("network is mainnet"), "network");
  assert.equal(gateGroup("V10 protected bets required"), "contract");
  assert.equal(gateGroup("deploy block shape"), "indexer");
  assert.equal(gateGroup("external rate limit for multi-replica web"), "rate-limit");
  assert.equal(gateGroup("backup directories outside repo"), "backup");
  assert.equal(failingGateGroups(failedChecks), "backup=1, contract=1, indexer=1, network=1, rate-limit=1");
  assert.equal(gateToken("  V10 Protected Bets / Required!  "), "v10-protected-bets-required");
  assert.equal(gateToken("!"), "unknown");
  assert.equal(gateToken("x".repeat(100)).length, 64);
  assert.equal(failingGateTokens(failedChecks), "network-is-mainnet, v10-protected-bets-required, deploy-block-shape, external-rate-limit-for-multi-replica-web, backup-directories-outside-repo");
  assert.equal(compactFailingGateTokens(failedChecks, 2), "network-is-mainnet, v10-protected-bets-required, ... (+3 more)");

  const summaryLines = buildMainnetProofOutputLines({
    checks: failedChecks.map((check) => ({ ...check, status: "fail", value: "mainnet-proof-secret" })),
    compactOnly: false,
    strict: true,
    summaryOnly: true,
    timestamp: "2026-08-14T00:00:00.000Z",
  });
  const summary = summaryLines.join("\n");
  assert.match(summary, /Gates checked: 5[\s\S]*Failing gates: 5[\s\S]*Failing gate names:/);
  assert.match(summary, /Failing gate tokens:[\s\S]*Failing gate groups:/);
  assert.doesNotMatch(summary, /mainnet-proof-secret|\| Gate \| Status \| Value \|/);

  const root = mkdtempSync(join(tmpdir(), "lore-mainnet-proof-policy-"));
  try {
    const outPath = join(root, "summary-output.log");
    const summaryResult = runCollector(root, "--summary-only", outPath);
    assert.equal(summaryResult.status, 1, `${summaryResult.stdout}\n${summaryResult.stderr}`);
    assert.equal(summaryResult.stderr, "");
    assert.match(summaryResult.stdout, /Failing gate names:[^\r\n]*V10 protected bets required/);
    assert.match(summaryResult.stdout, /Failing gate names:[^\r\n]*deploy block shape/);
    assert.match(summaryResult.stdout, /Failing gate names:[^\r\n]*web replica count/);
    assert.doesNotMatch(summaryResult.stdout, /required mainnet security gate coverage/);
    assert.doesNotMatch(summaryResult.stdout, /mainnet-proof-secret|\| Gate \| Status \| Value \|/);
    assert.equal(existsSync(outPath), false, "summary-only collector must not write the requested proof snapshot");

    const compactResult = runCollector(root, "--compact", outPath);
    assert.equal(compactResult.status, 1);
    assert.equal(compactResult.stderr, "");
    assert.match(compactResult.stdout, /Failing gate tokens sample:[^\r\n]*\.\.\. \(\+\d+ more\)/);
    assert.doesNotMatch(compactResult.stdout, /Failing gate names:|mainnet-proof-secret|\| Gate \| Status \| Value \|/);
    assert.equal(existsSync(outPath), false, "compact collector must not write the requested proof snapshot");
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
