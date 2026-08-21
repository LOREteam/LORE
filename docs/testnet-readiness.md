# Testnet Readiness

Use this runbook for Linea Sepolia validation only. It does not close or modify mainnet launch gates.

## Scope

- Target network: `sepolia` / Linea Sepolia (`59141`).
- Current canonical V10 target: contract
  `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a`, deploy block `31678224`.
- Runtime and every V10 canary must set
  `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1` and reject a target that
  lacks the epoch-bound betting selector. Legacy selectors are compatibility
  only.
- Offline local V10 manifest/provenance verification is recorded against
  verifier source SHA `7905dc764` only. It does not prove deployed bytecode,
  a hosted runtime, a wallet flow, or any signed testnet transaction.
- Do not copy testnet artifacts into `docs/canary-proof.json`, `docs/qa-proof.json`, or any mainnet proof record.

## Local Baseline

```powershell
npm.cmd run proof:drafts
npm.cmd run typecheck
npm.cmd run test:contract
npm.cmd run test:logic
npm.cmd run build
```

## Pending Nonce Recovery

Before a managed soak, run the transaction-free check:

```powershell
npm.cmd run soak:testnet:clear-pending
```

Do not start a soak while it reports a pending nonce gap. The command defaults
to dry-run and does not load a signing account. A replacement is a separate
operator action that requires fresh approval plus both `--execute` and
`--confirm-lowest-pending-nonce-replacement`. It is restricted to Linea
Sepolia, sends one zero-value self-transfer for the lowest pending nonce, and
has a hard cap of one replacement per invocation. Re-run the dry-run after any
approved replacement; do not retry a game transaction or start another
supervisor until the queue is clear.

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

The canary dry-run loads only public role addresses from
`.env.live-test-addresses`; it defers `.env.live-test-wallets` until both live
execution confirmations are present.

live:canary now prints only target configured status, roles, and aggregate readiness by default. Keep `LIVE_TEST_VERBOSE_TARGETS` and `LIVE_TEST_VERBOSE_WALLETS` unset for routine evidence runs so addresses and balances are not emitted to the console.

- connect, disconnect, reconnect, reload, wrong network, and clean-wallet first transaction;
- ETH gas top-up, LINEA transfer/deposit/withdrawal, rejection, revert, pending, success, and explorer links;
- manual bet, batch/bitmap bet, rewards/rebates claim, and resolve;
- RPC offline retry recovery, stale/degraded labels, empty-pool chart, number typography, jackpots/rewards, mobile layout, overlays, chat, and ErrorBoundary/console errors.

### V10 Evidence Boundary

Local smoke, static wallet-state checks, and historical V9 transaction records
do not prove a signed V10 wallet flow. Fresh V10 evidence for manual bet,
Auto-Miner, claim/rebate, and wallet reconnect/recovery requires a new,
explicit, bounded transaction authorization for that exact testnet run. Until
then, record those cases as external evidence blocked rather than promoting
older transaction hashes. Privy production-domain and real mobile Web3-browser
evidence also remain external until an HTTPS origin and Privy configuration are
available.

Never include private keys, wallet inventory, Privy sessions, cookies, or keyed RPC URLs in reports.

## Consent-Bound Sepolia Campaign

The required order is fixed: (1) a fresh-consent, six-unique-epoch V10
canary, (2) recovery and reconciliation against that canary, then (3) a
freshly authorized 50-unique-epoch soak. No phase may be inferred from a
submission count or from historical records. Every phase must use the canonical
target, required epoch-bound runtime mode, and its own exact bounded authority.

For phase 1, the saved JSONL must show six successful unique epochs and at
least 45 seconds between the first and last of those epochs. This is admission
evidence only; it is not the 50-epoch soak.

```powershell
$env:LIVE_CANARY_MIN_EPOCHS = "6"
$env:LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH = "45000"
$env:LIVE_CANARY_RPC_LABEL = "<concrete-redacted-sepolia-provider-label>"
# This is read-only unless both execution confirmations below are present.
npm.cmd run live:canary

# Run only after a fresh, bounded authorization for this exact canary.
$env:LIVE_TEST_EXECUTE = "1"
npm.cmd run live:canary -- --execute-live
```

Only after the six-epoch canary has completed and its recovery/reconciliation
record is accepted, run the transaction-free supervisor preflight for the
50-unique-epoch production-like soak. Keep the real supervisor in a durable
foreground terminal or an external process manager:

```powershell
npm.cmd run soak:testnet:dry-run
# The ordinary supervisor command is also dry-run by default.
npm.cmd run soak:testnet

# Run only after a fresh, bounded authorization for this exact soak.
$env:SOAK_EXECUTE_LIVE = "1"
npm.cmd run soak:testnet -- --execute-live
```

If preflight reports `pending-nonce-blocked`, do not start another supervisor.
Use the compact read-only status first:

```powershell
npm.cmd run soak:testnet:status:summary
npm.cmd run soak:testnet:clear-pending
```

The recovery command is locked to the `AUTOMINER_A` Linea Sepolia test wallet
and defaults to dry-run. Its explicit `--execute` mode replaces exactly one
blocked nonce with a zero-value self-transaction. Use it only after an operator
has approved that single replacement, then re-run the dry-run preflight before
any soak restart. It never targets mainnet, the game contract, or the token
contract.

The supervisor creates an ephemeral diagnostics secret in memory, starts an
isolated production server, enables randomized 1-25 tile rounds with bounded
small bets and RPC-failover injection, records atomic status under
`.tmp/testnet-soak/status.json`, and stops the server after the canary exits.
The real run defaults to 1,440 rounds and health sampling every five rounds.
The supervisor process itself must remain alive; a short-lived shell is not a
durable process manager.

After the real log exists, create redacted target, recovery, session, and transaction-scan artifacts. Then create a separate draft:

```powershell
npm.cmd run proof:testnet:canary:draft -- --network=linea-sepolia --chain-id=59141 --contract=$env:NEXT_PUBLIC_CONTRACT_ADDRESS --rpc-label=<concrete-redacted-sepolia-provider-label> --live-log=data/live-test-runs/<real-log>.jsonl --target-artifact=docs/testnet-canary-target.log --recovery-artifact=docs/testnet-canary-recovery.log --session-artifact=docs/testnet-canary-session.log --tx-artifact=docs/testnet-canary-transactions.log --out=docs/testnet-canary-proof.draft.json
```

Review and replace draft TODO fields only with real evidence, then promote it manually to `docs/testnet-canary-proof.json` and validate:

```powershell
npm.cmd run proof:testnet:canary -- data/live-test-runs/<real-log>.jsonl --strict --manifest=docs/testnet-canary-proof.json
```

The phase-1 validator must require its six unique successful auto-miner epochs;
the final soak validator must require 50 unique successful epochs. Both require
Sepolia target metadata, elapsed wall-clock evidence, unique valid tx hashes,
no duplicate role/epoch/tile keys, no nonce gaps, no failed bets/resolves,
no template/secret-like values, and verified recovery plus transaction-health
evidence.

## Evidence Status

Keep testnet reports and the live JSONL separate from mainnet proof manifests. A passing testnet canary is readiness evidence for testnet only; it is not mainnet launch approval.

### Historical Ledger (2026-07-23; not current canonical-V10 evidence)

The rows below preserve prior testnet history only. They do not establish a
live claim for the canonical target above: no signed canonical-V10 canary, bet,
claim/rebate, recovery, or soak is recorded by this runbook. Local offline
manifest/provenance verification at `7905dc764` remains local only.

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Local logic and V10 review gate | Pass | `gate:contract:v10:review` passed the official compiler-advisory check, complete deterministic local gate, and fixed-synthetic-caller Linea state-override behavior matrix for the manifest-pinned V10 candidate. This is semantic/security evidence only; it does not prove deployed bytecode or live transactions. |
| Final real-token predeployment gas refresh | Blocked | The stricter predeploy command reached its final transaction-free gas benchmark and failed closed because no configured public test account currently has sufficient existing allowance. Its redacted readiness diagnostic shows sufficient token balance and missing allowance for all four configured roles, without addresses, amounts, or RPC URLs. Existing mined V9/V10 receipts remain historical gas evidence; no synthetic-token estimate is presented as a replacement. |
| Contract/indexer reconciliation | Pass | A fresh V10 indexer replay stored 12 protected bets over six epochs; restart catch-up was clean and direct chain/indexer accounting matched through the latest resolved epoch. The older `docs/testnet-indexer-chain-comparison-2026-07-10.json` remains V9 regression evidence only. |
| Current indexer/runtime recheck | Pass | Exact Next/eslint-config-next pins were upgraded from 16.2.6 to 16.2.12. The production dependency audit is clear of high/critical advisories; the full dev-scope audit uses the documented ESLint/minimatch exception. The complete local check passes production build, HTTP smoke, and responsive desktop/mobile browser smoke against the V10 runtime and fresh V10 indexer scope. Its weak rate-limit identity exists only in managed child-process env, production validation rejects the flag, stale smoke origins fail before spawn, and port 3101 is closed. This does not replace the remaining signed wallet matrix. |
| Prior-deployment live canary | Historical only | The bounded V10 tranche recorded four approvals, 12 protected bets, five resolves, and a later sixth resolve on the prior deployment. It does not authorize or prove any action on the canonical target; no claims/rebates, recovery, or long soak are recorded for the current target. |
| Signed V10 Privy bet and recovery | Open | Existing signed Privy game-bet evidence predates V10. The active V10 browser path still needs a bounded signed bet plus rejection/pending/reload recovery evidence; responsive unsigned browser smoke already passes. |
| Basic browser UX | Pass | `docs/testnet-browser-smoke.log`: desktop/mobile layout, chart, number typography, navigation, chat, and local persistence. The global-stats browser RPC scan was replaced by indexer-backed `/api/global-stats`; the rebuilt production bundle uses local WOFF2 fonts and passed desktop/mobile Chrome checks with zero console errors. |
| Local failure-state UX | Pass | Extended browser smoke rendered RPC-offline retry wait, `Recovery queued`, `RESUME PENDING`, session-expired guidance, and state cleanup. This is local UI evidence, not a signed reverted/pending transaction claim. |
| Signed desktop Privy reload | Pass | Recorded in `docs/testnet-browser-smoke.log`: embedded wallet restored Active after reload; no manual MetaMask confirmation was required for the Privy bet path. |
| Signed Privy reload/tab/route recovery | Pass | Connected Chrome preserved the Active embedded wallet across `Hub -> Analytics -> Hub`, a temporary tab close/reopen, and a full reload; LOGIN remained absent, 25 tiles remained enabled, and console errors were zero. |
| Signed quiet-epoch manual bet | Historical V9 evidence | Connected Privy placed 1 LINEA on tile 1 in epoch 1996 after atomic quiet-epoch recovery; the pending control prevented duplicate submission and indexer evidence is block 30767779 / tx `0x270d688ae535270e2ccc02f18b59f0d3deaef1ed783dfb3b11183a3ab4868d50`. Repeat this contract-specific path on V10 before promoting it to current-candidate evidence. |
| Signed wrong-network ETH top-up | Pass | MetaMask switched from Ethereum Sepolia to Linea Sepolia and confirmed 0.001 ETH to the embedded wallet; historical block/tx identifiers are intentionally redacted here. Receipt status 1 and gas used 21,000. Rapid duplicate clicks are now guarded. |
| Signed external LINEA deposit | Pass | A single 10 LINEA ERC-20 transfer reached the embedded wallet at block 30770567 / tx `0xc6d280600638c6b8d5e0dc37c07e4236c691a7ccd57a3169ac453f27b25a77b8`; receipt status 1, gas used 35,060, no duplicate matching transfer, resulting embedded balance 99,009 LINEA. |
| Signed embedded-wallet withdrawals | Pass | Embedded Privy sent 0.001 ETH at block 30770653 / tx `0x5abf31f78e874890826ca905f291a01489dd4cbdd341c13c3cb5197cd63f6ec5` (status 1, gas 21,000) and 1 LINEA at block 30770656 / tx `0xa8fe376451c3bf09707792de4e58992475858c9744e567ee92cc502d970830ef` (status 1, gas 35,060); exactly one matching transfer of each asset was found. |
| Signed external-wallet rejection | Pass | In Wallet Settings, one LINEA deposit prompt was explicitly rejected in MetaMask. The application showed `LINEA deposit rejected in wallet.` and cleared the sending state; no transfer was submitted. |
| Signed pre-submission transfer failure | Pass | An intentionally oversized LINEA deposit was rejected by the RPC before broadcast with `Transaction gas limit cap exceeded`; the app cleared its sending state. The raw provider wording exposed an actionable UX defect, now fixed by external-balance validation before prompting and a generic pre-submission failure message. |
| Signed on-chain revert | Pass | `docs/testnet-signed-revert.json`: a guarded Linea Sepolia test wallet sent `Test LINEA.transfer(zeroAddress, 1)` only after local simulation reverted. The signed receipt for `0x57721fab36afdc81d38caec36409da3274ffc080a39617df35a46e55b0175c9c` has `status: reverted`, gas used 22,364, and moved no tokens. |
| Signed clean-wallet first transaction | Pass | A funded previously unused MetaMask account began at nonce 0, then sent exactly one 10 LINEA deposit to the current Privy recipient `0x092b1dC85B4BC9Faa1FFDb3fB6E21F6D9cA89cEB`: block 30772251 / tx `0xaa59151220b267582040c68280ebe99b5202b735246e8a11d9ffa1ab8a6e21ea`. Sender nonce is now 1 and no duplicate outbound transaction exists. |
| Real mobile-device wallet session | Deferred to mainnet rollout | Responsive mobile layout, wallet selector, overlay geometry, and console checks are covered on testnet. A physical MetaMask/Rabby mobile-browser session requires the final HTTPS origin and is intentionally deferred; it is not represented as mainnet proof here. |
| Mainnet gates | Out of scope | No testnet artifact is a mainnet proof, and no G1-G14 production evidence is promoted by this runbook. |
