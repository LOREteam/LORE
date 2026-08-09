import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "lore-mainnet-proof-out-"));
const finalOut = join(tempRoot, "docs", "mainnet-env-proof.log");
const scriptPath = resolve(repoRoot, "scripts", "collect-mainnet-proof.mjs");
const env = { ...process.env };

for (const key of [
  "LINEA_NETWORK",
  "NEXT_PUBLIC_LINEA_NETWORK",
  "LINEA_CHAIN_ID",
  "NEXT_PUBLIC_LINEA_CHAIN_ID",
  "KEEPER_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS",
  "INDEXER_START_BLOCK",
  "NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK",
  "INDEXER_FINALITY_BLOCKS",
  "KEEPER_RPC_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "HEALTH_DIAGNOSTICS_SECRET",
  "TRUST_PROXY_HEADERS",
  "LORE_DB_PATH",
  "PROOF_MAINNET_OUT",
]) {
  delete env[key];
}

const result = spawnSync(process.execPath, [scriptPath, "--strict", "--out=docs/mainnet-env-proof.log"], {
  cwd: tempRoot,
  env,
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});
const output = `${result.stdout || ""}\n${result.stderr || ""}`;
const issues = [];

if (result.status === 0) issues.push("strict failed-env proof unexpectedly exited cleanly");
if (existsSync(finalOut)) issues.push("strict failed-env proof wrote docs/mainnet-env-proof.log");
if (!/Proof snapshot not written: strict check failed for final docs\/mainnet-env-proof\.log\./.test(output)) {
  issues.push("strict failed-env proof did not explain why final artifact was not written");
}
if (/Proof snapshot written: docs[\\/]mainnet-env-proof\.log/.test(output)) {
  issues.push("strict failed-env proof reported writing the final env artifact");
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
} catch {
  // Best-effort temp cleanup; validation status is already captured.
}

if (issues.length > 0) {
  console.error(`Summary: ${issues.length} mainnet proof output issue(s): ${issues.join("; ")}.`);
  process.exit(1);
}

console.log("Summary: mainnet proof strict-fail output guard passed.");
