# Candidate 50-Epoch Canary - 2026-07-12

## Scope

- Network: Linea Sepolia (`59141`).
- Candidate contract: deployment at block `30804467`.
- Duration: `3,503,373 ms` across epochs `22` through `71`.
- Four test roles, four on-chain bet methods, `1` through `25` tiles, and `1,017.1` through `9,749.8` Test LINEA per bet.

## Results

| Metric | Result |
| --- | ---: |
| Successful bets | 50 / 50 |
| Resolve transactions | 50 |
| Failed resolves | 0 |
| Failed bets | 0 |
| Nonce gaps | 0 |
| Missing successful transaction hashes | 0 |
| Duplicate successful transaction hashes | 0 |
| Duplicate role/epoch/tile keys | 0 |
| Bet gas p50 / p95 / max | 797,560 / 1,765,652 / 1,839,369 |

Role coverage: MANUAL `13`, AUTOMINER_A `13`, AUTOMINER_B `12`, AUTOMINER_C `12`.

Method coverage: `single` `13`, `bitmap` `13`, `sameAmount` `12`, `arrays` `12`.

Every successful event records the candidate contract, Linea Sepolia chain id, and the concrete redacted RPC label. No address or transaction hash is reproduced in this summary; the raw local JSONL run log remains the detailed evidence.

## Interpretation

This closes the candidate 50-100 epoch canary requirement for transaction uniqueness, sequential nonce behavior, four-role method coverage, and non-empty epoch resolve reliability. It does not replace authenticated wallet/mobile browser evidence.
