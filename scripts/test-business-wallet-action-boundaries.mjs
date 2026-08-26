import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export function runWalletActionBoundaryTests() {
  const hookBehavior = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", "scripts/test-wallet-actions-hook-behavior.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(hookBehavior.error, undefined, "wallet action behavior harness must start");
  assert.equal(hookBehavior.status, 0, "wallet action behavior harness must pass");
  assert.match(
    hookBehavior.stdout,
    /wallet actions hook behavior tests passed \(22 cases\)/,
    "wallet action behavior harness must exercise receipt quorum finality, reward display, external-balance boundaries, and wallet action states",
  );
}
