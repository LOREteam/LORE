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
  redundant root markers were removed. The burner-wallet generator now reuses
  `viem/accounts`, removing the sole direct `ethers` dependency while preserving
  its five-role output shape. Dependency proof reported no high or critical
  advisories.
- `DONE` tracked-only secret filename/pattern scan found only example env files,
  transaction/proof-shaped hex strings, and scanner fixtures. Local proof
  redaction checks passed before cleanup commits.
- `DONE` the repeated pre-final scan found zero tracked files matching private
  key, mnemonic, token/session-secret, or keyed-URL assignment patterns. The
  only tracked env files are two examples; zero visible untracked files have a
  secret-like name. Five local name candidates remain confined to ignored
  runtime areas and their contents were not printed.
- `OPEN` `.tmp/` still contains the active 300-round canary plus older local
  evidence. It must not be deleted while the canary processes are running. Once
  the canary finishes, compare its result with tracked `docs/testnet-canary-*`,
  archive the accepted dated proof, and remove superseded local logs.
- `DONE` five unreferenced failed/incomplete 2026-07-11 canary JSONL files and
  their four closed stdout/stderr logs were moved to the ignored dated archive;
  the accepted 2026-07-10 logs and active 300-round log stayed in place.
- `DONE` `LoreIntro.tsx` and `useAddressNames.ts` had no production importer and
  were removed with only their obsolete test-only invariants. The unrelated
  canary hunks in the same test file were excluded through partial staging;
  `kael-hero.png` was retained because White Paper still imports it.
- `OPEN` repeat the secret/redaction audit after the accepted canary artifact is
  archived, then remove obsolete ignored wallet/session files; never commit raw
  RPC URLs, wallet/session data, or alert tokens.

## Performance and reliability

- `DONE` reproducible browser baseline: `npm.cmd run baseline:browser` records
  Web Vitals, resource bytes, request counts, RPC method names, heap, DOM nodes,
  long tasks, and categorized errors without URLs or payloads.
- `DONE` reproducible bundle baseline: `npm.cmd run baseline:bundle` records the
  static output totals and largest files. Current output is 8,369,216 bytes,
  including 6,974,286 bytes JavaScript, 217,406 bytes CSS, and 120,664 bytes
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
- `DONE` React Query/wagmi cache audit: the application has one QueryClient with
  a 10-second default `staleTime` and focus refetch disabled, no manual query
  keys or invalidation calls, and contract reads derive keys from
  chain/address/function/args. Grid prefetches use distinct epoch arguments;
  identical resolver reads share the same TanStack query key. No live polling
  interval was reduced without runtime evidence.
- `DONE` chat, auth, admin, deposits/epochs/rewards, rebate, recent-wins,
  jackpot, global-stats, leaderboard, profile, and address-name UI requests have
  abort-aware 12-second timeouts. Bootstrap resolve and live-state retain their
  existing custom request bounds. Telegram alert requests have a 10-second
  timeout; bot retry/backoff remains intact.
  Indexer RPC reads already use timeout/retry and its watch loop has an overlap
  guard.
- `DONE` duplicated stored block/epoch parsing in deposits, recent wins, and
  jackpot service now delegates to one tested validation contract.
- `DONE` two admin action timers are cleared on unmount and replacement.
- `DONE` timer/listener/retry-loop audit: DOM listeners are paired with cleanup,
  mining and jackpot timers are cancelled by lifecycle effects, auto-resolve
  loops check cancellation, indexer watch rejects overlap, and keeper/supervisor
  loops have bounded waits plus SIGINT/SIGTERM handling. No additional app-owned
  listener leak was identified.
- `OPEN` an authenticated Privy session was confirmed and its console sources
  were attributed, but the connected Chrome surface does not expose Resource
  Timing or network events. A request-count measurement is still required to
  quantify the removed balance observer.
- `OPEN` React Profiler evidence is still required before changing component
  boundaries. Static review shows memoized section components, but a measured
  rerender hotspot has not yet been established. A temporary React 19 DevTools
  root-hook probe was rejected because its callback count included internal
  commit/passive cycles and contradicted the near-idle CPU baseline; no
  memoization change was accepted from that invalid signal.
- `DONE` the 308 KiB transferred / 1.04 MiB decoded initial JS chunk is the root
  wallet/auth vendor: it contains Privy, WalletConnect, Coinbase, Solana,
  MetaMask, and Porto signatures. Privy secondary screens are already emitted as
  lazy chunks. Moving the root provider would risk wallet/session restoration,
  so no speculative split was accepted.
- `OPEN` verify local CSP/resource errors on the intended deployment origin.
  Local wallet-provider startup produced either zero errors or four CSP plus one
  resource error depending on run; no local API response failed. The latest
  authenticated dev reload instead hit a stale `ChunkLoadError` twice while the
  isolated production build remained green; the long-running user dev server
  was intentionally not restarted during the active canary.
- `DONE` final local mobile reruns at 390x844 measured LCP 1.272–1.288 s, CLS 0,
  2.090 MiB transfer, and zero horizontal overflow.
- `OPEN` run the browser baseline at the intended production origin before
  sign-off. The tracked candidate `https://playlore.xyz` currently resolves and
  accepts TCP 443, but HTTPS validation fails before any HTTP response. The
  certificate observed from this Windows host had subject
  `CN=catnet.vspandexe.com`, issuer
  `Kaspersky Anti-Virus Personal Root Certificate`, and
  `RemoteCertificateNameMismatch`. This may be local TLS interception, DNS
  filtering, or an upstream host/certificate problem; verify from an independent
  clean network and fix the origin certificate before collecting browser or
  production-health evidence. Do not bypass certificate validation for proof.

## Final gates

- `DONE` latest isolated production build, TypeScript, targeted ESLint,
  `test:logic`, timeout/parser tests, and HTTP smoke passed for the cleanup
  branch state.
- `DONE` current pre-canary `proof:local` passed L1–L14. L14 correctly treated
  the strict launch result as an expected failure: 13 launch checks remain
  missing because external mainnet evidence has not been collected.
- `OPEN` consume and validate the completed 300-round canary proof.
- `OPEN` run `proof:local` and the applicable mainnet/readiness proof gates after
  the canary changes are committed or explicitly excluded.
- `DONE` cleanup-branch review against `f7cb349`: 42 commits change 115 files
  with 949 text additions and 2,466 deletions, no runtime/proof additions, no
  binary additions, and no whitespace errors. All six remaining tracked assets
  over 1 MiB have production references.
- `OPEN` push the cleanup branch only with explicit user authorization. The
  branch is intentionally local at this stage.
