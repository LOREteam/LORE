# Current State

Last updated: 2026-08-21.

This file is the current repository truth. Historical detail is retained under
[`docs/archive/`](archive/). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); testnet campaign exit criteria
are in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Release-candidate snapshot

- Branch: `codex/repo-cleanup`.
- Latest code commit before this state refresh: `466de05d2937bdf7e1aaa34a240e8ffb3607c892`
  (`fix(wallet): show header balances as unavailable`).
- Before this docs refresh, tracked files were clean. The intentionally
  untracked `.tmp-npm-runtime-115/`, final-SHA local-gate artifact, and local
  campaign records are generated evidence/runtime inputs; they are not staged.
- Nothing was pushed, hosted, signed, approved, bet, claimed, or submitted to a
  chain in this local cycle.
- V9 remains a compatibility baseline. Routine gates are V10-oriented, but V9
  source/manifests/commands remain until independently evidenced V10 cutover.

## Protected database state

The protected base remains exact:

- `data/lore-v10.sqlite`
- SHA-256 `C6EB88E635C4B3A978AF77CE7B50736D6A6A92CC7A481E166118A66D0EC2B482`
- `258048` bytes
- mtime `2026-08-13T12:18:50.8015294Z`

The present sidecars are also protected evidence, not disposable test output:

- `data/lore-v10.sqlite-wal`: `90672` bytes, SHA-256
  `F5E02ACCB60DDCFAFDE9E591E8A5F7934A198400DFB87163C461E65DDDE5B1F5`,
  mtime `2026-08-21T04:35:00.3645942Z`;
- `data/lore-v10.sqlite-shm`: `32768` bytes, SHA-256
  `00E17C02AE1597CBFF1CF1417BDD098D3AB3776A2DD9CFA9B9E8436D21981AEE`,
  mtime `2026-08-21T04:35:00.3595362Z`.

Never delete, checkpoint, replace, or vacuum any of these three files without a
new exact destructive approval. Local DB tests must use explicit owned
OS-temp SQLite paths.

## 2026-08-21 local progress

- `738b23617`: removed the demonstrably unused direct `autoprefixer`
  devDependency.
- `060bef83a` and `cec715a66`: converted MiningGrid presentation/loading
  checks into executable behavior.
- `19880845b`: added executable exact jackpot amount-format coverage.
- `3f79455a`: binds V10 canary proof actions to admission identity; this is not
  a signed canary or hosted proof.
- `d51b5bb02`: global-stats route now fails closed as `503`/`no-store`; the UI
  distinguishes loading, ready, stale, and unavailable instead of fabricating
  zero totals.
- `603c43b75`, `ef0359c95`, and `7a75f709f`: wallet balances preserve unknown
  as `null`/`—`, wallet settings render `Unavailable`, transfer-history errors
  hide unverified totals, verified zero remains `0.00`, and Header no longer
  masks a completed no-data read as perpetual loading.
- `2518babcf`: manual bet storage waits for browser restore before first persistence.
- `91f951731`, `c06a9bc9d`, and `e185c392e`: local campaign runner disables
  rebuildable `tsx` cache per child command and fail-closes launch/environment
  restore anomalies.
- Removed only measured rebuildable caches: the old Node compile cache and npm
  `_cacache`/`_npx`, freeing about `1.00 GiB`. The active runtime, campaign
  records, project data, browser profile, and all SQLite files were retained.
- P1.10 AST audit is currently `4754/5447` behavioral assertions (`87.28%`);
  extraction remains partial.

## Verification state

| Boundary | Current evidence | Status |
| --- | --- | --- |
| Wallet unavailable/error UI | Focused SSR/pure tests, TypeScript, and diff hygiene passed for `603`, `7a`, and `466`; Header now renders unavailable balances explicitly; protected DB snapshot unchanged | Pass locally |
| Wallet-model regression | Direct targeted test and full isolated business runner passed after `ef0359c95`; protected DB snapshot unchanged | Pass locally for that pre-`7a` lineage |
| Manual bet persistence | Focused wallet-funding presentation test proves restore-before-persist and scoped storage behavior; TypeScript passed | Pass locally |
| Campaign runner hardening | PowerShell script parses, diff hygiene passed, child commands run with `TSX_DISABLE_CACHE=1`, environment restoration is fail-closed, and launch anomalies fail closed | Pass locally without rerunning full campaign |
| Local campaign | Iterations 1–3 completed all seven isolated gates. Iteration 4 stopped at `business-logic-isolated` because its old model assertion expected fake zero strings while code correctly returned `null`. The protected snapshot did not change and the campaign process exited. | Historical regression evidence only; not current-SHA/final evidence |
| P1.10 audit | `scripts/audit-p1-behavior.mjs` passed: `4754/5447` (`87.28%`) | Pass locally; partial objective |
| P1.17 mechanism | Dual canonical/profiling provenance tooling and self-tests exist | Open: final-SHA sealed builds plus physical native-hidden two-hour evidence |
| Sepolia V10 cutover | Canonical deployment/runtime proof is recorded locally with epoch-bound mode enabled | Hosted frontend/indexer and independent external evidence remain open |
| Production HTTPS | `https://playlore.xyz/` previously presented `ERR_CERT_COMMON_NAME_INVALID` | External hosting/domain remediation |
| Supported Standard security scan | Supported entitlement remains unavailable locally | External entitlement blocker |

## Objective status

### P0

1. Preserve and recheck the exact base/WAL/SHM snapshot around every DB-adjacent
   gate. Do not delete the sidecars as a prerequisite.
2. On a new immutable SHA, run a detached fresh `npm ci`, dependency/local
   prelaunch gates, clean-checkout reproduction, and the supported final
   security scan when disk and entitlement permit.
3. Obtain green hosted Linux/Windows CI and real public HTTPS/Privy evidence.
4. Keep the known block-context randomness risk open; the user explicitly
   deferred the redesign.

### P1

- Continue P1.10 only at real public behavior seams.
- Collect and strictly verify the final two-hour P1.17 native-hidden evidence.
- Keep global-stat, leaderboard, and wallet data states truthful; next local UX
  follow-up is an explicit Header error/stale/last-updated state rather than
  inferring offline from any RPC failure.
- Restart a new SHA-bound local campaign only after its starting commit is
  captured and sufficient free disk is available. Do not reuse the stopped
  campaign as final evidence.
- Real Redis/Valkey Lua, two replicas, external DB restore, hosted HTTPS/Privy,
  physical mobile wallets, signed canary, and 24–48 hour topology evidence
  remain external.

## External and live blockers

- G1–G14 remain `0/14 Complete`.
- The release record still has `25` external/status blockers; mainnet
  environment validation still has `41` recorded failures until refreshed
  evidence says otherwise.
- No current Preview authorizes a transaction. Any signing, approval, bet,
  claim, canary, soak, deployment, push, or hosted rollout needs its own fresh
  explicit authority and, for chain writes, a bounded consent.

## Safety boundaries

- Never print or persist private keys, mnemonics, sessions, wallet files, keyed
  RPC URLs, or private environment values.
- Local tests and generated artifacts never prove hosted or mainnet behavior.
- Do not call the project mainnet-ready while immutable-SHA evidence, P1.17,
  topology, external gates, and final sign-off remain open.
