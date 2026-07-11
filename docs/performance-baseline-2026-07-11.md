# Local production performance baseline — 2026-07-11

Scope: isolated production build on `http://localhost:3002`, desktop viewport
1440x900, 10-second observation window. Generated JSON remains ignored under
`artifacts/performance/`; this document keeps only the compact, non-sensitive
summary.

## Browser results

| Stage | Transfer | Decoded | LCP | CLS | Main finding |
| --- | ---: | ---: | ---: | ---: | --- |
| Before asset cleanup | 24.83 MB | 28.27 MB | 1.260 s | 0 | The 6.78 MB favicon was requested three times. |
| Favicon metadata fixed | 4.48 MB | 6.90 MB | 1.112 s | One icon declaration replaced three duplicate declarations. |
| Jackpot background optimized | 2.21–2.29 MB | 4.63–4.71 MB | median 1.632 s | The raw 2.42 MB PNG was replaced by 78–152 KB optimized variants. |
| Actual LCP image prioritized | 2.21–2.29 MB | 4.63–4.70 MB | 1.308–1.372 s | Preload was moved from the page backdrop to the Hub image reported as LCP. |

The final observed LCP element is the decorative Hub `img`; CLS remained zero.
The final transfer is about 91% below the original observation. LCP values are
local-run measurements and should be compared as a range, not as a production
SLO.

The remaining largest local resources are:

- `/icon.png`: 1,019,706 bytes. A lossless PNG re-encode preserved the exact
  RGBA pixel hash but grew to 1,270,779 bytes, so it was rejected.
- Largest JavaScript chunk: 308,282 bytes transferred / 1,040,594 bytes decoded.
- Next.js-optimized jackpot variants: 78,668 and 152,454 bytes.

## Request and runtime baseline

During a 10-second visible-page observation the app made 5–7 same-origin API
requests: chat messages once, live state twice, recent wins once, and global
stats once to three times while the epoch state settled. No local HTTP failure
was observed. External wallet/RPC traffic varied by run; only method counts were
recorded and no external URLs or payloads were persisted.

`npm.cmd run smoke:http` passed against the same production build. After warmup,
most API routes completed in 3–9 ms, `/api/health/runtime` in 46 ms, and the home
page in 33 ms.

A five-second idle process sample showed approximately zero CPU usage for the
observed local app and canary processes. The isolated production server used
154.5 MB working set. Other running instances were measured but not modified.

## Reproduction

```powershell
npm.cmd run build:isolated
$env:NEXT_DIST_DIR='.next-isolated'
$env:NEXT_TSCONFIG_PATH='tsconfig.build.json'
node .\node_modules\next\dist\bin\next start --port 3002
$env:BASELINE_BASE_URL='http://localhost:3002'
npm.cmd run baseline:browser
$env:SMOKE_BASE_URL='http://localhost:3002'
npm.cmd run smoke:http
```

## Remaining measured work

1. Confirm production CSP/resource errors against the intended deployed origin;
   local wallet-provider traffic produced 0 or 5 categorized errors between runs.
2. Profile the 308 KB transferred JavaScript chunk before changing bundle
   boundaries; existing secondary tab panels are already lazy-loaded.
3. Replace the 1 MB icon only when an approved visually equivalent source asset
   is available; recompression alone does not reduce it.
4. Use React Profiler on the intended origin to identify expensive rerenders.
   Do not reduce live game refresh frequencies without product evidence.
5. Re-run this baseline on mobile and on the deployment origin before mainnet
   sign-off.
