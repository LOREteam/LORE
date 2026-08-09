# Candidate Testnet Acceptance Checklist - 2026-07-12

Candidate: Linea Sepolia deployment at block `30804467`. Evidence details are in `docs/testnet-candidate-gas-matrix-2026-07-12.md`.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Gas receipts and controlled V9 comparison | Pass | 1/3/5/25 tiles, four applicable methods, first/repeat, allowance and first approval recorded separately from network fees. Candidate adds no material cost reduction over V9. |
| Compiler/source provenance | Pass | Remix Compiler panel confirms Solidity `0.8.34+commit.80d5c536`, optimization enabled with `200` runs, EVM target `osaka`, and target `contracts/LineaOreV9.sol:LineaOreV9`; normalized local sources match the published metadata. |
| V9 invariants on deployed source | Pass | `npm.cmd run test:contract` passed against the locally normalized source set that matches the candidate metadata; it covers ABI/event compatibility, non-reentrancy, epoch timing, fee/rollover math, and reward/rebate claim invariants. |
| Manual on-chain game paths | Pass | Single, bitmap, sameAmount, arrays; normal, non-empty resolve and empty-epoch atomic advance paths exercised. |
| Mixed roles and duplicate protection | Pass (short) | Four roles, varied stake sizes/tile counts, no failures or duplicate transaction hashes. |
| Auto-Miner reload/recovery | Not rerun | Shared UI persistence/reload smoke passed. The user explicitly declined another candidate-authenticated Auto-Miner run because this flow has already been exercised; do not represent this row as fresh live evidence. |
| Rewards, rebates, resolver reward | Pass | Batch reward claim, rebate claim, resolver claim, post-claim zero state and repeat rejection tested. |
| Fees, burn, rollover, jackpots | Pass (state) | Buckets observed nonzero; no owner fee-flush transaction was sent. |
| Fresh candidate indexer | Pass | Fresh SQLite from deployment block, restart idempotency, direct chain comparison, artificial missing-epoch reconcile and scope isolation passed. |
| Candidate API data handlers | Pass | Epochs, live state, jackpots, rewards/deposits, rebates, leaderboards, global stats and health handlers returned expected 200 responses against candidate DB. |
| Candidate HTTP smoke | Pass | Fresh candidate SQLite was indexed from deployment block and a full isolated HTTP smoke completed successfully, including a cold `/api/leaderboards` `200`. After the real Privy App ID was configured and the isolated production runtime rebuilt, the complete smoke passed again. The earlier 500 was not reproducible in the clean candidate runtime. |
| Candidate browser smoke | Pass (unauthenticated) | Safe UI-only candidate runtime passed the standard Playwright smoke on desktop and `390x844` mobile: chart, grid, Manual Bet, Auto-Miner persistence, wallet selector, chat, navigation and no unexpected console/page errors. Authenticated wallet actions remain a separate gate. |
| Privy authenticated manual bet | Pass | User selected tile `#25` and spent 10 Test LINEA through the active Privy wallet without a MetaMask confirmation. A subsequent candidate indexer pass observed exactly one new bet and its resolved epoch; reconcile found no gap. |
| Pre-confirmation ETH fee estimate | Accepted (no fresh rerun) | Manual Bet requests a debounced, read-only estimate for the selected `placeBet`/bitmap path and renders it in desktop and mobile controls; RPC/simulation failure is explicit rather than replaced with a fixed value. Typecheck, regression check and unauthenticated browser smoke passed. The user explicitly waived another authenticated funded-wallet quote; do not represent this row as fresh signed evidence. |
| External wallet and mobile flows | Accepted (no fresh rerun) | Shared ETH/LINEA transfer handling distinguishes reject, ambiguous timeout, pending, confirmed and reverted states. External sends verify the target chain and re-read the active provider account after network switching, preventing a stale MetaMask/Rabby `from` account. `test:logic` and `typecheck` pass. Existing wallet/mobile coverage was accepted by the user without another candidate Rabby or authenticated mobile rerun; do not claim fresh evidence. |
| RPC recovery and polling | Pass (controlled) | Fixed a live-state backoff deadlock where some failure counts could suppress every future retry. Failed reads now skip at most three base intervals before an obligatory retry. After two successful API reads, temporary direct-contract fallback polling is disabled again unless Auto-Miner requires it, avoiding permanent duplicate reads. Healthy/chart polling frequency is unchanged. `test:logic` and `typecheck` pass. A UI-only Playwright drill injected five consecutive `/api/live-state` 503 responses, observed the bounded retry recover with two successful reads, kept the pool chart mounted, and recorded zero page errors. |
| 50-100 epoch candidate canary | Pass | 50 sequential candidate epochs completed in 3,503,373 ms: 50/50 bets and 50 resolves, all four roles/methods, 1-25 tiles, 1,017.1-9,749.8 Test LINEA, zero failed bets/resolves, nonce gaps, duplicate hashes, or duplicate role/epoch/tile keys. See `docs/testnet-candidate-canary-2026-07-12.md`. |
| Ownership | Pass | Owner and fee recipient configured. This is historical candidate evidence; the old experimental wallet path has since been removed. |
| Mainnet permit integration | Deferred | `permitAndPlace...` remains a separate mainnet/EIP-2612 design and security-review task. |

## Testnet Switch Gate

The shared testnet candidate is accepted on the evidence above. Fresh reruns explicitly waived by the user remain labelled as such and are not promoted to new evidence.

1. Authenticated Privy and external-wallet flows use the existing recorded evidence; no fresh candidate rerun is claimed.
