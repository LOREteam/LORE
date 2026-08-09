# Linea fee optimization roadmap

Research note captured on 2026-07-21. This document records options for reducing
LORE transaction costs without treating UX improvements or gas sponsorship as
real protocol savings.

## Current baseline

- A five-tile bitmap bet currently measures about 455,583 gas.
- One hundred five-tile rounds therefore use about 45,558,300 gas before any
  network fee-price variation.
- The frontend gas-limit safety buffer is not an 80% fee surcharge. Unused gas
  is not charged, although the wallet can display a high maximum cost.
- The dominant cost is persistent contract state: user/tile bets, tile pools,
  epoch volume, and related counters.

Source: [testnet candidate gas matrix](./testnet-candidate-gas-matrix-2026-07-12.md).

## Decision summary

| Option | What it changes | Expected value | Decision |
| --- | --- | --- | --- |
| `linea_estimateGas` | Fee estimation, not contract gas usage | Possible reduction in effective gas price and fewer stuck/overpriced transactions | Test first with strict fallback |
| EIP-2612 permit | Removes a separate first-use approval transaction | One-time UX improvement; negligible over 100 rounds | Benchmark against the real mainnet LINEA token |
| EIP-1153 transient guard | Reentrancy-guard bookkeeping | Small per-transaction saving | Benchmark for the next contract version only |
| Osaka/compiler improvements | Bitmap and runtime bytecode efficiency | Micro-optimization | Include in compiler/gas matrix |
| Linea prover/blob/throughput upgrades | Network price per gas and congestion | Automatic network-level benefit | Monitor; no LORE migration required |
| ERC-4337/paymaster | Who pays gas and which token pays it | Better onboarding, but cost is shifted and may gain AA overhead | Use only with a bounded sponsorship budget |
| Mining Pass | Number of recurring transactions and persistent writes | Only current candidate for a large structural reduction | Design separately with invariants and gas prototype |

## Recommended work order

1. Add an A/B test for Linea's `linea_estimateGas` against the current generic
   estimator. Compare `gasUsed`, `effectiveGasPrice`, total paid, inclusion time,
   and retry/stuck behavior. Keep the current estimator as a fail-closed fallback.
2. Benchmark compiler configurations for the unchanged contract behavior:
   optimizer runs `200`, `10_000`, and `1_000_000`, with and without `viaIR`,
   targeting Osaka. Record runtime gas, deployment gas, and bytecode size.
3. On a mainnet fork, measure the real LINEA proxy token's `transferFrom`,
   `approve`, and EIP-2612 `permit` behavior. Do not extrapolate from Test LINEA.
4. For the next contract version, benchmark OpenZeppelin
   `ReentrancyGuardTransient` and set-bit bitmap traversal. Keep them only if the
   measured saving justifies a new security-review surface; do not redeploy for
   these micro-optimizations alone.
5. Specify and prototype Mining Pass accounting before implementing UI. A pass
   must reduce persistent per-user/per-epoch writes, not merely submit the same
   V9 transaction automatically every round.

## Mining Pass constraints

A useful pass would define exact tile IDs, amount per tile, epoch range or cycle
count, reserved balance, stop conditions, cancellation, and unused-balance
refunds. The design must avoid:

- an unbounded loop over all active players during resolve;
- materializing every user's five storage writes in every epoch;
- allowing a session key or resolver to change tiles, amount, recipient, or
  duration beyond the signed limits;
- changing payout, rebate, jackpot, late-bet, or epoch-close semantics without
  explicit review;
- moving gas from the player to the resolver while claiming it was eliminated.

If the implementation still calls the existing V9 bitmap bet once per round,
it improves automation only and does not materially reduce total chain cost.

## Deferred product idea: Scheduled Mining Session

A Scheduled Mining Session is a UX/product idea for later, not a mainnet launch
requirement. The user would predefine tiles, amount per tile, maximum epochs,
maximum spend, stop conditions, and optional start time. It may improve
retention by making a planned mining run feel intentional instead of requiring
constant manual attention.

Do not implement it as a frontend-only loop and market it as gas savings. If it
submits the same bet once per epoch, it is an automation convenience only. Treat
it as a separate design with explicit wallet permissions, cancellation, failure
recovery, and user-visible spend limits.

## Evidence and upstream references

- [Linea `linea_estimateGas` reference](https://docs.linea.build/api/reference/linea-estimategas)
- [Linea Prague and Osaka support](https://community.linea.build/t/ethereum-evolves-and-so-does-linea/10776)
- [Mainnet LINEA token implementation](https://lineascan.build/address/0xe03f157de67ac4b2a9a949d64d2a3c64ffa1bc55)
- [OpenZeppelin `ReentrancyGuardTransient`](https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuardTransient)
- [Linea Alpha v2 cost reductions](https://linea.build/blog/linea-unveils-alpha-v2-slashing-ethereum-finalization-costs-by-up-to-90percent)
- [Linea 100 MGas/s throughput update](https://linea.build/blog/linea-achieves-100-mgas-s-throughput)

## Revisit triggers

Review this note before the next contract candidate, before mainnet-token fork
testing, when Linea changes its fee API, or when a Mining Pass prototype is
approved. Re-measure all percentages from receipts; do not reuse estimates as
production claims.
