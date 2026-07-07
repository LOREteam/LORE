import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

const outDir = resolve(process.cwd(), argValue("out-dir", "docs/proof-drafts"));
mkdirSync(outDir, { recursive: true });

const tasks = [
  ["signoff", "scripts/create-signoff-proof-draft.mjs", []],
  ["host", "scripts/create-host-proof-draft.mjs", ["--origin=https://playlore.xyz", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary"]],
  ["indexer", "scripts/create-indexer-proof-draft.mjs", []],
  ["restore", "scripts/create-restore-proof-draft.mjs", ["--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore"]],
  ["monitoring", "scripts/create-monitoring-proof-draft.mjs", ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz"]],
  ["qa", "scripts/create-qa-proof-draft.mjs", ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144"]],
  ["canary", "scripts/create-canary-proof-draft.mjs", ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc"]],
];

const rows = [];
const issues = [];

for (const [id, script, args] of tasks) {
  const out = join(outDir, `${id}-proof.draft.json`);
  const result = spawnSync(process.execPath, [script, ...args, `--out=${out}`], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) issues.push(`${id}: ${script} failed`);
  rows.push([id, result.status === 0 ? "written" : "failed", out]);
}

console.log("| Draft | Status | Path |");
console.log("| --- | --- | --- |");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log(`Summary: ${issues.length === 0 ? "all proof drafts were created; Draft files are not launch proof; promote only after real external evidence and strict validation" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) process.exitCode = 1;