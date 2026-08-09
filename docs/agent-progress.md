# Agent Progress

Compact handoff for active work only. Full history through 2026-08-09 is in
[`docs/archive/agent-progress-through-2026-08-09.md`](archive/agent-progress-through-2026-08-09.md).
Repository truth lives in [`docs/current_state.md`](current_state.md), and the
single active queue is [`docs/remaining-worklist.md`](remaining-worklist.md).

## Completed in the current run

- Updated the npm overrides and lockfile to `nanoid 3.3.17` and
  `js-yaml 4.3.1`.
- Proved clean `npm ci`, production dependency audit, full dependency audit,
  and aggregate prelaunch required-local rows.
- Made `check-local` hermetic with a unique `.tmp` SQLite database, protected
  DB hash/mtime checks, targeted cleanup, and failure-safe process handling.
- Proved the full gate twice with no `data/lore-v10.sqlite*` drift, no residual
  temp directory, and no listener on port 3101.
- Added Node/npm declarations and tracked V10 source, compiler config, and
  compilation manifest.
- Split the existing post-hardening state into functional commit `b36b37ac`
  and tooling/proof/CI commit `caaeb9fe`.
- Archived the oversized state/progress files and four overlapping Sepolia
  worklists without discarding their contents.
- Kept the removed wallet-delegation experiment absent and performed no wallet
  signing, chain write, deployment, nonce replacement, approval, bet, claim,
  or soak action.

## Active handoff

1. Commit the concise documentation snapshot separately.
2. Add `.gitattributes`, inspect `git add --renormalize .`, and isolate any
   mechanical line-ending change in its own commit.
3. Reproduce the candidate from a clean detached checkout with Node 24/npm
   11.5.1: clean `npm ci`, both dependency audits, V10 provenance, two
   hermetic local gates, local proof, and prelaunch. The checkout must remain
   clean afterward.
4. Run the standard Codex Security scan against that exact unchanged commit.
   Any remediation produces a new candidate and requires reproduction + scan.
5. Continue P1 in small domain commits from
   [`docs/remaining-worklist.md`](remaining-worklist.md).

## Explicit blockers

- G1-G14 are still `0/14 Complete`; final proof manifests are missing.
- The Sepolia V10 Preview is stale and is not transaction consent.
- Mainnet docs do not currently allow Sepolia evidence to close G10/G11.
- Deployed V10 exact bytecode identity has a metadata-only mismatch.
- Independent EVM fuzzing, canonical ABI consumption, full wallet/API state
  matrices, indexer atomicity/fork handling, and external infrastructure proof
  remain open.

## Verification evidence

- `npm.cmd ci` — exit `0`.
- `npm.cmd run proof:deps:summary` — pass, production high/critical `0/0`.
- `npm.cmd run proof:deps:all:summary` — pass, blocking high/critical `0`.
- `npm.cmd run test:logic:summary` — pass, zero assertion failures.
- `npm.cmd run check:summary` — two separate complete passes; protected DB
  unchanged after each.
- `npm.cmd run proof:prelaunch:summary` — exit `0`; all required local rows
  passed and 25 external/status blockers remained visible.
