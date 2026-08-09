# QA Canary Test Plan Draft

This is a draft test plan. It is not launch proof until the real QA evidence is copied into docs/qa-proof.json and npm.cmd run proof:qa -- --strict passes.

## Target

- Origin: https://playlore.xyz
- Network: linea-mainnet
- Chain ID: 59144

## Wallet QA

| Check | Status | Evidence | Checked at |
| --- | --- | --- | --- |
| Privy allowed origins include the exact production origin, a production App ID is configured, and no development fallback app id is active. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Desktop connect, disconnect, reconnect, and wrong-network warning are verified. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Wallet loading state resolves or shows a recoverable error within the documented timeout. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Clean wallet first transaction succeeds and records a real non-zero tx hash. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Mobile Web3 browser connect and transaction flow are verified. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| ETH top-up, LINEA deposit, withdrawal, rejected prompt, timeout, and signed on-chain revert copy are verified. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Slow network auth modal and slow chat auth are visible and recoverable. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |

## Failure-State UX

| Check | Status | Evidence | Checked at |
| --- | --- | --- | --- |
| Disabled actions explain the reason instead of silently doing nothing. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Pending states are visible for bet, resolve, chat auth, and profile save. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Degraded/stale data is labelled clearly. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Pool chart remains visible with an explicit empty state when there are no bets. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Manual bet, Auto-Miner, tile values, wallet balances, jackpot amounts, and reward amounts use consistent number typography. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Route chunk recovery is visible and recoverable. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| No silent no-op remains in wallet, mining, chat, or profile flows. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |

## Support / Audit Visibility

| Check | Status | Evidence | Checked at |
| --- | --- | --- | --- |
| Bet history shows epoch, tile, amount, txHash, and result. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Auto-miner logs show round, epoch, nonce, txHash, retryCount, and stopReason. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Diagnostics/admin view shows indexer lag, heartbeat, and serving mode. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |

## Final Launch QA

| Check | Status | Evidence | Checked at |
| --- | --- | --- | --- |
| Browser smoke runs with debug autominer scenarios enabled. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| No unexpected console errors are present; unsupported wallet warnings are not masked. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Mobile layout, jackpot ticker, right panel, overlays, and chat geometry are verified without clipping or overlap. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| Jackpot and reward visibility are verified in empty, pending, awarded, and claimable states. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |
| FAQ, Whitepaper, and onboarding wording are mainnet-first. | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |

## Commands

```powershell
npm.cmd run proof:qa:draft -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --wallet-artifact=docs/qa-wallet-flow-report.md --failure-artifact=docs/qa-failure-state-report.md --support-artifact=docs/qa-support-audit-report.md --finalqa-artifact=docs/qa-final-browser-report.md --smoke-artifact=docs/qa-smoke-debug-autominer.log --clean-wallet-tx=<txHash> --out=docs/qa-proof.draft.json
npm.cmd run proof:qa -- --strict
```

## Evidence Rules

- Use only final public HTTPS origin evidence for launch proof.
- Redact cookies, tokens, Privy session data, RPC URLs, and unnecessary wallet inventory.
- Every completed item needs an ISO UTC timestamp and a concrete screenshot, log, tx hash, provider link, or QA artifact.
