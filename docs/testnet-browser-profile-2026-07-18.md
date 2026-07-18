# Testnet Browser Profile - 2026-07-18

## Scope

- Local production build at `http://localhost:3000`.
- Desktop viewport `1440x900`.
- Five-minute idle observation with one synthetic sound-toggle interaction.
- Local-only `ALLOW_WEAK_RATE_LIMIT_IDENTITY=1` was used so protected API
  polling exercised the documented development identity path.
- No wallet connection, signature, transaction, or testnet write occurred.

## Command

```powershell
$env:ALLOW_WEAK_RATE_LIMIT_IDENTITY='1'
npm.cmd run start:3000
$env:BASELINE_OBSERVE_MS='300000'
$env:BASELINE_SAMPLE_MS='30000'
$env:BASELINE_OUT='artifacts/performance/browser-baseline-5m-local-identity.json'
node scripts/measure-browser-baseline.mjs
```

## Compact Result

| Metric | Result |
| --- | ---: |
| Observation | 300,000 ms |
| Failed local responses | 0 |
| Same-origin API requests | 16.6/min |
| `/api/live-state` | 12/min |
| `/api/chat/messages` | 3/min |
| `/api/recent-wins` | 1.4/min |
| `/api/global-stats` | 1 initial request |
| JS heap delta | -239,518 bytes |
| JS heap peak over initial | +2,894,533 bytes |
| DOM node delta | +1 |
| Long tasks | 4, longest 123 ms |
| Local console errors | 0 |
| Layout shift | 0 |

The visible live-state/pool refresh remained intentionally frequent. Other API
polling stayed bounded, and neither heap nor DOM showed monotonic growth during
this five-minute window. Five external console messages and two external request
failures came from third-party wallet resources; there were no failed local
responses. This is local lab evidence, not a true-device or long-duration HTTPS
session.

