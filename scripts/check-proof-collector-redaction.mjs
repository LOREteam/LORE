import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";

const summaryOnly = process.argv.includes("--summary-only");
const MAX_REJECT_OUT_CLEANUP_BYTES = 64 * 1024;
const tempDirs = [];
function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
const restoreSourcePath = join(makeTempDir("lore-restore-source-"), "source.sqlite");
const restoreBackupDir = makeTempDir("lore-restore-backup-");
const restoreDir = makeTempDir("lore-restore-restored-");
const restoreBackupPath = join(restoreBackupDir, "backup.sqlite");
writeFileSync(restoreSourcePath, "synthetic source db for redaction guard");
writeFileSync(restoreBackupPath, "synthetic backup artifact for redaction guard");
const finalRejectOutPath = join(process.cwd(), "docs", "collector-redaction-proof.json");
const signoffEnvLog = join(makeTempDir("lore-signoff-env-"), "mainnet-env-proof.log");
const signoffChainLog = join(makeTempDir("lore-signoff-chain-"), "chain-proof-snapshot.json");
writeFileSync(signoffEnvLog, "Summary: all checked env gates passed. Synthetic redaction guard only.\n");
writeFileSync(signoffChainLog, "Summary: synthetic redacted proof:chain direct-chain comparison output for redaction guard: jackpot safetyPool deposits rewards rebates resolve\n");

const cases = [
  {
    id: "helper-env",
    command: null,
    input: `RPC_URL=https://rpc.example/?key=secret-token PRIVATE_KEY=superprivate PASSWORD=hunter2 --db-password=hunter3 --private-key splitprivate --rpc-url https://split-rpc.example/?key=split-token --database-url postgres://user:split-pass@db.example/lore --webhook-url "https://hooks.example/?token=split-hook" DATABASE_URL=postgres://user:db-pass@db.example/lore https://inline:secret@rpc.example Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.signature https://public-rpc.example/path 0x${"a".repeat(40)} 0x${"b".repeat(64)} 0x${"c".repeat(160)} ${"d".repeat(64)}`,
    forbidden: ["secret-token", "superprivate", "hunter2", "hunter3", "splitprivate", "split-token", "split-rpc.example", "split-pass", "split-hook", "user:db-pass@", "inline:secret", "abc.def.ghi", "eyJhbGciOiJIUzI1NiJ9", "public-rpc.example", `0x${"a".repeat(40)}`, `0x${"b".repeat(64)}`, `0x${"c".repeat(160)}`, "d".repeat(64)],
  },
  {
    id: "signoff",
    args: [
      "scripts/collect-signoff-evidence.mjs",
      "--epochs=1",
      "--user=0x1111111111111111111111111111111111111111",
      "--rpc-url=https://rpc.example/?key=secret-token",
      `--env-log=${signoffEnvLog}`,
      `--chain-log=${signoffChainLog}`,
      "--print-plan",
    ],
    forbidden: ["secret-token"],
  },
  {
    id: "host",
    args: [
      "scripts/collect-host-evidence.mjs",
      "--origin=https://playlore.xyz",
      "--host-type=production",
      "--load-origin=https://canary.playlore.xyz",
      "--load-host-type=canary",
      "--database-url=postgres://user:secret-pass@db.example/lore",
      "--print-plan",
    ],
    forbidden: ["secret-pass", "postgres://user:secret-pass@db.example/lore"],
  },
  {
    id: "indexer",
    args: [
      "scripts/collect-indexer-evidence.mjs",
      "--fresh-db=true",
      "--epochs=1",
      "--chain-id=59144",
      "--deploy-block=1",
      "--finality-blocks=1",
      "--private-key=superprivate",
      "--print-plan",
    ],
    forbidden: ["superprivate"],
  },
  {
    id: "restore",
    args: [
      "scripts/collect-restore-evidence.mjs",
      `--source=${restoreSourcePath}`,
      `--backup-dir=${restoreBackupDir}`,
      `--restore-dir=${restoreDir}`,
      `--backup=${restoreBackupPath}`,
      "--restored-origin=https://restore.playlore.xyz",
      "--restored-host-type=restore",
      "--webhook-url=https://hooks.example/?token=secret-token",
      "--print-plan",
    ],
    forbidden: ["secret-token"],
  },
];

function runCase(testCase) {
  if (testCase.command === null) {
    return { status: 0, output: redactProofText(testCase.input) };
  }
  const result = spawnSync(process.execPath, testCase.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    output: `${result.stdout || ""}\n${result.stderr || ""}`,
  };
}

const rows = [];
const issues = [];

const rejectCases = [
  {
    id: "final-absolute-out",
    args: [
      "scripts/collect-host-evidence.mjs",
      "--origin=https://playlore.xyz",
      "--host-type=production",
      "--load-origin=https://canary.playlore.xyz",
      "--load-host-type=canary",
      `--out=${finalRejectOutPath}`,
    ],
    expected: "collector writes incomplete evidence drafts only",
  },
];

function cleanupRejectOutPath() {
  if (!existsSync(finalRejectOutPath)) return;
  const stats = statSync(finalRejectOutPath);
  if (!stats.isFile() || stats.size > MAX_REJECT_OUT_CLEANUP_BYTES) return;
  const content = readFileSync(finalRejectOutPath, "utf8");
  if (content.includes('"collector": "host"') && content.includes('collector-redaction-proof.json')) {
    unlinkSync(finalRejectOutPath);
  }
}

for (const testCase of cases) {

  const result = runCase(testCase);
  const leaked = testCase.forbidden.filter((value) => result.output.includes(value));
  const redacted = result.output.includes("<redacted>");
  if (result.status !== 0) issues.push(`${testCase.id}: command failed with ${result.status}`);
  if (leaked.length > 0) issues.push(`${testCase.id}: leaked ${leaked.join(", ")}`);
  if (!redacted) issues.push(`${testCase.id}: output did not include <redacted>`);
  rows.push([testCase.id, result.status === 0 ? "ok" : "failed", leaked.length === 0 ? "no" : leaked.join(", "), redacted ? "yes" : "no"]);
}

for (const rejectCase of rejectCases) {
  const result = runCase(rejectCase);
  if (result.status === 0) issues.push(`${rejectCase.id}: final proof output was accepted`);
  if (!result.output.includes(rejectCase.expected)) issues.push(`${rejectCase.id}: expected rejection message missing`);
  cleanupRejectOutPath();
  rows.push([rejectCase.id, result.status === 0 ? "accepted" : "rejected", "no", "n/a"]);
}
if (summaryOnly) {
  const redacted = rows.filter((row) => row[3] === "yes").length;
  const leaked = rows.filter((row) => row[2] !== "no").length;
  console.log(`status=${issues.length === 0 ? "pass" : "fail"}, cases=${rows.length}, redacted=${redacted}, leaked=${leaked}, issues=${issues.length}`);
  console.log(`Summary: ${issues.length === 0 ? "proof collector redaction guard passed" : `${issues.length} proof collector redaction issue(s)`}.`);
} else {
  console.log("| Case | Command | Secret leaked | Redacted marker |");
  console.log("| --- | --- | --- | --- |");
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
  console.log(`Summary: ${issues.length === 0 ? "proof collector redaction guard passed" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
}

for (const tempDir of tempDirs) {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort temp cleanup; validation status is already captured.
  }
}

if (issues.length > 0) process.exitCode = 1;
