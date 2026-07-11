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
| Reliability-bound rerun | 2.214–2.215 MB | 4.628 MB | 1.200–1.692 s | Request counts and transferred assets stayed stable after shared timeout adoption; the two local LCP samples were too variable to claim a speed change. |

The final observed LCP element is the decorative Hub `img`; CLS remained zero.
The final transfer is about 91% below the original observation. LCP values are
local-run measurements and should be compared as a range, not as a production
SLO.

At 390x844 the final two local production reruns measured 2.090 MB transfer,
LCP 1.272–1.288 s, CLS 0, and zero horizontal overflow
(`documentScrollWidth === viewportWidth === 390`).

## Build output

`npm.cmd run baseline:bundle` measured the static production output in
`.next-isolated`:

- 219 files / 8,369,216 bytes total;
- JavaScript: 6,974,286 bytes;
- lazy Brotli WASM: 1,056,860 bytes;
- CSS: 217,406 bytes;
- local WOFF2 fonts: 120,664 bytes.

The reliability changes added 1,127 bytes of JavaScript (about 0.013% of the
static output) while WASM, CSS, and font totals remained unchanged.

The largest JavaScript file is 1,040,594 bytes uncompressed and 308,282 bytes
transferred in the browser baseline. Signature inspection identifies it as the
root Privy/wallet vendor chunk (Privy, WalletConnect, Coinbase, Solana, MetaMask,
and Porto). Secondary Privy screens remain lazy in the loadable manifest; the
root provider stays eager to preserve wallet/session restoration. The WASM file
was not requested during the default Hub observation, so it is not an
initial-load target without evidence from the wallet flows that load it.

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

`npm.cmd run smoke:http` passed against the same production build with no failed
checks. The final cold mixed-route run completed ordinary API checks in 9–75 ms;
the home page took 572 ms, data-sync health 630 ms, and rebate aggregation
443 ms.

A five-second idle process sample showed approximately zero CPU usage for the
observed local app and canary processes. The isolated production server used
154.5 MB working set. Other running instances were measured but not modified.

## Reproduction

```powershell
npm.cmd run build:isolated
npm.cmd run baseline:bundle
$env:NEXT_DIST_DIR='.next-isolated'
$env:NEXT_TSCONFIG_PATH='tsconfig.build.json'
node .\node_modules\next\dist\bin\next start --port 3002
$env:BASELINE_BASE_URL='http://localhost:3002'
$env:BASELINE_VIEWPORT='390x844' # optional; defaults to 1440x900
npm.cmd run baseline:browser
$env:SMOKE_BASE_URL='http://localhost:3002'
npm.cmd run smoke:http
```

## Remaining measured work

1. Confirm production CSP/resource errors against the intended deployed origin;
   local wallet-provider traffic produced 0 or 5 categorized errors between runs.
2. Replace the 1 MB icon only when an approved visually equivalent source asset
   is available; recompression alone does not reduce it.
3. Use React Profiler on the intended origin to identify expensive rerenders.
   Do not reduce live game refresh frequencies without product evidence.
4. Re-run this baseline on the deployment origin before mainnet sign-off. The
   local mobile rerun is complete.
