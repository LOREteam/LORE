# Testnet Bet Fee Baseline - 2026-07-12

Scope: Linea Sepolia receipts only. Amount is 1 test LINEA per selected tile. `gasUsed` is transaction gas; the paid network fee is `gasUsed * effectiveGasPrice` and is therefore not a contract-only metric.

## Measured Receipts

| Path | Tiles | gasUsed |
| --- | ---: | ---: |
| single, normal epoch | 1 | 149,299 |
| bitmap | 3 | 248,213 |
| sameAmount | 3 | 245,245 |
| arrays | 3 | 248,541 |
| bitmap | 5 | 343,531 |
| sameAmount | 5 | 339,415 |
| arrays | 5 | 344,623 |
| bitmap | 25 | 1,276,203 |
| sameAmount | 25 | 1,281,117 |
| arrays | 25 | 1,305,461 |

The 243,889-gas single-bet receipt is excluded from the normal single baseline because it atomically advanced an expired epoch. Resolver work must not be presented as ordinary player-bet cost.

## First-Tile Cost And Approval

A controlled same-epoch measurement recorded two 1-tile bets at the same effective gas price:

| Operation | gasUsed | network fee (ETH) |
| --- | ---: | ---: |
| allowance refresh with existing allowance | 29,866 | 0.000002066577690804 |
| first bet on tile | 149,299 | 0.000008608952990304 |
| repeated bet by the same user on the same tile | 80,899 | 0.000004664838263904 |

The repeat is 68,400 gas (45.8%) lower. It proves the first user/tile state writes dominate the difference. The approval row is an existing-allowance refresh, not a fresh zero-to-nonzero approval baseline.

## Findings And Safe Changes

- `_recordBet` always updates `userBets`, `userEpochVolumes`, `tilePools`, and the epoch pool. These writes scale with selected tiles and are required for payouts, rebates, and UI totals.
- Before this change, the first bet on a tile also wrote `hasUserBetOnTile`. Since zero bets are rejected and `userBets` only increases within an epoch, `userBets == 0` is an equivalent first-tile sentinel.
- `LineaOreV9.sol` now uses the prior `userBets` value and removes that redundant bool mapping. ABI and accounting semantics remain unchanged.
- The current frontend bitmap-first batch choice is retained. `sameAmount` was slightly cheaper at 3 and 5 tiles, while bitmap was slightly cheaper at 25; the evidence is insufficient for a stable crossover heuristic.
- Existing max allowance already avoids approval on normal subsequent bets. The test-only canary supports `LIVE_TEST_FORCE_ALLOWANCE_APPROVE=1` and `LIVE_TEST_REPEAT_SAME_BET=1` for future receipt collection; both default to off.
- No EIP-2612 support is proven for the current test token: read-only `DOMAIN_SEPARATOR` and `nonces` probes were unavailable. There is also no `permit` or Permit2 consumption path in the game contract. Neither is a safe cost reduction without a contract integration and fresh security review.

## Controlled A/B Result

Two isolated Linea Sepolia V9 deployments were built with the same optimizer settings and tested with the same fresh-state 1-tile first/repeat recipe:

| Operation | Baseline gasUsed | Optimized gasUsed | Delta |
| --- | ---: | ---: | ---: |
| first bet on tile | 209,463 | 186,992 | -22,471 (-10.7%) |
| repeated bet on same tile | 81,280 | 79,152 | -2,128 (-2.6%) |
| first 3-tile bitmap batch | 377,382 | 309,969 | -67,413 (-17.9%) |
| first 5-tile bitmap batch | 559,812 | 447,457 | -112,355 (-20.1%) |
| first 25-tile bitmap batch | 2,376,720 | 1,814,945 | -561,775 (-23.6%) |

Every first-batch saving is exactly `tileCount * 22,471`, which proves the removed mapping write is paid once for every new user/tile pair. This proves the storage optimization reduces real execution gas across the complete 1/3/5/25 matrix. It must not be compared directly to the active testnet game's older receipts: that contract has nonzero token and epoch storage, while the A/B deployments start cold. An earlier no-optimizer isolated build was discarded for the same reason.

## Verification Before Adopting The Contract Change

1. Check V9 invariants, ABI compatibility, indexer event ingestion, manual bet, auto-miner, rewards, and rebate reads against the optimized address.
2. Switch the shared testnet configuration only after the measured receipts and end-to-end smoke are accepted.
