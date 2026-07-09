import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";

const restoreSourcePath = join(mkdtempSync(join(tmpdir(), "lore-restore-source-")), "source.sqlite");
const restoreBackupDir = mkdtempSync(join(tmpdir(), "lore-restore-backup-"));
const restoreDir = mkdtempSync(join(tmpdir(), "lore-restore-restored-"));
const restoreBackupPath = join(restoreBackupDir, "backup.sqlite");
writeFileSync(restoreSourcePath, "synthetic source db for redaction guard");
writeFileSync(restoreBackupPath, "synthetic backup artifact for redaction guard");
const finalRejectOutPath = join(process.cwd(), "docs", "collector-redaction-proof.json");
const signoffEnvLog = join(mkdtempSync(join(tmpdir(), "lore-signoff-env-")), "mainnet-env-proof.log");
const signoffChainLog = join(mkdtempSync(join(tmpdir(), "lore-signoff-chain-")), "chain-proof-snapshot.json");
writeFileSync(signoffEnvLog, "Summary: synthetic redacted proof:mainnet output for redaction guard\n");
writeFileSync(signoffChainLog, "Summary: synthetic redacted proof:chain output for redaction guard\n");

const cases = [
  {
    id: "helper-env",
    command: null,
    input: "RPC_URL=https://rpc.example/?key=secret-token PRIVATE_KEY=superprivate Bearer abc.def.ghi",
    forbidden: ["secret-token", "superprivate", "abc.def.ghi"],
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
console.log("| Case | Command | Secret leaked | Redacted marker |");
console.log("| --- | --- | --- | --- |");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log(`Summary: ${issues.length === 0 ? "proof collector redaction guard passed" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) process.exitCode = 1;