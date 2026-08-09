# Monitoring Alert Test Plan Draft

This is a draft checklist. It is not launch proof until every TODO is replaced with external provider evidence from the real canary/production setup.

## Target

- Provider: email
- Origin: https://playlore.xyz
- Alert target: playlore88@gmail.com
- Error tracking: sentry
- Release/deploy: TODO: release or deploy id

## Required Alert Tests

| Monitor | Target | Cadence | Alert condition | Test method | Required evidence |
| --- | --- | --- | --- | --- | --- |
| health-prod | /api/health/runtime | 60s | Runtime health is not ok or the endpoint is unreachable. | Point the monitor at a temporary failing URL or force a non-ok runtime dependency in staging, then confirm an alert fires and resolves. | Monitor link, fired alert link, resolved alert link, timestamp, and redacted notification screenshot/export. |
| data-sync | /api/health/data-sync | 60s | Data-sync health is not ok. | Use staging/canary data-sync failure mode or a temporary threshold override, then confirm alert and recovery. | Monitor link, fired alert link, recovery event, and redacted provider export. |
| stale-indexer-heartbeat | /api/health/data-sync | 60s | Indexer heartbeat is stale beyond the production threshold. | Pause the canary indexer long enough to cross the stale threshold, then restart and confirm recovery. | Alert event, indexer restart timestamp, heartbeat before/after, and recovery event. |
| indexer-lag | /api/health/data-sync | 60s | Indexer lag exceeds the production threshold for consecutive checks. | Throttle or pause the canary indexer until lag crosses the threshold, then let it catch up. | Lag samples, alert event, recovery event, and direct chain/indexer comparison sample. |
| bot-restart | process manager | event-driven | lore-bot restarts unexpectedly or exceeds restart threshold. | Restart the canary bot process through the process manager and confirm the restart alert fires. | Process manager event, alert event, bot version/env label, and recovery timestamp. |
| indexer-restart | process manager | event-driven | lore-indexer restarts unexpectedly or exceeds restart threshold. | Restart the canary indexer process through the process manager and confirm the restart alert fires. | Process manager event, alert event, indexer version/env label, and recovery timestamp. |
| reverted-tx | centralized error tracking | event-driven | Repeated reverted transactions or repeated wallet send failures are reported. | Trigger a controlled reverted transaction in canary with a test wallet and confirm it appears in error tracking with safe redaction. | Error event link, redacted payload sample, wallet/tx hash redaction check, and alert notification. |

## Execution Notes

- Run tests on staging/canary first; do not use synthetic failures against production users.
- Keep payloads redacted: no private keys, auth tokens, raw cookies, or full wallet inventory dumps.
- Every alert needs a fired event and a recovery/resolution event.
- Reverted transaction monitoring must prove repeated failures are visible without leaking sensitive wallet/session data.
- Stale indexer and lag checks must use the same finality assumptions as production.

## Commands

```powershell
npm.cmd run proof:monitoring:draft -- --provider=email --error-provider=sentry --origin=https://playlore.xyz --monitor-artifact=docs/monitoring-alert-export.log --recovery-artifact=docs/monitoring-recovery-export.log --alert-target-artifact=docs/monitoring-alert-target-test.log --error-event-artifact=docs/error-tracking-test-event.log --out=docs/monitoring-proof.draft.json
npm.cmd run proof:monitoring -- --strict
```
