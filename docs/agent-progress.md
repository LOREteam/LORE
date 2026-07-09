# Agent Progress

Durable progress notes for long-running Codex work. Keep this file concise:
record facts, decisions, verification, and next actions instead of repeating
full chat history.

Current launch-readiness truth lives in `docs/current_state.md`. Keep this file
as historical progress only.

## 2026-06-29 Indexer Collector Fresh-DB/Epoch Print-Plan Guard

- Strengthened `scripts/collect-indexer-evidence.mjs` so indexer evidence
  collection validates `--fresh-db=true` and explicit positive `--epochs`
  before printing or running the collection plan.
- Strengthened `scripts/check-launch-command-map.mjs` so
  `proof:indexer:collect` in `docs/launch-evidence-command-map.md` must show
  both `--fresh-db=true` and `--epochs`.
- Updated `docs/current_state.md` with the current local guardrail state.
- Verified syntax for `collect-indexer-evidence` and command-map checker.
- Verified indexer `--print-plan` rejects missing `--fresh-db=true` and
  missing `--epochs`.
- Verified indexer `--print-plan --fresh-db=true --epochs=100,101` prints a
  chain command containing the checked epoch ids.
- Verified `npm.cmd run proof:launch-map` and `npm.cmd run proof:readiness`.
- Verified `npm.cmd run proof:local`; all L1-L11 local launch preflight checks
  pass, while G1-G14 still require external production/canary evidence.

## 2026-06-29 Host/Restore Print-Plan Validation Guard

- Moved `--load-origin`/`--load-host-type` validation in
  `scripts/collect-host-evidence.mjs` before `--print-plan`, so host evidence
  dry plans cannot print local or invalid load commands.
- Moved `--restored-origin`/`--restored-host-type` validation in
  `scripts/collect-restore-evidence.mjs` before `--print-plan`, so restore
  dry plans cannot print local or production-host restored health commands.
- Updated `docs/current_state.md` with the current local guardrail state.
- Verified syntax for both collectors.
- Verified host `--print-plan` rejects `http://localhost:3000` load origin and
  accepts `https://canary.playlore.xyz` with `--load-host-type=canary`.
- Verified restore `--print-plan` rejects `--restored-host-type=production` and
  accepts `https://restore-canary.playlore.xyz` with
  `--restored-host-type=canary`.
- Verified `npm.cmd run proof:local`; all L1-L11 local launch preflight checks
  pass, while G1-G14 still require external production/canary evidence.

## 2026-06-29 Sign-off Collector Redaction Guard

- Wired `scripts/collect-signoff-evidence.mjs` into the existing
  `redact-proof-output.mjs` helper so sign-off proof-run command args,
  stdout/stderr, and process errors are redacted before writing logs.
- Extended `scripts/check-proof-collector-redaction.mjs` so
  `npm.cmd run proof:collector-redaction` covers sign-off, host, indexer, and
  restore collectors.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  operator docs list sign-off collector redaction coverage.
- Verified syntax for `collect-signoff-evidence` and
  `check-proof-collector-redaction`.
- Verified `npm.cmd run proof:collector-redaction`; helper plus all four
  collectors pass.
- Verified `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; all L1-L11 local launch preflight checks
  pass, while G1-G14 still require external production/canary evidence.

## 2026-06-29 Sign-off Collector Epoch/User Guard

- Strengthened `scripts/collect-signoff-evidence.mjs` so G1-G4 sign-off
  evidence collection requires explicit `--epochs` with at least one positive
  epoch id and a real non-zero `--user` wallet before printing or running the
  collection plan.
- Strengthened `scripts/check-launch-command-map.mjs` so
  `proof:signoff:collect` in `docs/launch-evidence-command-map.md` must show
  both `--epochs` and `--user`.
- Updated `docs/current_state.md` with the current local guardrail state.
- Verified syntax for `collect-signoff-evidence` and command-map checker.
- Verified `collect-signoff-evidence --print-plan` rejects missing
  `--epochs`/`--user`, rejects a zero user address, and prints a complete chain
  command when both arguments are present.
- Verified `npm.cmd run proof:launch-map`.
- Verified `npm.cmd run proof:local`; all L1-L11 local launch preflight checks
  pass, while G1-G14 still require external production/canary evidence.

## 2026-06-29 Canary Target Metadata Guard

- Strengthened `scripts/create-canary-proof-draft.mjs` so canary drafts require
  explicit `--network`, positive `--chain-id`, non-zero `--contract`, and a
  redacted `--rpc-label`.
- The canary draft helper rejects raw RPC URLs and zero contract addresses
  before writing a draft.
- Updated launch docs and command-map guard so `proof:canary:draft` includes
  target network, chain id, contract, and redacted RPC label.
- Updated local draft self-checks to use synthetic target metadata while still
  requiring strict validators to reject drafts as non-launch proof.
- Verified syntax for canary draft, draft guard, draft bundle, and command-map
  helper.
- Verified canary draft rejects raw RPC labels and zero contract addresses, and
  writes explicit target metadata for a valid synthetic draft.
- Verified `npm.cmd run proof:drafts`, `npm.cmd run proof:launch-map`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:readiness`.
- Verified generated docs/scripts no longer contain the old
  `proof:canary:draft -- --out=...` command shape.
- Verified `npm.cmd run proof:local`; all L1-L11 local launch preflight checks
  pass, while G1-G14 still require external production/canary evidence.

## 2026-06-29 Agent Context Compaction

- Compressed `AGENTS.md` to hard rules only.
- Moved persistent Chrome profile automation details to
  `docs/browser_automation.md`.
- Replaced broad `.codexignore` `data/` exclusion with targeted generated,
  backtest, CSV, JSONL, log, SQLite, and build-output patterns so seed/config
  files are not hidden by default.
- Added `docs/current_state.md` as the short current-truth file; this progress
  file remains historical.

## 2026-06-29 Monitoring Origin Guard

- Strengthened `scripts/create-monitoring-test-plan.mjs` and
  `scripts/create-monitoring-proof-draft.mjs` so `--origin` must be a non-local
  HTTPS origin without path/query/hash before writing monitoring drafts.
- Updated launch docs so both `proof:monitoring:plan` and
  `proof:monitoring:draft` explicitly receive `--origin=<origin>`.
- Strengthened `scripts/check-launch-command-map.mjs` so the command map must
  show explicit monitoring origins for plan and draft generation.
- Updated local draft guards so monitoring draft generation uses a safe
  synthetic final HTTPS origin.
- Verified syntax for monitoring plan/draft, command-map, and proof-draft
  helpers.
- Verified monitoring plan/draft reject localhost/path origins and create valid
  runtime/data-sync URLs for `https://playlore.xyz`.
- Verified `npm.cmd run proof:drafts`, `npm.cmd run proof:drafts:create`,
  `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.

## 2026-06-29 Restore Collector Restored-Origin Guard

- Strengthened `scripts/collect-restore-evidence.mjs` so restored staging health
  collection requires `--restored-origin=<url>` and `--restored-host-type`.
- The collector now sets `PROD_HEALTH_BASE_URL=<restored-origin>` for
  `scripts/check-production-health.mjs` and rejects local/non-HTTPS origins or
  non-staging/canary host types before running network health.
- Updated `scripts/create-restore-proof-draft.mjs` so a passed
  `--restored-origin` is preserved in the draft when the health log lacks a
  `base=` line.
- Updated launch docs and command-map guard so `proof:restore:collect` must show
  `--restored-origin` and `--restored-host-type`.
- Verified syntax for `collect-restore-evidence`, `create-restore-proof-draft`,
  and `check-launch-command-map`.
- Verified `collect-restore-evidence` rejects missing/local `--restored-origin`
  and rejects `--restored-host-type=production` before running restore/health.
- Verified `--print-plan` shows `PROD_HEALTH_BASE_URL=<restored-origin>` for
  restored health checks.
- Verified synthetic restore draft preserves `restoredStagingHealth.url` and
  `hostType` from `--restored-origin`/`--restored-host-type`.
- Verified `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`,
  and `npm.cmd run proof:local`.

## 2026-06-29 Indexer Collector Fresh-DB Guard

- Strengthened `scripts/collect-indexer-evidence.mjs` so real G9 evidence
  collection refuses to start unless `--fresh-db=true` is provided.
- Strengthened `scripts/check-launch-command-map.mjs` so the command map must
  show `proof:indexer:collect` with `--fresh-db=true`.
- Updated `docs/mainnet-readiness-checklist.md` so the indexer collector command
  includes `--epochs=<list>` for checked epoch evidence.
- Verified syntax for `collect-indexer-evidence` and `check-launch-command-map`.
- Verified `collect-indexer-evidence` rejects missing `--fresh-db=true` before
  running the indexer.
- Verified `--print-plan` preserves `--epochs=<list>` in the strict chain
  snapshot command.
- Verified `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`,
  and `npm.cmd run proof:local`.

## 2026-06-29 Host Collector Load Target Guard

- Strengthened `scripts/collect-host-evidence.mjs` so `--load-origin=<url>`
  sets `LOAD_BASE_URL` for `scripts/load-http.mjs` and is forwarded into the
  host proof draft with `--load-host-type`.
- The host collector now requires `--load-origin` to be a non-local HTTPS origin
  without path/query/hash and `--load-host-type` to be `staging` or `canary`
  before running network load.
- Aligned `scripts/create-host-proof-draft.mjs` with `load-http.mjs` by reading
  `LOAD_BASE_URL` before the legacy `LOAD_HTTP_BASE_URL` fallback.
- Updated launch docs so host evidence collection explicitly records a
  staging/canary load target instead of relying on defaults.
- Strengthened `scripts/check-launch-command-map.mjs` so the command map must
  show `proof:host:collect` with `--load-origin` and `--load-host-type`.
- Verified syntax for `collect-host-evidence`, `create-host-proof-draft`, and
  `check-launch-command-map`.
- Verified host collector rejects missing/local `--load-origin` and rejects
  `--load-host-type=production`.
- Verified `--print-plan` shows `LOAD_BASE_URL=<load-origin>` for load checks.
- Verified synthetic host draft writes `loadHttp.url` and `loadHttp.hostType`
  from `--load-origin`/`--load-host-type`.
- Verified `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`,
  and `npm.cmd run proof:local`.

## 2026-06-29 Restore Collector Strict Drill Guard

- Strengthened `scripts/collect-restore-evidence.mjs` so the restore drill step
  runs `scripts/verify-db-restore.mjs --strict` while collecting G10 evidence.
- This makes the collector fail early on repo-local/default backup or restore
  paths instead of producing weak restore evidence that only fails later.
- Verified `node --check scripts/collect-restore-evidence.mjs`.
- Verified `node scripts/collect-restore-evidence.mjs --print-plan ...` shows
  `verify-db-restore.mjs --strict`.

## 2026-06-29 Launch Gate Structure-Only Guard

- Added `--structure-only` to `scripts/check-launch-gates.mjs` so local
  preflights can validate gate-table structure without failing on expected
  missing external G1-G14 evidence.
- Wired `--structure-only` into `scripts/run-local-proof-preflight.mjs` L5 and
  the `LOCAL` gate-table row in `scripts/run-launch-proof.mjs`.
- Verified `node --check scripts/check-launch-gates.mjs`,
  `scripts/run-local-proof-preflight.mjs`, and `scripts/run-launch-proof.mjs`.
- Verified `npm.cmd run proof:local`; L5 gate-table structure passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL proof-file and
  gate-table guards pass, while strict launch still fails as expected on missing
  external G1-G14 evidence.

## 2026-06-29 QA Command-Is-Not-Evidence Guard

- Strengthened `scripts/check-qa-proof.mjs` so a recorded command no longer
  counts as QA evidence by itself.
- Verified with synthetic manifests in `%TEMP%`: a complete QA manifest passes,
  while `finalQa.browserSmokeDebugAutominer` with only the smoke command and no
  evidence fails.
- Verified `node --check scripts/check-qa-proof.mjs`.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without a real `docs/qa-proof.json`.
- Verified `npm.cmd run proof:local`.

## 2026-06-29 Chain Non-Zero Direct Reads Guard

- Strengthened `scripts/collect-chain-proof.mjs` so direct chain proof rejects
  zero/invalid on-chain `owner()`, `token()`, and `feeRecipient()` reads, and
  rejects non-positive `epochDuration`/`epochStartTime`.
- Updated G4 wording in `docs/mainnet-status-board.md` and
  `docs/mainnet-proof-record.md` to require non-zero owner/token/feeRecipient
  reads and positive epoch timing values.
- Verified `node --check scripts/collect-chain-proof.mjs`.
- Verified `npm.cmd run proof:chain -- --strict`; it still fails as expected
  without configured target RPC and contract address.
- Verified `npm.cmd run proof:remaining` and
  `npm.cmd run proof:launch-docs`.

## 2026-06-29 Local Verification Notes

- Verified `npm.cmd run test:contract`; contract V9 invariant checks pass.
- `npm.cmd run test:logic` did not reach tests because local `tsx` is missing
  from `node_modules/.bin`.
- `npm.cmd exec -- tsx --version` also cannot recover this automatically in the
  current environment because npm cache writes fail with `EPERM` under
  `C:\Users\bogda\AppData\Local\npm-cache`.
- Treat this as an environment/dependency blocker for TypeScript-backed local
  tests until dependencies/cache permissions are restored.
- Verified `npm.cmd run proof:launch -- --strict` after the latest guard
  changes; all LOCAL rows pass, while external G1-G14 proof rows still fail as
  expected until real production/canary evidence is collected.

## 2026-06-29 Mainnet Env Non-Zero Address Guard

- Strengthened `scripts/collect-mainnet-proof.mjs` so G1 mainnet env proof
  rejects the zero address for both public/keeper contract addresses and the
  LINEA token address.
- Updated `docs/mainnet-status-board.md` and
  `docs/mainnet-proof-record.md` so G1 explicitly requires matching non-zero
  contract/token addresses.
- Verified `node --check scripts/collect-mainnet-proof.mjs`.
- Verified a synthetic strict env: non-zero contract/token addresses pass,
  while zero contract/token addresses are rejected by `contract address shape`
  and `token address shape`.
- Verified `npm.cmd run proof:mainnet -- --strict`; it still fails as expected
  without real final production env.
- Verified `npm.cmd run proof:remaining`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Final Command Map Guard Coverage

- Updated `docs/launch-evidence-command-map.md` so the final gate explicitly
  runs `proof:files -- --canary-log=<path>`, `proof:gates -- --strict`,
  `proof:readiness`, `proof:launch-docs`, and `proof:launch-map` before
  `proof:local` and `proof:launch -- --strict`.
- Strengthened `scripts/check-launch-command-map.mjs` so these final guard
  commands are required, `proof:gates` must be strict, and `proof:files` must
  be shown with `--canary-log=<path>`.
- Verified `node --check scripts/check-launch-command-map.mjs`.
- Verified `npm.cmd run proof:launch-map` and
  `npm.cmd run proof:launch-docs`.

## 2026-06-29 Canary Timestamp-Is-Not-Evidence Guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so G13 canary manifest
  sections no longer treat `timestamp`/`checkedAt` as evidence.
- Fixed the returned `transactionHealthOk` summary flag so it also requires
  transaction-health evidence, not only booleans, tx hashes, and timestamp.
- Updated `docs/mainnet-status-board.md` and `docs/mainnet-proof-record.md` so
  G13 explicitly requires concrete evidence separate from ISO UTC timestamps.
- Verified `node --check scripts/analyze-live-canary-proof.mjs` and
  `node --check scripts/create-canary-proof-draft.mjs`.
- Verified a synthetic target-network canary JSONL plus manifest: full evidence
  passes, while timestamp-only recovery/auto-miner/transaction-health sections
  are rejected.
- Verified `npm.cmd run proof:canary -- --strict`; it still fails as expected
  without a live canary JSONL path.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`.

## 2026-06-29 Signoff/Indexer/Restore Metadata-Is-Not-Evidence Guard

- Strengthened `scripts/check-signoff-proof.mjs` so G1-G4 sign-off proof no
  longer treats command summaries, operator/signer names, or ISO UTC timestamps
  as evidence by themselves.
- Strengthened `scripts/check-indexer-dry-run.mjs` so G9 indexer proof no
  longer treats `indexer:once` command, `timestamp`, or `checkedAt` as
  evidence.
- Strengthened `scripts/verify-db-restore.mjs` so G10 restore proof no longer
  treats restore/health commands or timestamps as evidence.
- Updated `docs/mainnet-status-board.md` and `docs/mainnet-proof-record.md` so
  G1/G3/G4/G9/G10 explicitly require concrete evidence separate from metadata.
- Verified `node --check` for all three validators.
- Verified synthetic manifests: full evidence passes, while metadata-only
  sign-off, indexer, and restore sections are rejected.
- Verified `npm.cmd run proof:signoff -- --strict`,
  `npm.cmd run proof:indexer -- --strict`, and
  `npm.cmd run proof:restore -- --strict`; all still fail as expected without
  real external proof/env/DB inputs.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:remaining`.

## 2026-06-29 Monitoring Monitor Evidence Link Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so required G11 monitor
  entries no longer treat alert-test timestamps as monitor evidence.
- Each required monitor must now include a concrete monitor link, artifact,
  evidence field, evidence path, or note in addition to the ISO UTC alert test
  timestamp.
- Updated `docs/mainnet-status-board.md` and `docs/mainnet-proof-record.md` so
  G11 explicitly separates monitor evidence from alert-test timestamps.
- Verified a synthetic monitoring manifest: monitor links pass, while the same
  manifest with only alert timestamps and no monitor links/evidence is rejected.
- Verified `node --check scripts/check-monitoring-proof.mjs`.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Host Timestamp-Is-Not-Evidence Guard

- Strengthened `scripts/check-host-proof.mjs` so G5-G8 host proof sections no
  longer treat `command`, `timestamp`, or `checkedAt` as evidence; process,
  persistent DB, health, and load sections must include concrete supervisor
  output, command summary, artifact path, link, or redacted notes.
- Updated `docs/mainnet-status-board.md` and `docs/mainnet-proof-record.md` so
  host/process/DB/health/load evidence must be separate from ISO UTC
  timestamps.
- Verified `node --check scripts/check-host-proof.mjs` and
  `node --check scripts/create-host-proof-draft.mjs`.
- Verified a synthetic host manifest: full evidence passes, while
  command/timestamp-only process, persistent DB, health, and load sections are
  rejected.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, `npm.cmd run proof:remaining`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Monitoring Error Event Evidence Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so G11 error tracking
  cannot be closed by only `testEventStatus` plus `testEventAt`; it must also
  include a provider event id, event link, evidence path, or redacted event
  evidence.
- Updated `scripts/create-monitoring-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`, `docs/mainnet-status-board.md`,
  `docs/production-runbook.md`, and `docs/mainnet-proof-record.md` with the
  explicit test-event evidence requirement.
- Verified `node --check scripts/check-monitoring-proof.mjs` and
  `node --check scripts/create-monitoring-proof-draft.mjs`.
- Verified a synthetic monitoring manifest: event id/link passes, while the
  same manifest without test-event evidence is rejected.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, `npm.cmd run proof:remaining`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 QA Timestamp-Is-Not-Evidence Guard

- Strengthened `scripts/check-qa-proof.mjs` so `checkedAt`/`timestamp` no
  longer count as QA evidence; wallet, failure-state, support/audit, and final
  QA checks still require concrete evidence such as redacted notes, artifact
  paths, command summaries, tx hashes, or links.
- Updated `docs/mainnet-status-board.md` and `docs/mainnet-proof-record.md` so
  G12/G14 explicitly require concrete evidence separate from ISO UTC
  timestamps.
- Verified `node --check scripts/check-qa-proof.mjs` and
  `node --check scripts/create-qa-proof-draft.mjs`.
- Verified a synthetic QA manifest: full evidence passes, while a
  `status+checkedAt` check without evidence is rejected.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, `npm.cmd run proof:remaining`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Chain Proof Non-Zero Address Guard

- Strengthened `scripts/collect-chain-proof.mjs` so G4 direct chain reads
  reject zero contract, token, and optional user addresses; token/user address
  errors are reported before any RPC read.
- Strengthened `scripts/collect-chain-proof.mjs` so an explicit `--epochs`
  list must contain at least one positive epoch id.
- Updated `docs/mainnet-status-board.md` and
  `docs/mainnet-proof-record.md` so direct chain proof requires non-zero
  contract/token/user addresses where used and at least one positive checked
  epoch id.
- Verified `node --check scripts/collect-chain-proof.mjs`.
- Verified a synthetic strict env with zero contract/token/user addresses:
  `proof:chain` exits 1 and reports all three zero/invalid address issues.
- Verified a synthetic strict `--epochs=0,-1` case: `proof:chain` exits 1 and
  reports `at least one positive epoch must be checked`.
- Verified `npm.cmd run proof:chain -- --strict`; it still fails as expected
  without configured final RPC/contract env.
- Verified `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`,
  `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Indexer Comparison Timestamp Guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so every
  `docs/indexer-proof.json` `chainComparison.*` entry must include an
  ISO-8601 UTC `checkedAt` timestamp.
- Updated `scripts/create-indexer-proof-draft.mjs` to include `checkedAt` for
  each generated direct chain comparison placeholder.
- Updated `docs/launch-proof-manifest-templates.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` so G9
  requires dry-run/finality/snapshot/comparison timestamps.
- Verified `node --check scripts/check-indexer-dry-run.mjs` and
  `node --check scripts/create-indexer-proof-draft.mjs`.
- Verified a synthetic indexer proof with a temporary SQLite DB: full
  comparison timestamps pass, while a missing
  `chainComparison.jackpot.checkedAt` is rejected.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:remaining`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Ownership Direct Read Evidence Guard

- Strengthened `scripts/check-signoff-proof.mjs` so G2 ownership proof must
  include `ownership.directOwnerReadEvidence`, not only
  `directOwnerReadMatches: true`.
- Updated `scripts/create-signoff-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`, `docs/mainnet-status-board.md`,
  `docs/production-runbook.md`, and `docs/mainnet-proof-record.md` with the
  explicit direct owner read evidence requirement.
- Verified `node --check scripts/check-signoff-proof.mjs` and
  `node --check scripts/create-signoff-proof-draft.mjs`.
- Verified a synthetic sign-off manifest: direct owner evidence passes, while
  a missing `ownership.directOwnerReadEvidence` is rejected.
- Verified `npm.cmd run proof:signoff -- --strict`,
  `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:remaining`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 QA Support/Final Timestamp Guard

- Strengthened `scripts/check-qa-proof.mjs` so
  `supportAuditVisibility.*` and `finalQa.*` checks must include ISO-8601 UTC
  `checkedAt` timestamps.
- Updated `scripts/create-qa-proof-draft.mjs` so bet history and auto-miner
  support-audit placeholders include `checkedAt`; generic QA placeholders
  already included it.
- Updated `docs/launch-proof-manifest-templates.md`,
  `docs/mainnet-status-board.md`, `docs/production-runbook.md`, and
  `docs/mainnet-proof-record.md` so G12/G14 require support/final QA
  timestamps.
- Verified `node --check scripts/check-qa-proof.mjs` and
  `node --check scripts/create-qa-proof-draft.mjs`.
- Verified a synthetic QA manifest: full timestamps pass, while a missing
  `finalQa.mobileLayout.checkedAt` is rejected.
- Verified `npm.cmd run proof:qa -- --strict`,
  `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:remaining`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Restore Preservation Before/After Guard

- Strengthened `scripts/verify-db-restore.mjs` so G10 restore proof must record
  matching `indexerPreservation.heartbeatBefore/After`, matching
  `latestIndexedEpochBefore/After`, and an ISO-8601 UTC preservation
  `checkedAt` timestamp.
- Updated `scripts/create-restore-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`, `docs/mainnet-status-board.md`,
  `docs/production-runbook.md`, and `docs/mainnet-proof-record.md` with the
  concrete before/after preservation fields.
- Verified `node --check scripts/verify-db-restore.mjs` and
  `node --check scripts/create-restore-proof-draft.mjs`.
- Verified a synthetic restore drill with a temporary SQLite DB: matching
  heartbeat/latest epoch values pass, while mismatched latest epoch values are
  rejected.
- Verified `npm.cmd run proof:restore -- --strict`,
  `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:remaining`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Host Process/Persistent DB Timestamp Guard

- Strengthened `scripts/check-host-proof.mjs` so each supervised process in
  `processModel` and `persistentDb` must include ISO-8601 UTC `checkedAt`
  timestamps.
- Updated `scripts/create-host-proof-draft.mjs`,
  `scripts/check-host-proof-load-target.mjs`,
  `docs/launch-proof-manifest-templates.md`, `docs/mainnet-status-board.md`,
  `docs/production-runbook.md`, and `docs/mainnet-proof-record.md` with the
  host timestamp requirements.
- Verified `node --check scripts/check-host-proof.mjs`,
  `node --check scripts/create-host-proof-draft.mjs`, and
  `node --check scripts/check-host-proof-load-target.mjs`.
- Verified a synthetic host proof: complete process/persistent timestamps pass,
  while a missing `processModel.lore-bot.checkedAt` is rejected.
- Verified `npm.cmd run proof:host -- --strict`,
  `node scripts/check-host-proof-load-target.mjs`,
  `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:remaining`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Canary Pending Recovery Tx Guard

- Updated `docs/mainnet-status-board.md` snapshot to 2026-06-29 and recorded
  the current proof-hardening state.
- Strengthened `scripts/analyze-live-canary-proof.mjs` so
  `recovery.pendingTxRecovery.txHash` must be a real non-zero transaction hash.
- Updated `scripts/create-canary-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`, `docs/mainnet-status-board.md`,
  `docs/production-runbook.md`, and `docs/mainnet-proof-record.md` so G13
  pending recovery proof is tied to a recovered tx hash.
- Verified `node --check scripts/analyze-live-canary-proof.mjs` and
  `node --check scripts/create-canary-proof-draft.mjs`.
- Verified a synthetic canary JSONL plus manifest: pending recovery tx hash
  passes, while a missing `recovery.pendingTxRecovery.txHash` is rejected.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:remaining`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Monitoring Alert Target Timestamp Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so every
  `alertTargets[]` entry must include an ISO-8601 UTC fired-test timestamp,
  not only one target in the manifest.
- Updated `docs/mainnet-status-board.md` and `docs/mainnet-proof-record.md` so
  G11 requires per-target alert test timestamps.
- Verified `node --check scripts/check-monitoring-proof.mjs`.
- Verified a synthetic monitoring proof: multiple alert targets with
  timestamps pass, while a missing second target timestamp is rejected.
- Verified `npm.cmd run proof:monitoring -- --strict`,
  `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:remaining`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## Completed

- Created a durable progress file for long-running agent work.
- Reviewed current launch docs:
  - `docs/mainnet-status-board.md`
  - `docs/mainnet-readiness-checklist.md`
  - `docs/production-runbook.md`
- Updated `docs/mainnet-status-board.md` with a 2026-06-27 snapshot, RED/YELLOW
  state, proof tracker, and recommended next moves.
- Added an evidence-first checkbox rule to
  `docs/mainnet-readiness-checklist.md`.
- Verified the updated markdown for consistency.
- Added `docs/mainnet-proof-record.md` as the central launch evidence record.
- Linked `docs/mainnet-status-board.md`, `docs/mainnet-readiness-checklist.md`,
  and `docs/production-runbook.md` to the proof record.
- Added evidence collection order, redaction rules, and command evidence format
  to `docs/mainnet-proof-record.md`.
- Added `scripts/collect-mainnet-proof.mjs` and `npm run proof:mainnet` for a
  redacted env/contract proof snapshot.
- Added `npm run proof:mainnet -- --strict` to the production preflight gates.
- Added `scripts/analyze-live-canary-proof.mjs` and `npm run proof:canary` to
  summarize JSONL live canary evidence by real epochs, failures, nonce gaps, and
  duplicate role/epoch/tile keys.
- Updated `docs/mainnet-status-board.md` with G1-G14 launch gate IDs, first
  checks, required proof, and closure order.
- Synced `docs/mainnet-proof-record.md` with the same G1-G14 IDs and added
  proof notes for production host, indexer dry-run, and backup/restore.
- Added `scripts/check-launch-gates.mjs` and `npm run proof:gates` to verify
  G1-G14 status/proof consistency.
- Added `scripts/collect-chain-proof.mjs` and `npm run proof:chain` for direct
  read-only chain/funds evidence covering contract owner, token, jackpot pools,
  epoch/tile consistency, and optional user reward/rebate checks.
- Added `scripts/verify-db-restore.mjs` and `npm run proof:restore` for a
  SQLite backup/restore drill that copies the DB bundle, opens the restored
  copy, runs `PRAGMA integrity_check`, and reports launch table row counts.
- Added `scripts/check-indexer-dry-run.mjs` and `npm run proof:indexer` to
  validate a fresh `indexer:once` SQLite output: DB path, deploy/finality env,
  integrity, required tables, cursor meta, and row counts.
- Added `scripts/check-monitoring-proof.mjs` and `npm run proof:monitoring` to
  validate a redacted external monitoring manifest for G11.
- Added `scripts/check-qa-proof.mjs` and `npm run proof:qa` to validate
  redacted wallet, failure-state UX, support/audit visibility, and final
  browser/mobile QA evidence for G12 and G14.
- Added `scripts/run-launch-proof.mjs` and `npm run proof:launch` as a compact
  aggregator for the local proof scripts.
- Added `scripts/check-signoff-proof.mjs` and `npm run proof:signoff` to
  validate explicit G1-G4 operator sign-off evidence.
- Added `scripts/check-host-proof.mjs` and `npm run proof:host` to validate
  redacted G5-G8 production host evidence.
- Added `docs/launch-proof-manifest-templates.md` with redacted JSON skeletons
  for sign-off, host, monitoring, and QA proof manifests.
- Hardened sign-off, host, monitoring, and QA proof validators so copied
  templates, `REPLACE_*` placeholders, zero addresses, and zero tx hashes cannot
  accidentally satisfy strict launch proof.
- Added `scripts/check-proof-templates.mjs` and `npm run proof:templates` to
  verify copied manifest templates are rejected by strict validators.
- Narrowed secret-key detection so public fields like `tokenAddress` are not
  misclassified as secrets while API/auth/access token fields remain blocked.
- Added `scripts/check-process-model.mjs` and `npm run proof:process-model` to
  validate the checked-in PM2/package launch topology before deploy.
- Wired `proof:process-model` into `npm run proof:launch` as the local G5
  preflight before external host proof.
- Updated the status board, proof record, readiness checklist, and production
  runbook so G5 requires both local process-model preflight and deployed host
  supervisor evidence.
- Verified `npm run proof:mainnet` locally in non-strict mode.
- Verified `node scripts/collect-mainnet-proof.mjs --strict` with safe fake env
  values; all checked gates passed and values were redacted.
- Verified `npm.cmd run proof:process-model -- --strict`; it passed for
  `lore-site`, `lore-bot`, and `lore-indexer`.
- Verified `npm.cmd run proof:launch -- --strict`; `proof:process-model` passed
  and the aggregate still failed on 10 expected missing external proof classes.
- Strengthened `npm run proof:restore -- --strict` so G10 now requires a
  redacted restore proof manifest in addition to SQLite copy/integrity checks.
- Added the `docs/restore-proof.json` template shape and template-guard
  coverage so copied restore templates fail strict validation.
- Updated restore docs to require backup schedule, restored staging
  `health:prod`, heartbeat preservation, and latest indexed epoch preservation.
- Verified `node --check` for `scripts/verify-db-restore.mjs` and
  `scripts/check-proof-templates.mjs`.
- Verified `npm.cmd run proof:templates`; restore template is rejected by
  strict validation.
- Verified `npm.cmd run proof:restore -- --strict`; it now fails as expected
  without `LORE_DB_PATH`, outside-repo backup/restore dirs, and
  `docs/restore-proof.json`.
- Verified `npm.cmd run proof:launch -- --strict`; G10 now reports missing
  restore manifest along with the expected external blockers.
- Strengthened `npm run proof:indexer -- --strict` so G9 now requires a
  redacted indexer proof manifest in addition to the fresh SQLite dry-run DB.
- Added the `docs/indexer-proof.json` template shape and template-guard
  coverage so copied indexer templates fail strict validation.
- Updated indexer docs to require `indexer:once`, finality-aware data-sync
  health, and direct chain comparison for jackpot, deposits, rewards, rebates,
  and latest epochs.
- Verified `node --check` for `scripts/check-indexer-dry-run.mjs` and
  `scripts/check-proof-templates.mjs`.
- Verified `npm.cmd run proof:templates`; indexer template is rejected by
  strict validation.
- Verified `npm.cmd run proof:indexer -- --strict`; it now fails as expected
  without `LORE_DB_PATH`, deploy/finality env, and `docs/indexer-proof.json`.
- Verified `npm.cmd run proof:launch -- --strict`; G9 now reports missing
  indexer manifest along with the expected external blockers.
- Strengthened `npm run proof:host -- --strict` so G7/G8 now require explicit
  health and load evidence instead of a vague pass summary.
- Host proof now requires `healthProd.finalityLagChecked`,
  `healthProd.jackpotRowsChecked`, load duration, concurrency, request count,
  error-rate threshold, and p95 latency threshold.
- Updated the host manifest template, proof record, and production runbook to
  record those health/load details.
- Verified `node --check` for `scripts/check-host-proof.mjs` and
  `scripts/check-proof-templates.mjs`.
- Verified `npm.cmd run proof:templates`; host template remains rejected by
  strict validation.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified `npm.cmd run proof:launch -- --strict`; G5 local preflight still
  passes and G5-G8 remain blocked on external host proof.
- Strengthened `npm run proof:signoff -- --strict` so G1-G4 require stronger
  ownership, randomness, and chain comparison evidence.
- Sign-off proof now requires a direct owner read match plus either a Safe /
  governance transaction hash or governance record evidence.
- Accepted-risk randomness sign-off now requires an explicit
  `riskAcceptedByOperator` flag; mitigated randomness requires
  `mitigationDeployed`.
- Each sign-off chain comparison entry now requires both direct-chain evidence
  and app/indexer evidence, instead of one vague comparison string.
- Updated the sign-off manifest template, proof record, production runbook, and
  status board with the stronger G1-G4 evidence shape.
- Verified `node --check` for `scripts/check-signoff-proof.mjs` and
  `scripts/check-proof-templates.mjs`.
- Verified `npm.cmd run proof:templates`; sign-off template is rejected by
  strict validation with the stronger requirements.
- Verified `npm.cmd run proof:signoff -- --strict`; it still fails as expected
  without `docs/signoff-proof.json`.
- Verified `npm.cmd run proof:launch -- --strict`; G1-G4 remain blocked on
  missing env/signoff/chain evidence.
- Strengthened `npm run proof:canary -- --strict` so G13 now requires a
  redacted canary proof manifest in addition to the JSONL transaction log.
- Canary proof now records target network/RPC/contract evidence,
  reload/reconnect/tab-close/pending-tx/route-remount recovery checks, and
  transaction health flags for duplicate bets, nonce loops, stuck pending, and
  pending recovery convergence.
- Canary strict mode now checks elapsed wall-clock span with
  `LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH` so many transactions inside too few
  real epochs cannot satisfy launch proof.
- Added the `docs/canary-proof.json` template shape and template-guard coverage.
- Updated the canary proof record, production runbook, and status board with the
  stronger G13 evidence shape.
- Verified `node --check` for `scripts/analyze-live-canary-proof.mjs` and
  `scripts/check-proof-templates.mjs`.
- Verified `npm.cmd run proof:templates`; canary template is rejected by strict
  validation.
- Verified `npm.cmd run proof:canary -- data/live-test-runs/live-canary-2026-06-14T05-03-12-898Z.jsonl --strict`;
  the old Sepolia sample still fails and now also reports missing canary proof
  manifest.
- Verified `npm.cmd run proof:launch -- --strict`; G13 still requires an
  explicit canary log input before the aggregate can run the canary analyzer.
- Strengthened `npm run proof:qa -- --strict` so G12/G14 require exact Privy
  production origin evidence, clean-wallet network/tx proof, visible
  unsupported-chain warning proof, concrete support/audit fields, and debug
  autominer browser smoke health.
- QA proof now rejects manifests where Privy used a development fallback app id,
  where wrong-network warnings are not visible, or where debug smoke does not
  record `debugAutominerScenariosPassed`, `noUnexpectedConsoleErrors`, and
  `unsupportedWalletWarningsNotMasked`.
- Support/audit QA now requires bet history fields `epoch`, `tile`, `amount`,
  `txHash`, `result`, and auto-miner log fields `round`, `epoch`, `nonce`,
  `txHash`, `retryCount`.
- Updated the QA manifest template, proof record, production runbook, and status
  board with the stronger G12/G14 evidence shape.
- Verified `node --check` for `scripts/check-qa-proof.mjs` and
  `scripts/check-proof-templates.mjs`.
- Verified `npm.cmd run proof:templates`; QA template remains rejected by
  strict validation.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified `npm.cmd run proof:launch -- --strict`; G12/G14 remain blocked on
  missing QA manifest.
- Strengthened `npm run proof:monitoring -- --strict` so G11 requires alert
  condition or threshold plus alert test timestamp for every required monitor,
  not only a dashboard link.
- Monitoring proof now requires provider evidence for each monitor kind and
  error tracking environment plus release/deploy identifier.
- Updated the monitoring manifest template, proof record, production runbook,
  and status board with the stronger G11 evidence shape.
- Verified `node --check` for `scripts/check-monitoring-proof.mjs` and
  `scripts/check-proof-templates.mjs`.
- Verified `npm.cmd run proof:templates`; monitoring template is rejected by
  strict validation with the stronger requirements.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified `npm.cmd run proof:launch -- --strict`; G11 remains blocked on
  missing monitoring manifest.
- Strengthened `npm run proof:mainnet -- --strict` so G1/G6 env proof now
  checks HTTPS keeper RPC, HTTPS site URL, production Privy app id presence,
  `TRUST_PROXY_HEADERS=1`, disabled EIP-7702 flags, and an absolute persistent
  DB path outside the repo/default data path.
- Kept private `KEEPER_RPC_URL` redacted as yes/no in proof output.
- Updated the mainnet proof record, readiness checklist, and production runbook
  with the stronger environment requirements.
- Verified `node --check` for `scripts/collect-mainnet-proof.mjs`.
- Verified `npm.cmd run proof:mainnet -- --strict` with the current empty
  local environment; it fails as expected with 26 missing/failing env gates.
- Verified `npm.cmd run proof:mainnet -- --strict` with safe fake env values;
  all checked env gates passed and private values were redacted.
- Verified `npm.cmd run proof:launch -- --strict`; G1/G6 now reports 26
  missing/failing env gates until real host env is supplied.
- Strengthened `npm run proof:gates -- --strict` so final gate completion now
  rejects duplicate G IDs and requires concrete evidence markers for
  `Complete` gates.
- Complete-gate evidence must now include a proof command, manifest path, tx
  hash, monitor URL, JSONL path, or ISO timestamp; vague notes are insufficient.
- Updated the proof record instructions with the stricter complete-gate evidence
  rule.
- Verified `node --check scripts/check-launch-gates.mjs`.
- Verified `npm.cmd run proof:gates`; current tables are structurally valid
  with 14 missing gates.
- Verified `npm.cmd run proof:gates -- --strict`; it still fails as expected
  while G1-G14 are incomplete.
- Verified `npm.cmd run proof:launch -- --strict`; aggregate still reports the
  expected missing external proof classes.
- Added the template guard to `npm run proof:launch` so the aggregate now runs
  `scripts/check-proof-templates.mjs` before the launch-gate proof scripts.
- Updated the launch runner clean-summary matcher so
  `Summary: all proof templates are rejected by strict validators.` is treated
  as a passing local guard.
- Updated the proof record and production runbook to document that
  `proof:launch` includes the template guard.
- Verified `node --check scripts/run-launch-proof.mjs`.
- Verified `npm.cmd run proof:launch -- --strict`; `LOCAL template guard` now
  passes and the aggregate still fails on the expected missing external proofs.

## In Progress

- Waiting on external production/canary evidence for RED launch gates.

## Findings

- The remaining mainnet work is mostly operational proof, not small code polish.
- Current docs still show unresolved gates around production host health,
  indexer dry-run, backup/restore, monitoring, and real-wallet canary.

## Decisions

- Keep mainnet readiness tracked as explicit proof gates.
- Do not mark a gate complete without command output, host evidence, or a
  recorded sign-off.
- Store launch evidence in `docs/mainnet-proof-record.md` instead of chat.
- Collect high-risk evidence first: contract/funds safety, production host,
  indexer/DB, backup/restore, monitoring, and real-epoch canary.
- Use `npm run proof:mainnet -- --strict` to collect redacted env proof before
  host health/load/indexer checks.
- Use `npm run proof:canary -- <jsonl> --strict` after a live canary; do not
  treat many transactions as proof of many epochs unless the analyzer confirms
  unique epoch coverage.
- Track launch completion by G1-G14 gates. A gate remains missing until the
  proof record has the matching command output, tx hash, monitor link, or
  operator sign-off.
- Use `npm run proof:gates -- --strict` as the final local launch-gate audit.
  It is expected to fail while any gate remains incomplete.
- Use `npm run proof:chain -- --strict` after final contract/RPC env is set.
  Add `PROOF_CHAIN_USER` and `--epochs=` when verifying a canary wallet or
  specific resolved epochs.
- Use `npm run proof:restore -- --strict` with absolute `LORE_DB_PATH`,
  `LORE_BACKUP_DIR`, and `LORE_RESTORE_DRILL_DIR` outside the repo for G10.
- Use `npm run proof:indexer -- --strict` after fresh DB `npm run indexer:once`
  for G9. Optional minimum row thresholds can be set with
  `INDEXER_DRY_RUN_MIN_SCOPED_EPOCHS` and `INDEXER_DRY_RUN_MIN_SCOPED_BETS`.
- Use `npm run proof:monitoring -- --strict` after external monitors and a test
  alert exist. The manifest must be redacted and must not contain webhook URLs,
  tokens, DSNs, or private secrets.
- Use `npm run proof:qa -- --strict` after wallet/failure/support/final QA
  evidence exists. Keep real-epoch canary proof separate under `proof:canary`.
- Use `npm run proof:launch -- --strict --canary-log=<jsonl>` only after the
  individual proof artifacts exist. It summarizes proof scripts and does not
  replace `health:prod`, `load:http`, `smoke:browser`, or operator sign-offs.
- Use `npm run proof:signoff -- --strict` after `docs/signoff-proof.json` has
  final contract env, ownership/Safe, randomness, and chain/API comparison
  evidence.
- Use `npm run proof:host -- --strict` after `docs/host-proof.json` has final
  host origin, split process supervision, persistent DB restart/reboot,
  `health:prod`, and `load:http` evidence.

## Verification

- Read current launch docs locally on 2026-06-27.
- Updated docs locally; no runtime/build verification required for markdown-only
  changes.
- Re-read changed markdown files after patching.
- Created and linked the proof record template; no runtime/build verification
  required for markdown-only changes.
- Re-read the proof record after adding evidence collection instructions.
- `npm run proof:mainnet` exits cleanly in non-strict mode when env is missing.
- Strict mode passes with safe fake values and redacted output.
- `proof:canary` was verified against
  `data/live-test-runs/live-canary-2026-06-14T05-03-12-898Z.jsonl`.
- Existing 300-tx log is not valid 300-epoch proof: it covers 49 unique epochs,
  has 3 failed resolve tx, 632 duplicate role/epoch/tile keys, and strict mode
  with `LIVE_CANARY_MIN_EPOCHS=300` exits with code 1 as expected.
- Re-read status/proof docs after adding G1-G14 gate mapping.
- `npm run proof:gates` passes structurally: 14 expected gates, 0 complete, 14
  missing, 0 structural issues.
- `npm run proof:gates -- --strict` exits with code 1 as expected while G1-G14
  remain incomplete.
- `npm run proof:chain` now runs without final env and reports
  `contract address is missing or invalid` without importing `viem` or reading
  network state.
- `npm run proof:chain -- --strict` exits with code 1 as expected when the
  contract address is missing.
- `npm run proof:restore` runs without `LORE_DB_PATH` and reports the missing
  source DB without touching production data.
- `npm run proof:restore -- --strict` exits with code 1 as expected when
  `LORE_DB_PATH`, absolute backup dir, and absolute restore dir are missing.
- `npm run proof:indexer` runs without `LORE_DB_PATH` and reports the missing
  dry-run DB without opening SQLite.
- `npm run proof:indexer -- --strict` exits with code 1 as expected when the
  dry-run DB path, deploy block env, and finality lag are missing.
- Tightened repo-path detection in `proof:indexer` and `proof:restore` so
  adjacent paths with the same prefix are not treated as inside the repo.
- `npm run proof:monitoring` runs without a manifest and reports the missing
  `docs/monitoring-proof.json`.
- `npm run proof:monitoring -- --strict` exits with code 1 as expected while
  external monitoring proof is missing.
- `npm run proof:qa` runs without a manifest and reports the missing
  `docs/qa-proof.json`.
- `npm run proof:qa -- --strict` exits with code 1 as expected while wallet,
  UX, support visibility, and final QA proof is missing.
- `npm run proof:launch` runs all local proof scripts and reported 8
  failed/missing proof classes before `proof:signoff` was added.
- `npm run proof:launch -- --strict` exits with code 1 as expected while final
  env, chain proof, DB proof, restore proof, monitoring proof, QA proof, canary
  log, and completed G1-G14 statuses are missing.
- `npm run proof:signoff` runs without a manifest and reports the missing
  `docs/signoff-proof.json`.
- `npm run proof:signoff -- --strict` exits with code 1 as expected while
  contract/funds sign-off proof is missing.
- `npm run proof:launch -- --strict` now includes `proof:signoff` and reports 9
  failed/missing proof classes while external launch evidence is absent.
- `npm run proof:host` runs without a manifest and reports the missing
  `docs/host-proof.json`.
- `npm run proof:host -- --strict` exits with code 1 as expected while
  production host proof is missing.
- `npm run proof:launch -- --strict` now includes `proof:host` and reports 10
  failed/missing proof classes while external launch evidence is absent.
- `npm run proof:signoff -- --strict`, `proof:host -- --strict`,
  `proof:monitoring -- --strict`, and `proof:qa -- --strict` still fail as
  expected while real manifests are absent.
- `npm run proof:launch -- --strict` still reports 10 failed/missing proof
  classes after placeholder hardening.
- `node --check` passes for the four hardened manifest validators.
- `npm run proof:templates` passes: copied signoff, host, monitoring, and QA
  templates all fail their strict validators as expected.
- `npm run proof:launch -- --strict` still reports 10 failed/missing proof
  classes until real external evidence is supplied.
- `node --check` passes for `check-proof-templates.mjs` and the four manifest
  validators.
- `node --check scripts/check-proof-templates.mjs` passes after removing the
  dependency on the historical canary JSONL sample.
- `npm.cmd run proof:templates` passes: copied proof templates are rejected by
  strict validators, and the canary template check now uses a temporary minimal
  JSONL sample.
- `npm.cmd run proof:launch -- --strict` exits with code 1 as expected: local
  template guard and process-model preflight pass, while 10 external proof
  classes remain missing.
- `docs/mainnet-status-board.md` now includes the current local proof state and
  an ordered external evidence task list without changing the gate table format.
- `npm.cmd run proof:gates` passes structurally after the status-board update:
  14 expected gates, 14 missing, 0 structural issues.
- `npm.cmd run proof:templates` still passes after the status-board update.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  template guard and process-model preflight pass; 10 external proof classes
  remain missing.
- Added `npm.cmd run proof:host:draft` via
  `scripts/create-host-proof-draft.mjs`. It creates a reviewed starter manifest
  from compact `health:prod` and `load:http` logs, while leaving supervisor,
  restart/reboot, and persistent DB proof as explicit TODOs.
- `node --check scripts/create-host-proof-draft.mjs` passes.
- `npm.cmd run proof:host:draft -- --out=<temp>` writes a draft successfully.
- `npm.cmd run proof:host -- --strict` against that temp draft exits with code
  1 as expected, so the draft cannot accidentally close G5-G8 without real
  production/canary evidence.
- `npm.cmd run proof:gates` still passes structurally after the host-draft
  script/docs update: 14 expected gates, 14 missing, 0 structural issues.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  local template guard and process-model preflight pass, while 10 external
  proof classes remain missing.
- Added `npm.cmd run proof:drafts` via `scripts/check-proof-drafts.mjs`. It
  creates every proof draft in a temp directory and verifies each matching
  strict validator rejects it.
- `node --check scripts/check-proof-drafts.mjs` passes.
- `npm.cmd run proof:drafts` passes: all generated drafts are rejected by
  strict validators.
- `npm.cmd run proof:launch -- --strict` now includes both LOCAL guards:
  template guard and draft guard pass, while 10 external proof classes remain
  missing.
- Strict manifest validators now explicitly reject `*.draft.json` paths as
  launch proof for signoff, host, indexer, restore, monitoring, QA, and canary
  proof commands.
- `node --check` passes for the seven hardened manifest validators after the
  `*.draft.json` rejection.
- `npm.cmd run proof:drafts` still passes after the validator hardening and
  reports `draft proof manifests are not accepted as launch proof` in each
  validator summary.
- `npm.cmd run proof:launch -- --strict` still reports both LOCAL guards as
  pass and 10 external proof classes as missing/failing.
- Added `npm.cmd run proof:files` via `scripts/check-proof-files.mjs`. It scans
  existing final `docs/*-proof.json` manifests for invalid JSON, template-like
  values, secret-like fields, and unexpected proof-like filenames.
- `node --check scripts/check-proof-files.mjs` passes.
- `npm.cmd run proof:files` passes on the current state: final proof manifests
  are clean or not yet collected.
- `npm.cmd run proof:launch -- --strict` now includes three LOCAL guards:
  template guard, draft guard, and proof file guard pass, while 10 external
  proof classes remain missing/failing.
- Added `npm.cmd run proof:local` via `scripts/run-local-proof-preflight.mjs`.
  It runs local-only launch guardrails: templates, drafts, proof files,
  process model, and gate-table structure.
- `node --check scripts/run-local-proof-preflight.mjs` passes.
- `npm.cmd run proof:local` passes with five local checks green.
- `npm.cmd run proof:launch -- --strict` still separates local pass state from
  external missing/failing proof classes.
- Added `npm.cmd run proof:drafts:create` via
  `scripts/create-all-proof-drafts.mjs`. It creates all seven
  `*-proof.draft.json` starter manifests in a chosen output directory and does
  not overwrite existing drafts unless `--force` is passed.
- `node --check scripts/create-all-proof-drafts.mjs` passes.
- `npm.cmd run proof:drafts:create -- --out-dir=<temp> --force` creates all
  seven draft manifests successfully.
- `npm.cmd run proof:local` still passes after adding the draft bundle helper.
- `npm.cmd run proof:launch -- --strict` still reports local guards as pass and
  10 external proof classes as missing/failing.
- Added `npm.cmd run proof:signoff:draft` via
  `scripts/create-signoff-proof-draft.mjs`. It creates a reviewed starter
  manifest for contract env, ownership, randomness sign-off, and chain
  comparison, while keeping owner/Safe, randomness decision, and all
  direct-chain comparisons unverified until real evidence exists.
- `node --check scripts/create-signoff-proof-draft.mjs` passes.
- `npm.cmd run proof:signoff:draft -- --out=<temp>` writes a draft
  successfully.
- `npm.cmd run proof:signoff -- --strict` against that temp draft exits with
  code 1 as expected, so the draft cannot accidentally close G1-G4 without real
  final env, owner/Safe, randomness, and chain comparison evidence.
- `npm.cmd run proof:gates` still passes structurally after the signoff-draft
  script/docs update: 14 expected gates, 14 missing, 0 structural issues.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  local template guard and process-model preflight pass, while 10 external
  proof classes remain missing.
- Added `npm.cmd run proof:canary:draft` via
  `scripts/create-canary-proof-draft.mjs`. It creates a reviewed starter
  manifest for target network, recovery checks, and transaction health, while
  keeping real target proof, recovery statuses, and transaction-health flags
  unverified until a real target-network JSONL canary exists.
- `node --check scripts/create-canary-proof-draft.mjs` passes.
- `npm.cmd run proof:canary:draft -- --network=<network> --chain-id=<chain-id>
  --contract=<contract-address> --rpc-label=<redacted-rpc-label> --out=<temp>`
  writes a draft successfully.
- `npm.cmd run proof:canary -- <temp-jsonl> --strict` against that temp draft
  exits with code 1 as expected, so the draft cannot accidentally close G13
  without 50+ real epochs, elapsed wall-clock coverage, recovery evidence, and
  clean transaction-health metrics.
- `npm.cmd run proof:gates` still passes structurally after the canary-draft
  script/docs update: 14 expected gates, 14 missing, 0 structural issues.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  local template guard and process-model preflight pass, while 10 external
  proof classes remain missing.
- Added `npm.cmd run proof:qa:draft` via
  `scripts/create-qa-proof-draft.mjs`. It creates a reviewed starter manifest
  for wallet, failure-state UX, support/audit visibility, and final browser QA,
  while keeping statuses/TODO evidence, zero clean-wallet tx, and debug smoke
  flags unverified until real QA is recorded.
- `node --check scripts/create-qa-proof-draft.mjs` passes.
- `npm.cmd run proof:qa:draft -- --out=<temp>` writes a draft successfully.
- `npm.cmd run proof:qa -- --strict` against that temp draft exits with code 1
  as expected, so the draft cannot accidentally close G12/G14 without real
  Privy, wallet, mobile, failure-state, support/audit, and browser-smoke
  evidence.
- `npm.cmd run proof:gates` still passes structurally after the QA-draft
  script/docs update: 14 expected gates, 14 missing, 0 structural issues.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  local template guard and process-model preflight pass, while 10 external
  proof classes remain missing.
- Added `npm.cmd run proof:monitoring:draft` via
  `scripts/create-monitoring-proof-draft.mjs`. It creates a reviewed starter
  manifest with all required monitor kinds, alert target, and error tracking
  section, while keeping monitors disabled and evidence fields as explicit
  TODOs until real provider links and alert tests exist.
- `node --check scripts/create-monitoring-proof-draft.mjs` passes.
- `npm.cmd run proof:monitoring:draft -- --out=<temp>` writes a draft
  successfully.
- `npm.cmd run proof:monitoring -- --strict` against that temp draft exits
  with code 1 as expected, so the draft cannot accidentally close G11 without
  deployed external monitors, alert target tests, and error tracking evidence.
- `npm.cmd run proof:gates` still passes structurally after the
  monitoring-draft script/docs update: 14 expected gates, 14 missing, 0
  structural issues.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  local template guard and process-model preflight pass, while 10 external
  proof classes remain missing.
- Added `npm.cmd run proof:restore:draft` via
  `scripts/create-restore-proof-draft.mjs`. It creates a reviewed starter
  manifest from compact restore-drill and restored-staging health logs, while
  leaving backup schedule and heartbeat/latest-epoch preservation as explicit
  TODOs.
- `node --check scripts/create-restore-proof-draft.mjs` passes.
- `npm.cmd run proof:restore:draft -- --out=<temp>` writes a draft
  successfully.
- `npm.cmd run proof:restore -- --strict` against that temp draft exits with
  code 1 as expected, so the draft cannot accidentally close G10 without a real
  DB source, outside-repo backup/restore paths, backup schedule, restored
  staging health, and indexer preservation evidence.
- `npm.cmd run proof:gates` still passes structurally after the restore-draft
  script/docs update: 14 expected gates, 14 missing, 0 structural issues.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  local template guard and process-model preflight pass, while 10 external
  proof classes remain missing.
- Added `npm.cmd run proof:indexer:draft` via
  `scripts/create-indexer-proof-draft.mjs`. It creates a reviewed starter
  manifest from compact `indexer:once` and `health:prod` logs, while leaving
  direct chain comparison entries as `matches: false` TODOs.
- `node --check scripts/create-indexer-proof-draft.mjs` passes.
- `npm.cmd run proof:indexer:draft -- --out=<temp>` writes a draft
  successfully.
- `npm.cmd run proof:indexer -- --strict` against that temp draft exits with
  code 1 as expected, so the draft cannot accidentally close G9 without a real
  fresh DB, positive finality env, and direct chain comparisons.
- `npm.cmd run proof:gates` still passes structurally after the indexer-draft
  script/docs update: 14 expected gates, 14 missing, 0 structural issues.
- `npm.cmd run proof:launch -- --strict` still exits with code 1 as expected:
  local template guard and process-model preflight pass, while 10 external
  proof classes remain missing.

## Remaining

- External proof still missing for production host, health checks, indexer
  dry-run, backup/restore, monitoring, wallet QA, and real-epoch canary.
- Local PM2/package process-model preflight is now covered, but deployed
  supervisor proof is still missing.
- G10 backup/restore tooling now requires end-to-end restore evidence, but the
  actual production/canary DB, backup schedule, restored staging health, and
  restore manifest are still missing. A draft helper now reduces manual
  transcription once the restore-drill and restored-staging health logs exist.
- G9 indexer tooling now requires direct chain comparison and finality-aware
  health evidence, but the actual fresh dry-run DB/env and indexer manifest are
  still missing. A draft helper now reduces manual transcription once the
  `indexer:once` and health logs exist.
- G7/G8 host proof now requires detailed health/load metrics, but the actual
  deployed host manifest, production health output, and load output are still
  missing. A draft helper now reduces manual transcription once those logs
  exist.
- G1-G4 sign-off tooling now requires direct owner read, Safe/governance proof,
  explicit randomness acceptance or mitigation proof, and two-sided chain
  comparison evidence; the actual sign-off manifest and chain reads are still
  missing. A draft helper now reduces checklist mistakes once final env,
  owner/Safe, randomness, and chain comparison evidence exists.
- G13 canary tooling now requires recovery manifest evidence and elapsed real
  epoch span, but the actual target-network canary JSONL and canary manifest
  are still missing. A draft helper now reduces recovery-checklist mistakes
  once the real canary log exists.
- G12/G14 QA tooling now requires exact Privy origin, clean-wallet tx,
  unsupported-chain warning visibility, concrete audit fields, debug autominer
  smoke, console-error review, and mobile/layout evidence; the actual QA
  manifest is still missing. A draft helper now reduces checklist mistakes once
  real wallet/mobile/browser QA evidence exists.
- G11 monitoring tooling now requires tested monitor alerts, provider links,
  alert thresholds/conditions, alert target verification, and error-tracking
  environment/release proof; the actual monitoring manifest is still missing.
  A draft helper now reduces setup mistakes once the external monitor provider
  is configured.
- G1/G6 env tooling now requires HTTPS RPC/site, production Privy app id,
  trusted proxy mode, disabled EIP-7702 flags, and absolute persistent DB path;
  the actual production env proof is still missing.
- Final gate-table tooling now rejects duplicate gate rows and vague
  `Complete` evidence, but all G1-G14 remain `Missing` until real proof is
  recorded.
- Aggregate launch tooling now also verifies that copied proof templates and
  generated proof drafts remain rejected before running the launch proof
  scripts; these guards no longer depend on any permanent historical canary log.
- Proof record is ready to be filled with external command output, tx hashes,
  monitor links, and operator sign-offs.
- Redacted env proof tooling is present, but production env values and external
  host proof are still missing.
- Canary proof tooling is present, but target-network real-epoch canary evidence
  is still missing; previous 300-tx Sepolia log is only a regression sample.
- The next launch work should close G1-G4 first, then G5-G8, then G9-G10,
  before spending more time on final wallet/canary QA.

## Next Action

- Start G1 with final env and `npm.cmd run proof:mainnet -- --strict`, then record
  G2-G4 owner/randomness/chain-read evidence before host work.

## 2026-06-27 Host Evidence Collection Helper

- Added `scripts/collect-host-evidence.mjs` and `npm.cmd run proof:host:collect`
  to run production `health:prod`, run `load:http`, save compact logs, and call
  the existing host draft helper.
- The collector writes only logs and a draft manifest. It does not write
  `docs/host-proof.json`, so G5-G8 still require manual review of supervisor,
  persistent DB, restart/reboot, health, and load evidence before strict proof.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-proof-record.md`, and
  `docs/production-runbook.md` with the new host evidence workflow.
- Verified `node --check scripts/collect-host-evidence.mjs` and
  `npm.cmd run proof:host:collect -- --print-plan`; no network checks are run in
  print-plan mode.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Indexer Evidence Collection Helper

- Added `scripts/collect-indexer-evidence.mjs` and
  `npm.cmd run proof:indexer:collect` to run `indexer:once`, run production
  health, save compact logs, and call the existing indexer draft helper.
- The collector writes only logs and a draft manifest. It does not perform
  direct chain comparisons and does not write `docs/indexer-proof.json`, so G9
  still requires manual jackpot/deposit/reward/rebate/latest-epoch comparison
  against the final contract/RPC before strict proof.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-proof-record.md`, and
  `docs/production-runbook.md` with the new indexer evidence workflow.
- Verified `node --check scripts/collect-indexer-evidence.mjs` and
  `npm.cmd run proof:indexer:collect -- --print-plan`; no network checks are
  run in print-plan mode.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Restore Evidence Collection Helper

- Added `scripts/collect-restore-evidence.mjs` and
  `npm.cmd run proof:restore:collect` to run the backup/restore drill, run
  restored-staging `health:prod`, save compact logs, and call the existing
  restore draft helper.
- The collector intentionally runs the drill helper without `--strict`, because
  strict restore proof requires the reviewed final manifest. It does not write
  `docs/restore-proof.json`, does not prove the backup schedule, and does not
  replace heartbeat/latest-indexed-epoch preservation evidence.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-proof-record.md`, and
  `docs/production-runbook.md` with the new restore evidence workflow.
- Verified `node --check scripts/collect-restore-evidence.mjs` and
  `npm.cmd run proof:restore:collect -- --print-plan`; no file-copy drill or
  network health check is run in print-plan mode.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Sign-Off Evidence Collection Helper

- Extended `scripts/create-signoff-proof-draft.mjs` so it can accept
  `--env-log` and `--chain-log`, carrying compact `proof:mainnet` and
  `proof:chain` summaries into the draft evidence fields.
- Added `scripts/collect-signoff-evidence.mjs` and
  `npm.cmd run proof:signoff:collect` to run redacted final-env proof, run
  direct chain reads, save compact logs, and call the sign-off draft helper.
- The collector writes only logs and a draft manifest. It does not write
  `docs/signoff-proof.json`, does not prove Safe/multisig ownership by itself,
  does not sign off randomness, and does not replace app/indexer comparison
  evidence, so G1-G4 still require reviewed operator proof before strict proof.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-proof-record.md`, and
  `docs/production-runbook.md` with the new sign-off evidence workflow.
- Verified `node --check scripts/create-signoff-proof-draft.mjs`,
  `node --check scripts/collect-signoff-evidence.mjs`, and
  `npm.cmd run proof:signoff:collect -- --print-plan`; no env or chain checks
  are run in print-plan mode.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Monitoring Alert Test Plan Helper

- Added `scripts/create-monitoring-test-plan.mjs` and
  `npm.cmd run proof:monitoring:plan` to generate an operator checklist for
  required G11 monitor kinds, alert-test methods, evidence fields, alert target
  proof, and error-tracking test evidence.
- The monitoring plan is a draft markdown checklist only. It is not accepted as
  launch proof and does not replace `docs/monitoring-proof.json` or real
  provider links/test alert timestamps.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-proof-record.md`, and
  `docs/production-runbook.md` with the monitoring test-plan workflow.
- Verified `node --check scripts/create-monitoring-test-plan.mjs` and
  `npm.cmd run proof:monitoring:plan -- --out=<temp> --force`.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 QA And Canary Test Plan Helper

- Added `scripts/create-qa-canary-test-plan.mjs` and
  `npm.cmd run proof:qa:plan` to generate an operator checklist for wallet QA,
  failure-state UX, support/audit visibility, final browser/mobile QA, and
  real-epoch canary recovery checks.
- The QA/canary plan is a draft markdown checklist only. It is not accepted as
  launch proof and does not replace `docs/qa-proof.json`,
  `docs/canary-proof.json`, a real clean-wallet tx hash, mobile/browser QA
  evidence, or a target-network canary JSONL.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-proof-record.md`, and
  `docs/production-runbook.md` with the QA/canary test-plan workflow.
- Verified `node --check scripts/create-qa-canary-test-plan.mjs` and
  `npm.cmd run proof:qa:plan -- --out=<temp> --force`.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Readiness Checklist Sync

- Updated `docs/mainnet-readiness-checklist.md` so the final checklist includes
  the current launch proof collection helpers:
  `proof:signoff:collect`, `proof:host:collect`, `proof:indexer:collect`,
  `proof:restore:collect`, `proof:monitoring:plan`, and `proof:qa:plan`.
- Updated the recommended launch order so final `docs/*-proof.json` manifests
  and `npm.cmd run proof:launch -- --strict` are required before launch.
- Verified checklist command references against status board, runbook, and proof
  record with `rg`.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Launch Evidence Command Map

- Added `docs/launch-evidence-command-map.md` as a compact operator command
  order for G1-G14 evidence collection, draft generation, final manifest
  validators, and the final aggregate launch gate.
- Linked the command map from `docs/mainnet-readiness-checklist.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md`.
- Verified command-map references with `rg`.
- Verified `npm.cmd run proof:local`; local launch proof preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Launch Command Map Guard

- Added `scripts/check-launch-command-map.mjs` and
  `npm.cmd run proof:launch-map` to verify that
  `docs/launch-evidence-command-map.md` references existing package scripts,
  lists all final proof manifests, states that drafts are not launch proof, and
  is linked from the main readiness/status/runbook docs.
- Wired the command-map guard into `npm.cmd run proof:local` as local check L6.
- Updated `docs/production-runbook.md` to run `proof:launch-map` after editing
  the command map or package proof scripts.
- Verified `node --check scripts/check-launch-command-map.mjs`.
- Verified `npm.cmd run proof:launch-map`; command map is consistent.
- Verified `npm.cmd run proof:local`; L6 command-map check passes inside local
  launch proof preflight.
- Verified `npm.cmd run proof:launch -- --strict`; it still fails as expected on
  missing external G1-G14 proof while local guards pass.

## 2026-06-27 Aggregate Launch Command Map Guard

- Wired `scripts/check-launch-command-map.mjs` into
  `npm.cmd run proof:launch` as a fourth LOCAL guard, so the aggregate launch
  proof now checks template guard, draft guard, proof-file guard, and command
  map guard before external G1-G14 evidence.
- Verified `node --check scripts/run-launch-proof.mjs`.
- Verified `npm.cmd run proof:launch-map`; command map remains consistent.
- Verified `npm.cmd run proof:local`; local preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; the new LOCAL command-map
  guard passes and external G1-G14 proof remains missing as expected.

## 2026-06-27 PowerShell Canary Command Fix

- Fixed `docs/launch-evidence-command-map.md`, `docs/production-runbook.md`, and
  `docs/mainnet-status-board.md` so canary proof examples use PowerShell
  `$env:` assignments instead of bash-style inline env assignments.
- Strengthened `scripts/check-launch-command-map.mjs` to reject bash-style
  inline env assignment in the PowerShell command map and require PowerShell
  canary env variables.
- Fixed the read-only betting smoke example in `docs/production-runbook.md` to
  use PowerShell `$env:` setup and cleanup instead of bash-style inline env
  assignment.
- Verified `node --check scripts/check-launch-command-map.mjs`.
- Verified `npm.cmd run proof:launch-map`; command map remains consistent and
  reports `PowerShell env syntax | pass`.
- Verified `npm.cmd run proof:local`; local preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; local guards pass and
  external G1-G14 proof remains missing as expected.

## 2026-06-27 Launch Docs Command Syntax Guard

- Fixed stale POSIX-style env examples in `docs/mainnet-proof-record.md` for
  scoped chain proof and canary proof commands, replacing them with PowerShell
  `$env:` setup and cleanup.
- Added `scripts/check-launch-doc-command-syntax.mjs` and
  `npm.cmd run proof:launch-docs` to reject inline `VAR=value npm run ...`
  examples in key launch docs.
- Wired the launch-doc command syntax guard into `npm.cmd run proof:local` as
  local check L7.
- Updated `docs/production-runbook.md` to run `proof:launch-docs` after editing
  launch docs with shell commands.
- Verified `node --check scripts/check-launch-doc-command-syntax.mjs`.
- Verified `npm.cmd run proof:launch-docs`; all key launch docs are
  PowerShell-safe.
- Verified `npm.cmd run proof:local`; L7 launch-doc command syntax check
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; local guards pass and
  external G1-G14 proof remains missing as expected.

## 2026-06-27 Aggregate Launch Docs Command Guard

- Wired `scripts/check-launch-doc-command-syntax.mjs` into
  `npm.cmd run proof:launch` as another LOCAL guard, so the aggregate launch
  proof now checks PowerShell-safe launch doc commands before external G1-G14
  evidence.
- Verified `node --check scripts/run-launch-proof.mjs`.
- Verified `npm.cmd run proof:launch-docs`; launch docs remain PowerShell-safe.
- Verified `npm.cmd run proof:local`; local preflight still passes.
- Verified `npm.cmd run proof:launch -- --strict`; the new LOCAL launch-doc
  command guard passes and external G1-G14 proof remains missing as expected.

## 2026-06-27 Strict Command Map Validation

- Strengthened `scripts/check-launch-command-map.mjs` so final validator
  commands in `docs/launch-evidence-command-map.md` must include `--strict`.
  Collectors, draft helpers, and plan helpers remain allowed without strict
  because they do not close launch gates.
- Verified `npm.cmd run proof:launch-map`; command map now reports
  `strict validators | pass`.
- Verified `npm.cmd run proof:local`; local preflight still passes with the
  stricter command-map guard.
- Verified `npm.cmd run proof:launch -- --strict`; local guards pass and
  external G1-G14 proof remains missing as expected.

## 2026-06-27 Status Board Local Guard Sync

- Updated `docs/mainnet-status-board.md` so Current Local Proof State explicitly
  lists `proof:launch-map`, `proof:launch-docs`, and the expanded `proof:local`
  L1-L7 guard set.
- Verified status-board references with `rg`.
- Verified `npm.cmd run proof:local`; L1-L7 local guards pass.
- Verified `npm.cmd run proof:launch -- --strict`; local aggregate guards pass
  and external G1-G14 proof remains missing as expected.

## 2026-06-27 Readiness Checklist Guard

- Added `scripts/check-readiness-checklist.mjs` and
  `npm.cmd run proof:readiness` to verify that
  `docs/mainnet-readiness-checklist.md` keeps required launch sections, current
  proof collection/validation commands, and evidence markers for checked items.
- Wired the readiness checklist guard into `npm.cmd run proof:local` as local
  check L8.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so the
  new guard is part of the documented local proof layer.
- Verified `node --check scripts/check-readiness-checklist.mjs`.
- Verified `npm.cmd run proof:readiness`; checklist structure is consistent and
  the one checked item has an evidence marker.
- Verified `npm.cmd run proof:local`; L8 readiness checklist guard passes.
- Verified `npm.cmd run proof:launch -- --strict`; local guards pass and
  external G1-G14 proof remains missing as expected.

## 2026-06-27 Aggregate Readiness Checklist Guard

- Wired `scripts/check-readiness-checklist.mjs` into
  `npm.cmd run proof:launch` as another LOCAL guard, so the aggregate launch
  proof now checks readiness checklist structure and checked-item evidence
  markers before external G1-G14 evidence.
- Verified `node --check scripts/run-launch-proof.mjs`.
- Verified `npm.cmd run proof:readiness`; checklist structure remains
  consistent.
- Verified `npm.cmd run proof:local`; L1-L8 local guards pass.
- Verified `npm.cmd run proof:launch -- --strict`; the new LOCAL readiness
  checklist guard passes and external G1-G14 proof remains missing as expected.

## 2026-06-27 Remaining Evidence Report

- Added `scripts/report-launch-remaining.mjs` and
  `npm.cmd run proof:remaining` to print incomplete G1-G14 launch gates from the
  status board and proof record, including each gate's first-check command and
  required proof.
- Added `proof:remaining` to `docs/launch-evidence-command-map.md` before
  final local/aggregate proof checks, and documented it in the production
  runbook and status board.
- Verified `node --check scripts/report-launch-remaining.mjs`.
- Verified `npm.cmd run proof:remaining`; it reports 14 remaining gates, zero
  complete gates, and no inconsistent G1-G14 rows.
- Verified `npm.cmd run proof:launch-map`; command map remains consistent after
  adding `proof:remaining`.
- Verified `npm.cmd run proof:local`; L1-L8 local launch proof preflight still
  passes.
- `git diff --check` for the touched report/docs files has no whitespace
  errors; Git only reports LF-to-CRLF normalization warnings for existing docs
  and `package.json`.

## 2026-06-27 Proof Collector Redaction

- Added `scripts/redact-proof-output.mjs` and wired it into host, indexer, and
  restore evidence collectors so production proof logs redact sensitive command
  arguments plus stdout/stderr patterns before writing `data/proof-runs/...`.
- Updated `docs/production-runbook.md` to note that collector logs are redacted
  but still require review before sharing outside the launch team.
- Verified `node --check` for the redaction helper and all three updated
  collectors.
- Verified `npm.cmd run proof:host:collect -- --print-plan`,
  `npm.cmd run proof:indexer:collect -- --print-plan`, and
  `npm.cmd run proof:restore:collect -- --print-plan`; no network checks or
  file-copy drills are run in print-plan mode.
- Verified redaction with a synthetic `PRIVATE_KEY`, `RPC_URL`, bearer token,
  and `--api-key` sample.
- Verified `npm.cmd run proof:local`; L1-L8 local launch proof preflight still
  passes.
- Verified `npm.cmd run proof:remaining`; all G1-G14 launch gates still require
  external evidence.

## 2026-06-27 Collector Redaction Local Guard

- Added `scripts/check-proof-collector-redaction.mjs` and
  `npm.cmd run proof:collector-redaction` to prevent regression in proof-run
  log redaction for host, indexer, and restore collectors.
- Wired the redaction guard into `npm.cmd run proof:local` as L9 and into
  `npm.cmd run proof:launch` as a LOCAL guard before external G1-G14 proof.
- Updated `docs/launch-evidence-command-map.md` and
  `docs/mainnet-status-board.md` so the redaction guard is visible in the
  final proof command order and local proof-state table.
- Verified `node --check` for the new guard and touched aggregate scripts.
- Verified `npm.cmd run proof:collector-redaction`; helper and all three
  collectors pass.
- Verified `npm.cmd run proof:launch-map`; command map now references 23 npm
  scripts and remains consistent.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards, including
  collector redaction, pass and the command still fails as expected on missing
  external G1-G14 evidence.

## 2026-06-27 Final Proof Manifest Strict Guard

- Strengthened `scripts/check-proof-files.mjs` so existing final
  `docs/*-proof.json` manifests are not only scanned for placeholders,
  secret-like values, and unexpected proof-like filenames, but also run through
  their strict launch validators before `proof:files` can pass.
- Added a one-event canary smoke log inside the guard so an existing
  `docs/canary-proof.json` can be validated for manifest shape without needing
  a full real-epoch canary log during local file hygiene checks.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` to
  describe the stricter proof-file guard.
- Verified `node --check scripts/check-proof-files.mjs`.
- Verified `npm.cmd run proof:files`; with no final manifests collected yet it
  passes and reports all expected manifests as `not yet collected`.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Restore Non-Local Health Guard

- Strengthened `scripts/verify-db-restore.mjs` so
  `docs/restore-proof.json` `restoredStagingHealth.url` must be a non-local
  HTTPS staging or canary URL, not localhost or a local placeholder.
- Fixed restore proof handling for corrupt or non-SQLite source files: the
  validator now reports `restored DB could not be opened or checked` as a
  controlled proof issue instead of throwing an unhandled stack trace.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G10 requires a non-local restored staging/canary health URL.
- Verified `node --check scripts/verify-db-restore.mjs`.
- Verified `npm.cmd run proof:restore -- --strict`; it still fails as expected
  without source DB paths and `docs/restore-proof.json`.
- Verified synthetic restore manifests: `https://localhost:3000/...` is
  rejected with `restoredStagingHealth.url must be a non-local HTTPS staging or canary URL`.
- Verified a corrupt temporary DB now produces a controlled proof issue instead
  of an unhandled exception.
- Verified a real temporary SQLite DB restore proof passes with a non-local
  canary health URL.
- Verified `npm.cmd run proof:templates`; restore template rejection includes
  the stronger non-local health URL requirement.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Monitoring Exact Origin Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so
  `docs/monitoring-proof.json` `origin` must be the final HTTPS origin without
  path, query, or hash, not just any non-local HTTPS URL.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G11 monitoring proof uses the same exact-origin rule as mainnet, host, QA,
  and final browser smoke proof.
- Verified `node --check scripts/check-monitoring-proof.mjs`.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified synthetic monitoring manifests: `https://playlore.xyz` passes,
  while `https://playlore.xyz/monitoring` is rejected with
  `origin must be a final HTTPS origin without path, query, or hash`.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:templates`; monitoring template rejection includes
  the stronger exact-origin requirement.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Canary RPC Redaction Guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so
  `docs/canary-proof.json` `targetNetwork.rpc` must be a redacted
  provider/endpoint label, not a raw RPC URL.
- Strengthened `scripts/check-proof-files.mjs` so final proof manifests are
  flagged when RPC fields contain raw URLs, even when a live canary JSONL is
  not supplied.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G13 records redacted target RPC evidence without exposing private RPC URLs.
- Verified `node --check scripts/analyze-live-canary-proof.mjs` and
  `node --check scripts/check-proof-files.mjs`.
- Verified `npm.cmd run proof:canary -- --strict`; it still fails as expected
  without a live canary JSONL path.
- Verified synthetic canary proof: `alchemy-mainnet-redacted` passes, while
  `https://rpc.example.com/private-key` is rejected with
  `targetNetwork.rpc must be a redacted RPC label, not a raw URL`.
- Verified `scripts/check-proof-files.mjs` from a temp cwd with
  `docs/canary-proof.json`; raw RPC URL is flagged as
  `secret-like values at $.targetNetwork.rpc` even without a canary JSONL.
- Verified `npm.cmd run proof:files`, `npm.cmd run proof:launch-docs`, and
  `npm.cmd run proof:templates`.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Chain Proof Configured RPC Guard

- Strengthened `scripts/collect-chain-proof.mjs` so strict G4 direct-chain
  proof requires a configured RPC env source and no longer silently relies on
  built-in fallback RPCs.
- The chain proof snapshot now records `rpcSource` as the configured env name or
  `built-in fallback`, and the console summary prints that source.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G4 direct chain reads explicitly use the configured target RPC.
- Verified `node --check scripts/collect-chain-proof.mjs`.
- Verified `npm.cmd run proof:chain -- --strict`; it now reports both missing
  configured RPC and missing contract address in the local environment.
- Verified a synthetic configured `KEEPER_RPC_URL` run: the built-in fallback
  issue disappears, leaving only the expected dependency/network-side failure
  for the dummy setup.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and G2/G4
  now reports missing configured RPC plus missing contract address, while the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Indexer Chain Snapshot RPC Source Guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so strict G9 indexer proof
  requires `chainSnapshot.rpcSource` to record a configured RPC source instead
  of accepting built-in fallback/default RPC evidence.
- Updated `scripts/create-indexer-proof-draft.mjs` so generated indexer drafts
  copy `rpcSource` from the chain snapshot when available.
- Updated `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so G9
  fresh DB dry-run evidence records the configured RPC source used for the
  matching chain snapshot.
- Verified `node --check scripts/check-indexer-dry-run.mjs` and
  `node --check scripts/create-indexer-proof-draft.mjs`.
- Verified `npm.cmd run proof:indexer -- --strict`; it still fails as expected
  without DB/env/final manifest.
- Verified synthetic indexer manifests: `rpcSource: "KEEPER_RPC_URL"` passes
  the new guard, while `rpcSource: "built-in fallback"` is rejected with
  `chainSnapshot.rpcSource must record a configured RPC source`.
- Verified a synthetic draft helper run copies `"rpcSource": "KEEPER_RPC_URL"`
  into the generated indexer draft.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.
- Verified `npm.cmd run proof:remaining`; all 14 external launch gates remain
  incomplete and G9 now explicitly requires configured RPC source evidence.

## 2026-06-29 Host Configured Origin Guard

- Strengthened `scripts/check-host-proof.mjs` so `docs/host-proof.json`
  `origin` must match `NEXT_PUBLIC_SITE_URL`, `PUBLIC_SITE_URL`, or `SITE_URL`
  when one of those production origin env vars is configured.
- Updated `docs/production-runbook.md` so host proof collection explicitly
  records an origin matching the configured site origin.
- Verified `node --check scripts/check-host-proof.mjs`.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified synthetic host manifest: matching `NEXT_PUBLIC_SITE_URL` passes,
  while a different configured origin is rejected with
  `origin must match configured production origin`.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 QA Debug Smoke Timestamp Guard

- Strengthened `scripts/check-qa-proof.mjs` so G14 debug browser smoke proof
  requires `finalQa.browserSmokeDebugAutominer.checkedAt` as ISO-8601 UTC.
- Updated `scripts/create-qa-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new QA drafts/templates include
  the required smoke timestamp field.
- Updated `docs/mainnet-status-board.md` so G14 remaining evidence explicitly
  includes an ISO UTC smoke timestamp.
- Verified `node --check scripts/check-qa-proof.mjs` and
  `node --check scripts/create-qa-proof-draft.mjs`.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified synthetic QA manifests: a complete manifest with smoke `checkedAt`
  passes, while the same manifest without `checkedAt` fails with
  `finalQa.browserSmokeDebugAutominer.checkedAt must be ISO-8601 UTC`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:remaining`; G14 now reports the smoke timestamp
  requirement.

## 2026-06-29 Monitoring Runtime Health URL Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so the G11
  `health-prod` external monitor URL must target `/api/health/runtime` on the
  final production origin instead of accepting any URL on the origin.
- Updated `scripts/create-monitoring-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so new
  monitoring evidence records the runtime health endpoint explicitly.
- Verified `node --check scripts/check-monitoring-proof.mjs` and
  `node --check scripts/create-monitoring-proof-draft.mjs`.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified synthetic monitoring manifests: a complete manifest with
  `health-prod.url` set to `/api/health/runtime` passes, while the same
  manifest with `health-prod.url` set to the origin fails with
  `health-prod monitor URL must target /api/health/runtime`.

## 2026-06-29 Host Load Origin Guard

- Strengthened `scripts/check-host-proof.mjs` so G8 `loadHttp.url` must be a
  non-local HTTPS staging/canary origin without path, query, or hash, and must
  still differ from the final production origin.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  load evidence records the staging/canary origin, not an arbitrary route URL.
- Verified `node --check scripts/check-host-proof.mjs`.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified synthetic host manifests: a complete manifest with
  `loadHttp.url: "https://canary.playlore.xyz"` passes, while the same manifest
  with `loadHttp.url: "https://canary.playlore.xyz/load"` fails with
  `loadHttp.url must be a non-local HTTPS staging or canary origin without path, query, or hash`.

## 2026-06-29 Signoff Chain Comparison Timestamp Guard

- Strengthened `scripts/check-signoff-proof.mjs` so every G4
  `chainComparison.*` manual chain/app comparison requires `checkedAt` as
  ISO-8601 UTC.
- Updated `scripts/create-signoff-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`, and
  `docs/mainnet-status-board.md` so signoff evidence records comparison
  timestamps for jackpot, Safety Pool, deposits, rewards, rebates, and resolve.
- Adjusted signoff `hasEvidence` to count existing `directChainEvidence` and
  `appOrIndexerEvidence` fields as evidence instead of relying on `checkedAt`.
- Verified `node --check scripts/check-signoff-proof.mjs` and
  `node --check scripts/create-signoff-proof-draft.mjs`.
- Verified `npm.cmd run proof:signoff -- --strict`; it still fails as
  expected without `docs/signoff-proof.json`.
- Verified synthetic signoff manifests: a complete manifest with
  `chainComparison.*.checkedAt` passes, while the same manifest without
  `chainComparison.jackpot.checkedAt` fails with
  `chainComparison.jackpot.checkedAt must be ISO-8601 UTC`.

## 2026-06-29 Restore Recurring Backup Cadence Guard

- Strengthened `scripts/verify-db-restore.mjs` so G10
  `backupSchedule.cadence` must describe a recurring schedule and cannot be a
  manual, one-off, ad-hoc, disabled, or on-demand backup.
- Updated `scripts/create-restore-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so restore
  evidence records a recurring backup cadence.
- Verified `node --check scripts/verify-db-restore.mjs` and
  `node --check scripts/create-restore-proof-draft.mjs`.
- Verified `npm.cmd run proof:restore -- --strict`; it still fails as expected
  without source DB/env/final manifest.
- Verified synthetic restore manifests with a temporary SQLite DB outside the
  repo: `cadence: "every 5 minutes"` passes the full copy/restore/integrity
  path, while `cadence: "manual once"` fails with
  `backupSchedule.cadence must describe a recurring schedule, not a manual one-off backup`.

## 2026-06-29 Canary Transaction Hash Guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so G13
  `transactionHealth.txHashes` must include at least one real non-zero tx hash.
- In strict mode the analyzer now checks that manifest tx hashes appear in the
  successful canary JSONL events and that at least one listed tx hash belongs
  to a successful auto-miner event.
- Updated `scripts/create-canary-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so canary
  evidence records structured tx hashes, not only prose evidence.
- Fixed the analyzer return summary to include `transactionHealth`, which the
  new strict hash comparison needs.
- Verified `node --check scripts/analyze-live-canary-proof.mjs` and
  `node --check scripts/create-canary-proof-draft.mjs`.
- Verified synthetic canary JSONL/manifests with `LIVE_CANARY_MIN_EPOCHS=1`:
  a manifest whose `transactionHealth.txHashes` matches the successful
  auto-miner JSONL tx passes; a manifest with a tx hash not present in the
  JSONL fails with `transactionHealth.txHashes not found in successful canary tx`
  and `transactionHealth.txHashes must include at least one successful auto-miner tx hash`.

## 2026-06-29 QA Wallet And Failure-State Timestamp Guard

- Strengthened `scripts/check-qa-proof.mjs` so G12 wallet checks and all
  `failureStateUx.*` checks require `checkedAt` as ISO-8601 UTC.
- Updated `scripts/create-qa-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so QA
  evidence records timestamps for wallet and failure-state checks.
- Verified `node --check scripts/check-qa-proof.mjs` and
  `node --check scripts/create-qa-proof-draft.mjs`.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified synthetic QA manifests: a complete manifest with wallet and
  failure-state `checkedAt` timestamps passes; the same manifest without
  `failureStateUx.pendingBet.checkedAt` fails with
  `failureStateUx.pendingBet.checkedAt must be ISO-8601 UTC`.

## 2026-06-29 Monitoring Alert Target Evidence Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so G11 alert targets must
  use a concrete alert channel kind such as `pagerduty`, `opsgenie`, `slack`,
  `email`, or `sms`, rather than a generic `pager-or-chat` label.
- The monitoring proof now also requires each alert target to include a
  redacted evidence field, evidence path, notes, or provider link for the fired
  test alert.
- Updated `scripts/create-monitoring-proof-draft.mjs`,
  `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so alert
  target evidence is explicit.
- Verified `node --check scripts/check-monitoring-proof.mjs` and
  `node --check scripts/create-monitoring-proof-draft.mjs`.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified synthetic monitoring manifests: a complete manifest with a
  `pagerduty` target and fired-alert evidence passes, while the same manifest
  with `kind: "pager-or-chat"` and no evidence/link fails with
  `alertTargets[0].kind must be a concrete alert channel` and
  `alertTargets[0] must include evidence or link for the fired test alert`.

## 2026-06-28 Host Final Origin Guard

- Strengthened `scripts/check-host-proof.mjs` so `docs/host-proof.json`
  `origin` must be a final HTTPS origin without path, query, or hash, and must
  not be localhost or a local placeholder.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G7 host health proof uses the same exact-origin requirement as mainnet,
  monitoring, and QA proof.
- Verified `node --check scripts/check-host-proof.mjs`.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified `npm.cmd run proof:host-guard`; host load target guard passes.
- Verified synthetic host manifests: `https://playlore.xyz` passes, while
  `https://playlore.xyz/app` is rejected with
  `origin must be a final HTTPS origin without path, query, or hash`.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Mainnet Privy Fallback Guard

- Strengthened `scripts/collect-mainnet-proof.mjs` so G1/G6 mainnet env proof
  rejects the known development Privy fallback app id from `app/providers.tsx`.
- The proof output now reports `development fallback` for that case instead of
  a generic configured value.
- Updated `docs/mainnet-status-board.md` so G1 explicitly requires a
  production Privy app id.
- Verified `node --check scripts/collect-mainnet-proof.mjs`.
- Verified synthetic mainnet env: the known development Privy app id is
  rejected, while a non-fallback production-like id passes the mainnet env
  guard.
- Verified `npm.cmd run proof:mainnet -- --strict`; it still fails as expected
  in the local environment with 30 missing/failing env gates.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Mainnet Site Origin Guard

- Strengthened `scripts/collect-mainnet-proof.mjs` so `NEXT_PUBLIC_SITE_URL`
  must be a true final HTTPS origin with no path, query, or hash, in addition
  to rejecting localhost/local placeholders.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G1 contract env evidence records a final origin, not a route URL.
- Verified `node --check scripts/collect-mainnet-proof.mjs`.
- Verified synthetic mainnet env: `https://playlore.xyz/play` is rejected by
  `site URL is final https origin`, while `https://playlore.xyz` passes the
  mainnet env guard.
- Verified `npm.cmd run proof:mainnet -- --strict`; it still fails as expected
  in the local environment with 30 missing/failing env gates.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Remaining Evidence Local Guard

- Wired `scripts/report-launch-remaining.mjs` into
  `scripts/run-local-proof-preflight.mjs` as L11 so `npm.cmd run proof:local`
  verifies the status board and proof record do not drift while external
  G1-G14 evidence is still open.
- Added the same remaining-evidence report to `scripts/run-launch-proof.mjs`
  as a LOCAL guard, so aggregate launch output always includes the current
  external blocker list before the individual strict proof checks.
- Updated `docs/mainnet-status-board.md` so local and aggregate proof rows
  mention remaining-evidence consistency.
- Verified `node --check scripts/run-local-proof-preflight.mjs` and
  `node --check scripts/run-launch-proof.mjs`.
- Verified `npm.cmd run proof:remaining`; it reports 14 remaining external
  gates and no inconsistent gate rows.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:launch -- --strict`; the new LOCAL
  remaining-evidence row passes and the command still fails as expected on
  missing external G1-G14 evidence.

## 2026-06-28 Canary Proof File Guard Log Handling

- Fixed `scripts/check-proof-files.mjs` so `docs/canary-proof.json` is not
  strict-validated against a synthetic one-event JSONL that could mismatch the
  real target contract, network metadata, or auto-miner round counts.
- `proof:files` now accepts `--canary-log=<path>` or `PROOF_CANARY_LOG` for
  canary manifest validation; without a live log it still checks the manifest
  for placeholders and secret-like fields, then marks the canary strict
  validator as skipped instead of producing a false failure.
- Updated `docs/mainnet-status-board.md` and `docs/production-runbook.md` so
  final canary proof file validation explicitly uses the live canary JSONL.
- Verified `node --check scripts/check-proof-files.mjs`.
- Verified `npm.cmd run proof:files`; it passes with final proof manifests not
  yet collected.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Host Process Role Command Guard

- Strengthened `scripts/check-host-proof.mjs` so deployed G5-G8 host proof
  must show the expected long-running launch role commands:
  `lore-site` uses `npm run start`, `lore-bot` uses `npm run bot`, and
  `lore-indexer` uses `npm run indexer`.
- Tightened matching so one-shot or alternate commands such as
  `npm run indexer:once` and `npm run start:3000` do not satisfy production
  process role proof.
- Updated the host proof template, production runbook, status board, and host
  guard fixture to document the same required role commands.
- Verified `node --check scripts/check-host-proof.mjs`.
- Verified synthetic host manifests: the valid role commands pass, while
  `lore-indexer` using `npm.cmd run indexer:once` is rejected with
  `processModel.lore-indexer.command must match the expected launch role command`.
- Verified `npm.cmd run proof:process-model -- --strict` and
  `npm.cmd run proof:host-guard`; both pass.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 QA Final Origin Guard

- Strengthened `scripts/check-qa-proof.mjs` so
  `wallet.privyAllowedOrigins.origin` and
  `finalQa.browserSmokeDebugAutominer.origin` must be final non-local HTTPS
  origins, not localhost or local placeholders.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G12/G14 explicitly require non-local production origins.
- Verified `node --check scripts/check-qa-proof.mjs` and
  `node --check scripts/create-qa-proof-draft.mjs`.
- Verified a synthetic QA manifest: `https://playlore.xyz` passes the new
  origin guard, while `https://localhost:3000` is rejected for both Privy and
  browser smoke origins.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Monitoring Final Origin Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so monitoring proof
  `origin` must be a final HTTPS origin, not localhost or a local placeholder.
- The monitoring proof `origin` must also match `NEXT_PUBLIC_SITE_URL`,
  `PUBLIC_SITE_URL`, or `SITE_URL` when one of those env values is configured.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G11 explicitly requires external monitoring on the final HTTPS origin.
- Verified `node --check scripts/check-monitoring-proof.mjs` and
  `node --check scripts/create-monitoring-proof-draft.mjs`.
- Verified a synthetic monitoring manifest: `https://playlore.xyz` passes the
  new guard, `https://localhost:3000` is rejected, and a canary origin is
  rejected when configured production origin is `https://playlore.xyz`.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Signoff Chain Comparison Epoch Guard

- Strengthened `scripts/check-signoff-proof.mjs` so every
  `chainComparison.*` item in `docs/signoff-proof.json` must include a
  non-empty `checkedEpochs` list.
- Updated `scripts/create-signoff-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so signoff proof drafts/templates
  include `checkedEpochs` for jackpot, Safety Pool, deposits, rewards,
  rebates, and resolve comparisons.
- Updated `docs/mainnet-status-board.md` so G4 explicitly requires checked
  epoch ids for direct chain versus app/indexer comparisons.
- Verified `node --check scripts/check-signoff-proof.mjs` and
  `node --check scripts/create-signoff-proof-draft.mjs`.
- Verified a synthetic signoff manifest: non-empty `checkedEpochs` passes the
  new guard, while an empty `chainComparison.jackpot.checkedEpochs` is rejected.
- Verified `npm.cmd run proof:signoff -- --strict`; it still fails as expected
  without `docs/signoff-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Mainnet Env Chain ID / Origin Guard

- Strengthened `scripts/collect-mainnet-proof.mjs` so G1 requires explicit
  `LINEA_CHAIN_ID=59144` and `NEXT_PUBLIC_LINEA_CHAIN_ID=59144`, plus matching
  public/keeper chain ids.
- Strengthened the same proof so `NEXT_PUBLIC_SITE_URL` must be a final HTTPS
  origin, not localhost or a local placeholder.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  mainnet runtime proof explicitly records chain id 59144 and final HTTPS
  origin requirements.
- Verified `node --check scripts/collect-mainnet-proof.mjs`.
- Verified a synthetic mainnet env: valid chain ids/final origin pass, wrong
  public chain id fails `target chain id` and `chain ids match`, and
  `https://localhost:3000` fails `site URL is final https origin`.
- Verified `npm.cmd run proof:mainnet -- --strict`; it still fails as expected
  without final host env, now reporting 30 missing/failing env gates.
- Verified `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`,
  and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Canary ISO Timestamp Guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so
  `targetNetwork.checkedAt`, every `recovery.*.checkedAt`,
  `autoMinerSession.checkedAt`, and `transactionHealth.checkedAt` must be
  ISO-8601 UTC timestamps.
- Updated `scripts/create-canary-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so canary proof drafts/templates
  include those timestamp fields.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G13 explicitly requires ISO UTC target/recovery/auto-miner/transaction
  timestamps.
- Verified `node --check scripts/analyze-live-canary-proof.mjs` and
  `node --check scripts/create-canary-proof-draft.mjs`.
- Verified a synthetic one-event canary JSONL plus manifest: valid ISO
  timestamps pass the new guard, while `done`/`today`/`later`/`soon` are
  rejected for target, recovery, auto-miner, and transaction health timestamps.
- Verified `npm.cmd run proof:canary -- --strict`; it still fails as expected
  without a live canary JSONL path.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Indexer ISO Timestamp Guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so
  `dryRun.timestamp`, `finality.checkedAt`, and `chainSnapshot.checkedAt` must
  be ISO-8601 UTC timestamps.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G9 indexer proof explicitly requires ISO UTC dry-run, finality, and chain
  snapshot timestamps.
- Verified `node --check scripts/check-indexer-dry-run.mjs` and
  `node --check scripts/create-indexer-proof-draft.mjs`.
- Verified a synthetic indexer manifest: valid ISO timestamps pass the new
  guard, while `done`/`today`/`later` are rejected for dry-run, finality, and
  chain-snapshot timestamps.
- Verified `npm.cmd run proof:indexer -- --strict`; it still fails as expected
  without DB/env/final manifest.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Host Health/Load ISO Timestamp Guard

- Strengthened `scripts/check-host-proof.mjs` so `healthProd.timestamp` and
  `loadHttp.timestamp` must be ISO-8601 UTC timestamps.
- Updated `scripts/check-host-proof-load-target.mjs` fixtures so L10 local
  host-load guard exercises the stricter host proof schema.
- Fixed `docs/production-runbook.md` host proof wording: production health URL
  must match the final origin, while load proof must be collected on a
  staging/canary HTTPS host and not on the final production origin.
- Updated `docs/mainnet-status-board.md` so G7/G8 explicitly require ISO UTC
  health/load timestamps.
- Verified `node --check scripts/check-host-proof.mjs`,
  `node --check scripts/create-host-proof-draft.mjs`, and
  `node --check scripts/check-host-proof-load-target.mjs`.
- Verified a synthetic host manifest: valid ISO timestamps pass the new guard,
  while `done`/`later` are rejected for health/load timestamps.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:host-guard`, `npm.cmd run proof:launch-docs`,
  `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Restore ISO Timestamp Guard

- Strengthened `scripts/verify-db-restore.mjs` so `backupSchedule.checkedAt`,
  `restoreDrill.timestamp`, and `restoredStagingHealth.timestamp` must be
  ISO-8601 UTC timestamps.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G10 restore evidence explicitly requires ISO UTC backup/restore/health
  timestamps.
- Verified `node --check scripts/verify-db-restore.mjs` and
  `node --check scripts/create-restore-proof-draft.mjs`.
- Verified a synthetic restore manifest: valid ISO timestamps do not trigger
  timestamp errors, while `today`/`done`/`later` are rejected for the three
  restore timestamp fields.
- Verified `npm.cmd run proof:restore -- --strict`; it still fails as expected
  without `LORE_DB_PATH`, outside-repo backup/restore dirs, and
  `docs/restore-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-27 Canary JSONL Target Metadata Audit

- Updated `scripts/live-round-canary.ts` so every live canary JSONL event now
  includes `network`, `chainId`, and `contractAddress` metadata from the active
  configured target.
- Strengthened `scripts/analyze-live-canary-proof.mjs` so strict canary proof
  rejects successful canary events whose target metadata is missing or does not
  match the reviewed canary manifest/configured env.
- Updated local proof guards' synthetic canary JSONL samples to include target
  metadata.
- Updated `docs/production-runbook.md` to require per-event target metadata in
  the live canary JSONL.
- Verified `node --check` for the live canary producer, canary analyzer, and
  affected local proof guards.
- Verified a synthetic old-style canary JSONL without target metadata; strict
  canary proof rejects it with `target metadata mismatches`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:files`.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-27 Canary Target Env Manifest Audit

- Strengthened `scripts/analyze-live-canary-proof.mjs` so
  `docs/canary-proof.json` must record `targetNetwork.network`, and that
  network plus `targetNetwork.contractAddress` must match configured Linea
  network/contract env when present.
- Updated `docs/production-runbook.md` so canary proof collection explicitly
  requires network/RPC/contract proof before summarizing the live canary JSONL.
- Verified `node --check scripts/analyze-live-canary-proof.mjs`.
- Verified `npm.cmd run proof:canary -- --strict`; it still fails as expected
  without a live canary JSONL path.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`;
  canary templates/drafts are still rejected by strict validators with the new
  target-network requirement.
- Verified a synthetic canary manifest whose network and contract do not match
  env; strict proof rejects it with both target-network and contract mismatch
  issues.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-27 QA Target Network Manifest Audit

- Strengthened `scripts/check-qa-proof.mjs` so `docs/qa-proof.json` must record
  a top-level `targetNetwork`, must match configured Linea network env when
  present, and `wallet.cleanWalletFirstTx.network` must match that target
  network.
- Updated `scripts/create-qa-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new QA proof drafts include the
  target network for later audit.
- Updated `docs/production-runbook.md` to require target network evidence in
  the QA manifest.
- Verified `node --check` for QA validator and draft helper.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`; QA
  templates/drafts are still rejected by strict validators with the new target
  network requirement.
- Verified a synthetic QA manifest where clean-wallet tx network is `sepolia`
  while `targetNetwork` is `mainnet`; strict proof rejects it with
  `wallet.cleanWalletFirstTx.network must match targetNetwork`.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-27 Monitoring Origin Manifest Audit

- Strengthened `scripts/check-monitoring-proof.mjs` so
  `docs/monitoring-proof.json` must record a final HTTPS `origin`, and the
  `health-prod` monitor must record a monitored HTTPS URL matching that origin.
- Updated `scripts/create-monitoring-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new monitoring proof drafts
  include the target origin for later audit.
- Updated `docs/production-runbook.md` to make external `health:prod`
  monitoring explicitly tied to the final HTTPS origin.
- Verified `node --check` for monitoring validator and draft helper.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`;
  monitoring templates/drafts are still rejected by strict validators with the
  new origin requirement.
- Verified a synthetic monitoring manifest where `health-prod.url` points to a
  different origin; strict proof rejects it with `health-prod monitor URL must
  match monitoring proof origin`.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Contract Sign-Off Env Manifest Audit

- Strengthened `scripts/check-signoff-proof.mjs` so `docs/signoff-proof.json`
  must record raw `publicContractAddress`, `keeperContractAddress`,
  `publicDeployBlock`, `indexerStartBlock`, and `finalityBlocks`, not only
  boolean summary flags.
- The sign-off validator now rejects manifests where the reviewed contract
  address does not match public/keeper addresses, where deploy block does not
  match public/indexer block values, or where configured env values disagree
  with recorded manifest values.
- Updated `scripts/create-signoff-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new sign-off drafts/templates
  include the raw values needed for audit.
- Updated `docs/production-runbook.md` deploy order to require recording raw
  public/keeper contract addresses, deploy/indexer block, and finality blocks
  before `npm run proof:signoff -- --strict`.
- Verified `node --check` for the sign-off validator and draft helper.
- Verified `npm.cmd run proof:signoff -- --strict`; it still fails as expected
  without `docs/signoff-proof.json`.
- Verified a synthetic weak sign-off manifest with only boolean env flags;
  strict proof rejects it because raw public/keeper/finality fields are absent.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`; the
  sign-off template/draft are still rejected by strict validators with the new
  field requirements.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Direct Chain Proof Snapshot Audit

- Added optional `--out=<path>` / `PROOF_CHAIN_OUT` support to
  `scripts/collect-chain-proof.mjs` so direct-chain proof runs can save a
  compact JSON snapshot for later sign-off/indexer evidence.
- The snapshot records target network, chain id, endpoint count, contract/token
  addresses, top-level contract reads, jackpot info, epoch rows, user reward
  reads, and issues without storing RPC URLs or secrets.
- Updated `docs/production-runbook.md` so the direct-chain launch step writes
  `data/proof-runs/chain-<stamp>/snapshot.json`.
- Updated `docs/launch-evidence-command-map.md`,
  `docs/mainnet-status-board.md`, and `docs/mainnet-readiness-checklist.md`
  so every operator-facing chain-proof command records that snapshot path.
- Verified `node --check scripts/collect-chain-proof.mjs`.
- Verified a strict failure path with no contract address; the command rejects
  the run and still writes a JSON snapshot containing the missing-address issue.
- Verified `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`,
  and `npm.cmd run proof:readiness`.
- Verified `git diff --check` for the chain collector and runbook; only the
  known docs LF/CRLF warning appeared.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Host Origin Binding Audit

- Strengthened `scripts/check-host-proof.mjs` so `docs/host-proof.json` must
  record `healthProd.url` and `loadHttp.url`, and both URLs must match the
  manifest `origin`.
- Updated `scripts/create-host-proof-draft.mjs` to parse `health:prod`
  `base=<url>` and `load:http` `Load base URL: <url>` lines into those fields.
- Updated `docs/launch-proof-manifest-templates.md` and
  `docs/production-runbook.md` to require health/load proof URLs that match the
  final host origin.
- Verified `node --check` for the host validator and draft helper.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified a synthetic host manifest where `healthProd.url` points at a
  different origin; strict proof rejects it with
  `healthProd.url must match host proof origin`.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`; host
  templates/drafts are still rejected by strict validators with the new URL
  requirements.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Sign-Off Collector Chain Snapshot

- Updated `scripts/collect-signoff-evidence.mjs` so the G1-G4 sign-off
  collector passes `--out=<out-dir>/chain-snapshot.json` into
  `scripts/collect-chain-proof.mjs`.
- The collector print plan now shows the chain snapshot path alongside env and
  chain logs, making the direct-chain evidence artifact explicit.
- Updated `docs/launch-evidence-command-map.md` and
  `docs/production-runbook.md` to document
  `data/proof-runs/signoff-<stamp>/chain-snapshot.json` as a collector
  artifact.
- Verified `node --check scripts/collect-signoff-evidence.mjs`.
- Verified `npm.cmd run proof:signoff:collect -- --print-plan ...`; it shows
  `--out=<signoff-run>/chain-snapshot.json` without running network checks.
- Verified `npm.cmd run proof:launch-map` and `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.

## 2026-06-28 Indexer Collector Chain Snapshot

- Updated `scripts/collect-indexer-evidence.mjs` so the G9 indexer collector
  runs `scripts/collect-chain-proof.mjs --strict --out=<out-dir>/chain-snapshot.json`
  and saves both `chain-reads.log` and `chain-snapshot.json`.
- Updated `scripts/create-indexer-proof-draft.mjs` to accept
  `--chain-snapshot=<path>` and include that artifact path in each
  `chainComparison.*.evidence` TODO without automatically setting
  `matches: true`.
- Updated `docs/launch-evidence-command-map.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` so the
  indexer collector command includes `--epochs=<list>` and documents
  `data/proof-runs/indexer-<stamp>/chain-snapshot.json`.
- Verified `node --check` for the indexer collector and draft helper.
- Verified `npm.cmd run proof:indexer:collect -- --print-plan ...`; it shows
  the chain command, chain log, and chain snapshot without running network
  checks.
- Verified `npm.cmd run proof:launch-docs`,
  `npm.cmd run proof:collector-redaction`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Restore Health URL Audit

- Strengthened `scripts/verify-db-restore.mjs` so `docs/restore-proof.json`
  must include `restoredStagingHealth.url` and it must be a HTTPS URL.
- Updated `scripts/create-restore-proof-draft.mjs` to parse the restored
  staging `health:prod` `base=<url>` line into `restoredStagingHealth.url`.
- Updated `docs/launch-proof-manifest-templates.md` and
  `docs/production-runbook.md` so restore proof records the restored staging
  health URL, not only runtime/data-sync booleans.
- Verified `node --check` for the restore validator and draft helper.
- Verified `npm.cmd run proof:restore -- --strict`; it still fails as expected
  without source DB, outside-repo dirs, and final restore proof manifest.
- Verified a synthetic restore manifest missing `restoredStagingHealth.url`;
  strict proof rejects it with `restoredStagingHealth.url must be a HTTPS URL`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:collector-redaction`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Monitoring Data-Sync URL Audit

- Strengthened `scripts/check-monitoring-proof.mjs` so the `data-sync`
  monitor must record a HTTPS URL on the monitoring proof `origin` and the path
  must be `/api/health/data-sync`.
- Updated `scripts/create-monitoring-proof-draft.mjs` so monitoring drafts
  fill `health-prod.url` with the origin and `data-sync.url` with
  `<origin>/api/health/data-sync` when an HTTPS origin is known.
- Updated `docs/launch-proof-manifest-templates.md` and
  `docs/production-runbook.md` so G11 monitoring proof explicitly records the
  data-sync monitor URL on the same final origin.
- Verified `node --check` for the monitoring validator and draft helper.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified a synthetic monitoring manifest where `data-sync.url` points to a
  different origin; strict proof rejects it with
  `data-sync monitor URL must match monitoring proof origin`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 QA Privy Origin Binding Audit

- Strengthened `scripts/check-qa-proof.mjs` so
  `wallet.privyAllowedOrigins.origin` must match the configured production
  origin from `NEXT_PUBLIC_SITE_URL`, `PUBLIC_SITE_URL`, or `SITE_URL` when one
  is present.
- Strengthened the same QA proof so `wallet.privyAllowedOrigins.checkedAt`
  must be an ISO-8601 UTC timestamp.
- Updated `docs/production-runbook.md` to state that the Privy origin recorded
  in `docs/qa-proof.json` must match the final `NEXT_PUBLIC_SITE_URL` and carry
  an ISO UTC check timestamp.
- Updated `docs/mainnet-status-board.md` so G12 explicitly requires the Privy
  origin check timestamp.
- Verified `node --check scripts/check-qa-proof.mjs`.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified a synthetic QA manifest where Privy allowed origin points to a
  different site; strict proof rejects it with
  `wallet.privyAllowedOrigins.origin must match configured production origin`.
- Verified a synthetic QA manifest where `wallet.privyAllowedOrigins.checkedAt`
  is `today`; strict proof rejects it with
  `wallet.privyAllowedOrigins.checkedAt must be ISO-8601 UTC`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Canary Chain ID Binding Audit

- Strengthened `scripts/analyze-live-canary-proof.mjs` so
  `docs/canary-proof.json` must include `targetNetwork.chainId`, and
  successful canary events must record the same `chainId` alongside matching
  network and contract address.
- Updated `scripts/create-canary-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new canary proof drafts/templates
  include `targetNetwork.chainId`.
- Updated `docs/production-runbook.md` to require matching `network`,
  `chainId`, and `contractAddress` in both the reviewed canary manifest and
  live JSONL.
- Verified `node --check` for the canary analyzer and draft helper.
- Verified a synthetic canary JSONL where an otherwise successful event reports
  the wrong chain id; strict proof rejects it with a target metadata mismatch.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Launch Docs PowerShell Command Audit

- Extended `scripts/check-launch-doc-command-syntax.mjs` to include
  `docs/launch-proof-manifest-templates.md`, so manifest-template verification
  commands are checked for PowerShell-safe env usage too.
- Replaced stale bash-style inline env commands in
  `docs/launch-proof-manifest-templates.md` for debug autominer smoke and
  canary proof verification.
- Updated `scripts/create-qa-canary-test-plan.mjs` so generated QA/canary plans
  use PowerShell `$env:` setup/cleanup for canary proof variables.
- Updated `scripts/create-qa-proof-draft.mjs` so the debug autominer smoke
  command recorded in QA drafts uses PowerShell `$env:` setup/cleanup.
- Updated the `health:prod` example in `docs/production-runbook.md` to use
  PowerShell env setup/cleanup instead of bash multiline env assignment.
- Verified `node --check` for the launch-doc syntax guard and changed QA
  draft/plan helpers.
- Verified `npm.cmd run proof:launch-docs`; it now checks
  `docs/launch-proof-manifest-templates.md` and passes.
- Verified a generated QA/canary plan in a temp file contains PowerShell env
  commands and no inline `VAR=value npm run` command.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Chain Proof RPC Chain Id Guard

- Strengthened `scripts/collect-chain-proof.mjs` so direct chain proof now reads
  the RPC-reported chain id, compares it with the expected Linea network chain
  id, prints both values, and writes both into `chain-snapshot.json`.
- Updated `docs/mainnet-readiness-checklist.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` so G4 chain
  proof requires expected/RPC chain id match evidence.
- Verified `node --check scripts/collect-chain-proof.mjs`.
- Verified `npm.cmd run proof:chain -- --strict`; it still fails as expected
  without final contract env.
- Verified `npm.cmd run proof:readiness`,
  `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.

## 2026-06-28 Sign-Off Network Chain Id Manifest Guard

- Strengthened `scripts/check-signoff-proof.mjs` so `docs/signoff-proof.json`
  must record `contractEnv.network` and `contractEnv.chainId`, with chain id
  matching the recorded Linea network and configured env values when present.
- Updated `scripts/create-signoff-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new sign-off drafts include
  the target network and chain id fields.
- Updated `docs/mainnet-readiness-checklist.md` and
  `docs/mainnet-status-board.md` so G1 explicitly covers final network and
  chain id, not only addresses/deploy block.
- Verified `node --check` for the sign-off validator and draft helper.
- Verified `npm.cmd run proof:signoff -- --strict`; it still fails as
  expected without final `docs/signoff-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-docs`,
  `npm.cmd run proof:local`, and `npm.cmd run proof:launch -- --strict`.
- Strengthened `scripts/collect-mainnet-proof.mjs` so the mainnet env proof
  prints a computed `target chain id` gate; it passes only when both public and
  server network env resolve to mainnet and records `59144` as launch evidence.
- Verified `node --check scripts/collect-mainnet-proof.mjs` and
  `npm.cmd run proof:mainnet -- --strict`; it still fails as expected without
  final production env.

## 2026-06-28 Host Proof Distinct Process Command Guard

- Strengthened `scripts/check-host-proof.mjs` so `docs/host-proof.json` must
  record a real `command` for each of `lore-site`, `lore-bot`, and
  `lore-indexer`.
- The host proof now rejects duplicated normalized commands across those three
  launch processes, so a single mixed process cannot satisfy the split-process
  mainnet gate by manifest wording alone.
- Updated `scripts/create-host-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new host drafts/templates ask
  for the exact supervised command per process.
- Updated `docs/mainnet-readiness-checklist.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` to state
  the split-process requirement as distinct supervised commands.
- Verified `node --check` for the host validator and draft helper.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without final `docs/host-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:readiness`, `npm.cmd run proof:local`, and
  `npm.cmd run proof:launch -- --strict`.

## 2026-06-28 Indexer Chain Snapshot Manifest Guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so `docs/indexer-proof.json`
  must include a `chainSnapshot` section with the direct chain snapshot path,
  expected chain id, RPC-reported chain id, RPC chain id match flag, contract
  address, and contract address match flag.
- The indexer proof now rejects manifests where the direct chain snapshot
  points at the wrong Linea chain id or does not match the configured contract
  address, instead of accepting comparison evidence as free text only.
- Updated `scripts/create-indexer-proof-draft.mjs` so drafts read
  `chain-snapshot.json` and prefill the new snapshot fields when the collector
  supplies `--chain-snapshot`.
- Updated `docs/launch-proof-manifest-templates.md`,
  `docs/mainnet-readiness-checklist.md`, `docs/mainnet-status-board.md`, and
  `docs/production-runbook.md` to require matching chain snapshot RPC/contract
  proof for the indexer dry-run gate.
- Verified `node --check` for the indexer validator and draft helper.
- Verified `npm.cmd run proof:indexer -- --strict`; it still fails as expected
  without final DB/env/manifest.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:readiness`, `npm.cmd run proof:local`, and
  `npm.cmd run proof:launch -- --strict`.

## 2026-06-28 Restore Drill Path Isolation Guard

- Strengthened `scripts/verify-db-restore.mjs` so restore proof rejects backup
  and restore directories that resolve to the same path.
- The restore proof now also rejects source DB paths that live inside the
  backup directory or the restore drill directory, preventing a circular or
  self-contained drill from satisfying G10.
- Added `backupRestoreDirsDistinct` and
  `sourceDbOutsideBackupRestoreDirs` to restore proof drafts/templates.
- Updated `docs/mainnet-readiness-checklist.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` to require
  isolated source, backup, and restore paths.
- Verified `node --check` for the restore validator and draft helper.
- Verified `npm.cmd run proof:restore -- --strict`; it still fails as expected
  without final source/outside dirs/manifest.
- Verified `npm.cmd run proof:templates`, fixed a restore draft helper
  regression, then verified `npm.cmd run proof:drafts`.
- Verified a synthetic strict restore run with identical backup/restore dirs is
  rejected with `backup dir and restore dir must be different`.
- Verified `npm.cmd run proof:local` and
  `npm.cmd run proof:launch -- --strict`.

## 2026-06-28 Monitoring Data-Sync Source Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so `data-sync`,
  `stale-indexer-heartbeat`, and `indexer-lag` monitors must record an HTTPS
  URL on the final proof origin targeting `/api/health/data-sync`.
- Updated `scripts/create-monitoring-proof-draft.mjs` so monitoring drafts
  prefill that endpoint for data-sync, stale heartbeat, and indexer lag
  monitors when an HTTPS origin is supplied.
- Updated `docs/launch-proof-manifest-templates.md`,
  `docs/mainnet-readiness-checklist.md`, `docs/mainnet-status-board.md`, and
  `docs/production-runbook.md` so G11 explicitly requires stale/lag alerts to
  target the production data-sync health endpoint.
- Verified `node --check` for the monitoring validator and draft helper.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without final `docs/monitoring-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:readiness`, `npm.cmd run proof:local`, and
  `npm.cmd run proof:launch -- --strict`.

## 2026-06-28 QA Target Chain Id Guard

- Strengthened `scripts/check-qa-proof.mjs` so `docs/qa-proof.json` must
  record `targetChainId`, and that value must match configured Linea chain id
  or the known chain id for the recorded target network.
- Clean-wallet first transaction evidence must now include a positive
  `chainId` matching `targetChainId`, in addition to a real non-zero tx hash.
- Wrong-network QA evidence must now include `targetChainId` and
  `testedChainId`; the tested chain id must differ from the target chain id
  and the unsupported-chain warning must be visible.
- Updated `scripts/create-qa-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new QA drafts/templates include
  target/wrong-network/clean-wallet chain id fields.
- Updated `docs/mainnet-readiness-checklist.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` so G12
  explicitly requires target/tested chain id evidence.
- Verified `node --check` for the QA validator and draft helper.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without final `docs/qa-proof.json`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:readiness`, `npm.cmd run proof:local`, and
  `npm.cmd run proof:launch -- --strict`.

## 2026-06-28 Canary Auto-Miner Session Guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so strict canary proof
  now fails when the JSONL contains no successful canary bet from a role whose
  name includes `AUTOMINER`.
- Added an `autoMinerSession` section to `docs/canary-proof.json` validation;
  it must include a verified/pass status, `targetRpcConfirmed: true`, positive
  `rounds`, positive `uniqueEpochs`, and real evidence.
- Updated `scripts/create-canary-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so canary drafts/templates include
  the auto-miner session proof section.
- Updated `docs/mainnet-readiness-checklist.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` so G13
  explicitly requires successful auto-miner canary rounds on the target RPC.
- Verified `node --check` for the canary validator and draft helper.
- Verified `npm.cmd run proof:canary -- --strict`; it still fails as expected
  without a canary JSONL path.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`,
  `npm.cmd run proof:readiness`, `npm.cmd run proof:local`, and
  `npm.cmd run proof:launch -- --strict`.

## 2026-06-28 Launch Docs Shell Fence Guard Audit

- Strengthened `scripts/check-launch-doc-command-syntax.mjs` so it rejects
  bare `VAR=value` assignments inside shell-style fenced code blocks, not only
  inline `VAR=value npm run ...` commands.
- Added `--extra-doc=<path>` support to the syntax guard for targeted synthetic
  checks without editing the checked launch docs.
- Updated `docs/mainnet-status-board.md` to describe the broader
  bash-style-env guard.
- Verified `node --check scripts/check-launch-doc-command-syntax.mjs`.
- Verified `npm.cmd run proof:launch-docs`; all checked launch docs pass.
- Verified a synthetic shell fenced block containing multiline
  `PROD_HEALTH_BASE_URL=... \` is rejected by the syntax guard.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-27 Restore Drill Path Manifest Audit

- Strengthened `scripts/verify-db-restore.mjs` so `docs/restore-proof.json`
  must record `restoreDrill.sourceDbPath`, `restoreDrill.backupDir`, and
  `restoreDrill.restoreDir`, and those paths must be absolute, outside the repo
  checkout, and match the restore command paths used for strict proof.
- Updated `scripts/create-restore-proof-draft.mjs`,
  `scripts/collect-restore-evidence.mjs`, and
  `docs/launch-proof-manifest-templates.md` so new restore drafts preserve the
  source/backup/restore paths needed for later audit.
- Updated `docs/production-runbook.md` to require recording source DB, backup
  directory, and restore directory in `docs/restore-proof.json`.
- Verified `node --check` for restore validator, draft helper, and collector.
- Verified `npm.cmd run proof:restore -- --strict`; it still fails as expected
  without source DB, outside-repo dirs, and final restore proof manifest.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`; restore
  templates/drafts are still rejected by strict validators with the new path
  requirements.
- Verified a synthetic restore manifest with mismatched `sourceDbPath`; strict
  proof rejects it with `restoreDrill.sourceDbPath must match the restore
  command path`.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-27 Indexer Deploy Block Manifest Audit

- Strengthened `scripts/check-indexer-dry-run.mjs` so
  `docs/indexer-proof.json` must record `dryRun.startBlock`,
  `dryRun.deployBlock`, and `finality.finalityBlocks`, with values matching
  `INDEXER_START_BLOCK`, `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK`, and
  `INDEXER_FINALITY_BLOCKS` when strict launch proof runs.
- Updated `scripts/create-indexer-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new indexer proof drafts include
  those deploy/start/finality values for later audit.
- Updated `docs/production-runbook.md` to require recording start block,
  deploy block, and finality blocks in `docs/indexer-proof.json`.
- Verified `node --check` for the indexer validator and draft helper.
- Verified `npm.cmd run proof:indexer -- --strict`; it still fails as expected
  without DB/env/final manifest.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`; the
  updated indexer template/draft are still rejected by strict validators.
- Verified a synthetic indexer manifest with mismatched `startBlock` and
  `deployBlock`; strict proof rejects it with manifest/env mismatch issues.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-27 Host Persistent DB Path Validation

- Strengthened `scripts/check-host-proof.mjs` so `persistentDb.path` in
  `docs/host-proof.json` must be an absolute path outside the repo checkout,
  not only accompanied by `persistentDb.absolutePathOutsideRepo: true`.
- Verified `node --check scripts/check-host-proof.mjs`.
- Verified `npm.cmd run proof:host -- --strict`; it still fails as expected
  without `docs/host-proof.json`.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`; host
  templates/drafts are still rejected by strict validators.
- Verified a synthetic host manifest with `persistentDb.path:
  data/lore.sqlite`; strict host proof rejects it with both `persistentDb.path
  must be absolute` and `persistentDb.path must be outside the repo checkout`.
- Verified `npm.cmd run proof:local`; L1-L9 local launch proof preflight passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Host Load Canary Guard

- Strengthened `scripts/check-host-proof.mjs` so `loadHttp.url` must be a HTTPS
  staging/canary URL and must not match the final production `origin`.
- Added `loadHttp.hostType` validation; accepted values are `staging` and
  `canary`.
- Updated `scripts/create-host-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new host proof drafts/templates
  include `loadHttp.hostType`.
- Updated `docs/mainnet-readiness-checklist.md`,
  `docs/mainnet-status-board.md`, and `docs/production-runbook.md` so
  `load:http` is documented as a staging/canary proof, not a final production
  origin stress test.
- Added a regression guard in `scripts/test-business-logic.mjs` that runs
  `scripts/check-host-proof.mjs` against synthetic host manifests and verifies
  that canary load evidence passes while final-origin load evidence is rejected.
- Added node-only `scripts/check-host-proof-load-target.mjs`, exposed it as
  `npm.cmd run proof:host-guard`, and wired it into `npm.cmd run proof:local`
  as L10 plus `npm.cmd run proof:launch` as a LOCAL guard.
- Updated `docs/launch-evidence-command-map.md` and
  `docs/mainnet-status-board.md` so launch docs list the L10 host load target
  guard.
- Verified `node --check scripts/check-host-proof.mjs`,
  `node --check scripts/create-host-proof-draft.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `node --check scripts/check-host-proof-load-target.mjs`,
  `node --check scripts/run-local-proof-preflight.mjs`, and
  `node --check scripts/run-launch-proof.mjs`.
- Verified `npm.cmd run proof:host-guard`; host load target guard passes.
- Verified a direct synthetic host proof run; `canary.playlore.xyz` load
  evidence passes and `playlore.xyz` load evidence fails with
  `loadHttp.url must not be the final production origin`.
- `npm.cmd run test:logic` could not run in this workspace because
  `node_modules` is absent and `tsx` is not available.
- Verified `npm.cmd run proof:launch-map`; command map is consistent.
- Verified `npm.cmd run proof:launch-docs`; launch docs command syntax remains
  PowerShell-safe.
- Verified `npm.cmd run proof:readiness`; checklist structure passes.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence:
  mainnet env, sign-off manifest, contract address/chain reads, host proof,
  indexer DB/env/manifest, restore proof, monitoring proof, QA proof, and
  canary JSONL.

## 2026-06-28 Restore Staging Host Type Guard

- Strengthened `scripts/verify-db-restore.mjs` so `docs/restore-proof.json`
  must record `restoredStagingHealth.hostType` as `staging` or `canary`.
- Updated `scripts/create-restore-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so new restore proof drafts and
  templates include `restoredStagingHealth.hostType`.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  the restore drill evidence is explicitly restored staging/canary health
  evidence, not an ambiguous production health check.
- Verified `node --check scripts/verify-db-restore.mjs` and
  `node --check scripts/create-restore-proof-draft.mjs`.
- Verified `npm.cmd run proof:restore -- --strict`; it still fails as expected
  without source DB, outside-repo dirs, and final restore proof manifest.
- Verified a synthetic restore manifest without
  `restoredStagingHealth.hostType`; strict restore proof rejects it with
  `restoredStagingHealth.hostType must be staging or canary`.
- Verified `npm.cmd run proof:templates` and `npm.cmd run proof:drafts`; restore
  templates/drafts are still rejected by strict validators with the new
  host-type requirement.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Monitoring ISO Timestamp Guard

- Strengthened `scripts/check-monitoring-proof.mjs` so monitor alert tests must
  record ISO-8601 UTC timestamps, not arbitrary text.
- Alert targets now need a verified target plus an ISO-8601 UTC test timestamp.
- Error tracking proof now needs an ISO-8601 UTC `testEventAt` timestamp, even
  when `testEventStatus` is pass/ok.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G11 monitoring evidence explicitly requires ISO UTC timestamps for fired
  alerts and the error-tracking test event.
- Verified `node --check scripts/check-monitoring-proof.mjs`.
- Verified `npm.cmd run proof:monitoring -- --strict`; it still fails as
  expected without `docs/monitoring-proof.json`.
- Verified a synthetic monitoring manifest: valid ISO timestamps pass, while
  `tested today`/`done`/`not-iso` are rejected with monitor, alert-target, and
  error-tracking timestamp errors.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 QA Browser Smoke Origin Guard

- Strengthened `scripts/check-qa-proof.mjs` so
  `finalQa.browserSmokeDebugAutominer.origin` must be the exact HTTPS
  production origin, and must match `NEXT_PUBLIC_SITE_URL`/configured
  production origin when present.
- Updated `scripts/create-qa-proof-draft.mjs` and
  `docs/launch-proof-manifest-templates.md` so QA proof drafts/templates record
  the browser smoke origin.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  G14 final QA requires debug browser smoke against the exact production
  origin, not only a local smoke run.
- Verified `node --check scripts/check-qa-proof.mjs` and
  `node --check scripts/create-qa-proof-draft.mjs`.
- Verified `npm.cmd run proof:qa -- --strict`; it still fails as expected
  without `docs/qa-proof.json`.
- Verified a synthetic QA manifest: production-origin debug smoke passes, while
  `http://localhost:3000` smoke origin is rejected with
  `finalQa.browserSmokeDebugAutominer.origin must be the exact HTTPS production origin`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Canary Auto-Miner Count Guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so
  `docs/canary-proof.json` `autoMinerSession.rounds` and
  `autoMinerSession.uniqueEpochs` must match the observed successful
  auto-miner bet count and unique auto-miner epochs in the live JSONL.
- Added the successful auto-miner unique epoch count to the canary proof
  summary output.
- Updated `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so G13
  canary evidence records auto-miner rounds/unique epochs matching the live
  JSONL, not manually estimated values.
- Verified `node --check scripts/analyze-live-canary-proof.mjs`.
- Verified `npm.cmd run proof:canary -- --strict`; it still fails as expected
  without a live canary JSONL path.
- Verified a synthetic canary JSONL plus manifest: matching auto-miner counts
  pass, while manifest counts `3/3` against observed `2/2` are rejected with
  `autoMinerSession.rounds 3 != observed 2` and
  `autoMinerSession.uniqueEpochs 3 != observed 2`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Signoff ISO Timestamp Guard

- Strengthened `scripts/check-signoff-proof.mjs` so
  `contractEnv.checkedAt`, `ownership.checkedAt`, and `randomness.signedAt`
  must be ISO-8601 UTC timestamps.
- Updated `docs/production-runbook.md` and `docs/mainnet-status-board.md` so
  contract/funds sign-off evidence explicitly requires ISO UTC sign-off
  timestamps.
- Verified `node --check scripts/check-signoff-proof.mjs`.
- Verified `npm.cmd run proof:signoff -- --strict`; it still fails as expected
  without `docs/signoff-proof.json`.
- Verified a synthetic sign-off manifest: ISO timestamps pass, while
  `today`/`done`/`accepted` are rejected with contract env, ownership, and
  randomness timestamp errors.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-28 Indexer Checked Epochs Guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so every
  `docs/indexer-proof.json` `chainComparison.*` entry must include a non-empty
  `checkedEpochs` list.
- Updated `scripts/create-indexer-proof-draft.mjs` to copy checked epoch ids
  from the collected chain snapshot into new indexer proof drafts.
- Updated `docs/launch-proof-manifest-templates.md`,
  `docs/production-runbook.md`, and `docs/mainnet-status-board.md` so G9
  direct chain comparison evidence records the concrete epoch ids that were
  checked.
- Verified `node --check scripts/check-indexer-dry-run.mjs` and
  `node --check scripts/create-indexer-proof-draft.mjs`.
- Verified `npm.cmd run proof:indexer -- --strict`; it still fails as expected
  without DB/env/final manifest.
- Verified a synthetic indexer manifest: non-empty `checkedEpochs` passes the
  new guard, while an empty `chainComparison.jackpot.checkedEpochs` is rejected
  with `chainComparison.jackpot.checkedEpochs must include at least one checked epoch`.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, and
  `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:local`; L1-L10 local launch proof preflight
  passes.
- Verified `npm.cmd run proof:launch -- --strict`; LOCAL guards pass and the
  command still fails as expected on missing external G1-G14 evidence.

## 2026-06-29 Launch Proof Layer Recovery

- Restored NUL-corrupted launch proof files: readiness/status/runbook/current-state/proof-record docs, command map, monitoring plan, canary draft generator, draft guards, evidence collectors, and collector redaction guard.
- Kept all G1-G14 launch gates `Missing`; no external mainnet evidence was invented or marked complete.
- Added/verified collector redaction coverage for env-style secrets, RPC URL args, database URL args, private key args, and webhook URL args.
- Verified `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:readiness`.
- Verified `npm.cmd run proof:gates -- --structure-only`.
- Verified `npm.cmd run proof:launch-map`.
- Verified `npm.cmd run proof:drafts`.
- Verified `npm.cmd run proof:drafts:create -- --out-dir=$env:TEMP\lore-proof-draft-bundle-final`.
- Verified `npm.cmd run proof:collector-redaction`.
- Verified `npm.cmd run proof:remaining`; it reports G1-G14 still require external evidence.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight passes.

## 2026-06-29 Collector Final-Proof Guard

- Hardened signoff/host/indexer/restore evidence collectors so incomplete collector output defaults to `docs/*-proof.draft.json`.
- Added a fail-fast guard that rejects direct writes to final `docs/*-proof.json` paths from these incomplete collectors.
- Updated launch command map, production runbook, readiness checklist, and status board to show collector draft outputs while keeping final proof files as the required launch evidence.
- Strengthened `proof:launch-map` so collector commands must include the `.draft.json` output paths.
- Verified all four collectors reject final proof output by default.
- Verified host collector writes a draft output to a temp file.
- Verified `npm.cmd run proof:collector-redaction`.
- Verified `npm.cmd run proof:launch-map`.
- Verified `npm.cmd run proof:launch-docs`.
- Verified `npm.cmd run proof:files`; final proof manifests are still missing/not yet collected.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight passes.

## 2026-06-29 QA Plan and Browser Automation Recovery

- Scanned `docs` and `scripts` for remaining NUL-leading files and found `docs/browser_automation.md` plus `scripts/create-qa-canary-test-plan.mjs`.
- Restored `scripts/create-qa-canary-test-plan.mjs` with final HTTPS origin, network, and chain-id validation.
- Restored `docs/browser_automation.md` as compact hard rules for browser automation, wallet QA, smoke tests, redaction, and long-run summaries.
- Verified QA plan rejects `http://localhost:3000` for launch QA evidence.
- Verified QA plan generates for `https://playlore.xyz` / `linea-mainnet` and includes Wallet QA, Failure-State UX, Support/Audit Visibility, and Final Launch QA sections.
- Verified `npm.cmd run proof:launch-docs`.
- Verified a full docs/scripts NUL-leading scan reports no remaining damaged files.
- Verified `npm.cmd run proof:local`; L1-L11 local launch proof preflight passes.
- Verified `npm.cmd run proof:drafts:create -- --out-dir=$env:TEMP\lore-proof-draft-bundle-qa-plan-recovery`.

## 2026-07-02 - launch gate runner alignment

- Aligned `scripts/run-launch-proof.mjs` gate IDs/labels with the current G1-G14 ledger: G7 indexer, G8 restore, G9 monitoring, G10/G11 canary/tx recovery, and G12-G14 QA.
- Strengthened `scripts/check-launch-gates.mjs` so `docs/mainnet-proof-record.md` and `docs/mainnet-status-board.md` must also agree on gate names, not only IDs/statuses.
- Cleaned literal `` `r`n `` artifacts from `docs/current_state.md`.
- Verified `node --check` for changed scripts, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.
- External launch evidence remains missing for G1-G14; local tooling only confirms the proof framework is consistent.
- Verified `npm.cmd run proof:launch -- --strict` as expected-fail: LOCAL rows pass, external G1-G14 remain missing, and runner output now uses the corrected G7/G8/G9/G10-G11 labels.

## 2026-07-02 - compact remaining-evidence summary

- Added `--json` mode to `scripts/report-launch-remaining.mjs` so long launch sessions can read the next missing G1-G14 gate without parsing markdown tables.
- Documented `npm.cmd run proof:remaining -- --json` in `docs/launch-evidence-command-map.md`.
- Verified `node --check scripts/report-launch-remaining.mjs`, `npm.cmd run proof:remaining`, `node scripts/report-launch-remaining.mjs --json`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- JSON summary confirms all G1-G14 external evidence remains missing; next gate is G1 final contract/env/funds safety.

## 2026-07-02 - restore proof host type alignment

- Fixed restore proof mismatch: documented `proof:restore:collect -- --restored-host-type=restore` now matches `scripts/verify-db-restore.mjs` strict validation.
- `scripts/verify-db-restore.mjs` accepts restored health `hostType` values `staging`, `canary`, or `restore`; production remains rejected by the collector flow.
- Updated restore draft/template wording for staging/canary/restore restored health.
- Hardened `scripts/check-proof-templates.mjs` to parse fenced JSON blocks with LF or CRLF line endings, avoiding false failures after Windows doc edits.
- Verified `node --check` for restore/template scripts, `npm.cmd run proof:templates`, synthetic restore manifest with `hostType=restore`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.

## 2026-07-02 - G1 env snapshot first step

- Aligned G1 operator docs so final contract/env safety starts with `npm.cmd run proof:mainnet -- --strict`, then carries that redacted env log into `proof:signoff:draft -- --env-log=<proof-mainnet-log>`.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-readiness-checklist.md`, and `docs/launch-evidence-command-map.md` so `proof:remaining -- --json` reports the correct next G1 first check.
- Strengthened `scripts/check-readiness-checklist.mjs` so the checklist must keep `proof:mainnet -- --strict`.
- Verified `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:gates -- --structure-only`, `node scripts/report-launch-remaining.mjs --json`, and `npm.cmd run proof:local`.

## 2026-07-02 - production health non-local origin guard

- Strengthened `scripts/check-production-health.mjs` so `health:prod` rejects local/non-HTTPS origins unless `PROD_HEALTH_ALLOW_LOCAL=1` is explicitly set for local smoke checks.
- Added a source-level assertion in `scripts/test-business-logic.mjs` so the localhost guard cannot disappear silently.
- Updated `docs/production-runbook.md` to state that local health checks cannot satisfy G6 production evidence.
- Verified `node --check scripts/check-production-health.mjs`, `node --check scripts/test-business-logic.mjs`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.
- Runtime behavior checks for `health:prod` and `npm.cmd run test:logic` are currently blocked by missing local dependencies (`dotenv`/`viem`) in this workspace, not by the guard change.

## 2026-07-02 - load:http non-local target guard

- Strengthened `scripts/load-http.mjs` so launch load evidence rejects local/non-HTTPS targets unless `LOAD_ALLOW_LOCAL=1` is explicitly set for local smoke checks.
- Added a source-level assertion in `scripts/test-business-logic.mjs` so the local-target guard cannot disappear silently.
- Updated `docs/production-runbook.md` to state that local `load:http` cannot satisfy G6 production evidence.
- Verified `node --check scripts/load-http.mjs`, `node --check scripts/test-business-logic.mjs`, localhost rejection behavior, `npm.cmd run proof:host-guard`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.
- Full `npm.cmd run test:logic` remains blocked by missing local `viem` dependency in this workspace.

## 2026-07-02 - G7 real indexer dry-run first step

- Aligned G7 operator docs so the first check is the real `npm.cmd run indexer:once` fresh DB dry-run, not only `proof:indexer:collect` draft creation.
- Updated `docs/mainnet-status-board.md`, `docs/mainnet-readiness-checklist.md`, `docs/production-runbook.md`, and `docs/launch-evidence-command-map.md` to show `indexer:once` before indexer proof collection.
- Strengthened `scripts/check-readiness-checklist.mjs` and `scripts/check-launch-command-map.mjs` so `indexer:once` stays visible in launch docs.
- Verified `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:local`, `npm.cmd run proof:indexer -- --strict` as expected-fail, and `node scripts/report-launch-remaining.mjs --json` showing G7 firstCheck=`npm.cmd run indexer:once`.

## 2026-07-02 - G8 external restore artifact guard

- Strengthened `scripts/collect-restore-evidence.mjs` so `--backup` must be an absolute existing file outside the repo checkout.
- Updated restore evidence docs to use `<absolute-backup-file-outside-repo>`.
- Updated `scripts/check-proof-collector-redaction.mjs` so restore redaction testing uses a synthetic external temp backup file.
- Verified `node --check` for restore collector/redaction guard, `npm.cmd run proof:collector-redaction`, restore collector accepting a temp external backup, restore collector rejecting repo-local `package.json`, `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:gates -- --structure-only`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:restore -- --strict` as expected-fail until real external source/backup/restore dirs and `docs/restore-proof.json` are collected.

## 2026-07-02 - G9 recovery alert evidence guard

- Strengthened `scripts/check-monitoring-proof.mjs` so every required monitor must include recovery/resolution evidence and an ISO-8601 UTC recovery/resolution timestamp, not only a fired alert.
- Updated `scripts/create-monitoring-proof-draft.mjs` to include `recoveryLink` and `lastRecoveryAt` TODO fields for each monitor.
- Updated `docs/mainnet-readiness-checklist.md` so G9 explicitly requires fired and recovery/resolution evidence.
- Verified `node --check` for monitoring validator/draft generator.
- Verified synthetic strict monitoring proof without recovery fails on the new guard.
- Verified synthetic strict monitoring proof with recovery passes.

## 2026-07-02 - G6 production host type guard

- Strengthened `scripts/check-host-proof.mjs` so strict launch host proof requires top-level `hostType=production`.
- Updated `scripts/create-host-proof-draft.mjs` and `docs/launch-proof-manifest-templates.md` to include top-level `hostType`.
- Updated `scripts/check-host-proof-load-target.mjs` self-test fixture so production host proof still uses canary/staging `loadHttp.hostType` while top-level host proof remains production.
- Verified synthetic production host proof passes strict validation and synthetic canary host proof fails with `hostType must be production for launch host proof`.
- Verified `npm.cmd run proof:host-guard`, `npm.cmd run proof:templates`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:host -- --strict` as expected-fail until real `docs/host-proof.json` is collected.

## 2026-07-02 - G1 mainnet-only signoff guard

- Strengthened `scripts/check-signoff-proof.mjs` so strict launch sign-off proof requires `contractEnv.network=mainnet` and `contractEnv.chainId=59144`.
- Verified synthetic mainnet signoff proof passes strict validation.
- Verified synthetic Sepolia signoff proof fails with mainnet/59144 launch guard errors.
- Verified `node --check scripts/check-signoff-proof.mjs`, `npm.cmd run proof:templates`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:signoff -- --strict` as expected-fail until real `docs/signoff-proof.json` is collected.

## 2026-07-02 - G7 mainnet chain snapshot guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so strict indexer launch proof requires `chainSnapshot.expectedChainId=59144` and `chainSnapshot.rpcChainId=59144`.
- Verified synthetic mainnet indexer manifest does not produce chain-id errors, while still failing as expected without real DB/env proof.
- Verified synthetic Sepolia indexer manifest fails with Linea mainnet chain-id guard errors.
- Verified `node --check scripts/check-indexer-dry-run.mjs`, `npm.cmd run proof:templates`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
- Verified `npm.cmd run proof:indexer -- --strict` as expected-fail until real external `LORE_DB_PATH`, env, and `docs/indexer-proof.json` are collected.

## 2026-07-02 - G10/G11 mainnet canary guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so canary launch proof requires mainnet target metadata and `chainId=59144` even when env is not set.
- Strengthened `scripts/create-canary-proof-draft.mjs` so draft generation rejects Sepolia/testnet and raw wrong chain IDs, while accepting mainnet aliases like `linea-mainnet`.
- Verified `linea-mainnet` draft generation succeeds and `linea-sepolia` draft generation fails.
- Verified synthetic mainnet canary proof only fails for short canary evidence, while synthetic Sepolia canary proof also fails with mainnet/59144 guard errors.
- Verified `node --check` for canary scripts, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.

## 2026-07-02 - G12-G14 mainnet QA guard

- Strengthened `scripts/check-qa-proof.mjs` so wallet/UX/final QA launch proof requires mainnet target metadata and `targetChainId=59144` even when env is not set.
- Strengthened `scripts/create-qa-proof-draft.mjs` so draft generation rejects Sepolia/testnet and wrong chain IDs, while accepting mainnet aliases like `linea-mainnet`.
- Verified `linea-mainnet` QA draft generation succeeds and `linea-sepolia` QA draft generation fails.
- Verified synthetic complete mainnet QA proof passes strict validation and synthetic complete Sepolia QA proof fails with mainnet/59144 guard errors.
- Verified `node --check` for QA scripts, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.

## 2026-07-02 - launch proof template alignment

- Updated `docs/launch-proof-manifest-templates.md` so monitoring examples include `recoveryLink` and `lastRecoveryAt` for every required monitor.
- Updated QA examples to use `targetNetwork=linea-mainnet`, `targetChainId=59144`, and clean-wallet mainnet metadata.
- Updated canary examples to use `network=linea-mainnet`, `chainId=59144`, and 50 rounds/unique epochs to match the strict canary threshold.
- Verified `npm.cmd run proof:templates`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.

## 2026-07-02 - QA plan mainnet command alignment

- Strengthened `scripts/create-qa-canary-test-plan.mjs` so QA plan generation rejects Sepolia/testnet and non-59144 chain IDs for launch QA.
- Updated launch docs and command map so QA plan/draft and canary draft examples use `linea-mainnet` and `chain-id=59144` instead of generic network placeholders.
- Verified QA plan generation succeeds for `linea-mainnet` / `59144` and fails for `linea-sepolia` / `59141`.
- Verified `node --check scripts/create-qa-canary-test-plan.mjs`, `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:remaining -- --json`, and `npm.cmd run proof:local`.

## 2026-07-02 - canary log command alignment

- Updated G10/G11 launch docs so `proof:canary` examples include `data/live-test-runs/live-canary-YYYY.jsonl --strict` instead of the invalid `proof:canary -- --strict` form.
- Strengthened `scripts/check-launch-command-map.mjs` so the command map must show `proof:canary` with both a `.jsonl` log path and `--strict`.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:remaining -- --json`, and `npm.cmd run proof:local`.

## 2026-07-02 - proof file strict validator import

- Fixed `scripts/check-proof-files.mjs` so collected final proof JSON files can actually execute their strict validators via `spawnSync`.
- Verified `node --check scripts/check-proof-files.mjs` and exercised the final `docs/signoff-proof.json` path with a temporary synthetic file; the guard now reports strict signoff validation issues instead of failing before validation.

## 2026-07-02 - canary proof live-log guard

- Strengthened `scripts/check-proof-files.mjs` so a collected `docs/canary-proof.json` fails unless `--canary-log=<path>` or `PROOF_CANARY_LOG` is provided.
- Verified a temporary synthetic `docs/canary-proof.json` fails with the expected missing live JSONL message, then removed the temporary file.
- Verified `npm.cmd run proof:files` and `npm.cmd run proof:local` still pass when final proof files have not yet been collected.

## 2026-07-02 - complete gate artifact guard

- Strengthened `scripts/check-launch-gates.mjs` so any `Complete` launch gate must reference its expected final local proof JSON artifact.
- G10, G11, and G14 `Complete` evidence must also reference a local `data/live-test-runs/*.jsonl` canary log.
- Verified a temporary synthetic G1 `Complete` status fails when `docs/signoff-proof.json` is missing, then restored the ledger rows to `Missing`.
- Verified `node --check scripts/check-launch-gates.mjs`, `npm.cmd run proof:gates -- --structure-only`, and `npm.cmd run proof:local`.

## 2026-07-02 - collector helper final-output guard

- Fixed `scripts/collect-proof-common.mjs` so shared `writeJson()` imports the filesystem helpers it uses.
- Strengthened `refuseFinalProofOutput()` so collectors reject absolute paths that resolve to final `docs/*-proof.json` files, not only relative paths.
- Fixed `scripts/check-proof-collector-redaction.mjs` to import `spawnSync` and added a regression case for absolute final-proof output rejection.
- Verified host collector draft writing to `.tmp`, absolute final output rejection, `npm.cmd run proof:collector-redaction`, and `npm.cmd run proof:local`.

## 2026-07-02 - host collector launch guard

- Strengthened `scripts/collect-host-evidence.mjs` so launch host evidence collection only accepts `--host-type=production`.
- Added a collector guard requiring `--load-origin` to differ from the production `--origin`, keeping load evidence on staging/canary as required by G6.
- Verified positive production/canary plan output, negative staging host-type rejection, negative same-origin load rejection, `npm.cmd run proof:collector-redaction`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.

## 2026-07-02 - indexer collector mainnet metadata guard

- Strengthened `scripts/collect-indexer-evidence.mjs` so G7 evidence collection requires `--chain-id=59144`, `--deploy-block=<positive>`, and `--finality-blocks=<positive>` in addition to `--fresh-db=true` and `--epochs=<positive>`.
- Updated launch docs and `scripts/check-launch-command-map.mjs` so `proof:indexer:collect` examples require chain/deploy/finality metadata.
- Updated `scripts/check-proof-collector-redaction.mjs` indexer case for the new required args.
- Verified positive mainnet collector plan output, negative Sepolia chain-id rejection, negative missing finality rejection, `npm.cmd run proof:collector-redaction`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:local`.

## 2026-07-02 - restore collector external path guard

- Strengthened `scripts/collect-restore-evidence.mjs` so G8 evidence collection requires `--source`, `--backup-dir`, `--restore-dir`, and `--backup` to be absolute external paths, with the backup file inside the backup directory.
- Updated launch docs and `scripts/check-launch-command-map.mjs` so `proof:restore:collect` examples require source/backup/restore path metadata.
- Updated `scripts/check-proof-collector-redaction.mjs` restore case for the new required args.
- Verified positive restore collector plan output with temporary external paths, negative backup-outside-backup-dir rejection, `npm.cmd run proof:collector-redaction`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:local`.

## 2026-07-02 - monitoring draft final-output guard

- Strengthened `scripts/create-monitoring-proof-draft.mjs` so the G9 draft generator refuses direct writes to final `docs/monitoring-proof.json`.
- Added a regression case to `scripts/check-proof-drafts.mjs` proving monitoring final-output draft generation is rejected.
- Verified positive monitoring draft generation to a temp draft path, negative final-output rejection, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.

## 2026-07-02 - canary analyzer and draft final-output guard

- Fixed `scripts/analyze-live-canary-proof.mjs` so strict live-canary validation has the filesystem imports it uses.
- Strengthened `scripts/create-canary-proof-draft.mjs` so the G10/G11 draft generator refuses direct writes to final `docs/canary-proof.json`.
- Added a regression case to `scripts/check-proof-drafts.mjs` proving canary final-output draft generation is rejected.
- Verified positive canary draft generation to a temp draft path, negative final-output rejection, strict analyzer failure on an empty temp JSONL log, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.

## 2026-07-02 - QA draft final-output guard

- Strengthened `scripts/create-qa-proof-draft.mjs` so the G12-G14 draft generator refuses direct writes to final `docs/qa-proof.json`.
- Added a regression case to `scripts/check-proof-drafts.mjs` proving QA final-output draft generation is rejected.
- Verified positive QA draft generation to a temp draft path, negative final-output rejection, negative Sepolia/network rejection, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.

## 2026-07-02 - host draft final-output guard

- Strengthened `scripts/create-host-proof-draft.mjs` so the G5-G6 draft generator refuses direct writes to final `docs/host-proof.json`.
- Added a regression case to `scripts/check-proof-drafts.mjs` proving host final-output draft generation is rejected.
- Verified positive host draft generation to a temp draft path, negative final-output rejection, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check` for the touched proof/docs files.

## 2026-07-02 - core proof draft final-output guards

- Strengthened `scripts/create-signoff-proof-draft.mjs`, `scripts/create-indexer-proof-draft.mjs`, and `scripts/create-restore-proof-draft.mjs` so draft generators refuse direct writes to final `docs/signoff-proof.json`, `docs/indexer-proof.json`, and `docs/restore-proof.json`.
- Added regression cases to `scripts/check-proof-drafts.mjs` for signoff, indexer, and restore final-output rejection.
- Verified positive draft generation to temp paths, negative final-output rejection for all three, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and syntax checks for the touched proof scripts.

## 2026-07-02 - draft bundle non-proof guard

- Updated `scripts/create-all-proof-drafts.mjs` so successful bundle generation explicitly says draft files are not launch proof and can be promoted only after real external evidence and strict validation.
- Strengthened `scripts/check-proof-drafts.mjs` with a `draft-bundle` regression row that runs the bundle generator and verifies that warning.
- Verified `node --check` for the touched scripts, `npm.cmd run proof:drafts:create` to a temp `.tmp` directory, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check` for the touched scripts.

## 2026-07-02 - remaining report complete-artifact guard

- Strengthened `scripts/report-launch-remaining.mjs` so `Complete` gates are checked for required final proof artifacts, and G10/G11/G14 are checked for a referenced local canary JSONL log.
- Added `--board=<path>` and `--proof=<path>` inputs so the report can be tested against temporary synthetic status/proof tables without editing real launch docs.
- Verified current `npm.cmd run proof:remaining`, JSON output with `completeGateEvidenceIssues`, synthetic G1 Complete missing-artifact failure, `npm.cmd run proof:local`, and `git diff --check` for the touched script.

## 2026-07-03 - launch aggregator strict guard

- Strengthened `scripts/run-launch-proof.mjs` so `npm.cmd run proof:launch` fails unless `--strict` or `PROOF_STRICT=1` is used.
- Removed the clean-summary allowance for `launch gate(s) still require external evidence`, so the final launch aggregator treats remaining G1-G14 evidence as blocking.
- Verified `node --check scripts/run-launch-proof.mjs`, non-strict `npm.cmd run proof:launch` failure with the explicit strict-mode row, strict `npm.cmd run proof:launch -- --strict` failure on current missing evidence, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - production health finality evidence guard

- Strengthened `scripts/check-production-health.mjs` so production health fails when the data-sync payload lacks numeric finality-target lag evidence, and the summary now includes `finalityLagBlocks=`.
- Strengthened `scripts/create-host-proof-draft.mjs` so `healthProd.finalityLagChecked` is true only when the health log includes numeric `finalityLagBlocks`, not merely `effectiveLagBlocks` or `n/a`.
- Verified host draft parsing with synthetic health logs both without and with `finalityLagBlocks`, `node --check` for touched scripts, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - indexer finality health evidence guard

- Strengthened `scripts/create-indexer-proof-draft.mjs` so `finality.dataSyncHealthFinalityAware` is true only when the health log includes numeric `finalityLagBlocks`, not generic `dataSync` or `effectiveLagBlocks` output.
- Strengthened `scripts/check-indexer-dry-run.mjs` so strict G7 validation requires `finality.evidence` to include numeric `finalityLagBlocks` from `health:prod`.
- Verified indexer draft parsing with synthetic health logs both without and with `finalityLagBlocks`, synthetic strict validator failure without numeric `finalityLagBlocks`, `node --check`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - restore finality health evidence guard

- Strengthened `scripts/create-restore-proof-draft.mjs` so restored G8 health drafts set `finalityLagChecked` only when the restored `health:prod` log includes numeric `finalityLagBlocks`.
- Strengthened `scripts/verify-db-restore.mjs` so strict G8 validation requires `restoredStagingHealth.finalityLagChecked=true` and numeric `finalityLagBlocks` evidence.
- Updated restore proof template/status/checklist wording to require finality-aware restored health evidence.
- Verified `node --check` for touched restore scripts, synthetic strict restore validation without/with `finalityLagBlocks`, synthetic restore draft parsing, `npm.cmd run proof:drafts`, `npm.cmd run proof:templates`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - monitoring complete-entry evidence guard

- Strengthened `scripts/check-monitoring-proof.mjs` so each required G9 monitor kind must have one enabled monitor entry containing provider, condition/threshold, fired-alert evidence, recovery evidence, and ISO timestamps.
- This prevents weak proof where `enabled`, alert evidence, recovery evidence, and timestamps are spread across duplicate monitor entries for the same kind.
- Verified `node --check scripts/check-monitoring-proof.mjs`, synthetic full monitoring manifest pass, synthetic split-evidence manifest failure, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - canary auto-miner epoch and tx-hash guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so strict G10/G11 canary proof requires at least 50 successful auto-miner unique epochs, not just 50 successful bet epochs overall.
- Added strict rejection for successful bet events with missing/invalid tx hashes and for duplicate successful tx hashes in the live JSONL log.
- Verified `node --check scripts/analyze-live-canary-proof.mjs`, synthetic partial-auto-miner log failure, synthetic duplicate-tx-hash log failure, synthetic 50-auto-miner-epoch pass, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - QA concrete evidence guard

- Strengthened `scripts/check-qa-proof.mjs` so every required G12-G14 QA item must include concrete evidence: path, link, artifact, screenshot, log, report, or tx hash.
- Generic text-only QA notes can no longer satisfy wallet, failure-state UX, support/audit visibility, or final QA checks.
- Verified `node --check scripts/check-qa-proof.mjs`, synthetic generic-evidence manifest failure, synthetic concrete-evidence manifest pass, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - signoff concrete evidence guard

- Strengthened `scripts/check-signoff-proof.mjs` so G1-G4 signoff proof needs concrete evidence markers for contract/env, owner Safe/multisig, randomness sign-off, and every chainComparison row.
- Generic text-only evidence such as `checked` no longer closes contract/funds safety or chain reconciliation proof.
- Verified `node --check scripts/check-signoff-proof.mjs`, synthetic generic-evidence manifest failure, synthetic concrete-evidence manifest pass, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - host concrete evidence and finality guard

- Strengthened `scripts/check-host-proof.mjs` so G5-G6 host proof requires concrete supervisor, persistent DB, health:prod, and load:http evidence markers.
- Strict host proof now also requires health evidence to include numeric `finalityLagBlocks` from `health:prod`, not just `finalityLagChecked=true`.
- Updated the host load-target self-test fixture so local proof preflight covers the stricter host proof schema.
- Verified `node --check scripts/check-host-proof.mjs`, `node --check scripts/check-host-proof-load-target.mjs`, `node scripts/check-host-proof-load-target.mjs`, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - indexer concrete evidence guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so G7 strict proof requires concrete dry-run, finality, chain snapshot, and direct-chain comparison evidence markers.
- Generic text-only indexer evidence such as `checked` can no longer satisfy fresh DB or direct-chain comparison proof.
- Verified `node --check scripts/check-indexer-dry-run.mjs`, synthetic generic-evidence manifest failure, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - restore concrete evidence guard

- Strengthened `scripts/verify-db-restore.mjs` so G8 strict proof requires concrete backup schedule, restore drill, restored health, and indexer preservation evidence markers.
- Generic text-only restore evidence such as `checked` can no longer satisfy backup/restore drill or preservation proof.
- Verified `node --check scripts/verify-db-restore.mjs`, synthetic generic-evidence manifest failure, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - monitoring concrete evidence guard

- Strengthened `scripts/check-monitoring-proof.mjs` so G9 strict proof requires concrete monitor evidence, recovery/resolution evidence, alert target evidence, and error tracking test-event evidence.
- Generic text-only monitoring evidence such as `checked` can no longer satisfy fired-alert, recovery, alert target, or error tracking proof.
- Verified `node --check scripts/check-monitoring-proof.mjs`, synthetic generic-evidence manifest failure, synthetic concrete-evidence manifest pass, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - canary concrete evidence guard

- Strengthened `scripts/analyze-live-canary-proof.mjs` so G10-G11 strict proof requires concrete target network, recovery, auto-miner session, and transaction health evidence markers.
- Generic text-only canary evidence such as `checked` can no longer satisfy target/recovery/session proof; real tx hashes still count as concrete transaction evidence.
- Verified `node --check scripts/analyze-live-canary-proof.mjs`, synthetic generic-evidence manifest failure, synthetic concrete-evidence manifest pass, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - QA artifact-like evidence guard

- Strengthened `scripts/check-qa-proof.mjs` so G12-G14 strict proof requires artifact-like concrete evidence markers, not generic non-empty `checked` values in link/artifact/screenshot/log/report fields.
- Real tx hashes still satisfy transaction evidence for clean-wallet first transaction; screenshots/logs/reports/URLs/command output paths satisfy browser and UX evidence.
- Verified `node --check scripts/check-qa-proof.mjs`, synthetic generic-concrete-field manifest failure, synthetic artifact evidence manifest pass, `npm.cmd run proof:templates`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - launch docs concrete evidence wording

- Updated `docs/launch-proof-manifest-templates.md` so QA and canary placeholders ask for screenshot/log/report/path artifacts instead of generic QA/recovery notes.
- Updated `docs/production-runbook.md` and `docs/launch-evidence-command-map.md` to state that generic text such as `checked` is not launch proof.
- Verification target: `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:templates`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - remaining report concrete evidence guard

- Strengthened `scripts/report-launch-remaining.mjs` so any `Complete` launch gate must include a concrete proof marker, not only prose.
- Verified `node --check scripts/report-launch-remaining.mjs`, a synthetic prose-only `Complete` gate failure, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
- Current launch state remains unchanged: all G1-G14 gates still require external production/canary/mainnet evidence before mainnet launch.

## 2026-07-03 - host collector validator-shaped draft

- Updated `scripts/collect-host-evidence.mjs` so `npm.cmd run proof:host:collect` writes a `proof:host` validator-shaped draft with `processModel`, `persistentDb`, `healthProd`, and `loadHttp` sections.
- The generated draft still contains explicit TODO/false fields and strict host validation rejects it until real supervisor, persistent DB, health, and load evidence is filled.
- Verified `node --check scripts/collect-host-evidence.mjs`, generated `.tmp/host-proof.collector-draft.json`, strict negative validation of the incomplete draft, `npm.cmd run proof:host-guard`, `npm.cmd run proof:remaining`, `npm.cmd run proof:local`, and `git diff --check`.

## 2026-07-03 - host command map cleanup

- Removed the stale `proof:host:draft -- --origin=...` operator command from `docs/launch-evidence-command-map.md`.
- Host draft collection is now documented through `npm.cmd run proof:host:collect` with both production origin and distinct staging/canary load origin.
- Verified `npm.cmd run proof:launch-map` and `npm.cmd run proof:launch-docs`.

## 2026-07-03 - indexer collector validator-shaped draft

- Updated `scripts/collect-indexer-evidence.mjs` so `npm.cmd run proof:indexer:collect` writes a `proof:indexer` validator-shaped draft with `dryRun`, `finality`, `chainSnapshot`, and `chainComparison` sections.
- The generated draft pre-fills required CLI config but still keeps real status/evidence/comparison fields as TODO/false, and strict G7 validation rejects it until real DB/env/health/direct-chain evidence is filled.
- Verified `node --check scripts/collect-indexer-evidence.mjs`, generated `.tmp/indexer-proof.collector-draft.json`, and strict negative validation of the incomplete draft.

## 2026-07-03 - restore collector validator-shaped draft

- Updated `scripts/collect-restore-evidence.mjs` so `npm.cmd run proof:restore:collect` writes a `proof:restore` validator-shaped draft with `backupSchedule`, `restoreDrill`, `restoredStagingHealth`, and `indexerPreservation` sections.
- The generated draft preserves external path evidence from CLI args but keeps schedule, restored health, and preservation outcomes as TODO/false until real restore proof is filled.
- Verified `node --check scripts/collect-restore-evidence.mjs`, generated `.tmp/restore-proof.collector.json` from temp external paths, and strict negative validation of the incomplete draft.

## 2026-07-03 - signoff collector validator-shaped draft

- Updated `scripts/collect-signoff-evidence.mjs` so `npm.cmd run proof:signoff:collect` writes a `proof:signoff` validator-shaped draft with `contractEnv`, `ownership`, `randomness`, and `chainComparison` sections.
- The generated draft carries requested epochs/user context but keeps final env, Safe/multisig owner, randomness sign-off, and direct-chain comparisons as TODO/false until real G1-G4 evidence is filled.
- Verified `node --check scripts/collect-signoff-evidence.mjs`, generated `.tmp/signoff-proof.collector.json`, and strict negative validation of the incomplete draft.

## 2026-07-03 - collector draft regression guard

- Strengthened `scripts/check-proof-drafts.mjs` so `npm.cmd run proof:drafts` also exercises signoff, host, indexer, and restore collector-shaped drafts.
- The guard now verifies collector outputs contain the strict-validator sections and remain rejected while incomplete.
- Capped per-row evidence output to keep proof:drafts logs compact.
- Verified `node --check scripts/check-proof-drafts.mjs` and `npm.cmd run proof:drafts`.

## 2026-07-03 - signoff collector log-backed flow

- Updated `scripts/collect-signoff-evidence.mjs` so `npm.cmd run proof:signoff:collect` can ingest saved `proof:mainnet` and `proof:chain` outputs via `--env-log` and `--chain-log`.
- Updated `docs/launch-evidence-command-map.md`, `docs/mainnet-readiness-checklist.md`, and `scripts/check-launch-command-map.mjs` so the operator-facing G1-G4 flow uses one collector command instead of overwriting a previous signoff draft.
- Updated `scripts/check-proof-drafts.mjs` so the signoff collector regression case exercises the log-backed flow.
- Verified `node --check` for changed scripts, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:drafts`.

## 2026-07-03 - saved mainnet env proof artifact

- Added `--out=<path>` support to `scripts/collect-mainnet-proof.mjs`; it writes the same redacted mainnet env proof snapshot shown in the terminal.
- Updated the G1-G4 operator flow so `proof:mainnet -- --strict --out=docs/mainnet-env-proof.log` and `proof:chain -- --strict --out=docs/chain-proof-snapshot.json` feed `proof:signoff:collect` through `--env-log` and `--chain-log`.
- Updated `scripts/check-launch-command-map.mjs` to require the saved proof artifact arguments.
- Verified `node --check` for changed scripts, `npm.cmd run proof:mainnet -- --out=.tmp/mainnet-env-proof.log`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:drafts`.

## 2026-07-03 - status board saved artifact commands

- Updated `docs/mainnet-status-board.md` so G1 uses `npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log` and G4 uses `npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json`.
- Verified `npm.cmd run proof:remaining`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:gates -- --structure-only`.

## 2026-07-03 - host collector health/load logs

- Updated `scripts/collect-host-evidence.mjs` so `npm.cmd run proof:host:collect` accepts saved `health:prod` and `load:http` outputs through `--health-log` and `--load-log`.
- The collector now parses health/load summaries into the G6 `healthProd` and `loadHttp` sections while still requiring real supervisor and persistent DB evidence for G5.
- Updated launch docs and `scripts/check-launch-command-map.mjs` so the operator-facing G5/G6 command includes `docs/host-health-prod.log` and `docs/host-load-http.log` artifacts.
- Updated `scripts/check-proof-drafts.mjs` to cover the log-backed host collector path.
- Verified synthetic log-backed host collection, strict negative validation, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:drafts`.
## 2026-07-03 - indexer collector artifact-backed flow

- Updated `scripts/collect-indexer-evidence.mjs` so `npm.cmd run proof:indexer:collect` can ingest saved `indexer:once`, `health:prod`, and `proof:chain` artifacts via `--indexer-log`, `--health-log`, and `--chain-snapshot`.
- The collector now pre-fills dryRun, finality, and chainSnapshot sections from those artifacts while keeping direct-chain comparison matches explicit.
- Updated launch docs and `scripts/check-launch-command-map.mjs` so the G7 operator command includes `docs/indexer-once.log`, `docs/indexer-health-prod.log`, and `docs/chain-proof-snapshot.json`.
- Updated `scripts/check-proof-drafts.mjs` to cover the artifact-backed indexer collector path.
- Verified synthetic artifact-backed indexer collection, strict negative validation, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:drafts`.
## 2026-07-03 - restore collector artifact-backed flow

- Updated `scripts/collect-restore-evidence.mjs` so `npm.cmd run proof:restore:collect` can ingest saved restore drill and restored `health:prod` logs through `--restore-log` and `--health-log`.
- The collector now pre-fills `restoreDrill` status/summary and `restoredStagingHealth` from those artifacts while keeping backup schedule and indexer preservation evidence explicit.
- Updated launch docs and `scripts/check-launch-command-map.mjs` so the G8 operator command includes `docs/restore-drill.log` and `docs/restore-health-prod.log`.
- Updated `scripts/check-proof-drafts.mjs` to cover the artifact-backed restore collector path.
- Verified `node --check` for changed restore scripts, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:drafts`, `npm.cmd run proof:remaining`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - monitoring draft artifact-backed flow

- Updated `scripts/create-monitoring-proof-draft.mjs` so `npm.cmd run proof:monitoring:draft` can ingest saved fired-alert, recovery, alert-target, and error-event artifacts through `--monitor-artifact`, `--recovery-artifact`, `--alert-target-artifact`, and `--error-event-artifact`.
- The draft generator only pre-fills artifact evidence fields; it still leaves monitors disabled and TODO timestamps/conditions until real provider review is completed.
- Updated launch docs, monitoring test plan output, and `scripts/check-launch-command-map.mjs` so the G9 operator command names the expected redacted artifacts.
- Updated `scripts/check-proof-drafts.mjs` to cover the artifact-backed monitoring draft path.
- Verified `node --check` for changed monitoring scripts, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:drafts`, `npm.cmd run proof:remaining`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - canary draft artifact-backed flow

- Updated `scripts/create-canary-proof-draft.mjs` so `npm.cmd run proof:canary:draft` can ingest a real live JSONL log and redacted target/recovery/session/transaction artifacts through `--live-log`, `--target-artifact`, `--recovery-artifact`, `--session-artifact`, and `--tx-artifact`.
- The draft generator pre-fills observed auto-miner rounds, unique epochs, checkedAt, and successful tx hashes from the live log, but keeps recovery status, target RPC confirmation, and transaction safety booleans explicit.
- Updated launch docs, production runbook, readiness checklist, and `scripts/check-launch-command-map.mjs` so the G10-G11 operator command names the required canary artifacts.
- Updated `scripts/check-proof-drafts.mjs` to cover the artifact-backed canary draft path.
- Verified `node --check` for changed canary scripts, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:drafts`, `npm.cmd run proof:remaining`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - QA draft artifact-backed flow

- Updated `scripts/create-qa-proof-draft.mjs` so `npm.cmd run proof:qa:draft` can ingest wallet, failure-state, support/audit, final-browser, and debug-smoke artifacts plus a clean-wallet tx hash.
- The draft generator pre-fills evidence paths and the clean-wallet tx hash only; it still leaves statuses, booleans, timestamps, wrong-network data, and final QA confirmations explicit for real review.
- Updated launch docs, QA test plan output, production runbook, readiness checklist, and `scripts/check-launch-command-map.mjs` so the G12-G14 operator command names the required QA artifacts.
- Updated `scripts/check-proof-drafts.mjs` to cover the artifact-backed QA draft path.
- Verified `node --check` for changed QA scripts, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:drafts`, `npm.cmd run proof:remaining`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - launch command map stale draft cleanup

- Removed stale standalone `proof:signoff:draft`, `proof:indexer:draft`, and `proof:restore:draft` examples from `docs/launch-evidence-command-map.md`; those G1-G8 drafts now use collector commands with saved evidence artifacts.
- Updated monitoring and QA test plan generators so their suggested draft commands include the current artifact-backed arguments.
- Verified `node --check` for changed plan generators, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:drafts`, `npm.cmd run proof:remaining`, `npm.cmd run proof:local`, and `git diff --check`.
## 2026-07-03 - launch artifact command guard coverage

- Strengthened `scripts/check-launch-command-map.mjs` so `npm.cmd run proof:launch-map` now verifies artifact-backed evidence commands in `docs/production-runbook.md` and `docs/mainnet-readiness-checklist.md`, not only `docs/launch-evidence-command-map.md`.
- The guard now fails if host/indexer/restore/monitoring/QA/canary operator docs lose required saved artifact arguments.
## 2026-07-03 - proof draft bundle strict rejection guard

- Strengthened `scripts/check-proof-drafts.mjs` so the `draft-bundle` regression now runs the matching strict validator against every file produced by `scripts/create-all-proof-drafts.mjs`.
- `npm.cmd run proof:drafts` now fails if any starter bundle draft is accepted as launch proof.
## 2026-07-03 - status board required-proof guard

- Strengthened `scripts/check-launch-gates.mjs` so status-board `Required proof` cells must reference the expected final proof JSON for each G1-G14 row.
- G10/G11/G14 required proof now must explicitly mention a live canary log, preventing the launch tracker from losing the real-epoch evidence requirement.
- Updated `docs/mainnet-status-board.md` wording for G11 and G14.
- Verified `node --check scripts/check-launch-gates.mjs`, `npm.cmd run proof:gates -- --structure-only`, and `npm.cmd run proof:remaining`.
## 2026-07-03 - remaining report required-proof guard

- Strengthened `scripts/report-launch-remaining.mjs` so `npm.cmd run proof:remaining` now reports `required proof issues` separately from completed-gate evidence problems.
- The remaining report now fails if any status-board `Required proof` cell loses the expected final proof JSON, or if G10/G11/G14 stop mentioning live canary log evidence.
- Updated `scripts/run-local-proof-preflight.mjs` so L11 explicitly requires `proof:remaining` to report no inconsistent rows, no complete-gate evidence issues, and no required-proof issues.
- Verified `node --check scripts/report-launch-remaining.mjs`, `node --check scripts/run-local-proof-preflight.mjs`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-03 - proof record reference guard

- Strengthened `scripts/check-launch-gates.mjs` so non-complete proof-record rows must keep references to the expected final proof JSON, and G10/G11/G14 must mention live canary log evidence.
- Strengthened `scripts/report-launch-remaining.mjs` so `npm.cmd run proof:remaining` reports `proof record reference issues` separately and fails if the proof ledger loses those references.
- Updated `docs/mainnet-proof-record.md` placeholders for G10/G11/G14 to consistently mention live canary log evidence.
- Updated `scripts/run-local-proof-preflight.mjs` so L11 requires no proof-record reference issues.
- Verified `node --check` for changed proof scripts, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-03 - readiness checklist command coverage

- Strengthened `scripts/check-readiness-checklist.mjs` so readiness validation requires the saved direct-chain snapshot command, canary draft/strict commands, QA draft command, and monitoring draft command.
- Updated `docs/mainnet-readiness-checklist.md` to include the exact `npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json` command alongside the saved mainnet env proof command.
- Verified `node --check scripts/check-readiness-checklist.mjs`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:local`.
## 2026-07-03 - final proof files guard in operator flow

- Added explicit `npm.cmd run proof:files -- --canary-log=<canary-log-file>` before final `proof:launch` in `docs/production-runbook.md` and `docs/mainnet-readiness-checklist.md`.
- Strengthened `scripts/check-readiness-checklist.mjs` so readiness validation requires the final proof-files check.
- Strengthened `scripts/check-launch-command-map.mjs` so linked operator docs must keep the `proof:files -- --canary-log=` step.
- Verified `node --check scripts/check-readiness-checklist.mjs`, `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.
## 2026-07-03 - production runbook G1-G4 signoff flow

- Added a dedicated `Contract and funds safety` section to `docs/production-runbook.md` before production host/indexer steps.
- The runbook now explicitly runs `proof:mainnet -- --strict --out=docs/mainnet-env-proof.log`, `proof:chain -- --strict --out=docs/chain-proof-snapshot.json`, `proof:signoff:collect`, and strict `proof:signoff` for G1-G4.
- Strengthened `scripts/check-launch-command-map.mjs` so linked production runbook validation fails if those G1-G4 commands disappear.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
## 2026-07-03 - production runbook order guard

- Strengthened `scripts/check-launch-command-map.mjs` with an ordered marker check for `docs/production-runbook.md`.
- The guard now fails if the runbook stops showing the intended sequence: prepare evidence, G1-G4 signoff, production host, indexer/restore, monitoring, QA/canary, `proof:files`, final strict launch, then hold conditions.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.
## 2026-07-03 - readiness final proof manifest guard

- Added a `Final proof manifests` line to `docs/mainnet-readiness-checklist.md` listing signoff, host, indexer, restore, monitoring, QA, and canary final proof JSON files.
- Strengthened `scripts/check-readiness-checklist.mjs` so `npm.cmd run proof:readiness` fails if any final proof manifest reference disappears from the checklist.
- Verified `node --check scripts/check-readiness-checklist.mjs`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:local`.
## 2026-07-03 - proof record final command guard

- Updated `docs/mainnet-proof-record.md` so the required final command block runs `npm.cmd run proof:files -- --canary-log=<canary-log-file>` before strict `proof:launch`.
- Strengthened `scripts/check-launch-gates.mjs` so `npm.cmd run proof:gates -- --structure-only` fails if the proof record loses the final command header, canary env settings, proof-files check, or strict launch command.
- Verified `node --check scripts/check-launch-gates.mjs`, `npm.cmd run proof:gates -- --structure-only`, and `npm.cmd run proof:local`.
## 2026-07-03 - remaining report final guidance

- Updated `scripts/report-launch-remaining.mjs` so the all-complete guidance points operators through `npm.cmd run proof:files -- --canary-log=<path>` before strict `proof:launch`.
- Verified `node --check scripts/report-launch-remaining.mjs`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-03 - status board G14 proof-files first check

- Updated `docs/mainnet-status-board.md` so G14 `First check` now runs `npm.cmd run proof:files -- --canary-log=<canary-log-file>` instead of jumping straight to strict launch.
- Strengthened `scripts/check-launch-gates.mjs` so G14 status-board first check must include `proof:files -- --canary-log=`.
- Verified `node --check scripts/check-launch-gates.mjs`, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-03 - status board first-check coverage

- Strengthened `scripts/check-launch-gates.mjs` with expected `First check` markers for every G1-G14 status-board row.
- The guard now fails if status board rows lose their required strict commands, canary JSONL path, final `proof:files`, or artifact-backed collector arguments.
- Verified `node --check scripts/check-launch-gates.mjs`, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-03 - remaining report first-check issues

- Added G1-G14 status-board first-check expectations to `scripts/report-launch-remaining.mjs`.
- `npm.cmd run proof:remaining` now reports `first check issues` separately and fails if any status-board first-check command loses required command markers or artifact-backed arguments.
- Updated `scripts/run-local-proof-preflight.mjs` so L11 requires `first check issues` to be `none`.
- Verified `node --check scripts/report-launch-remaining.mjs`, `node --check scripts/run-local-proof-preflight.mjs`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-05 - local proof JSON remaining guard verified

- Verified `node --check scripts/run-local-proof-preflight.mjs`, `node --check scripts/report-launch-remaining.mjs`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local` after the L12 remaining-evidence JSON guard.
- `proof:local` now reports L1-L12 passing; L12 summarizes `proof:remaining --json` as `JSON: 14 remaining gate(s), 0 first-check issue(s)`.
- Added `docs/mainnet-status-board.md` last local verification line for 2026-07-05, then re-verified `npm.cmd run proof:gates -- --structure-only` and `npm.cmd run proof:remaining`.
- Launch is still blocked by missing external G1-G14 evidence; this step only confirms the local proof guard and status-board command drift checks remain green.
## 2026-07-05 - production runbook fresh indexer guard

- Updated `docs/production-runbook.md` G7 flow so `indexer:once` evidence must come from a fresh external DB at the final deploy block, with `LORE_DB_PATH`, `INDEXER_START_BLOCK`, `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK`, and `INDEXER_FINALITY_BLOCKS` shown before collection.
- Strengthened `scripts/check-launch-command-map.mjs` so `proof:launch-map` fails if the production runbook loses those fresh-indexer markers or moves `indexer:once` after `proof:indexer:collect`.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
## 2026-07-05 - production runbook host evidence guard

- Updated `docs/production-runbook.md` G5-G6 flow so production `health:prod` and canary/staging `load:http` evidence commands are shown before `proof:host:collect`, with expected saved log paths `docs/host-health-prod.log` and `docs/host-load-http.log`.
- Strengthened `scripts/check-launch-command-map.mjs` so `proof:launch-map` fails if the production runbook loses those host evidence markers or moves host collection before health/load evidence generation.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
## 2026-07-05 - restore drill two-phase evidence guard

- Updated `docs/production-runbook.md` so G8 restore evidence is collected in order: external-path restore drill, restored `health:prod`, `proof:restore:collect`, then final strict `proof:restore` against `docs/restore-proof.json`.
- Updated `docs/mainnet-readiness-checklist.md` and `scripts/check-readiness-checklist.mjs` so readiness validation requires the restore drill command, `docs/restore-drill.log`, `docs/restore-health-prod.log`, and final `--manifest=docs/restore-proof.json` strict check.
- Strengthened `scripts/check-launch-command-map.mjs` so `proof:launch-map` fails if the production runbook loses restore drill/health markers or orders collector before drill evidence.
- Verified `node --check` for changed guard scripts, `npm.cmd run proof:readiness`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.
## 2026-07-05 - monitoring evidence marker guard

- Updated `docs/production-runbook.md` so G9 monitoring evidence explicitly requires one complete enabled monitor for `health-prod`, `data-sync`, `stale-indexer-heartbeat`, `indexer-lag`, `bot-restart`, `indexer-restart`, and `reverted-tx`.
- Strengthened `scripts/check-launch-command-map.mjs` so `proof:launch-map` fails if the production runbook loses required monitoring kinds, fired-alert/recovery/alert-target/error-event artifact paths, or the plan/draft/strict monitoring order.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:local`.
## 2026-07-05 - canary and QA evidence marker guard

- Updated `docs/production-runbook.md` so G10-G14 evidence explicitly requires a real target-RPC JSONL canary run, at least 50 successful auto-miner unique epochs, reload/reconnect/tab-close/pending tx/remount recovery checks, and no duplicate bets, nonce loops, or stuck pending.
- The runbook now also names required QA evidence for Privy allowed origins, wrong network, mobile Web3 browser, clean-wallet first tx, slow auth, failure states, support/audit visibility, final browser/mobile layout, mainnet wording, and debug autominer smoke artifacts.
- Strengthened `scripts/check-launch-command-map.mjs` so `proof:launch-map` fails if the production runbook loses those canary/QA markers or the QA/canary strict proof order.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:local`.
## 2026-07-05 - signoff evidence marker guard

- Updated `docs/production-runbook.md` so G1-G4 signoff evidence explicitly names final `docs/signoff-proof.json` sections: `contractEnv`, `ownership.directOwnerReadEvidence`, Safe/multisig governance evidence or proof tx, `randomness.decision`, operator/signer sign-off, and `chainComparison` for jackpot, safetyPool, deposits, rewards, rebates, and resolve.
- Strengthened `scripts/check-launch-command-map.mjs` so `proof:launch-map` fails if the production runbook loses those G1-G4 signoff evidence markers before the mainnet env/chain/signoff commands.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:readiness`, and `npm.cmd run proof:local`.
## 2026-07-05 - proof record gate-specific marker guard

- Expanded `docs/mainnet-proof-record.md` G1-G14 missing evidence placeholders so each gate names its required final proof file plus the key evidence markers needed before it can become Complete.
- Strengthened `scripts/check-launch-gates.mjs` and `scripts/report-launch-remaining.mjs` so `proof:gates` and `proof:remaining` fail if the proof ledger loses those gate-specific markers or regresses to generic `TBD docs/*.json` references.
- Verified `node --check` for both guard scripts, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-05 - status board required-proof marker guard

- Updated `docs/mainnet-status-board.md` so each G1-G14 `Required proof` cell uses the same gate-specific evidence markers as the proof record, including explicit marker names such as `ownership.directOwnerReadEvidence`, `target-RPC JSONL`, and `debug autominer smoke`.
- Strengthened `scripts/check-launch-gates.mjs` and `scripts/report-launch-remaining.mjs` so `proof:gates` and `proof:remaining` fail if status-board required proof cells lose those markers.
- Deduplicated proof-record marker expectations by aliasing them to the required-proof marker map in both guard scripts.
- Verified `node --check` for both guard scripts, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-05 - final launch runner remaining JSON guard

- Updated `scripts/run-launch-proof.mjs` so final `proof:launch -- --strict` also runs `scripts/report-launch-remaining.mjs --json` alongside the human-readable remaining report.
- The launch runner now summarizes JSON remaining evidence and only treats it as clean when it reports zero remaining gates and zero structural/reference issue counts.
- Verified `node --check scripts/run-launch-proof.mjs`, `npm.cmd run proof:remaining -- --json`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.## 2026-07-05 - launch evidence command-map marker guard

- Added a compact `Required Evidence Markers` section to `docs/launch-evidence-command-map.md` so the operator command map names the G1-G14 evidence markers, not only the proof files and commands.
- Strengthened `scripts/check-launch-command-map.mjs` so `proof:launch-map` fails if the command map loses those required markers.
- Verified `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:launch-docs`, and `npm.cmd run proof:local`.## 2026-07-05 - final proof files hard gate

- Strengthened `scripts/check-proof-files.mjs` so the soft preflight still allows missing final manifests, but final mode (`--canary-log` or `--strict`) now requires the canary log and all final proof manifests: signoff, host, indexer, restore, monitoring, QA, and canary.
- Verified `node --check scripts/check-proof-files.mjs`, `npm.cmd run proof:files`, and a negative final-mode check with `node scripts/check-proof-files.mjs --canary-log=data/live-test-runs/live-canary-YYYY.jsonl`; the negative check correctly fails on missing final manifests and missing canary log.
- Re-verified `npm.cmd run proof:launch-docs` and `npm.cmd run proof:local`.## 2026-07-05 - launch runner proof-files summary alignment

- Updated `scripts/run-launch-proof.mjs` so the final launch runner treats the new successful final-mode `proof:files` summary (`all required proof manifest files are present and clean`) as clean.
- Verified `node --check scripts/run-launch-proof.mjs`, `node --check scripts/check-proof-files.mjs`, `npm.cmd run proof:local`, and the negative final-mode `check-proof-files` case.## 2026-07-05 - host proof health base-origin guard

- Strengthened `scripts/check-host-proof.mjs` so strict G5/G6 host proof requires `healthProd` evidence to include `base=<production origin>` from the `health:prod` output, in addition to matching `healthProd.url` and numeric `finalityLagBlocks`.
- Updated `scripts/check-host-proof-load-target.mjs` with a passing fixture that includes `base=https://playlore.xyz` and a negative fixture that proves missing health base-origin evidence fails with the expected reason.
- Verified `node --check` for both host proof scripts, `npm.cmd run proof:host-guard`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local`.## 2026-07-05 - indexer dry-run deploy/start evidence guard

- Strengthened `scripts/check-indexer-dry-run.mjs` so strict G7 indexer proof requires `dryRun` evidence to include `[indexer] Deploy block:` and `[indexer] Start block:` markers matching the manifest deploy/start block values.
- This prevents a manually filled manifest from using generic `indexer:once` evidence that does not prove the fresh DB run began at the final deploy block.
- Verified `node --check scripts/check-indexer-dry-run.mjs`, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.## 2026-07-05 - restore proof health base-origin guard

- Strengthened `scripts/verify-db-restore.mjs` so strict G8 restore proof requires `restoredStagingHealth` evidence to include `base=<restored origin>` from the restored `health:prod` output, alongside numeric `finalityLagBlocks`.
- This prevents a restore manifest from using a manually filled restored URL with unrelated or ambiguous health evidence.
- Verified `node --check scripts/verify-db-restore.mjs`, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.## 2026-07-05 - monitoring alert target verification guard

- Strengthened `scripts/check-monitoring-proof.mjs` so strict G9 monitoring proof requires a verified alert target (`verified=true`) with ISO timestamp and concrete fired-alert evidence.
- The validator now also fails any recorded alert target that is not marked verified after a real alert target test.
- Verified `node --check scripts/check-monitoring-proof.mjs`, `npm.cmd run proof:drafts`, and `npm.cmd run proof:local`.
## 2026-07-09 - canary target RPC JSONL guard

- Added redacted `rpcLabel` to live canary JSONL events and replaced raw RPC URL console output with `rpcLabel` plus RPC count.
- Strengthened `scripts/analyze-live-canary-proof.mjs` so strict canary proof requires a concrete redacted `targetNetwork.rpc` label and successful canary events must match it.
- Updated canary template guard fixture and canary draft generator summary to include observed `rpcLabel` values; matching live labels now set `autoMinerSession.targetRpcConfirmed` in drafts.
- Verified `node --check scripts/analyze-live-canary-proof.mjs`, `node --check scripts/check-proof-templates.mjs`, `node --check scripts/create-canary-proof-draft.mjs`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, a synthetic negative check that fails when canary JSONL misses `rpcLabel`, and a synthetic draft check for `observedRpcLabels`.
- Added `LIVE_CANARY_RPC_LABEL` and `npm.cmd run live:canary` to the production runbook canary block, and strengthened launch docs/command-map guards so the operator flow cannot omit the redacted RPC label step.
- Re-verified `node --check scripts/check-launch-doc-command-syntax.mjs`, `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-docs`, `npm.cmd run proof:launch-map`, and `npm.cmd run proof:local` after the runbook update.
- `npm.cmd run typecheck` could not start because local `next` is not available in `node_modules/.bin`; no TypeScript result was produced.
## 2026-07-09 - status board verification freshness guard

- Updated `docs/mainnet-status-board.md` last local verification to the current 2026-07-09 proof run while keeping G1-G14 marked Missing pending external evidence.
- Strengthened `scripts/check-launch-gates.mjs` so the status board must retain the last-verification line with `proof:local`, `proof:remaining`, `proof:gates -- --structure-only`, `proof:launch-map`, `proof:launch-docs`, `proof:readiness`, and the explicit G1-G14 Missing warning.
- Verified `node --check scripts/check-launch-gates.mjs`, `npm.cmd run proof:gates -- --structure-only`, `npm.cmd run proof:remaining`, and `npm.cmd run proof:local`.
## 2026-07-09 - indexer dry-run DB path proof guard

- Added `dryRun.dbPath` to `scripts/collect-indexer-evidence.mjs`, sourced from `[indexer] SQLite path:` in the real `indexer:once` log.
- Strengthened `scripts/check-indexer-dry-run.mjs` so strict indexer proof requires `dryRun.dbPath` to be absolute, outside the repo, and matching `LORE_DB_PATH` or `--db`.
- Updated `docs/production-runbook.md`, `docs/mainnet-readiness-checklist.md`, and `scripts/check-launch-command-map.mjs` so G7 evidence explicitly requires `[indexer] SQLite path:` matching the external `LORE_DB_PATH`.
- Verified `node --check scripts/check-indexer-dry-run.mjs`, `node --check scripts/collect-indexer-evidence.mjs`, `node --check scripts/check-launch-command-map.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:readiness`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, plus synthetic negative and positive checks for `dryRun.dbPath`.
## 2026-07-09 - restore backup artifact proof guard

- Strengthened `scripts/verify-db-restore.mjs` so strict G8 proof requires the backup artifact path via `--backup` or `LORE_RESTORE_BACKUP`, and validates `restoreDrill.backupArtifact` as absolute, outside the repo, inside `restoreDrill.backupDir`, existing on disk, and matching the supplied backup artifact path.
- Updated restore launch commands in runbook/readiness/command-map/template docs to include `--backup=<absolute-backup-file-inside-backup-dir>` in the final strict restore proof.
- Updated `scripts/check-proof-drafts.mjs` restore collector fixture to pass the same backup artifact into strict validation.
- Verified `node --check scripts/verify-db-restore.mjs`, `node --check scripts/check-proof-drafts.mjs`, `node --check scripts/check-launch-command-map.mjs`, `node --check scripts/check-readiness-checklist.mjs`, `npm.cmd run proof:launch-map`, `npm.cmd run proof:readiness`, `npm.cmd run proof:drafts`, `npm.cmd run proof:local`, and a synthetic negative/positive check for missing/present `restoreDrill.backupArtifact`.
