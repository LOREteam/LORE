# Launch Evidence Command Map

This map is the operator-facing checklist for collecting mainnet launch evidence. Draft files are not launch proof; only filled JSON proof files with external evidence, final addresses, final origins, redacted links, and concrete artifact markers can satisfy launch gates. Generic text such as `checked` is not proof.

Related docs:
- docs/mainnet-readiness-checklist.md
- docs/mainnet-status-board.md
- docs/production-runbook.md

## Required Proof Files

- docs/signoff-proof.json
- docs/host-proof.json
- docs/indexer-proof.json
- docs/restore-proof.json
- docs/monitoring-proof.json
- docs/qa-proof.json
- docs/canary-proof.json

## Compact Status Checks

Use these before opening long JSON, tables, or logs. They do not replace strict
proof checks and do not write launch artifacts.

```powershell
npm.cmd run proof:prelaunch:summary
npm.cmd run proof:local:summary
npm.cmd run proof:security-followup:summary
npm.cmd run proof:autonomous:daily:summary
npm.cmd run proof:process-model:summary
npm.cmd run proof:templates:summary
npm.cmd run proof:files:summary
npm.cmd run proof:collector-redaction:summary
npm.cmd run proof:readiness:summary
npm.cmd run proof:launch-map:summary
npm.cmd run proof:remaining:summary
npm.cmd run proof:mainnet:summary
npm.cmd run proof:mainnet:strict:summary
npm.cmd run proof:chain:summary
npm.cmd run proof:chain:strict:summary
npm.cmd run proof:signoff:summary
npm.cmd run proof:signoff:strict:summary
npm.cmd run proof:host:summary
npm.cmd run proof:host:strict:summary
npm.cmd run proof:indexer:summary
npm.cmd run proof:indexer:strict:summary
npm.cmd run proof:restore:summary
npm.cmd run proof:restore:strict:summary
npm.cmd run monitor:runtime:summary
npm.cmd run proof:monitoring:summary
npm.cmd run proof:monitoring:strict:summary
npm.cmd run proof:qa:summary
npm.cmd run proof:qa:strict:summary
npm.cmd run proof:canary:summary
npm.cmd run proof:testnet:canary:strict:summary
npm.cmd run proof:testnet:canary:v10:summary
npm.cmd run db:backup:summary
npm.cmd run db:backup:strict:summary
npm.cmd run proof:launch:summary
npm.cmd run proof:launch:strict:summary
```

## Required Evidence Markers

Each final proof file must contain concrete external evidence, not placeholders:

- G1-G4 signoff: `contractEnv`, token, deploy block, finality, V10 protected bets flag, `ownership.directOwnerReadEvidence`, Safe/multisig governance evidence or proof tx, `randomness.decision`, operator/signer sign-off, `chainComparison` for jackpot, safetyPool, deposits, rewards, rebates, resolve, and existing saved artifacts for every local artifact reference.
- G5-G8 host/indexer/restore: `docs/host-health-prod.log`, `docs/host-load-http.log`, externalRateLimit proof with `webReplicaCount`, `distinctReplicas`, `sharedBucketVerified`, and `failClosed`, fresh external DB, two-replica shared rate-limit proof, `docs/indexer-once.log`, `chainSnapshot` with `rpcChainId` and `contractAddress`, `finalityLagBlocks`, `$env:LORE_DB_PATH`, `$env:INDEXER_START_BLOCK`, `$env:NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK`, `$env:INDEXER_FINALITY_BLOCKS`, backup schedule with `retentionDays` and `lastSuccessfulBackupAt`, `docs/restore-drill.log`, `docs/restore-health-prod.log`, indexer preservation evidence, and existing saved artifacts for every local restore artifact reference.
- G9 monitoring: health-prod, data-sync, stale-indexer-heartbeat, indexer-lag, bot-restart, indexer-restart, reverted-tx, fired alert, recovery alert, verified email alert target, and error event artifacts.
- G10-G14 canary/QA: target-RPC JSONL, successful role coverage for `MANUAL`, `AUTOMINER_A`, and `AUTOMINER_B`, 50 successful auto-miner unique epochs, unique tx hashes, reload/reconnect/tab-close/pending tx/remount recovery, noDuplicateBets, noNonceLoops, noStuckPending, Privy allowed origins, redacted production Privy App ID configured proof, wrong network, mobile Web3 browser, clean-wallet first tx, failure-state UX, support/audit visibility, debug autominer smoke, mobile layout, overlays, chat geometry, mainnet wording, fresh Codex Security scan report or sealed scan artifact, and no open High/Medium local findings.

## Pre-Bet Dry-Run Preview

Regenerate this immediately before requesting any fresh authorization for Linea
Sepolia V10 claims, approvals, bets, resolver actions, nonce replacements, or a
managed soak. It writes a redacted local Preview only; it does not satisfy G10
or G11 because dry-run logs have no successful live transactions.

```powershell
npm.cmd run preview:canary:v10:dry-run
npm.cmd run preview:canary:v10:dry-run:summary
npm.cmd run preview:canary:v10:authorization-ready:summary
```

Expected output artifact:

- docs/v10-canary-dry-run-preview.md

The regular summary command validates the existing Preview freshness within
the local proof window, bounded artifact sizes, safe dry-run log path,
`transactionSent=false`, no signing or wallet client creation, and the
expected G10/G11 dry-run blocker. The authorization-ready summary applies the
stricter fresh-consent window and must pass immediately before requesting or
using any bounded real-transaction authorization. Neither summary command
regenerates the Preview. The authorization-ready summary does not satisfy live
canary/soak proof.

## Draft Generators

```powershell
# Signoff, host, indexer, and restore drafts are generated by the collector commands below because they need saved evidence artifacts.
npm.cmd run proof:monitoring:plan -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --out=docs/monitoring-alert-test-plan.draft.md
npm.cmd run proof:monitoring:draft -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --monitor-artifact=docs/monitoring-alert-export.log --recovery-artifact=docs/monitoring-recovery-export.log --alert-target-artifact=docs/monitoring-alert-target-test.log --error-event-artifact=docs/error-tracking-test-event.log --out=docs/monitoring-proof.draft.json
npm.cmd run proof:qa:plan -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --out=docs/qa-canary-test-plan.draft.md
npm.cmd run proof:qa:draft -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --wallet-artifact=docs/qa-wallet-flow-report.md --failure-artifact=docs/qa-failure-state-report.md --support-artifact=docs/qa-support-audit-report.md --finalqa-artifact=docs/qa-final-browser-report.md --smoke-artifact=docs/qa-smoke-debug-autominer.log --clean-wallet-tx=<txHash> --out=docs/qa-proof.draft.json
npm.cmd run proof:canary:draft -- --network=linea-mainnet --chain-id=59144 --contract=<contract> --rpc-label=<redacted-provider-rpc-label> --live-log=data/live-test-runs/live-canary-YYYY.jsonl --target-artifact=docs/canary-target-proof.log --recovery-artifact=docs/canary-recovery-proof.log --session-artifact=docs/canary-session-summary.log --tx-artifact=docs/canary-transaction-scan.log --out=docs/canary-proof.draft.json
npm.cmd run proof:drafts:create -- --out-dir=docs/proof-drafts
npm.cmd run proof:drafts:create:summary -- --out-dir=docs/proof-drafts
```

## Evidence Collectors

These collector commands write incomplete evidence drafts. Promote a draft to docs/*-proof.json only after adding real external evidence and confirming the matching strict validator passes.

```powershell
npm.cmd run proof:signoff:collect -- --epochs=<count> --user=<wallet> --env-log=docs/mainnet-env-proof.log --chain-log=docs/chain-proof-snapshot.json --randomness-decision=accepted-risk --randomness-risk-accepted=true --randomness-operator=<operator-or-signer> --randomness-signed-at=<ISO-UTC> --randomness-evidence=<artifact-or-link> --out=docs/signoff-proof.draft.json
npm.cmd run proof:host:collect -- --origin=https://playlore.xyz --host-type=production --load-origin=https://canary.playlore.xyz --load-host-type=canary --db-path=<absolute-external-LORE_DB_PATH> --supervisor=<pm2-systemd-docker-compose> --process-evidence=docs/host-process-model.log --health-log=docs/host-health-prod.log --load-log=docs/host-load-http.log --out=docs/host-proof.draft.json
npm.cmd run indexer:once
npm.cmd run proof:indexer:collect -- --fresh-db=true --epochs=<count> --chain-id=59144 --deploy-block=<deploy-block> --finality-blocks=<finality-blocks> --indexer-log=docs/indexer-once.log --health-log=docs/indexer-health-prod.log --chain-snapshot=docs/chain-proof-snapshot.json --out=docs/indexer-proof.draft.json
npm.cmd run proof:restore:collect -- --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --restored-origin=https://restore.playlore.xyz --restored-host-type=restore --restore-log=docs/restore-drill.log --health-log=docs/restore-health-prod.log --backup-schedule-artifact=docs/restore-backup-schedule.log --preservation-artifact=docs/restore-indexer-preservation.log --out=docs/restore-proof.draft.json
```

`docs/restore-backup-schedule.log` must prove a recurring backup job, a
positive retention window, and the latest successful scheduled backup timestamp.

## Strict Proof Checks

```powershell
npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log
npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json
npm.cmd run proof:signoff -- --strict
npm.cmd run proof:collector-redaction
npm.cmd run proof:process-model -- --strict
npm.cmd run proof:host -- --strict
npm.cmd run proof:host-guard
npm.cmd run proof:indexer -- --strict
npm.cmd run proof:restore -- --strict --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --manifest=docs/restore-proof.json
npm.cmd run proof:monitoring -- --strict
npm.cmd run proof:qa -- --strict
npm.cmd run proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict
npm.cmd run proof:deps
npm.cmd run proof:deps:all
npm.cmd run proof:files -- --canary-log=<canary-log-file>
npm.cmd run proof:gates -- --strict
npm.cmd run proof:readiness
npm.cmd run proof:launch-docs
npm.cmd run proof:launch-map
npm.cmd run proof:remaining
npm.cmd run proof:remaining -- --json
npm.cmd run proof:local
npm.cmd run proof:launch -- --strict --canary-log=<canary-log-file>
```

## Canary Log Environment

Use PowerShell environment variables for local launch proof orchestration when needed:

```powershell
$env:CANARY_LOG = "C:\\path\\to\\canary-log.jsonl"
# Keep LORE_DB_PATH, LORE_BACKUP_DIR, LORE_RESTORE_DRILL_DIR, and LORE_RESTORE_BACKUP set to the reviewed external restore-proof paths.
npm.cmd run proof:deps
npm.cmd run proof:deps:all
npm.cmd run proof:files -- --canary-log=$env:CANARY_LOG
npm.cmd run proof:launch -- --strict --canary-log=$env:CANARY_LOG
```

## Proof Boundary

- `proof:*:draft` commands create templates only.
- `proof:*:collect` commands must be run against final canary/production targets.
- Strict proof checks must pass against non-draft files before launch. Evidence fields must contain concrete paths, redacted URLs, command-output artifacts, screenshots, logs, reports, tx hashes, or direct-chain summaries.
- Final QA evidence must include a fresh Codex Security scan report or sealed scan artifact for the exact launch candidate, with no open High/Medium local findings. The local `proof:security-followup:summary` regression check is required evidence, but it does not replace the final scan.
- Redact RPC URLs, tokens, cookies, private keys, session identifiers, and unnecessary wallet inventory data.
