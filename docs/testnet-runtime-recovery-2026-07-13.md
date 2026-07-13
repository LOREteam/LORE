# Testnet Runtime Recovery Drill - 2026-07-13

Scope: local testnet SQLite and the currently configured testnet contract. The
active database was used only as a read-only source. Backup, restored database,
and indexer writes were isolated under separate system temporary directories.
No wallet transaction or contract write was performed.

## Backup And Restore

- Source runtime was stopped before the drill.
- Backup and restore directories were distinct and outside the repository.
- Restored SQLite opened successfully and `PRAGMA integrity_check` returned
  `ok`.
- All 16 expected application/indexer tables were present.

## Indexer Restart

- First one-shot catch-up scanned from the configured deployment boundary to
  the current finalized head and completed without a fatal error.
- Repair processed the same historical scope with idempotent writes; reconcile
  reported no missing epochs.
- Aggregated restored counts after catch-up: 80 scoped bets, 78 scoped epochs,
  1 scoped jackpot, and 2 scoped reward claims.
- A second one-shot run resumed from the persisted cursor, found no new logs,
  and again reported no missing epochs. Aggregated row counts remained stable.

This proves the local testnet backup/restore and indexer cursor restart path. It
does not replace a future production-host scheduled backup, external storage,
or restored HTTPS health check.
