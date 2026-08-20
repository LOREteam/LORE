import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseV10SepoliaDeploymentManifest, verifyV10SepoliaDeploymentManifest } from "./verify-v10-sepolia-deployment-manifest.mjs";

export function runV10SepoliaDeploymentManifestTests() {
  const root = process.cwd();
  const raw = readFileSync(path.join(root, "config", "lineaV10SepoliaDeploymentManifest.json"), "utf8");
  const manifest = parseV10SepoliaDeploymentManifest(raw);
  assert.equal(manifest.contractAddress, "0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a");
  assert.equal(manifest.deployBlock, "31678224");
  assert.equal(manifest.epochBoundBetSelector, "0xd2815478");
  assert.equal(manifest.epochBoundBetsRequired, true);
  assert.throws(() => parseV10SepoliaDeploymentManifest(JSON.stringify({ ...manifest, chainId: 1 })), /target is invalid/);
  assert.throws(() => parseV10SepoliaDeploymentManifest(JSON.stringify({ ...manifest, contractAddress: manifest.historicalContractAddresses[0] })), /historical target is invalid/);
  assert.throws(() => parseV10SepoliaDeploymentManifest(JSON.stringify({ ...manifest, epochBoundBetsRequired: false })), /epoch-bound mode is invalid/);
  assert.throws(() => parseV10SepoliaDeploymentManifest(JSON.stringify({ ...manifest, sourceSha256: "0".repeat(63) })), /sourceSha256 is invalid/);
  assert.throws(() => parseV10SepoliaDeploymentManifest(JSON.stringify({ ...manifest, fallbackAddress: manifest.contractAddress })), /unexpected schema/);
  const result = verifyV10SepoliaDeploymentManifest({ projectRoot: root });
  assert.equal(result.status, "pass");
  assert.equal(result.historicalTargetsExcluded, true);
  assert.equal(result.transactionSent, false);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runV10SepoliaDeploymentManifestTests();
  console.log("V10 Sepolia deployment manifest behavior tests passed");
}
