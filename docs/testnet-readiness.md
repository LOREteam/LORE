# Testnet Readiness

Use this runbook for Linea Sepolia validation only. It does not close or modify mainnet launch gates.

## Scope

- Target network: `sepolia` / Linea Sepolia (`59141`).
- Current deployed game: contract `0x235ba811b69f4e449c11ae1264a611e67386ee4d`, deploy block `30804467`.
- Keep EIP-7702 disabled for normal wallet transactions. The diagnostic/repair path is out of the normal test plan.
- Do not copy testnet artifacts into `docs/canary-proof.json`, `docs/qa-proof.json`, or any mainnet proof record.

## Local Baseline

```powershell
npm.cmd run proof:drafts
npm.cmd run typecheck
npm.cmd run test:contract
npm.cmd run test:logic
npm.cmd run build
```

## Contract and Indexer

1. Confirm the browser and indexer use Sepolia chain ID `59141`, the configured game address, token address, and deploy block.
2. Run a fresh indexer DB outside the repository from the configured deploy block.
3. Compare selected epochs, jackpots, rewards, rebates, deposits, and resolves with direct Sepolia reads.
4. Restart the indexer and verify the same external DB persists its heartbeat and latest indexed epoch.
5. Perform one backup/restore drill against test data. Save only redacted summaries.

## Wallet and UI QA

Use the dedicated test profile and funded test wallets. Record exact testnet origin, timestamp, tx hash, result, and concise error/recovery evidence for:

Create a fresh ignored burner-wallet file only when one does not already exist:

```powershell
npm.cmd run live:wallets:create
```

The generator refuses to overwrite `.env.live-test-wallets`. Never print or
copy that file into logs, reports, proof artifacts, or commits.

live:canary now prints only roles and aggregate readiness by default. Keep LIVE_TEST_VERBOSE_WALLETS unset for evidence runs so addresses and balances are not emitted to the console.

- connect, disconnect, reconnect, reload, wrong network, and clean-wallet first transaction;
- ETH gas top-up, LINEA transfer/deposit/withdrawal, rejection, revert, pending, success, and explorer links;
- manual bet, batch/bitmap bet, rewards/rebates claim, and resolve;
- RPC offline retry recovery, stale/degraded labels, empty-pool chart, number typography, jackpots/rewards, mobile layout, overlays, chat, and ErrorBoundary/console errors.

Never include private keys, wallet inventory, Privy sessions, cookies, or keyed RPC URLs in reports.

## Real Sepolia Canary

The target is at least 50 successful unique auto-miner epochs. A count of submitted transactions is not evidence of 50 epochs: the saved JSONL timestamps must show at least 45 seconds between the first and last of the first 50 unique epochs.

```powershell
$env:LIVE_CANARY_MIN_EPOCHS = "50"
$env:LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH = "45000"
$env:LIVE_CANARY_RPC_LABEL = "<concrete-redacted-sepolia-provider-label>"
npm.cmd run live:canary
```

For the production-like 24-hour soak, first run the transaction-free supervisor
preflight, then keep the real supervisor in a durable foreground terminal or an
external process manager:

```powershell
npm.cmd run soak:testnet:dry-run
npm.cmd run soak:testnet
```

The supervisor creates an ephemeral diagnostics secret in memory, starts an
isolated production server, enables randomized 1-25 tile rounds with bounded
small bets and RPC-failover injection, records atomic status under
`.tmp/testnet-soak/status.json`, and stops the server after the canary exits.
The real run defaults to 1,440 rounds and health sampling every five rounds.
The supervisor process itself must remain alive; a short-lived shell is not a
durable process manager.

After the real log exists, create redacted target, recovery, session, and transaction-scan artifacts. Then create a separate draft:

```powershell
npm.cmd run proof:testnet:canary:draft -- --network=linea-sepolia --chain-id=59141 --contract=0x235ba811b69f4e449c11ae1264a611e67386ee4d --rpc-label=<concrete-redacted-sepolia-provider-label> --live-log=data/live-test-runs/<real-log>.jsonl --target-artifact=docs/testnet-canary-target.log --recovery-artifact=docs/testnet-canary-recovery.log --session-artifact=docs/testnet-canary-session.log --tx-artifact=docs/testnet-canary-transactions.log --out=docs/testnet-canary-proof.draft.json
```

Review and replace draft TODO fields only with real evidence, then promote it manually to `docs/testnet-canary-proof.json` and validate:

```powershell
npm.cmd run proof:testnet:canary -- data/live-test-runs/<real-log>.jsonl --strict --manifest=docs/testnet-canary-proof.json
```

The strict testnet validator requires: Sepolia target metadata, 50 unique successful auto-miner epochs, elapsed wall-clock evidence, unique valid tx hashes, no duplicate role/epoch/tile keys, no nonce gaps, no failed bets/resolves, no template/secret-like values, and verified recovery plus transaction-health evidence.

## Evidence Status

Keep testnet reports and the live JSONL separate from mainnet proof manifests. A passing testnet canary is readiness evidence for testnet only; it is not mainnet launch approval.

### Current Ledger (2026-07-17)

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Local logic and V9 invariants | Pass | `typecheck`, `test:logic`, `test:contract`, and the rebuilt production `build` passed after the latest runtime changes. Fonts are local WOFF2 assets, so the former Google Fonts build dependency is removed. |
| Contract/indexer reconciliation | Pass | `docs/testnet-indexer-chain-comparison-2026-07-10.json`: four selected resolved epochs matched direct chain events exactly; the fresh-indexer restart and local restore drill are recorded in `docs/current_state.md`. |
| Current indexer/runtime recheck | Pass | Latest `indexer:once` scanned the current 1,433-block interval, completed one bounded repair slice, and reported no missing epochs. Rebuilt `next start` then passed HTTP and browser smoke; this is incremental testnet evidence, not a replacement for the fresh-DB/restart/restore drill. |
| Current-candidate live canary | Pending | The 2026-07-10 50-epoch canary passed for the previous testnet candidate and remains historical regression evidence only. The accepted V9 candidate still requires the 1,440-round production-like soak with health telemetry and RPC-failover injection described above. |
| Basic browser UX | Pass | `docs/testnet-browser-smoke.log`: desktop/mobile layout, chart, number typography, navigation, chat, and local persistence. The global-stats browser RPC scan was replaced by indexer-backed `/api/global-stats`; the rebuilt production bundle uses local WOFF2 fonts and passed desktop/mobile Chrome checks with zero console errors. |
| Local failure-state UX | Pass | Extended browser smoke rendered RPC-offline retry wait, `Recovery queued`, `RESUME PENDING`, session-expired guidance, and state cleanup. This is local UI evidence, not a signed reverted/pending transaction claim. |
| Signed desktop Privy reload | Pass | Recorded in `docs/testnet-browser-smoke.log`: embedded wallet restored Active after reload; no manual MetaMask confirmation was required for the Privy bet path. |
| Signed Privy reload/tab/route recovery | Pass | Connected Chrome preserved the Active embedded wallet across `Hub -> Analytics -> Hub`, a temporary tab close/reopen, and a full reload; LOGIN remained absent, 25 tiles remained enabled, and console errors were zero. |
| Signed quiet-epoch manual bet | Pass | Connected Privy placed 1 LINEA on tile 1 in epoch 1996 after atomic quiet-epoch recovery; the pending control prevented duplicate submission and indexer evidence is block 30767779 / tx `0x270d688ae535270e2ccc02f18b59f0d3deaef1ed783dfb3b11183a3ab4868d50`. |
| Signed wrong-network ETH top-up | Pass | MetaMask switched from Ethereum Sepolia to Linea Sepolia and confirmed 0.001 ETH to the embedded wallet at block 30770269 / tx `0x3aa666275356f9600f4cc2c49d8fca990bace5fef5d97826912c331797856f5c`; receipt status 1 and gas used 21,000. Rapid duplicate clicks are now guarded. |
| Signed external LINEA deposit | Pass | A single 10 LINEA ERC-20 transfer reached the embedded wallet at block 30770567 / tx `0xc6d280600638c6b8d5e0dc37c07e4236c691a7ccd57a3169ac453f27b25a77b8`; receipt status 1, gas used 35,060, no duplicate matching transfer, resulting embedded balance 99,009 LINEA. |
| Signed embedded-wallet withdrawals | Pass | Embedded Privy sent 0.001 ETH at block 30770653 / tx `0x5abf31f78e874890826ca905f291a01489dd4cbdd341c13c3cb5197cd63f6ec5` (status 1, gas 21,000) and 1 LINEA at block 30770656 / tx `0xa8fe376451c3bf09707792de4e58992475858c9744e567ee92cc502d970830ef` (status 1, gas 35,060); exactly one matching transfer of each asset was found. |
| Signed external-wallet rejection | Pass | In Wallet Settings, one LINEA deposit prompt was explicitly rejected in MetaMask. The application showed `LINEA deposit rejected in wallet.` and cleared the sending state; no transfer was submitted. |
| Signed pre-submission transfer failure | Pass | An intentionally oversized LINEA deposit was rejected by the RPC before broadcast with `Transaction gas limit cap exceeded`; the app cleared its sending state. The raw provider wording exposed an actionable UX defect, now fixed by external-balance validation before prompting and a generic pre-submission failure message. |
| Signed on-chain revert | Pass | `docs/testnet-signed-revert.json`: a guarded Linea Sepolia test wallet sent `Test LINEA.transfer(zeroAddress, 1)` only after local simulation reverted. The signed receipt for `0x57721fab36afdc81d38caec36409da3274ffc080a39617df35a46e55b0175c9c` has `status: reverted`, gas used 22,364, and moved no tokens. |
| Signed clean-wallet first transaction | Pass | A funded previously unused MetaMask account began at nonce 0, then sent exactly one 10 LINEA deposit to the current Privy recipient `0x092b1dC85B4BC9Faa1FFDb3fB6E21F6D9cA89cEB`: block 30772251 / tx `0xaa59151220b267582040c68280ebe99b5202b735246e8a11d9ffa1ab8a6e21ea`. Sender nonce is now 1 and no duplicate outbound transaction exists. |
| Real mobile-device wallet session | Deferred to mainnet rollout | Responsive mobile layout, wallet selector, overlay geometry, and console checks are covered on testnet. A physical MetaMask/Rabby mobile-browser session requires the final HTTPS origin and is intentionally deferred; it is not represented as mainnet proof here. |
| Mainnet gates | Out of scope | No testnet artifact is a mainnet proof, and no G1-G14 production evidence is promoted by this runbook. |
