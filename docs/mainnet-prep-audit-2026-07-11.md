# Mainnet preparation audit — 2026-07-11

This is a requirement-by-requirement working audit. `DONE` means current local
evidence exists; `OPEN` means mainnet preparation is not yet complete.

## Repository safety and cleanup

- `DONE` GitHub preservation: the 18-commit testnet baseline is available at
  `origin/codex/testnet-readiness-baseline` with tip `f7cb349`.
- `DONE` inventory: tracked size offenders, ignored runtime output, proof
  evidence, and production assets were separated before deletion.
- `DONE` obvious root diagnostics and `.playwright-cli/` were removed.
- `DONE` generated binaries, PID files, screenshots, generated solc output,
  preview routes, orphan shims, and a duplicate favicon were removed in small
  commits. Approximately 99 MiB of tracked generated content was removed.
- `DONE` `.gitignore` and `.codexignore` cover runtime Node, Playwright,
  isolated-build, performance, PID, and generated artifact paths.
- `DONE` production images were retained unless import/runtime searches proved
  them unused. Old raster chat avatars were removed only after confirming that
  runtime avatars are inline SVG components.
- `DONE` direct dependency cleanup retained hidden wagmi connector requirements;
  only redundant root markers were removed. Dependency proof reported no high
  or critical advisories.
- `DONE` tracked-only secret filename/pattern scan found only example env files,
  transaction/proof-shaped hex strings, and scanner fixtures. Local proof
  redaction checks passed before cleanup commits.
- `OPEN` `.tmp/` still contains the active 300-round canary plus older local
  evidence. It must not be deleted while the canary processes are running. Once
  the canary finishes, compare its result with tracked `docs/testnet-canary-*`,
  archive the accepted dated proof, and remove superseded local logs.
- `OPEN` repeat the secret/redaction audit after the accepted canary artifact is
  archived; never commit raw RPC URLs, wallet/session data, or alert tokens.

## Performance and reliability

- `DONE` reproducible browser baseline: `npm.cmd run baseline:browser` records
  Web Vitals, resource bytes, request counts, RPC method names, heap, DOM nodes,
  long tasks, and categorized errors without URLs or payloads.
- `DONE` reproducible bundle baseline: `npm.cmd run baseline:bundle` records the
  static output totals and largest files. Current output is 8,368,089 bytes,
  including 6,973,159 bytes JavaScript, 217,406 bytes CSS, and 120,664 bytes
  WOFF2.
- `DONE` HTTP/API baseline: the warmed smoke suite passed; most routes completed
  in 3–10 ms locally, with zero smoke failures.
- `DONE` process baseline: the isolated production server used about 154.5 MiB
  working set and observed app/canary processes were effectively idle during a
  five-second CPU sample.
- `DONE` asset delivery: duplicate favicon requests and raw jackpot backgrounds
  were removed. Initial transfer fell from 24.83 MiB to about 2.21–2.29 MiB;
  final measured LCP was 1.308–1.372 s with CLS 0.
- `DONE` critical preload points to the measured Hub LCP image, not the page
  backdrop. Lossless re-encoding of the remaining icon was rejected because it
  increased size while preserving the same RGBA hash.
- `DONE` heavy secondary tab panels, chat, wallet settings, backup gate, and the
  first-visit tutorial use dynamic loading. The 1.06 MiB Brotli WASM file was not
  requested during the default Hub observation.
- `DONE` all five local font files are referenced by the three active local-font
  families/weights. Their combined production output is 120,664 bytes; no
  unused font file was identified.
- `DONE` duplicate wallet polling: the second identical
  `balanceOf(embeddedWallet)` wagmi observer was removed while keeping the
  original 12/45-second visible/hidden interval and refetch handle.
- `DONE` secondary UI requests now have abort-aware 12-second timeouts. Telegram
  alert requests have a 10-second timeout; bot retry/backoff remains intact.
  Indexer RPC reads already use timeout/retry and its watch loop has an overlap
  guard.
- `DONE` duplicated stored block/epoch parsing in deposits, recent wins, and
  jackpot service now delegates to one tested validation contract.
- `DONE` two admin action timers are cleared on unmount and replacement.
- `OPEN` authenticated wallet measurement is still required to quantify the
  removed balance observer; clean browser contexts cannot exercise that query.
- `OPEN` React Profiler evidence is still required before changing component
  boundaries. Static review shows memoized section components, but a measured
  rerender hotspot has not yet been established.
- `OPEN` investigate the 308 KiB transferred / 1.04 MiB decoded initial JS chunk
  with a bundle analyzer or source map before splitting it.
- `OPEN` verify local CSP/resource errors on the intended deployment origin.
  Local wallet-provider startup produced either zero errors or four CSP plus one
  resource error depending on run; no local API response failed.
- `OPEN` run the browser baseline at the mobile viewport and intended production
  origin before sign-off.

## Final gates

- `DONE` latest isolated production build, TypeScript, targeted ESLint,
  `test:logic`, timeout/parser tests, and HTTP smoke passed for the cleanup
  branch state.
- `OPEN` consume and validate the completed 300-round canary proof.
- `OPEN` run `proof:local` and the applicable mainnet/readiness proof gates after
  the canary changes are committed or explicitly excluded.
- `OPEN` review the cleanup branch diff, then push it only with explicit user
  authorization. The branch is intentionally local at this stage.
