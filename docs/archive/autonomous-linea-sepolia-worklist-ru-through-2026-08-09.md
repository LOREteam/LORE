# Автономный список задач Linea Sepolia

Обновлено: 2026-07-30.

Цель этого списка - дать Codex очередь работы больше чем на два дня для LORE
на Linea Sepolia. Это не launch-ready заявление. Автономно можно закрывать
локальные проверки, тестовые симуляции, proof tooling, UX, API, indexer, DB и
ops-защиту. Нельзя автономно менять рискованные основы продукта или отправлять
реальные транзакции.

## Жесткие границы

- Не менять randomness и модель выбора победителя.
- Не менять токеномику, проценты, reward, fee, rebate, dust и jackpot
  распределение.
- Не менять деплой, адрес контракта, миграцию или ABI ради нового контракта.
- Не возвращать удаленный экспериментальный wallet path в обычные wallet,
  betting, mining, resolver или canary flows.
- Не читать и не печатать секреты, приватные env, RPC URL, private keys,
  mnemonics, wallet files, cookies, Privy sessions, webhook URLs, DB URLs,
  Sentry DSNs.
- Не делать реальные транзакции без свежего точного разрешения после свежего
  dry-run Preview.
- Останавливать живой сценарий при duplicate hash, duplicate nonce, unknown
  pending nonce, unplanned revert, hashless timeout, indexer mismatch или
  missing proof artifact.

## Текущий снимок перед автономной работой

Свежий `npm.cmd run proof:autonomous:summary` от 2026-07-30T15:50:14.654Z:

- режим read-only: транзакции, деплой и live soak не запускались;
- launch gates: `0/14` complete, следующий blocker `G1`;
- V10 deployed identity: manifest matches, runtime executable, но strict
  deployed proof fail-closed из-за metadata-only bytecode mismatch;
- testnet soak: not-started;
- pending nonce recovery dry-run: `pendingGap=0`, `wouldSend=false`;
- V10 canary matrix: blocked, live canary log отсутствует;
- strict external gates blocked: signoff, configured chain RPC, production
  host, indexer DB/finality/manifest, restore, backup, monitoring, wallet/UX QA,
  G1 env.

Практический вывод: автономно продолжаем local/off-chain hardening, proof
tooling, UX, API, DB, indexer, performance и redaction. Реальные ставки,
approvals, claims, nonce replacements, live canary и soak остаются отдельным
разрешаемым этапом после свежего dry-run Preview.

## Ежедневный автономный цикл

1. `npm.cmd run proof:autonomous:summary`
2. `npm.cmd run cleanup:workspace:autonomous`
3. `npm.cmd run test:logic:summary`
4. `npm.cmd run typecheck:summary`
5. `npm.cmd run lint:summary`
6. `npm.cmd run baseline:bundle:summary`
7. `npm.cmd run proof:prelaunch:summary`

Если один и тот же failure не чинится за две попытки, не крутить бесконечно.
Нужно зафиксировать точный blocker и перейти к следующей локальной задаче.

## Что еще не сделано

### P0 - локальные blockers и false-green защита

- Сверить `proof:autonomous:summary`, `proof:prelaunch:summary` и статусные
  docs: все external G1-G14 blockers должны оставаться видимыми.
- Проверить, что ни один summary не считает external blocker успешным только
  из-за локального теста.
- Проверить, что `proof:indexer:strict:summary`,
  `proof:restore:strict:summary`, `db:backup:strict:summary`,
  `monitor:runtime:summary`, `proof:qa:strict:summary`,
  `proof:host:strict:summary` fail-closed без реальных внешних inputs.
- Добавить guards, если какой-то proof command печатает слишком много,
  показывает paths/secrets или скрывает blocker.
- Держать `.codexignore` и cleanup allowlist в актуальном состоянии, чтобы
  heavy artifacts, logs, reports и cache не мешали автономным проверкам.

Acceptance:

- required local rows проходят;
- external rows остаются blocked с компактными причинами;
- нет raw secrets, RPC URLs, DB URLs, webhook URLs и private paths в routine
  summaries.

### P0 - V10 contract invariants

- Расширить `scripts/test-contract-v10-invariants.mjs` на duplicate batch
  entries, duplicate claims, replay-like inputs и late actions после close.
- Проверить все financial exits: `claimRewards`, rebate claims, resolver
  reward, dust paths, batch paths. Условие: accounting закрывается до внешнего
  token transfer.
- Проверить CEI и reentrancy assumptions для каждого external mutating
  entrypoint.
- Добавить edge cases для zero amount, max stake, packed boundaries, epoch
  boundary, timestamp boundary, dust residuals и rounding.
- Проверить false-return/reverting token transfer rollback assumptions без
  изменения deployed contract.
- Проверить, что staking entrypoints имеют ровно один `safeTransferFrom` и
  не добавляют скрытый второй transfer.
- Проверить event order и event count там, где frontend/indexer полагаются на
  receipt logs.
- Пинить ABI selectors и V10 identity, но не менять деплой.

Commands:

- `npm.cmd run test:contract:v10`
- `npm.cmd run test:contract:v10:summary`
- `npm.cmd run test:logic`
- `npm.cmd run proof:contract-deployed:v10:offline:summary`

### P0 - ABI, frontend и indexer compatibility

- Сравнить `contracts/LineaOreV10.sol`, `config/abi.ts`, frontend event usage
  и indexer event parser.
- Доказать совместимость topic order, indexed args, bigint serialization,
  address normalization и log index handling.
- Проверить исключение по aggregate dust summary events: frontend ABI может
  знать их, но indexer не должен double-count per-epoch dust accounting.
- Добавить replay/idempotency drills: тот же tx/log дважды, тот же log index,
  foreign contract with same tx/log id, malformed log, missing payload,
  replacement/reorg-like row.
- Проверить scoped DB isolation по chain id, contract address, deploy block,
  finality и namespace.
- Проверить deploy block/finality proof tooling: strict mode должен быть
  blocked без реальной конфигурации.

Commands:

- `npm.cmd run test:indexer-storage`
- `npm.cmd run test:indexer-storage:summary`
- `npm.cmd run proof:indexer:summary`
- `npm.cmd run proof:indexer:strict:summary`

### P0 - wallet runtime без отправки транзакций

- Проверить manual bet, repeat bet, reward claim, rebate claim, resolver
  reward claim, pending tx recovery, Wallet Settings и Privy loading.
- Закрыть duplicate-send windows до появления tx hash: быстрый double click,
  rerender gap, stale callback, parallel modal action.
- Проверить rejected signature, reverted receipt, pending, success, timeout,
  hashless timeout, wrong network, reconnect, reload, account switch.
- Проверить explorer links: link появляется только когда chain и tx hash
  известны.
- Проверить error copy: rejected, reverted, pending, wrong network,
  insufficient funds, rate limited, stale data и degraded RPC должны быть
  различимы.
- Проверить, что manual bet disabled, когда Auto-Miner владеет wallet flow.
- Проверить pending nonce recovery: dry-run по умолчанию, no contract calls,
  no unknown nonce replacement.

Commands:

- `npm.cmd run test:logic`
- `npm.cmd run typecheck`
- `npm.cmd run smoke:browser`

### P0 - Auto-Miner two-tab и recovery

- Проверить Web Locks: acquire, contention, unsupported browser, reload,
  orphan recovery, stale session cleanup.
- Проверить, что mining loop не стартует до эксклюзивного lock ownership.
- Проверить no send after lock loss.
- Проверить failed setup: возврат в idle, очистка staged recovery, нет stale
  restore loop.
- Проверить pending nonce blocked: persisted session сохраняется, но нет
  auto-resume и нет новой отправки.
- Проверить roles: нет duplicate active role/epoch pair.
- Улучшить UI copy для lock contention, unsupported lock, stale pending,
  reverted tx, RPC retry exhaustion.

Commands:

- `npm.cmd run test:logic`
- `npm.cmd run typecheck`
- `npm.cmd run smoke:browser`

### P1 - API, cache, redaction и rate limits

- Проверить все `app/api/**/route.ts(x)` JSON routes: explicit no-store.
- Проверить Cookie-sensitive routes: `Vary: Cookie`.
- Проверить bounded JSON body на malformed, huge body, wrong content-type.
- Проверить 429 responses: no-store, redacted, no raw keys/origins/addresses.
- Проверить route error redaction по keys и values, включая nested objects.
- Проверить admin/chat auth origin validation: localhost/private/reserved host
  rejection там, где это expected.
- Проверить external rate-limit strict mode: multi-replica должен fail-closed
  без реального public external store.
- Проверить deposit-history recovery: single-flight и cooldown.

Commands:

- `npm.cmd run test:logic`
- `npm.cmd run test:fetch-timeout:summary`
- `npm.cmd run smoke:http`
- `npm.cmd run load:http`
- `npm.cmd run health:prod:summary`

### P1 - DB, backup, restore и operations

- Расширить SQLite backup tests: corrupt source, corrupt final, wrong scope,
  stale manifest, no overwrite, partial artifact cleanup, disk-full simulation.
- Проверить atomic publish: temp file в той же директории, integrity check,
  rename, cleanup только temporary artifacts.
- Проверить restore strict: не пишет при missing source/backup/manifest.
- Проверить backup strict: требует configured DB, backup dir, retention,
  freshness policy.
- Проверить redacted summaries: без raw DB paths, credentials и secrets.
- Проверить scoped DB: chain id, contract address, deploy block, finality,
  namespace isolation.

Commands:

- `npm.cmd run test:db-operations`
- `npm.cmd run test:db-operations:summary`
- `npm.cmd run db:backup:summary`
- `npm.cmd run db:backup:strict:summary`
- `npm.cmd run proof:restore:summary`
- `npm.cmd run proof:restore:strict:summary`

### P1 - monitoring, cleanup и runtime ops

- Проверить monitoring drill: partial alert failure, all-settled fanout,
  restart dedup, stale health, backup freshness alerts.
- Проверить missing-config summaries: только safe tokens, без endpoints.
- Проверить cleanup loop: typed PID, cooperative stop, no force kill, no
  duplicate loop.
- Проверить cleanup allowlist: только `.next/cache`, reports, coverage,
  test-results, `.tmp`, age-gated by newest nested file.
- Проверить host proof strict: blocked без domain/HTTPS/load evidence.
- Проверить production health: fail-closed без origin/diagnostics secret.

Commands:

- `npm.cmd run test:monitoring`
- `npm.cmd run test:monitoring:summary`
- `npm.cmd run monitor:runtime:summary`
- `npm.cmd run cleanup:workspace:dry-run:summary`
- `npm.cmd run cleanup:workspace:autonomous`
- `npm.cmd run proof:host:summary`
- `npm.cmd run proof:host:strict:summary`

### P1 - UX, mobile, accessibility

- Проверить mobile layout: wallet settings, manual bet, Auto-Miner, reward
  scanner, rebate panel, chat/profile modal, first visit tutorial.
- Проверить focus trap: Tab loop, Shift+Tab, Escape, restore focus, body scroll
  lock.
- Проверить reduced motion для canvas/confetti/particles.
- Проверить decorative canvases: `aria-hidden`.
- Проверить button targets на mobile: минимум 44px там, где это primary
  interaction.
- Проверить number typography: jackpot, reward, stake, balance, gas, fee,
  epoch, countdown, extreme values.
- Проверить visible transaction states: preparing, signing, pending, success,
  failed, rejected, degraded/stale.
- Не ухудшать chart freshness и intentional user-visible refreshes.

Commands:

- `npm.cmd run smoke:browser`
- `npm.cmd run baseline:browser:summary`
- `npm.cmd run baseline:bundle:summary`
- `npm.cmd run typecheck`
- `npm.cmd run test:logic`

### P1 - performance

- Снимать `baseline:bundle:summary` после UI/build changes.
- Смотреть top largest static files и фиксировать только measured regressions.
- Найти heavy React components с unnecessary rerenders: wallet settings,
  reward scanner, rebate/deep scan, analytics panels, leaderboards, chat,
  header charts, Auto-Miner controls.
- Проверить polling waste по каждому live hook: убедиться, что inactive tab,
  hidden modal, disconnected wallet и stale network не продолжают тяжелые
  refreshes без пользовательской пользы.
- Свести duplicate fetches/multicalls, где один и тот же chain/API snapshot
  читается несколькими компонентами в одном render interval.
- Проверить lazy-loading для admin/analytics/deep wallet panels, если baseline
  показывает стабильный выигрыш без first-action regression.
- Проверить API latency и SQLite query cost на stats/history/rewards/rebates:
  добавить индексы или bounds только при измеренном узком месте.
- Проверить animations на CPU waste и reduced-motion behavior.
- Проверить, что perf changes не ломают live chart freshness, wallet status и
  transaction state visibility.

Commands:

- `npm.cmd run baseline:bundle:summary`
- `npm.cmd run smoke:browser`
- `npm.cmd run typecheck`
- `npm.cmd run test:logic`

### P2 - security scan follow-up

- Резюмировать или запускать formal scan только через codex-security workflow.
- Перед threat modeling сначала пройти security-scan capability preflight.
- Не считать старый sealed scan доказательством текущего состояния.
- Проверить residual classes: host auth, Web Locks, keeper receipt status,
  nonce ownership, deposit recovery limiter, dry-run defaults, CI SHA pins,
  dormant client auto-resolve.
- Создавать canonical artifacts только в workflow-owned scan path, если scan
  workflow этого требует.
- Не вызывать terminal fail для resumable scan из-за окончания turn/context.

### P2 - docs и operator readiness

- Свести `docs/current_state.md`, `docs/mainnet-status-board.md`,
  `docs/testnet-readiness.md`, `docs/launch-evidence-command-map.md` и
  `docs/production-runbook.md`.
- Убедиться, что все commands в docs существуют в `package.json`.
- Убрать противоречия между local proof, testnet proof и production blockers.
- Обновить acceptance checklist только фактической evidence, не ожиданиями.
- Держать blockers компактными: кто должен сделать, какой artifact нужен,
  какая команда должна стать green.

## План ставок и транзакций

Автономно можно:

- инспектировать canary/soak/pending-nonce scripts;
- запускать только dry-run summaries;
- готовить Preview без отправки транзакций;
- улучшать duplicate-send, pending recovery, explorer links и failure copy;
- проверять, что dry-run не читает signing wallet и не вызывает game/token
  write methods.

Автономно нельзя:

- manual bet;
- Auto-Miner bet;
- claim, rebate, approval, resolver reward, cancel, replace, fee bump;
- live canary tranche;
- live soak;
- deploy или contract mutation.

Перед реальными ставками нужен fresh Preview:

- network и chain id;
- V10 contract identity evidence;
- roles: manual, autominer A, autominer B;
- exact tx count;
- stake per tx и total stake;
- gas estimate и gas cap assumptions;
- balance/allowance status только present/missing/redacted;
- nonce status и pending-gap summary;
- duplicate-send protection status;
- stop criteria;
- artifact paths;
- строка `no transaction sent yet`.

После Preview нужно свежее точное разрешение пользователя на конкретный tx
count, roles, stake, max gas, stop criteria и artifact paths. Старое
`разрешаю` или `работай автономно` достаточно для локальных тестов, но не для
wallet sends.

## Очередь больше чем на два дня

Эта очередь рассчитана на автономное выполнение блоками. После каждого блока
нужно запускать указанные проверки, фиксировать только фактический результат и
не закрывать внешний blocker локальной симуляцией.

### День 1 - contract/runtime safety

Цель: убрать максимальное количество локальных false-green и wallet/contract
регрессий без сети и без транзакций.

1. Запустить autonomous loop.
2. Закрыть локальные failures из `test:logic:summary`, если они есть.
3. Расширить V10 invariants по duplicate/replay/late/CEI boundaries.
4. Проверить все V10 financial exits: reward, rebate, resolver reward, dust,
   protocol fee flush.
5. Пинить event order для claim/rebate/reward/dust paths, где indexer или UI
   завязаны на receipt logs.
6. Проверить wallet failure copy: rejected, reverted, pending, timeout,
   insufficient funds, wrong network, provider/RPC failure.
7. Добавить guards для duplicate-send windows до tx hash.
8. Проверить pending tx persistence: chain, contract, actor, nonce, hash.
9. Проверить Auto-Miner Web Lock fail-closed и no-send-after-lock-loss.
10. Запустить проверки.

Checks:

- `npm.cmd run test:contract:v10`
- `npm.cmd run test:logic`
- `npm.cmd run typecheck:summary`
- `npm.cmd run proof:autonomous:summary`

Stop:

- повторяется один и тот же failure после двух разных попыток;
- нужно менять randomness/tokenomics/contract deployment/ABI;
- нужна реальная подпись или transaction send.

### День 2 - frontend/indexer/API compatibility

Цель: доказать, что frontend, API и indexer одинаково понимают V10 events,
storage scope и transaction states.

1. ABI/indexer compatibility.
2. Topic order, indexed args, normalized addresses, bigint serialization.
3. Same tx with multiple log indexes.
4. Replay same tx/log idempotency.
5. Foreign contract same tx/log isolation.
6. Malformed/partial log handling.
7. Deploy block/finality strict fail-closed proof.
8. API no-store coverage for JSON routes.
9. `Vary: Cookie` for session-sensitive routes.
10. Error redaction for route errors, auth failures, rate limits and body
    parser failures.
11. Deposit recovery limiter: no cross-user payload reuse, cooldown visible,
    bounded global chain scans.
12. Browser smoke for core UI paths without signing.

Checks:

- `npm.cmd run test:indexer-storage`
- `npm.cmd run test:logic`
- `npm.cmd run smoke:browser`
- `npm.cmd run proof:indexer:strict:summary`
- `npm.cmd run proof:prelaunch:summary`

### День 3 - operations, backup, restore, monitoring

Цель: сделать так, чтобы запуск был остановлен понятными external blockers, а
не неизвестными runtime gaps.

1. DB backup/restore strict local simulations.
2. Corrupt backup, stale manifest, wrong scope, partial artifact cleanup.
3. Restore strict: no write on missing source/manifest.
4. Backup strict: configured DB/path/retention/freshness required.
5. Monitoring strict: sender/domain, recipient, heartbeat, backup freshness,
   chain-indexer audit, no raw endpoints.
6. Cleanup loop: typed PID, cooperative stop, no arbitrary process kill, no
   non-allowlisted deletion.
7. Host strict: blocked without HTTPS/domain/load evidence.
8. Production health: fail-closed without trusted origin/diagnostic secret.
9. Run daily compact proof.

Checks:

- `npm.cmd run test:db-operations:summary`
- `npm.cmd run test:monitoring:summary`
- `npm.cmd run cleanup:workspace:dry-run:summary`
- `npm.cmd run monitor:runtime:summary`
- `npm.cmd run proof:autonomous:daily:summary`
- `npm.cmd run proof:prelaunch:summary`

### День 4 - UX, accessibility, performance

Цель: улучшить пользовательскую готовность без изменения продукта и без
уменьшения намеренно свежих live states.

1. Mobile layout: manual bet, Auto-Miner, wallet settings, rewards, rebates,
   profile/chat/admin dialogs.
2. Focus trap: Tab, Shift+Tab, Escape, restore focus, scroll lock.
3. Reduced motion and canvas accessibility.
4. Touch targets and disabled-state descriptions.
5. Number typography for jackpot, rewards, balances, gas, epoch/countdown,
   extreme values and zero states.
6. Clear transaction states: preparing, signing, pending, success, failed,
   rejected, degraded/stale.
7. Bundle baseline: top largest static files and regression budget.
8. Measured rerender/polling cleanup only where evidence shows waste.
9. Keep chart freshness, live game state refresh and wallet status refresh.

Checks:

- `npm.cmd run smoke:browser`
- `npm.cmd run baseline:browser:summary`
- `npm.cmd run baseline:bundle:summary`
- `npm.cmd run typecheck:summary`
- `npm.cmd run test:logic`

### День 5+ - security scan closure and pre-canary prep

Цель: подготовить проект к следующему формальному security scan и к live
canary Preview, не отправляя транзакции.

1. Повторять daily loop.
2. Брать самый высокий локальный risk из summaries.
3. Перепроверить residual security classes: host auth, Web Locks, keeper
   receipt/backoff, nonce ownership, deposit limiter, dry-run defaults,
   CI permissions/SHA pins, dormant client auto-resolve.
4. Добавлять targeted guard/test.
5. Проверять узко, затем расширять только при shared impact.
6. Подготовить redacted canary Preview:
   chain id, contract status, roles, exact tx count, stake, gas cap, balances
   present/missing, allowance present/missing, nonce status, stop criteria,
   artifact paths, `no transaction sent yet`.
7. Проверить dry-run live scripts: resolver key не читается до live path,
   wallet client/write methods не вызываются, dry-run default remains true.
8. Подготовить security scan context только через codex-security workflow, если
   scan возобновляется.
9. Держать external blockers явными.
10. Остановиться перед любым signing/write/send.

Checks:

- `npm.cmd run proof:autonomous:summary`
- `npm.cmd run proof:autonomous:daily:summary`
- `npm.cmd run plan:canary:v10:postdeploy:summary`
- `npm.cmd run soak:testnet:clear-pending:summary`
- `npm.cmd run proof:prelaunch:summary`

### Постоянный автономный backlog

Эти задачи можно брать в любом порядке после P0, если текущие проверки green
или blocker уже зафиксирован:

- Уменьшать шум compact summaries без потери blockers.
- Добавлять source/runtime guards на каждый найденный wallet ambiguous state.
- Покрывать negative cases для API body parsing, auth origin и rate limits.
- Проверять docs commands против `package.json`.
- Проверять redaction: logs, summaries, health, monitoring, canary previews.
- Профилировать только измеримые frontend regressions.
- Убирать duplicate calculations/fetches, если tests доказывают неизменность
  chart freshness и wallet status.
- Обновлять `docs/current_state.md` только фактами: что изменено, чем
  проверено, чего не было сделано.
- Не закрывать `External blockers`, пока нет реального artifact/evidence.

## External blockers

Эти задачи нельзя закрыть автономно:

- domain/HTTPS host evidence;
- Privy production/domain config;
- Resend verified sender/domain;
- external rate-limit store;
- real backup path and schedule;
- real restore source and manifest;
- real indexer DB, deploy block and finality proof;
- live V10 canary matrix;
- live managed soak;
- wallet/mobile QA with signed operator evidence;
- final security scan after latest fixes;
- mainnet signoff.
