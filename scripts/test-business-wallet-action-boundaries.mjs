import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function runWalletActionBoundaryTests() {
  const walletActionsSource = readFileSync("app/hooks/useWalletActions.ts", "utf8");
  const walletTransferIntentSource = readFileSync("app/lib/walletTransferIntent.ts", "utf8");
  assert.match(walletTransferIntentSource, /async function readWalletTransferReceiptQuorum[\s\S]*Promise\.allSettled[\s\S]*receiptFingerprint\(first, hash\) !== receiptFingerprint\(second, hash\)[\s\S]*async function assertWalletTransferReceiptFinality[\s\S]*WALLET_TRANSFER_FINALITY_CONFIRMATIONS[\s\S]*const canonical = await readWalletTransferReceiptQuorum\(clients, hash\)[\s\S]*receiptFingerprint\(canonical, hash\) !== firstFingerprint[\s\S]*async function assertStableWalletTransferReceipt[\s\S]*assertWalletTransferReceiptFinality\(clients, hash, first\)[\s\S]*second\.status === "reverted"[\s\S]*throw new WalletTransactionRevertedError\(hash\)[\s\S]*return "confirmed"/, "wallet intents must require exact two-client receipt agreement, confirmation depth, and a canonical quorum reread before success or revert can clear an intent");
  assert.match(walletActionsSource, /RESOLVER_REWARD_LARGE_DISPLAY_WEI[\s\S]*formatResolverRewards[\s\S]*formatBalanceFixed\(\{ value, decimals: 18 \}/, "resolver reward display must format raw bigint reward units");
  assert.doesNotMatch(walletActionsSource, /Number\(formatUnits\(value, 18\)\)/, "resolver reward display must not coerce formatted reward units through Number()");
  assert.match(walletActionsSource, /publicClient\.readContract\([\s\S]*functionName: "balanceOf"[\s\S]*Insufficient LINEA balance in external wallet\./, "LINEA deposits must reject an amount above the current external-wallet balance before opening a wallet prompt");

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
    /wallet actions hook behavior tests passed \(17 cases\)/,
    "wallet action behavior harness must exercise pending, rejected, reverted, wrong-network, manual-reconciliation, and explorer-link states",
  );
}
