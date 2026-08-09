# LORE / Linea Sepolia: автономный backlog на 2+ дня

Обновлено: 2026-08-01.

Назначение этого файла - дать Codex подробную очередь автономной работы по
LORE на Linea Sepolia без скрытого расширения полномочий. Это не launch-ready
claim: локальные проверки могут быть зелеными, но pre-mainnet состояние
считается честным только если внешние blockers остаются видимыми, а реальные
транзакции выполняются только после свежего dry-run Preview и отдельного
точного разрешения.

## Текущий рабочий статус

- Последние известные локальные проверки проходят:
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`.
- `proof:autonomous:summary` остается read-only агрегатором: он не отправляет
  транзакции, не запускает deploy, не стартует live soak и не читает секреты.
- Launch gates остаются `0/14 complete`; `proof:remaining:summary` на
  2026-08-01 показывает оставшиеся группы:
  `canary=2`, `chain=1`, `env=1`, `host=2`, `indexer=1`, `monitoring=1`,
  `qa=3`, `restore=1`, `signoff=2`.
- Основные внешние blockers все еще должны быть видимы: G1 env/signoff,
  configured RPC strict proof, host/domain/HTTPS/Privy production config,
  real indexer DB/finality, backup/restore, monitoring/alerts, QA/mobile,
  live V10 canary log, managed soak, final security scan/signoff.
- V10 deployed identity имеет read-only boundary: использовать для Sepolia
  behavior/gas evidence, но не делать redeploy и не прятать metadata/source
  mismatch как "зеленый" deploy proof.

## Что еще не сделано

Это рабочий список оставшихся направлений. Локальные пункты можно делать
автономно. Пункты с live-транзакциями, внешними сервисами, приватной
инфраструктурой или production secrets должны оставаться blocked до свежего
разрешения и соответствующего proof.

- V10 contract: расширить инварианты по duplicate/replay/late actions,
  accounting exits, claim/rebate/dust/fee paths, rollback при revert/false
  token transfer, CEI/reentrancy assumptions, event ordering и gas summaries.
  Не менять winner selection, проценты, ABI или deploy.
- ABI/indexer/frontend compatibility: доказать, что контракт, API, frontend и
  indexer одинаково понимают events, deploy block, finality, log identity,
  `transactionHash + logIndex`, chain/contract scope, normalized storage и
  idempotent upsert.
- Wallet runtime: добить ручную ставку, approve, pending nonce recovery,
  reject/revert/pending/success, wrong network, reconnect/reload, Privy loading,
  explorer links, duplicate-send prevention и понятные failure messages.
- Auto-Miner: проверить Web Locks, two-tab contention, no-send-before-lock,
  no-send-after-lock-loss, stop/restart, stale session recovery, role binding,
  nonce/hash uniqueness, RPC retry exhaustion и recovery UX.
- API/cache/auth/redaction: пройти все `app/api/**/route.ts(x)` на no-store,
  `Vary: Cookie`, bounded query/body parsing, timeout/cancellation, 429
  redaction, health endpoints, rate-limit strict mode, deposit recovery limiter
  и отсутствие raw private paths/errors.
- DB/indexer operations: усилить backup/restore/indexer strict proofs, scoped
  SQLite isolation, WAL/size boundaries, corrupt/partial backup cases, stale
  manifests, atomic publish и fail-closed behavior без реального внешнего DB.
- Proof tooling: продолжать false-green sweep для `proof:autonomous:summary`,
  `proof:prelaunch:summary`, strict G1-G14 manifests, numeric/timestamp parsing,
  redaction, launch map и readiness docs.
- Security follow-up: после локальной стабилизации запустить fresh
  codex-security diff/full scan; старый sealed scan не считать доказательством
  новых исправлений. Цель - не оставлять локально исправимых High/Medium.
- UX/UI: пройти mobile widths, modals/focus trap, Wallet Settings, loading and
  recovery states, transaction copy, jackpot/reward visibility, number
  typography, accessibility для canvas/animations/dialogs.
- Performance: снять baseline, найти heavy components, убрать измеренные
  лишние rerenders/fetches/polling waste, оптимизировать форматирование и
  charts без ухудшения live freshness.
- Operations: держать explicit blockers для domain/HTTPS, Privy production
  domain config, Resend sender, external rate-limit store, real backup
  path/schedule, real indexer DB/finality proof, live V10 canary/soak,
  monitoring alerts, QA и final security signoff.

## Жесткие запреты

- Не менять randomness, winner selection, tokenomics, проценты, jackpot,
  reward, rebate, dust или fee distribution.
- Не менять deployed contract, адрес, ABI, legacy ABI, deploy, migration или
  compiler/deployment assumptions без отдельного решения.
- Не возвращать removed experimental delegated-wallet path в обычные wallet,
  betting, mining, resolver, canary или recovery flows.
- Не читать и не печатать private env, RPC URL, private keys, mnemonics,
  wallet files, cookies, Privy sessions, webhook URLs, DB URLs, Sentry DSN,
  secrets или keyed endpoints.
- Не отправлять реальные транзакции: bet, approve, claim, rebate,
  resolver claim, fee flush, nonce replacement, deploy, live canary или soak
  без свежего dry-run Preview и отдельного точного разрешения после него.
- Не называть mainnet/pre-mainnet готовым, если G1-G14 не закрыты реальными
  proof artifacts.

## Постоянный автономный цикл

Перед новым блоком работы:

1. `npm.cmd run proof:remaining:summary`
2. `npm.cmd run proof:autonomous:summary`
3. `git status --short`

После каждой узкой правки запускать минимальный релевантный check. Каждые
2-4 часа запускать `npm.cmd run proof:autonomous:summary`. Каждые 6-8 часов
запускать `npm.cmd run check:summary`. Ежедневно запускать:

- `npm.cmd run proof:autonomous:daily:summary`
- `npm.cmd run cleanup:workspace:autonomous`
- `npm.cmd run baseline:bundle:summary`
- `npm.cmd run proof:prelaunch:summary`
- `npm.cmd run proof:remaining:summary`
- `npm.cmd run proof:deps:summary`
- `npm.cmd run proof:deps:all:summary`
- `npm.cmd run proof:wallet-deps:summary`

Если один failure не закрывается после двух разных fix cycles, не крутить его
бесконечно: записать точный blocker в `docs/agent-progress.md` и перейти к
следующей безопасной локальной задаче.

## P0: contract / V10 invariants

Автономно сделать:

- Расширять `scripts/test-contract-v10-invariants.mjs` без изменения Solidity:
  duplicate batch entries, duplicate claims, replay-like inputs, late actions
  after close, zero amounts, max packed values, timestamp boundaries,
  exact one-year claim/dust windows, rounding residuals.
- Усилить coverage по exits: `claimReward`, `claimRewards`,
  `claimEpochRebate`, batch rebate claim, resolver reward claim, reward dust,
  rebate dust, `flushProtocolFees`.
- Проверить accounting rollback: reverted/false-return token transfer не
  оставляет claimed/dust/fee state, liability deltas, transfer evidence или
  event evidence.
- Проверить CEI/nonReentrant assumptions для всех external token-moving
  entrypoints. Если требуется менять contract logic, остановиться и записать
  blocker.
- Проверить event order и event count там, где frontend/indexer опираются на
  receipt logs.
- Проверить duplicate/replay/late actions: один epoch/actor/role не должен
  создавать повторный payout, repeated event или double storage mutation.
- Проверить gas-related local evidence: summary counters, compiler matrix,
  bounded behavior benchmark, но не запускать tx gas refresh без разрешения.
- Пинить ABI selectors, compiler provenance, optimizer/viaIR/evmVersion и
  V10 identity в read-only/offline proofs.

Проверки:

- `npm.cmd run test:contract:v10:summary`
- `npm.cmd run proof:contract-compile:v10:summary`
- `npm.cmd run proof:contract-compiler-advisories:v10:summary`
- `npm.cmd run proof:contract-deployed:v10:offline:summary`
- `npm.cmd run bench:contract:v10:compiler-matrix:summary`
- `npm.cmd run bench:contract:v10:diagnostics:summary`
- `npm.cmd run test:logic:summary`

Stop criteria:

- Нужна правка randomness/tokenomics/ABI/deploy.
- Invariant показывает проблему, которую нельзя закрыть модельным тестом без
  изменения deployed behavior.
- Gas proof требует live transaction или allowance restoration.

## P0: ABI, frontend, indexer, DB compatibility

Автономно сделать:

- Сверить `contracts/LineaOreV10.sol`, ABI config, frontend event usage и
  indexer parser: topic order, indexed args, bigint serialization,
  address normalization, `transactionHash + logIndex`.
- Расширить storage/idempotency tests: same tx/log twice, same tx with
  different logIndex, foreign chain, foreign contract, before deploy block,
  malformed log, partial RPC log, missing block metadata, replacement/reorg-like
  row.
- Проверить normalized categories: bet, resolve, reward claim, rebate claim,
  batch claim, dust settlement, resolver reward, protocol fee flush.
- Проверить reward-vs-rebate subtype parity внутри `batch_claim` и
  `dust_settlement`, чтобы frontend/API не double-count summary events.
- Проверить scoped DB isolation по chain id, contract address, deploy block,
  finality, namespace и contract-scope cleanup.
- Проверить pagination и legacy read compatibility: старые rows не должны
  попадать в текущий V10 scope.
- Проверить direct chain comparison proof tooling. Без real DB/RPC/manifest
  strict mode должен fail-closed, а не становиться false-green.
- Проверить WAL/DB growth boundaries в локальных DB operation tests.

Проверки:

- `npm.cmd run test:indexer-storage:summary`
- `npm.cmd run test:db-operations:summary`
- `npm.cmd run db:scope-audit`
- `npm.cmd run proof:indexer:summary`
- `npm.cmd run proof:indexer:strict:summary`
- `npm.cmd run proof:prelaunch:summary`

## P0: wallet runtime без live-send

Автономно сделать:

- Покрыть manual bet, repeat bet, reward claim, rebate claim, resolver claim,
  ETH/LINEA withdraw/transfer display states, Wallet Settings pending recovery
  и Privy wallet loading/recovery.
- Проверить состояния: preparing, signing, pending, success, failed, reverted,
  rejected, ambiguous timeout, hashless timeout, wrong network, reconnect,
  reload, account switch, expired session, unavailable embedded wallet.
- Закрыть duplicate-send windows: fast double click, rerender gap, stale
  callback, parallel modal action, duplicate modal submit, Auto-Miner/manual
  overlap.
- Проверить pending recovery scope: chain, contract, actor, role, run id,
  nonce, hash. Malformed or inverted nonce evidence must remain pending and
  fail closed.
- Проверить explorer links: показывать только когда chain и tx hash точно
  известны; wrong-network/unknown-chain не должны давать ложную ссылку.
- Улучшать failure copy: rejected, reverted, pending, wrong network,
  insufficient native gas, insufficient LINEA, low allowance, rate-limited API,
  stale/degraded RPC, expired Privy session.
- Проверить dry-run paths: они не создают wallet client, не читают signing
  material и не вызывают write/send methods.

Проверки:

- `npm.cmd run test:logic:summary`
- `npm.cmd run typecheck:summary`
- `npm.cmd run smoke:browser`
- `npm.cmd run playtest:wallet` только если он работает без реального send.

## P0: Auto-Miner, two-tab lock и recovery

Автономно сделать:

- Проверить Web Locks: acquire, contention, denied, unsupported browser,
  orphan recovery, stale session cleanup.
- Требовать fail-closed, если atomic lock недоступен. Mining loop не должен
  стартовать до lock ownership.
- Проверить no-send-before-lock и no-send-after-lock-loss.
- Проверить start, stop, restart, reload, reconnect, account switch и role
  switch.
- Проверить pending nonce blocked state: persisted session сохраняется для
  ручного восстановления, но auto-resume не отправляет новый tx.
- Проверить actor/run binding: stale checkpoint, stale finalize, inactive
  controller и actor mismatch не стирают чужую live session.
- Проверить RPC retry exhaustion, reverted receipt, epoch-closing skip,
  hash/nonce reuse prevention и UI diagnostics.

Проверки:

- `npm.cmd run test:logic:summary`
- `npm.cmd run typecheck:summary`
- `npm.cmd run smoke:browser`

## P0: security follow-up

Автономно сделать:

- Закрыть оставшиеся локально исправимые High/Medium из security follow-up:
  host auth, Web Locks, keeper receipt status/backoff, nonce ownership,
  deposit recovery limiter, dry-run defaults, CI permissions/SHA pins.
- Доказать, что browser wallet никогда не отправляет unattended resolve.
- Проверить, что dormant client auto-resolve sweep удален или окончательно
  изолирован.
- Проверить no-secret/no-private-path redaction для routine summaries, proof
  collectors, API errors, monitoring errors, draft generators.
- После стабилизации запустить новый security diff/full scan только через
  codex-security workflow; старый sealed scan не считать доказательством новых
  исправлений.

Проверки:

- `npm.cmd run proof:security-followup:summary`
- `npm.cmd run proof:ci-security:summary`
- `npm.cmd run test:logic:summary`
- fresh codex-security scan после локальной стабилизации.

## P1: API, cache, auth boundaries и redaction

Автономно сделать:

- Sweep всех `app/api/**/route.ts(x)`: explicit no-store, correct
  `Vary: Cookie`, bounded body/query parsing, timeout/cancellation,
  response redaction.
- Проверить 429 responses: `Retry-After` bounded, JSON redacted, no raw keys,
  origins, RPC URLs, DB paths или wallet internals.
- Проверить origin/CSRF/auth assumptions для admin/chat/deposit/recovery
  routes.
- Проверить external rate-limit strict mode: multi-replica production должен
  fail-closed без real external store. Не читать credentials.
- Проверить deposit recovery global concurrency и cooldown: no duplicate
  recovery job, no spam loop, no hidden tx send.
- Проверить health endpoints: безопасные статусы, no-store, no secrets,
  no private paths, stable machine-readable compact output.

Проверки:

- `npm.cmd run test:logic:summary`
- `npm.cmd run test:fetch-timeout:summary`
- `npm.cmd run smoke:http`
- `npm.cmd run load:http`
- `npm.cmd run health:prod:summary`

## P1: backup, restore, monitoring и ops

Автономно сделать:

- Усилить SQLite backup tests: corrupt source, corrupt final, wrong scope,
  stale manifest, no overwrite, partial artifact cleanup, disk-full simulation.
- Проверить atomic publish: temp file в той же директории, integrity check,
  rename, cleanup only temporary artifacts.
- Проверить restore strict: missing source/backup/manifest не пишет и не
  маскирует blocker.
- Проверить backup strict: требует configured DB, backup dir, retention,
  freshness policy и real external path.
- Проверить monitoring strict: base URL, diagnostics secret presence-only,
  alert target, backup freshness, chain/indexer audit, canary log. Missing
  config должен быть явным blocker.
- Проверить runtime monitor numeric/timestamp parsing: canonical integers,
  ISO timestamps, no future-dated evidence, safe defaults.
- Проверить cleanup loop: dry-run first, allowlist only, safe integer summary,
  no deletion outside intended workspace.
- Проверить process separation: site, bot, indexer, monitor, cleanup loop.

Проверки:

- `npm.cmd run test:db-operations:summary`
- `npm.cmd run db:backup:summary`
- `npm.cmd run db:backup:strict:summary`
- `npm.cmd run proof:restore:summary`
- `npm.cmd run proof:restore:strict:summary`
- `npm.cmd run test:monitoring:summary`
- `npm.cmd run monitor:runtime:summary`
- `npm.cmd run proof:monitoring:strict:summary`
- `npm.cmd run cleanup:workspace:dry-run:summary`

## P1: proof tooling и launch visibility

Автономно сделать:

- Проверить `proof:autonomous:summary` и `proof:prelaunch:summary`: required
  local rows проходят, external rows остаются blocked с компактными причинами.
- Проверить, что `proof:indexer:strict:summary`,
  `proof:restore:strict:summary`, `db:backup:strict:summary`,
  `proof:monitoring:strict:summary`, `proof:qa:strict:summary`,
  `proof:host:strict:summary`, `proof:signoff:strict:summary` fail-closed без
  real manifests.
- Проверить proof drafts/templates/redaction/launch map/readiness checklist:
  docs commands должны совпадать с `package.json`, TODO/draft не считается
  proof.
- Проверить future timestamp rejection во всех G1-G14 strict proof manifests.
- Проверить canonical numeric parsing для all gate counters: no leading zero,
  fractional, unsafe integer, `NaN`, `Infinity`, partial text.
- Обновлять `docs/current_state.md` и `docs/agent-progress.md` только фактом:
  что проверено, какие команды прошли, какие blockers остались.

Проверки:

- `npm.cmd run proof:drafts:summary`
- `npm.cmd run proof:templates:summary`
- `npm.cmd run proof:collector-redaction:summary`
- `npm.cmd run proof:launch-map:summary`
- `npm.cmd run proof:readiness:summary`
- `npm.cmd run proof:prelaunch:summary`
- `npm.cmd run proof:remaining:summary`

## P1: UX/UI

Автономно сделать без изменения продукта:

- Mobile layout: 360px/390px/430px widths, landscape, keyboard overlap,
  safe-area, sticky bars, wallet settings, mining grid.
- Dialogs/modals: focus trap, ESC/backdrop behavior, return focus, scroll lock,
  nested dialog avoidance, readable errors.
- Loading/recovery states: Privy loading, reconnect, wrong network, stale data,
  degraded API, indexer lag, pending tx, ambiguous receipt.
- Transaction state copy: preparing, signing, pending, success, rejected,
  reverted, timeout, duplicate prevented.
- Number typography: LINEA/ETH amounts, wei-to-decimal conversion, jackpot,
  reward, rebate, dust, gas, percentages, countdowns, disk/memory durations.
- Jackpot/reward visibility: Hub, Mining Grid, Safety Pool, Wins Ticker,
  Jackpot Banner, Leaderboards, Admin Ops.
- Accessibility: canvas/animations labels, reduced motion, color contrast,
  touch targets at least 44px, keyboard nav, aria-live only for important
  state changes.
- Browser smoke after UI changes on intended local/prod-like origin. Before
  browser automation, read `docs/browser_automation.md`.

Проверки:

- `npm.cmd run smoke:browser`
- `npm.cmd run baseline:browser:summary`
- `npm.cmd run typecheck:summary`
- `npm.cmd run lint:summary`

## P1: performance

Автономно сделать:

- Снять baseline до оптимизации: build output, browser baseline, route timings,
  long tasks, memory growth, repeated renders, polling cadence.
- Найти heavy components: Analytics/Admin/Wallet panels, charts, mining grid,
  animation/canvas sections.
- Убрать unnecessary rerenders и duplicate fetches, но не ломать intentional
  user-visible refreshes.
- Проверить polling waste: visibility state, stale tabs, disabled wallets,
  background modals, duplicate query keys.
- Оптимизировать только измеренные проблемы: lazy-load тяжелые панели,
  memoize derived bigint/number formatting, batch API reads, bound multicalls,
  avoid chart recomputation.
- Проверить, что chart freshness и live game state не стали менее свежими для
  пользователя.

Проверки:

- `npm.cmd run baseline:bundle:summary`
- `npm.cmd run baseline:browser:summary`
- `npm.cmd run build:summary`
- `npm.cmd run smoke:browser`

## P2: docs, runbooks и operator experience

Автономно сделать:

- Проверить `docs/launch-evidence-command-map.md` против `package.json`.
- Обновить `docs/production-runbook.md` только если меняются команды,
  env names, proof paths или operational boundaries.
- Свести blockers в короткую operator-facing таблицу: команда, ожидаемый
  status, что нужно извне, почему локально закрыть нельзя.
- Проверить `.codexignore` на новые heavy generated paths: `.next`, `.tmp`,
  artifacts, cache, coverage, dist, logs, out, playwright-report,
  test-results, typechain-types, tsbuildinfo.
- Не превращать draft evidence в proof; draft files должны оставаться явными
  черновиками.

Проверки:

- `npm.cmd run proof:launch-docs:summary`
- `npm.cmd run proof:launch-map:summary`
- `npm.cmd run proof:files:summary`
- `npm.cmd run proof:readiness:summary`

## External blockers G1-G14

Эти задачи нельзя честно закрыть автономным локальным патчем:

- G1: final contract env, configured HTTPS RPC, owner/admin/wallet/funds safety,
  no built-in fallback as strict proof.
- G2: owner/signoff evidence and final product/security acceptance.
- G3: randomness acceptance evidence without changing randomness model.
- G4: direct chain reconciliation with real configured RPC.
- G5: production HTTPS/domain host evidence and process model.
- G6: two-replica/external rate-limit store evidence.
- G7: fresh V10 indexer DB, deploy block, finality, manifest, direct chain
  comparison.
- G8: real backup path, schedule, retention, restore drill, restored health.
- G9: monitoring config, health cadence, alert delivery, Resend sender,
  backup/canary/chain-indexer audit.
- G10: live V10 canary matrix with successful unique bet tx and gas evidence.
- G11: recovery drill after live canary/soak, including pending/reverted paths.
- G12: Privy production/domain config and wallet QA on final origin.
- G13: failure UX QA on real browser/device/network conditions.
- G14: final mobile/browser QA, final security scan, mainnet signoff.

Each blocker must stay visible through:

- `npm.cmd run proof:prelaunch:summary`
- `npm.cmd run proof:remaining:summary`
- `npm.cmd run proof:autonomous:summary`

## Что можно сделать по ставкам автономно

Можно автономно, потому что это read-only/dry-run:

- Перегенерировать fresh Preview: `npm.cmd run preview:canary:v10:dry-run`.
- Проверить planner: `npm.cmd run plan:canary:v10:postdeploy:summary`.
- Проверить pending nonce dry-run: `npm.cmd run soak:testnet:clear-pending:summary`.
- Запустить V10 matrix в dry-run режиме, если скрипт не создает wallet client,
  не читает signing material и не вызывает write/send.
- Проанализировать canary dry-run log через strict analyzer и подтвердить, что
  dry-run не закрывает G10/G11.
- Подготовить redacted transaction plan: chain id, contract, roles, max tx
  count, max stake/transfer, max gas budget, stop criteria, already-completed
  tx exclusion.
- Проверить UI/manual bet/Auto-Miner flows через mocks/browser smoke без
  реального wallet send.

Нельзя автономно:

- Делать реальные bet transactions.
- Делать approvals.
- Делать reward/rebate/resolver claims.
- Делать `flushProtocolFees`.
- Делать pending nonce replacement.
- Запускать live V10 matrix или managed soak.
- Деплоить или менять контракт.

Если после fresh Preview будет отдельное точное разрешение, live tranche должен
быть bounded:

- Chain: Linea Sepolia.
- Target: configured V10 contract only.
- Exact tranche: manual bet, Auto-Miner matrix, claim/flush, resolver,
  pending replacement или soak.
- Maximum transaction count.
- Maximum stake/transfer amount.
- Maximum native gas budget.
- Allowed roles: MANUAL, AUTOMINER_A, AUTOMINER_B, resolver или owner, только
  если явно указано.
- Stop criteria: duplicate hash/nonce/role+epoch, unknown pending state,
  unexpected revert, indexer mismatch, health failure, supervisor exit, RPC
  exhaustion, insufficient balance/allowance, missing proof artifact.
- После каждой tx: receipt, token movement, accounting state, indexer event,
  frontend/API visibility, explorer link.

## 48+ hour execution order

Day 1:

1. Baseline: `proof:remaining:summary`, `proof:autonomous:summary`,
   `git status --short`.
2. P0 V10 invariant/model expansion.
3. P0 ABI/indexer/frontend storage compatibility.
4. P0 wallet duplicate-send/pending-recovery coverage.
5. Focused checks and `check:summary`.

Day 2:

1. P0 Auto-Miner Web Locks/recovery coverage.
2. P0 security follow-up checks and local High/Medium closure.
3. P1 API/cache/redaction/rate-limit sweep.
4. P1 backup/restore/monitoring strict proof hardening.
5. `proof:prelaunch:summary`, `proof:remaining:summary`, docs handoff update.

Day 3+:

1. UX/mobile/dialog/accessibility pass.
2. Performance baseline and measured optimizations.
3. Proof tooling false-green sweep.
4. Fresh read-only V10 canary Preview.
5. Security diff/full scan through codex-security workflow.
6. Final local gate: `check:summary`, `proof:autonomous:summary`,
   `proof:prelaunch:summary`, `proof:remaining:summary`.

Completion condition for autonomous work: no remaining critical local task that
can be fixed without changing forbidden product foundations or sending live
transactions; all external blockers are compactly visible with exact commands.
