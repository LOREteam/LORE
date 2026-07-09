# Current State

Current focus: launch readiness / production proof. Runtime feature work is secondary until proof tooling and external evidence are reliable.

## Known State

- Serena project config exists and is read-only with navigation/symbol/diagnostics tools only.
- Launch proof docs/scripts that were NUL-corrupted have been restored to readable files.
- `npm.cmd run proof:local` passes local launch-proof preflight L1-L12.
- `proof:launch-map`, `proof:drafts`, `proof:drafts:create`, `proof:launch-docs`, `proof:readiness`, `proof:gates -- --structure-only`, and `proof:remaining` are green locally.
- Launch command-map validation now also checks `docs/production-runbook.md` and `docs/mainnet-readiness-checklist.md` for required artifact-backed launch evidence arguments, preventing stale non-artifact commands from reappearing outside the command map.
- Launch evidence command map now includes a compact `Required Evidence Markers` section for G1-G14, and `proof:launch-map` fails if those command-map markers drift or disappear.
- `proof:drafts` now also checks signoff/host/indexer/restore collector-shaped drafts: they must contain strict-validator sections and still be rejected while incomplete.
- `proof:drafts:create` now prints an explicit warning that generated draft bundles are not launch proof and must be promoted only after real external evidence and strict validation.
- `proof:drafts` now also runs strict validators against every draft produced by `proof:drafts:create`, ensuring the starter bundle cannot be mistaken for accepted launch proof.
- `proof:remaining` now reports `completeGateEvidenceIssues` and fails if a `Complete` gate references missing final proof artifacts or required canary logs.
- `proof:launch` now fails without strict mode and treats remaining external evidence as a launch-blocking failure, not a clean local guard.
- `proof:launch` now also runs `proof:remaining -- --json` and only treats JSON remaining evidence as clean when it reports zero remaining gates and zero structural/reference issues.
- `proof:launch` recognizes the hardened final `proof:files` success summary, so a complete final proof-file pass will not be misclassified as a launch failure.
- Collectors now write draft evidence by default and reject direct writes to final `docs/*-proof.json` paths.
- Proof collectors can write draft JSON via the shared helper, and absolute paths to final `docs/*-proof.json` are rejected.
- Restore evidence collection now requires an absolute existing backup file outside the repo checkout.
- Restore evidence collection now requires absolute external source DB, backup dir, restore dir, and a backup artifact inside the backup dir.
- Restore evidence collection now writes a validator-shaped draft with backupSchedule, restoreDrill, restoredStagingHealth, and indexerPreservation sections so G8 evidence can be filled without inventing a second schema.
- Restore collection now accepts saved `proof:restore` and restored `health:prod` artifacts through `--restore-log` and `--health-log`; valid artifacts prefill restoreDrill and restoredStagingHealth while backup schedule and indexer preservation remain explicit.
- Production runbook, readiness checklist, and command-map/readiness validation now describe the two-phase G8 restore flow: non-strict restore drill log, restored `health:prod` log, `proof:restore:collect`, then final strict `proof:restore` against `docs/restore-proof.json`.
- Restore proof draft generation now refuses direct writes to final `docs/restore-proof.json`; final G8 proof still requires real backup schedule, restore drill, finality-aware restored health, and preservation evidence.
- Restore proof validation now requires restored `health:prod` evidence with numeric `finalityLagBlocks`; restore drafts no longer mark restored health finality from generic `dataSync` alone. Strict G8 proof also requires concrete backup schedule, restore drill, restored health, and indexer preservation evidence markers.
- Strict restore proof now also requires `restoredStagingHealth` evidence to include `base=<restored origin>` from the restored `health:prod` output.
- Monitoring proof validation now requires concrete fired alert and recovery/resolution evidence for each required monitor, fired and recovery evidence must be distinct, recovery timestamps cannot precede fired-alert timestamps, and each required kind must have one complete enabled monitor entry rather than evidence spread across duplicates.
- Monitoring proof draft generation now refuses direct writes to final `docs/monitoring-proof.json`; final G9 proof still requires real fired/recovery alert evidence, concrete alert target evidence, concrete error tracking test-event evidence, and strict validation.
- Monitoring proof draft generation now accepts saved fired-alert, recovery, alert-target, and error-event artifacts through `--monitor-artifact`, `--recovery-artifact`, `--alert-target-artifact`, and `--error-event-artifact`; strict G9 still requires real enabled monitors, ISO timestamps, conditions, target verification, and error tracking evidence.
- Strict monitoring proof now requires at least one alert target with `verified=true`, ISO timestamp, and concrete fired-alert evidence, and every recorded alert target must be verified after a real test.
- Production runbook and command-map validation now require G9 monitoring evidence markers for all required monitor kinds plus fired-alert, recovery, alert-target, and error-event artifacts before strict monitoring proof.
- Host proof validation now requires `hostType=production` for launch production host evidence.
- Host evidence collection now requires production host type and a distinct staging/canary load origin.
- Host evidence collection now writes a validator-shaped draft with processModel, persistentDb, healthProd, and loadHttp sections so G5-G6 evidence can be filled without inventing a second schema.
- Host collection now accepts saved `health:prod` and `load:http` logs through `--health-log` and `--load-log`; valid logs prefill G6 health/load fields while G5 supervisor and persistent DB proof remain explicit.
- Production runbook and command-map validation now require explicit G6 artifact generation markers before host collection: `$env:PROD_HEALTH_BASE_URL`, `npm.cmd run health:prod`, `docs/host-health-prod.log`, `$env:LOAD_BASE_URL`, `npm.cmd run load:http`, and `docs/host-load-http.log`.
- Host proof draft generation now refuses direct writes to final `docs/host-proof.json`; final G5-G6 proof still requires real production supervisor, persistent DB, health, load, and persistence evidence.
- Production `health:prod` now requires numeric finality-target lag evidence, and host proof drafts only mark `finalityLagChecked` from numeric `finalityLagBlocks`. Strict host proof also requires concrete supervisor, persistent DB, health, and load evidence markers.
- Strict host proof now also requires `healthProd` evidence to include `base=<production origin>` from the `health:prod` output, preventing a manually filled URL from masking unrelated health evidence.
- Signoff proof validation now requires Linea mainnet (`network=mainnet`, `chainId=59144`) and concrete evidence markers for contract/env, owner Safe/multisig, randomness sign-off, and direct chain/app-indexer comparisons.
- Signoff evidence collection now writes a validator-shaped draft with contractEnv, ownership, randomness, and chainComparison sections so G1-G4 evidence can be filled without inventing a second schema.
- `proof:mainnet` now supports `--out=<path>` and writes a redacted text proof snapshot suitable for `proof:signoff:collect --env-log=...`.
- Signoff collection now accepts saved `proof:mainnet` and `proof:chain` logs through `--env-log` and `--chain-log`, so one collector command can carry G1 env evidence and G4 direct-chain evidence into the same draft.
- Signoff proof draft generation now refuses direct writes to final `docs/signoff-proof.json`; final G1-G4 proof still requires real contract/env, owner, randomness sign-off, and chain comparison evidence.
- Indexer proof validation now requires Linea mainnet chain snapshots (`expectedChainId=59144`, `rpcChainId=59144`).
- Indexer evidence collection now requires Linea mainnet chain id, deploy block, and positive finality blocks before writing a G7 draft.
- Indexer evidence collection now writes a validator-shaped draft with dryRun, finality, chainSnapshot, and chainComparison sections so G7 evidence can be filled without inventing a second schema.
- Indexer collection now accepts saved `indexer:once`, `health:prod`, and direct-chain snapshot artifacts through `--indexer-log`, `--health-log`, and `--chain-snapshot`; valid artifacts prefill dryRun, finality, and chainSnapshot while chainComparison remains explicit.
- Indexer proof draft generation now refuses direct writes to final `docs/indexer-proof.json`; final G7 proof still requires real fresh DB dry-run, finality, chain snapshot, and direct chain comparison evidence.
- Indexer proof validation now requires finality health evidence with numeric `finalityLagBlocks`; indexer drafts no longer mark `dataSyncHealthFinalityAware` from generic `dataSync` or `effectiveLagBlocks` lines. Strict G7 proof also requires concrete dry-run, finality, chain snapshot, and direct-chain comparison evidence markers.
- Strict indexer proof now also requires `dryRun` evidence to include `[indexer] Deploy block:` and `[indexer] Start block:` markers matching the manifest deploy/start block values.
- Canary proof validation now requires Linea mainnet target metadata (`mainnet`/`linea-mainnet`, `chainId=59144`).
- QA proof validation now requires Linea mainnet target metadata (`mainnet`/`linea-mainnet`, `targetChainId=59144`) and concrete artifact-like evidence paths, links, screenshots, logs, reports, command output, or tx hashes for each required G12-G14 check. Generic text-only values such as `checked` do not satisfy QA evidence.
- QA proof draft generation now refuses direct writes to final `docs/qa-proof.json`; final G12-G14 proof still requires real wallet/browser/mobile evidence and strict validation.
- QA proof draft generation now accepts wallet, failure-state, support/audit, final-browser, and smoke artifacts plus a clean-wallet tx hash through `--wallet-artifact`, `--failure-artifact`, `--support-artifact`, `--finalqa-artifact`, `--smoke-artifact`, and `--clean-wallet-tx`; strict G12-G14 still requires reviewed statuses, booleans, timestamps, wrong-network data, and mainnet wording evidence.
- Launch proof templates are aligned with recovery-alert, mainnet QA, and 50-epoch canary guard expectations.
- QA plan generation now requires Linea mainnet (`linea-mainnet`, `chain-id=59144`), matching QA proof validation.
- Canary proof commands now require an explicit live JSONL log path in launch docs and command-map validation.
- Canary analyzer can now execute strict live-log validation with its filesystem imports present.
- Canary proof validation now requires at least 50 successful auto-miner unique epochs, concrete target/recovery/session/transaction evidence markers, and rejects missing or duplicate successful bet tx hashes in the live JSONL log.
- Canary proof draft generation now refuses direct writes to final `docs/canary-proof.json`; final G10/G11 proof still requires real live JSONL canary evidence and strict validation.
- Canary proof draft generation now accepts a real live JSONL log plus target, recovery, session, and transaction artifacts through `--live-log`, `--target-artifact`, `--recovery-artifact`, `--session-artifact`, and `--tx-artifact`; it pre-fills observed auto-miner counts and tx hashes but still leaves recovery/status/safety booleans explicit.
- Production runbook and command-map validation now require G10-G14 canary/QA evidence markers: real target-RPC JSONL, 50 successful auto-miner unique epochs, recovery checks, duplicate/nonce/stuck-pending scans, Privy/wrong-network/mobile/clean-wallet evidence, and debug autominer smoke artifacts.
- Proof file guard now exercises strict validators for collected final proof JSON files.
- `proof:files` remains a soft local preflight without a canary log, but with `--canary-log` or `--strict` it now requires every final proof manifest plus the canary log to exist before launch.
- Final canary proof file validation now fails without an explicit live JSONL log path.
- Complete launch gates now require expected local final proof artifacts, and canary/final QA gates also require a local live JSONL log reference.
- Launch gate structure validation now also requires every status-board `Required proof` cell to reference the expected final proof JSON, and canary-dependent gates G10/G11/G14 must explicitly mention a live canary log.
- `proof:gates` and `proof:remaining` now require status-board `Required proof` cells to retain gate-specific evidence markers for G1-G14, matching the proof record marker expectations.
- `proof:remaining` now reports `requiredProofIssues` and fails if status-board `Required proof` cells lose the expected final proof JSON or live canary log requirement.
- `proof:local` L11 now explicitly requires `proof:remaining` to report no inconsistent rows, no complete-gate evidence issues, no required-proof issues, and no proof-record reference issues.
- `proof:gates` and `proof:remaining` now also protect non-complete `docs/mainnet-proof-record.md` evidence placeholders from losing their expected final proof JSON references; G10/G11/G14 placeholders must mention live canary log evidence.
- `proof:gates` and `proof:remaining` now also require `docs/mainnet-proof-record.md` placeholders to retain gate-specific evidence markers for G1-G14, preventing the proof ledger from degrading to generic `TBD docs/*.json` references.
- `docs/mainnet-proof-record.md` final command now includes `proof:files -- --canary-log=<canary-log-file>` before strict launch, and `proof:gates` validates those final command snippets.
- `proof:remaining` final all-complete guidance now tells operators to run `proof:files -- --canary-log=<path>` before strict `proof:launch`.
- `docs/mainnet-status-board.md` G14 first check now points to `proof:files -- --canary-log=<canary-log-file>`, and `proof:gates` enforces that final-launch first check.
- `proof:gates` now validates expected `First check` command markers for every G1-G14 status-board row, including artifact-backed collector arguments and strict proof commands.
- `proof:remaining` now reports `first check issues` and `proof:local` L11 requires that counter to stay `none`, so the main remaining-evidence report catches status-board command drift directly.
- `proof:local` L12 now validates `proof:remaining --json` and summarizes JSON output compactly, including remaining gate count and first-check issue count.
- Readiness checklist validation now requires the exact saved `proof:chain -- --strict --out=docs/chain-proof-snapshot.json`, canary draft/strict, QA draft, and monitoring draft command references.
- Readiness checklist validation now also requires explicit references to every final proof manifest: signoff, host, indexer, restore, monitoring, QA, and canary proof JSON.
- Final operator flow now explicitly runs `proof:files -- --canary-log=<canary-log-file>` before `proof:launch -- --strict`; readiness and command-map guards require that step in linked docs.
- Production runbook now includes an explicit G1-G4 contract/funds safety section before host/indexer work, and command-map validation requires `proof:mainnet`, `proof:chain`, `proof:signoff:collect`, and strict `proof:signoff` in that runbook.
- Production runbook and command-map validation now also require G1-G4 signoff evidence markers for `contractEnv`, direct owner read, Safe/multisig governance or proof tx, `randomness.decision`, operator/signer sign-off, and `chainComparison` for jackpot, safetyPool, deposits, rewards, rebates, and resolve.
- Command-map validation now also enforces production runbook order: prepare evidence, G1-G4 signoff, production host, indexer/restore, monitoring, QA/canary, proof files, strict launch, then hold conditions.
- Production runbook and command-map validation now require the G7 indexer dry-run to show fresh external DB markers: `docs/indexer-once.log`, `$env:LORE_DB_PATH`, `$env:INDEXER_START_BLOCK`, `$env:NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK`, and `$env:INDEXER_FINALITY_BLOCKS` before `proof:indexer:collect`.
- Mainnet launch remains blocked by missing external evidence for G1-G14; local proof tooling passing does not mean launch-ready.
- No NUL-leading docs/scripts files remain after the latest recovery scan.

## Current Blockers

- Final contract/env/funds safety sign-off is not collected.
- Production host evidence is not collected from real HTTPS origin.
- Indexer fresh DB dry-run from deploy block is not collected.
- Backup/restore drill evidence is not collected; strict G8 also requires external source, backup dir, restore dir, finality-aware restored `health:prod`, and final `docs/restore-proof.json`.
- External monitoring and error tracking evidence is not collected.
- Real canary epoch run and wallet QA proof are not collected.

## Next Best Step

Collect production host evidence, then indexer fresh DB dry-run, backup/restore drill, monitoring/error tracking, real canary epochs, wallet QA, and final launch evidence in that order.
