import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isHttpsRpcUrl,
  launchGateSummary,
  parseCanonicalPositiveBigInt,
  parseChainTileId,
  parseEpochArgValues,
  parseEpochs,
  validateEpochArg,
} from "./chain-proof-policy.mjs";

const projectRoot = process.cwd();
const collectorPath = join(projectRoot, "scripts", "collect-chain-proof.mjs");
const CONTRACT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";

function runSummary({ rpc = "https://rpc.linea.build", epochs = "3,1,3" } = {}) {
  return spawnSync(process.execPath, [collectorPath, "--strict", "--summary-only", `--epochs=${epochs}`], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      LINEA_NETWORK: "mainnet",
      KEEPER_RPC_URL: rpc,
      NEXT_PUBLIC_LINEA_RPCS: "",
      NEXT_PUBLIC_LINEA_SEPOLIA_RPCS: "",
      KEEPER_CONTRACT_ADDRESS: CONTRACT,
      NEXT_PUBLIC_CONTRACT_ADDRESS: CONTRACT,
      NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: TOKEN,
      PROOF_CHAIN_USER: "",
      PROOF_CHAIN_EPOCHS: "",
      PROOF_CHAIN_OUT: "",
      PROOF_STRICT: "",
    },
  });
}

export function runChainProofPolicyTests() {
  const collectorSource = readFileSync(collectorPath, "utf8");
  assert.equal(
    [...collectorSource.matchAll(/\bparseChainTileId\(/g)].length,
    2,
    "chain collector must validate both resolved-epoch and user-reward winning tiles through the tested policy",
  );
  assert.doesNotMatch(
    collectorSource,
    /function (?:isHttpsRpcUrl|launchGateSummary|parseChainTileId|parseEpochs|validateEpochArg)\(/,
    "chain collector must not reintroduce local implementations beside the tested policy",
  );

  assert.equal(launchGateSummary(0), "covered gates: G1; groups: chain=1");
  assert.equal(launchGateSummary(1), "blocked gates: G1; groups: chain=1");

  assert.equal(isHttpsRpcUrl("https://rpc.linea.build"), true);
  for (const value of ["http://rpc.linea.build", "https://user:pass@rpc.linea.build", "not a URL"]) {
    assert.equal(isHttpsRpcUrl(value), false, `RPC URL must fail closed: ${value}`);
  }

  assert.equal(parseChainTileId(1n), 1);
  assert.equal(parseChainTileId(25n), 25);
  for (const value of [0n, 26n, 1, "1", null]) {
    assert.equal(parseChainTileId(value), null, `invalid chain tile must be rejected: ${String(value)}`);
  }
  assert.equal(parseChainTileId(1n, 0), null);
  assert.equal(parseChainTileId(1n, Number.NaN), null);

  assert.equal(parseCanonicalPositiveBigInt("9007199254740993"), 9_007_199_254_740_993n);
  for (const value of ["0", "01", "1e2", "-1", "10000000000000000"]) {
    assert.equal(parseCanonicalPositiveBigInt(value), null, `noncanonical epoch must be rejected: ${value}`);
  }
  assert.deepEqual(parseEpochArgValues("3, 1, nope"), [3n, 1n, null]);
  assert.deepEqual(parseEpochs("3,1,3", 99n), [1n, 3n]);
  assert.deepEqual(parseEpochs("", 5n), [2n, 3n, 4n, 5n]);
  assert.deepEqual(parseEpochs("", 2n), [1n, 2n]);
  assert.deepEqual(validateEpochArg("3,1,3"), []);
  assert.deepEqual(validateEpochArg("01,1e2"), [
    "epoch values must be canonical positive decimal integers",
    "at least one positive epoch must be checked",
  ]);

  const ready = runSummary();
  assert.equal(ready.status, 0, `${ready.stdout}\n${ready.stderr}`);
  assert.equal(ready.stderr, "");
  assert.match(ready.stdout, /RPC source: configured/);
  assert.match(ready.stdout, /Would read RPC: false/);
  assert.match(ready.stdout, /covered gates: G1; groups: chain=1/);
  assert.doesNotMatch(ready.stdout, /https:\/\//);

  const rejected = runSummary({ rpc: "https://user:secret@rpc.linea.build", epochs: "01,1e2" });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stderr, "");
  assert.match(rejected.stdout, /strict chain proof requires configured HTTPS RPC endpoints/);
  assert.match(rejected.stdout, /epoch values must be canonical positive decimal integers/);
  assert.match(rejected.stdout, /Would read RPC: false/);
  assert.match(rejected.stdout, /blocked gates: G1; groups: chain=1/);
  assert.doesNotMatch(rejected.stdout, /user:secret|https:\/\//);

  const broadNumberMutant = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? BigInt(Math.trunc(parsed)) : null;
  };
  assert.equal(broadNumberMutant("1e2"), 100n);
  assert.equal(parseCanonicalPositiveBigInt("1e2"), null);
}
