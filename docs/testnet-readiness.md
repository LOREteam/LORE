# Testnet Readiness

Use this runbook for Linea Sepolia validation only. It does not close or modify mainnet launch gates.

## Scope

- Target network: `sepolia` / Linea Sepolia (`59141`).
- Current deployed game: contract `0x98eef041b012668529fb66ac3133900fdffc7282`, deploy block `28869863`.
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

After the real log exists, create redacted target, recovery, session, and transaction-scan artifacts. Then create a separate draft:

```powershell
npm.cmd run proof:testnet:canary:draft -- --network=linea-sepolia --chain-id=59141 --contract=0x98eef041b012668529fb66ac3133900fdffc7282 --rpc-label=<concrete-redacted-sepolia-provider-label> --live-log=data/live-test-runs/<real-log>.jsonl --target-artifact=docs/testnet-canary-target.log --recovery-artifact=docs/testnet-canary-recovery.log --session-artifact=docs/testnet-canary-session.log --tx-artifact=docs/testnet-canary-transactions.log --out=docs/testnet-canary-proof.draft.json
```

Review and replace draft TODO fields only with real evidence, then promote it manually to `docs/testnet-canary-proof.json` and validate:

```powershell
npm.cmd run proof:testnet:canary -- data/live-test-runs/<real-log>.jsonl --strict --manifest=docs/testnet-canary-proof.json
```

The strict testnet validator requires: Sepolia target metadata, 50 unique successful auto-miner epochs, elapsed wall-clock evidence, unique valid tx hashes, no duplicate role/epoch/tile keys, no nonce gaps, no failed bets/resolves, no template/secret-like values, and verified recovery plus transaction-health evidence.

## Evidence Status

Keep testnet reports and the live JSONL separate from mainnet proof manifests. A passing testnet canary is readiness evidence for testnet only; it is not mainnet launch approval.