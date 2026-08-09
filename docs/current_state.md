# Current State

Last updated: 2026-08-09.

Detailed history is preserved in:

- [`docs/archive/current-state-through-2026-08-09.md`](archive/current-state-through-2026-08-09.md)
- [`docs/archive/agent-progress-through-2026-08-09.md`](archive/agent-progress-through-2026-08-09.md)

Open archived evidence only when a task needs it. The single active queue is
[`docs/remaining-worklist.md`](remaining-worklist.md).

## Candidate and provenance

- The prior exact clean, reproduced, and scanned release candidate is
  `06d0fe710f5991bbd4348eeb226cacb97d5a995c`.
- The new hardening candidate is partitioned into functional commit
  `d97f4f80`, tests/proof commit `c40ca50d`, CI commit `e3f37589`, and this
  compact documentation update. Clean detached reproduction and a fresh scan
  of the resulting immutable HEAD are still pending.
- The prior candidate includes functional commit `b36b37ac`, reproducibility commit
  `caaeb9fe`, the compact documentation archive, and isolated line-ending
  normalization.
- Its clean-checkout proof used Node 24/npm 11.5.1, clean `npm ci`, both
  dependency gates, V10 provenance, two hermetic local gates, local proof, and
  prelaunch; the checkout remained clean and the protected SQLite files did not
  drift.
- Live V10 provenance on the current tree passes with solc `0.8.36`, optimizer
  runs `200`, EVM `osaka`, runtime size `16488` bytes, manifest match, ABI
  snapshot match, and reviewed-fragment digest
  `69218b3a06dbe7faf71f17a33e6a4b21b2e033c6fdfa5f4ca2008dc7a2f1900c`.
- After smoke-compatibility fixes, two consecutive full
  `npm.cmd run check:summary` runs exited `0`; each ended with
  `Local check completed successfully`. Before, between, and after the runs,
  protected `data/lore-v10.sqlite`, `-wal`, and `-shm` were identical by
  length, UTC mtime, and SHA-256 (`D2CF3A...`, `9E5CA5...`, `E9C61E...`).
  Residual `.tmp/check-local-*` count was `0` and port `3101` had no listener.

## Security scan and remediation

- Standard scan `1e481951-231e-4901-bdba-59eb14942070` ran against exact commit
  `06d0fe710f5991bbd4348eeb226cacb97d5a995c` and reported `1 High`,
  `11 Medium`, and `7 Low` findings.
- The new hardening candidate contains targeted local remediations and executable
  regression coverage for all 11 Medium and 7 Low findings, including admin
  sessions, wallet transaction ambiguity/nonces, fee caps, deposits/finality,
  jackpot admission, indexer rollback/lease/identity, bootstrap locking, bounded
  health work, proof redaction, process identity, trusted origins, and import
  containment. These are not closed until the new exact commit is reproduced
  and freshly rescanned.
- The High protocol finding remains open: permissionless conditional-revert
  grinding can bias block-derived randomness during epoch resolution. A real
  fix requires changing the randomness design and deploying replacement
  contract behavior, while the objective explicitly forbids randomness and
  deployed-contract changes. Do not label this remediated or accepted.

## P1 local engineering state

- `test:p1-hardening:all:summary` currently passes `18/18` bounded suites with
  the EVM runner included. The EVM suite exercises eight seeded epochs,
  84 runtime transactions, 33 conservation checks, 39 expected reverts,
  duplicate/replay/late paths, large values, gas bounds, reentrancy, and hostile
  ERC-20 behavior. This is local VM evidence, not Linea sequencer evidence.
- The compiler-derived V10 ABI snapshot, reviewed fragments, and semantic digest
  are wired into shared frontend, route, indexer, canary, and keeper paths with
  provenance drift checks. Repository non-test and test `parseAbi(` recounts
  are both zero.
- Wallet hardening now covers hashless ambiguous broadcasts, tracked pending
  approval nonces, actor/signer changes, retries, reload/reconnect, wrong
  network, two-tab duplication, and terminal transaction states in executable
  local tests. Real Privy/wallet signing proof remains external.
- Indexer storage now couples events/checkpoints/cursor atomically, supports
  bounded fork rollback/replay, uses an opaque single-writer lease, preserves
  log-index bet identity, and has restart/two-process WAL/busy contention tests.
- API work adds a black-box route matrix plus real two-process shared admission
  proof for jackpots/OG, deposits, and health behavior. Production two-replica
  evidence remains a G1-G14 requirement.
- Business tests have begun domain extraction into wallet, read-model,
  runtime-recovery, and cache/planner modules; the main file is now about 17.2k
  lines. Further source-string reduction remains open.
- CI is committed with Linux and Windows rows, scheduled dependency
  audits, explicit indexer-storage/P1 gates, concurrency, timeouts, and bounded
  artifacts. No hosted run for the new candidate has completed yet.
- Focused smoke checks pass after adapting selectors to the canonical `Login`
  aria-label and exact `Manual Bet` text. The extreme fixture now follows the
  authoritative chain epoch; huge-bigint behavior remains covered separately
  by a dedicated unit test.
- Round-state/current-source evidence, a 44px mobile mining dock, safe-area and
  visual-viewport handling, Privy login state/accessibility, dialog focus
  semantics, and reduced-motion behavior have dedicated passing local suites.
  Browser runtime now passes the mobile dock at `390x844` and `320x800` after
  the `HubContent` backdrop fix, plus sidebar Escape/focus return. The app Privy
  trigger also passes Escape/focus return.
- The Privy `3.27.2` embedded modal remains an upstream accessibility blocker:
  the email control's accessible name becomes `Submit` and the close target is
  `24x24`; no supported config/API fixes either issue. No DOM/CSS or
  `node_modules` hack was used, so full real-modal closure remains open.
- Latest bounded performance evidence for build
  `JhHgSzv-ZUdb4JBBsIwV7` ran `30.021s`: all five routes returned `200`, zero
  assets were missing, API writes were zero, external requests were blocked,
  and experiment long tasks were zero. First-load gzip bytes were `/` `992897`,
  `/admin` `862572`, `/jackpot` `848473`, `/privacy` `848475`, and `/terms`
  `848473`. This is not final-candidate or two-hour proof; native hidden-state
  behavior and the two-hour heap/long-task soak remain open.

## External and live blockers

- G1-G14 remain `0/14 Complete`. Canonical status lives in
  [`docs/mainnet-status-board.md`](mainnet-status-board.md) and
  [`docs/mainnet-proof-record.md`](mainnet-proof-record.md).
- No wallet signing, chain write, deployment, approval, bet, claim, nonce
  replacement, canary, or soak was performed during this work.
- The existing Sepolia Preview is stale and authorizes nothing. Before any
  write, generate a fresh exact bounded dry-run Preview, then obtain separate
  fresh exact consent.
- Current policy requires G10/G11 evidence on Linea mainnet and says Sepolia
  closes no G1-G14 gate. The requested Sepolia soak therefore remains testnet
  evidence unless that conflict is explicitly resolved.
- Deployed Sepolia V10 remains executable but has an exact metadata-only
  bytecode mismatch. Do not bypass or silently relabel it.

## Safety boundaries

- The removed wallet-delegation experiment remains disabled.
- Preserve intentional user-visible refresh behavior until measured evidence
  supports a change.
- Do not read or print secrets, private RPC URLs, signing material, wallet
  files, or private environment values.
- Do not claim production, mainnet, G1-G14, browser, or long-soak readiness from
  local checks alone.
