# Candidate Testnet Gas Matrix - 2026-07-12

Scope: Linea Sepolia candidate deployment at block `30804467`. These are confirmed receipt `gasUsed` values from controlled canaries using 1,000 Test LINEA per selected tile and an already-issued allowance. The canary JSONL evidence stores `gasUsed`, `effectiveGasPrice`, and `networkFeeWei` separately; ETH fees are not contract-only measurements.

## Normal Bet Receipts

| Method | Tiles | gasUsed |
| --- | ---: | ---: |
| placeBet | 1 | 171,631 |
| placeBatchBetsBitmap | 3 | 315,227 |
| placeBatchBetsSameAmount | 3 | 312,237 |
| placeBatchBets | 3 | 315,579 |
| placeBatchBetsBitmap | 5 | 455,583 |
| placeBatchBetsSameAmount | 5 | 451,067 |
| placeBatchBets | 5 | 456,345 |
| placeBatchBetsBitmap | 25 | 1,834,477 |
| placeBatchBetsSameAmount | 25 | 1,839,369 |
| placeBatchBets | 25 | 1,864,023 |

All rows succeeded. Each batch-matrix canary also completed its required non-empty resolves without a revert.

## Controlled Comparison With Prior V9

The comparison uses the same role, allowance state, amount, tile count, and no atomic epoch advance:

| Method | Prior V9 gasUsed | Candidate gasUsed | Delta |
| --- | ---: | ---: | ---: |
| placeBet, 1 tile | 171,726 | 171,631 | -95 |
| bitmap, 3 tiles | 315,158 | 315,227 | +69 |
| sameAmount, 3 tiles | 312,546 | 312,237 | -309 |
| arrays, 3 tiles | 315,888 | 315,579 | -309 |

The candidate is 644 gas lower across these four receipts (161 gas per receipt, about 0.06%). This is not a material user-facing fee reduction and is not enough to justify switching the shared testnet frontend.

The candidate's initial 1-tile receipt used 283,143 gas because it atomically advanced an expired empty epoch. It is intentionally excluded from normal-bet comparisons.

## First, Repeat, And Approval

| Operation | gasUsed | Notes |
| --- | ---: | --- |
| First 1-tile bet | 171,631 | Existing allowance, no atomic advance |
| Immediate repeat on the same tile | 80,768 | Same user and epoch |
| First allowance approval | 46,966 | Candidate contract spender |

The repeat is 90,863 gas lower (52.9%). The difference is expected: the first bet initializes the user/tile and per-epoch accounting slots, while the repeat updates warm, existing state. `effectiveGasPrice` and `networkFeeWei` remain in the receipt evidence and are not conflated with these gas values.

## Fresh Indexer Check

A fresh temporary SQLite DB started at the candidate deployment block scanned 2,598 blocks and ingested 40 logs. Its first restart ingested zero logs and left the counts unchanged. After the first/repeat probe, the same DB caught up four new logs and contained 15 bets, 14 resolved epochs, and 2 jackpot events with no duplicate scoped bet identifiers. An isolated artificial-gap test then deleted one resolved epoch from a fresh copy: reconcile detected one missing epoch and restored one epoch with no duplicate rows. A direct chain comparison then matched all 16 candidate bet events to 16 indexed rows and all 16 `EpochResolved` events to indexed epoch rows, including winning tile, total pool, and reward pool after normalizing event wei values to the indexed LINEA units. The temporary DB is separate from the working application database.

## Reward And Rebate Claims

- A three-epoch `claimRewards` batch succeeded for the manual test wallet after three resolved 25-tile bets. It used 235,474 gas, marked all three epochs claimed, and a repeated batch correctly reverted in a read-only simulation.
- A separate one-tile AUTOMINER_A scenario resolved into a losing bet with a nonzero rebate. `claimEpochsRebate([epoch])` succeeded in 85,085 gas; its post-claim state was claimed with zero pending value, and a repeated/zero batch correctly reverted in a read-only simulation.
- Receipt evidence retains `gasUsed`, `effectiveGasPrice`, and `networkFeeWei` as separate fields. No claim hash or wallet identifier is recorded in this document.

## Fee, Rollover, And Resolver Flow

- Owner and fee recipient are configured. The accrued protocol-fee bucket, burn-fee bucket, resolver-reward bucket, rollover pool, and both jackpot pools were nonzero after the candidate scenarios.
- `claimResolverRewards` succeeded in 59,456 gas. The resolver pending balance became zero and a repeated claim correctly reverted in a read-only simulation.

## Mixed-Role Canary

A four-round candidate canary completed successfully across all four test roles. It covered 1, 10, 18, and 25 selected tiles with total stakes from 3,169.9 to 5,365 Test LINEA, plus three successful non-empty resolves. There were no failures or duplicate transaction hashes. This is short live coverage only; it does not replace the post-runtime-smoke 50-100 epoch canary.

## Candidate API Handler Smoke

The candidate environment and isolated SQLite DB were passed directly to the existing Next route handlers because the active local Next dev instance owns the workspace dev lock. All checked handlers returned HTTP 200: `/api/epochs`, `/api/live-state`, `/api/jackpots`, `/api/rebates`, `/api/leaderboards`, `/api/deposits?includeRewards=1`, `/api/global-stats`, `/api/health/data-sync`, and `/api/health/runtime`. The deposits response contained 15 indexed candidate records. Direct calls intentionally have no browser identity, so fallback rate-limit diagnostics were expected. This verifies route behavior and candidate data isolation, but is not a substitute for browser/HTTP smoke against a dedicated candidate server.

An isolated candidate Next dev runtime was then started with a separate `NEXT_DIST_DIR` on port 3002. Full HTTP smoke did not pass: its cold `/api/leaderboards` request reproducibly returned 500 with `SyntaxError: Unexpected end of JSON input`, while a subsequent direct request returned 200. The same route succeeded in direct handler checks. A clean second dev dist failed more broadly because Next on Windows returned `UNKNOWN` while opening its own generated chunk, so that result is an environment failure rather than application evidence. Candidate browser smoke reached the desktop hub, chart, number typography, and wallet-selector entry point, then hung waiting for the Privy modal and was stopped after a bounded timeout. Neither HTTP smoke nor authenticated candidate browser QA is marked passed.

An isolated production build produced compiled API route artifacts, but the corresponding `next start` candidate server returned 404 for the runtime-health route. It is also not accepted as production HTTP smoke evidence. Temporary candidate servers were stopped after these checks; the existing local runtime on port 3000 was left running.

The shared local UI browser smoke also passed on desktop and mobile. It covered chart mounting, number-font guards, wallet-selector rendering, Auto-Miner local persistence after reload, manual tile interaction, chat/profile overlays, Analytics, Safety Pool, leaderboards, White Paper, and FAQ. This is a shared UI regression result against the active local runtime, not candidate-frontend proof.

A short shared-runtime local load-smoke completed 5,146 responses in 10 seconds with no failed requests and a 109 ms total p95. The test intentionally exercised rate limiting; `429` responses were accepted protective responses, not transport errors. This remains shared-runtime evidence, not launch or candidate-server load proof.

The candidate runtime health handler reported `eip7702Enabled=false` and `eip7702MiningEnabled=false`.

## Provenance Status

- Deployment block: `30804467`.
- Deployment transaction: `0x75274752a6312b8269de5908f57013df8dc6b218f5f9022e4b09db6f39480138`.
- Runtime code hash at deployment block: `0x914e4bbe2c929525831941addb0abe0cf0cb98daa351f6a5a08452deda3cf6e6` (22,457 bytes).
- Contract code, Test LINEA binding, owner, fee recipient, ABI reads, four bet methods, and canary resolves have been checked.
- The Remix Compiler panel confirms Solidity `0.8.34+commit.80d5c536`, optimization enabled with `200` runs, EVM target `osaka`, and target `contracts/LineaOreV9.sol:LineaOreV9`. The normalized local source set matches the published metadata, so deployment provenance is complete.
- This document does not replace the isolated A/B proof of the `22,471 gas` storage-write removal in `docs/testnet-bet-fee-baseline-2026-07-12.md`; it shows that the new Remix deployment does not add a further material optimization gain.
