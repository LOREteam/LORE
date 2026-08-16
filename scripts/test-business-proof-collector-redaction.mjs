import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  hasPublicProofHttpsUrl,
  isFinalHttpsOrigin,
  normalizeProofOrigin,
  sameProofOrigin,
} from "./collect-proof-common.mjs";

const projectRoot = process.cwd();
const guardPath = join(projectRoot, "scripts", "check-proof-collector-redaction.mjs");
const rejectOutPath = join(projectRoot, "docs", "collector-redaction-proof.json");
const tempPrefixes = [
  "lore-restore-source-",
  "lore-restore-backup-",
  "lore-restore-restored-",
  "lore-signoff-env-",
  "lore-signoff-chain-",
  "lore-signoff-unsafe-env-",
  "lore-signoff-unsafe-collector-out-",
  "lore-signoff-unsafe-draft-out-",
];
const forbiddenOutput = [
  "secret-token",
  "superprivate",
  "hunter2",
  "hunter3",
  "splitprivate",
  "split-token",
  "split-rpc.example",
  "split-pass",
  "split-hook",
  "user:db-pass@",
  "inline:secret",
  "abc.def.ghi",
  "eyJhbGciOiJIUzI1NiJ9",
  "public-rpc.example",
  "synthetic-secret-must-not-persist",
  `0x${"a".repeat(40)}`,
  `0x${"b".repeat(64)}`,
  `0x${"c".repeat(160)}`,
  "d".repeat(64),
];

function tempFixtureNames() {
  return readdirSync(tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && tempPrefixes.some((prefix) => entry.name.startsWith(prefix)))
    .map((entry) => entry.name)
    .sort();
}

function runGuard() {
  return spawnSync(process.execPath, [guardPath, "--summary-only"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function assertPassingGuard(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    "status=pass, cases=8, redacted=5, leaked=0, issues=0\n"
      + "Summary: proof collector redaction guard passed.\n",
  );
  for (const forbidden of forbiddenOutput) assert.ok(!combined.includes(forbidden), `guard leaked ${forbidden}`);
  assert.doesNotMatch(combined, /(?:Error:|node:internal|at Module\.|at file:)/i);
  assert.ok(!combined.toLowerCase().includes(projectRoot.toLowerCase()), "compact guard output must not expose the checkout path");
}

export function runProofCollectorRedactionBehaviorTests() {
  const normalizedOriginVectors = [
    ["https://PlayLore.XYZ", "https://playlore.xyz"],
    [" https://playlore.xyz:443/path?probe=1#status ", "https://playlore.xyz"],
    ["https://canary.playlore.xyz:8443/health", "https://canary.playlore.xyz:8443"],
    ["http://staging.playlore.xyz/path", "http://staging.playlore.xyz"],
    ["https://user@playlore.xyz", ""],
    ["https://user:password@playlore.xyz", ""],
    ["not a URL", ""],
    ["", ""],
  ];
  for (const [input, expected] of normalizedOriginVectors) {
    assert.equal(normalizeProofOrigin(input), expected, `unexpected normalized proof origin for ${JSON.stringify(input)}`);
  }
  assert.equal(sameProofOrigin("https://PLAYLORE.xyz/load", "https://playlore.xyz"), true);
  assert.equal(sameProofOrigin("https://playlore.xyz", "https://canary.playlore.xyz"), false);
  assert.equal(sameProofOrigin("https://user@playlore.xyz", "https://playlore.xyz"), false);
  assert.equal(sameProofOrigin("", ""), false);

  const acceptedEvidenceUrls = [
    "evidence https://playlore.xyz/path?q=1",
    "see https://canary.playlore.xyz:8443/health.",
    "(https://[2606:4700:4700::1111]/status)",
  ];
  for (const value of acceptedEvidenceUrls) assert.equal(hasPublicProofHttpsUrl(value), true, value);
  const rejectedEvidenceUrls = [
    "http://playlore.xyz",
    "https://playlore",
    "https://user:password@playlore.xyz",
    "https://localhost/status",
    "https://10.0.0.1/status",
    "https://100.64.0.1/status",
    "https://169.254.1.1/status",
    "https://198.51.100.1/status",
    "https://203.0.113.1/status",
    "https://[2001:db8::1]/status",
  ];
  for (const value of rejectedEvidenceUrls) assert.equal(hasPublicProofHttpsUrl(value), false, value);

  const acceptedFinalOrigins = [
    "https://playlore.xyz",
    "https://canary.playlore.xyz:8443",
    "https://[2606:4700:4700::1111]",
  ];
  for (const origin of acceptedFinalOrigins) assert.equal(isFinalHttpsOrigin(origin), true, origin);
  const rejectedFinalOrigins = [
    "http://playlore.xyz",
    "https://playlore",
    "https://user@playlore.xyz",
    "https://playlore.xyz/path",
    "https://playlore.xyz?probe=1",
    "https://localhost",
    "https://10.0.0.1",
    "https://100.64.0.1",
    "https://169.254.1.1",
    "https://198.51.100.1",
    "https://203.0.113.1",
    "https://[2001:db8::1]",
  ];
  for (const origin of rejectedFinalOrigins) assert.equal(isFinalHttpsOrigin(origin), false, origin);

  assert.equal(existsSync(rejectOutPath), false, "redaction guard output path must be absent before the hermetic probe");
  const tempBefore = tempFixtureNames();
  const baseline = runGuard();
  assertPassingGuard(baseline);
  assert.deepEqual(tempFixtureNames(), tempBefore, "redaction guard must remove every owned temporary fixture");
  assert.equal(existsSync(rejectOutPath), false, "rejected final artifact must be removed after the guard run");

  try {
    const oversizedSentinel = `sentinel:${"x".repeat(64 * 1024)}`;
    writeFileSync(rejectOutPath, oversizedSentinel, "utf8");
    const oversized = runGuard();
    assertPassingGuard(oversized);
    assert.equal(readFileSync(rejectOutPath, "utf8"), oversizedSentinel, "oversized foreign artifact must not be read, replaced, or removed");
    assert.deepEqual(tempFixtureNames(), tempBefore, "oversized artifact path must not leak owned temporary fixtures");
  } finally {
    rmSync(rejectOutPath, { force: true, maxRetries: 4, retryDelay: 50 });
  }

  try {
    mkdirSync(rejectOutPath);
    const directory = runGuard();
    assertPassingGuard(directory);
    assert.equal(statSync(rejectOutPath).isDirectory(), true, "foreign directory at reject output path must remain untouched");
    assert.deepEqual(tempFixtureNames(), tempBefore, "directory reject path must not leak owned temporary fixtures");
  } finally {
    rmSync(rejectOutPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
