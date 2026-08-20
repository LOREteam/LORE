# Testnet hardening plan / План доводки тестнета

Статус: рабочий backlog, не release sign-off. Этот документ задаёт путь к максимально production-like Linea Sepolia; ни один пункт ниже не означает, что доказательство уже получено.

## Guardrails / Границы

- V9 остаётся compatibility baseline до внешне подтверждённого canonical V10 cutover. Нельзя удалять или ослаблять V9-маршруты только потому, что V10 проходит локальные проверки.
- Старый proof для `0x98ee...` — историческое доказательство прежнего развёртывания. Текущий V10 `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` требует нового manifest, provenance и строгой проверки именно этой идентичности.
- Randomness намеренно вне текущего объёма работ и остаётся открытым риском. Его нельзя неявно считать закрытым в testnet/mainnet readiness.
- Никаких deploy, подписаний, wallet actions, approvals, транзакций или иных chain writes в рамках этого плана. Bounded signed canary допускается только после отдельного свежего, точного consent на конкретный Preview/лимит/окно.
- Все секреты, приватные ключи, RPC URLs с ключами, wallet sessions и персональные данные исключаются из артефактов, журналов и отчётов.

## P0 — доказать безопасную production-like среду

### P0.1 Runtime identity and provenance / идентичность рантайма

Собрать новый V10 testnet manifest, привязанный к canonical contract `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a`, chain/network, deploy block, ABI/runtime digest и immutable Git SHA. Строгий анализатор обязан отклонять старый адрес, иной SHA, несовпадающий epoch-bound режим, неполный JSONL и неявные fallback values.

Exit criteria:

- Новый manifest и proof содержат один явный V10 target; `0x98ee...` помечен historical и не засчитывается.
- Каждая запись доказательства имеет связанный run id, immutable SHA, runtime/provenance digest, timestamp и epoch identity.
- Strict verifier воспроизводимо принимает только полный proof текущего V10 и fail-closed отклоняет подмены address/SHA/digest/epoch.

### P0.2 Production-like topology / топология, близкая к production

Поднять отдельную testnet-инфраструктуру: минимум две web-реплики, отдельные indexer/bot/monitor процессы, реальный Redis/Valkey с Lua `EVAL`, внешняя БД и проверяемая резервная копия. Локальный single-process supervisor не является эквивалентом этой топологии.

Exit criteria:

- Обе реплики обслуживают один и тот же runtime identity и переживают переключение трафика без двойной отправки, потери intent или расхождения read model.
- Lock/lease/nonce/claim paths выполняются через реальный Redis/Valkey, а не memory fallback; отказ Redis переводит опасные действия в fail-closed состояние.
- Внешняя БД имеет зафиксированные backup/restore процедуры; восстановление проверено на изолированной копии, включая indexer reconciliation и reorg-safe повторный проход.
- Health, error, lag, queue, Redis, DB, RPC и disk signals наблюдаемы отдельно для web/indexer/bot/monitor и имеют owner/alert route.

### P0.3 Public read-model correctness and scale / корректность публичной модели

Заменить запросы, сканирующие весь raw SQLite на каждом публичном запросе, на materialized public read-model snapshot. Snapshot должен иметь монотонный `publicReadModelRevision`, привязанный к profile revision/indexer progress и обновляться атомарно вместе с reconcile/reorg обработкой.

Exit criteria:

- Публичные global stats и leaderboards не выполняют O(N) raw-table scan на request path.
- Каждая выдача содержит или внутренне связывается с revision/watermark, который корректно меняется при historical repair, reconcile и reorg, а не только при latest block/reward.
- Сравнение materialized snapshot с независимым full reconciliation на representative data не выявляет расхождений; stale/degraded состояние явно видно пользователю и оператору.

### P0.4 Bounded operational evidence / ограниченные операционные артефакты

Supervisor и proof pipeline должны писать ограниченные, ротируемые, redacted JSONL-артефакты. Completion разрешается только после строгого анализа полного bounded proof; exit code процесса сам по себе недостаточен.

Exit criteria:

- Размеры журналов, retained runs, error samples и proof window имеют явные лимиты и rotation policy.
- Supervisor запускает strict post-run analysis с timeout, передаёт только allowlisted non-secret runtime identity и публикует компактный status verdict.
- Неполный, просроченный, неподтверждённый или конфликтующий proof не может завершить run как успешный.

## P1 — кампании доказательств и UX

### P1.1 2–4h read-only rehearsal / репетиция без записей

Провести 2–4 часа в production-like topology без подписи и chain writes: observe, index, reconcile, switch replicas, restart non-critical workers и собирать bounded telemetry.

Exit criteria:

- Ноль transaction submissions, signatures, approvals и contract writes; это подтверждено allowlisted telemetry и chain-side read-only audit.
- Нет unhandled errors, duplicate work, lost leases или silent stale state; все intentional degraded states имеют понятный UI/ops статус.
- Реплика и worker restart не создают непредвиденную работу и не ломают read-model revision.
- RPC failover и indexer catch-up остаются в заранее зафиксированных SLO/lag budget.

### P1.2 6-epoch bounded signed canary / ограниченный signed canary

Только после нового отдельного consent выполнить V10 canary на шесть уникальных epochs. Consent должен быть привязан к свежему Preview, точному адресу/chain/SHA, списку ролей, allowance cap, сумме, числу epochs и окну времени; старый consent или старый Preview недействительны.

Exit criteria:

- До старта strict preflight подтверждает V10 runtime/manifest, epoch-bound mode, адрес, chain, signer, роли и лимиты.
- Allowance не превышает exact planned run cap; zero-spend роли не требуют approval и не маскируют ошибку.
- Каждый intent остаётся связанным с подтверждением/receipt, pending/revert/reject recovery не теряет состояние, а неподдерживаемые transaction-envelope types остаются запрещёнными.
- Ровно шесть уникальных epochs закрыты без unexpected revert, duplicate tx/hash/nonce gap, unbound bet, duplicate claim или нарушенного quorum; strict proof verifier принимает полный campaign artifact.

### P1.3 8–12h recovery campaign / восстановление

Проверить recovery под контролируемыми, неразрушающими сбоями: web/indexer/bot restart, crash между broadcast и receipt, RPC failover, temporary Redis/DB unavailability, delayed indexer, restore/reconcile и reorg handling.

Exit criteria:

- Каждая инъекция сбоя имеет timestamp, ожидаемый fail-closed режим, наблюдаемый recovery путь и записанный результат.
- После восстановления нет двойных отправок, потерянных pending intents, неверных claims, orphaned leases или read-model divergence.
- Backup/restore plus reconciliation восстанавливают согласованное состояние в заданный RTO/RPO budget; неопределённость явно помечается до завершения reconcile.

### P1.4 24–48h soak, at least 50 unique epochs / длительный прогон

Запустить 24–48 часов в production-like topology и собрать не менее 50 уникальных epochs. Это campaign evidence, а не mainnet approval.

Exit criteria:

- Не менее 50 unique epochs с непрерывной epoch identity; sample cadence не реже одного раза в 60 секунд.
- Ноль unexpected failures: unbound intent, duplicate hash/nonce, unsafe allowance, quorum bypass, forbidden transaction-envelope action, silent state loss или strict-proof violation.
- P95/P99 latency, RPC/indexer lag, error rate, heap/RSS slope, DB/WAL growth, disk usage и queue depth остаются в заранее определённых budgets без деградации по времени.
- Артефакт кампании bounded, redacted, complete и принимается strict verifier для current V10 SHA/manifest.

### P1.5 P1.17: 2h same-SHA sealed profiling / sealed profiling того же SHA

Сделать двухфазное доказательство одного immutable SHA: отдельный sealed production build/provenance и совместимый profiling build того же source SHA. Не подменять это profiling `.next`-директорией как будто она является sealed release artifact.

Exit criteria:

- Sealed build, profiling build, source tree и manifest привязаны к одному immutable SHA; различия режима явно описаны и проверяемы.
- Два часа profiling evidence включают real native `document.hidden` период не менее 60 секунд, не только headless imitation.
- Auto-Miner/read-only simulation длится не менее 60 секунд и доказывает отсутствие writes в DB/chain/wallet paths.
- Evidence содержит route/chunk ownership, long tasks, memory trend, performance samples не реже 60 секунд и strict provenance verdict; dirty checkout или незащищённые artifacts fail closed.

### P1.6 6h HTTP load and resilience / HTTP-нагрузка

Провести шесть часов controlled HTTP load после введения bounded statistics. Нагрузка должна включать realistic public routes, reconnect/error profiles и наблюдение за materialized read model, но не wallet/chain writes.

Exit criteria:

- Генератор не накапливает неограниченные latency/error arrays: total/max остаются точными, percentile approximation имеет задокументированную точность, retained error samples ограничены.
- P95/P99, error rate, throughput, heap/RSS, event-loop/long-task indicators и DB/Redis metrics остаются в согласованных budgets весь прогон.
- Нет роста задержек от O(N) public queries, memory leak, file-descriptor leak или неограниченного supervisor/log growth.

### P1.7 Physical mobile and Privy HTTPS / физический mobile QA

Проверить реальные телефоны и реальные wallet surfaces: MetaMask mobile/browser и минимум один альтернативный поддерживаемый wallet, плюс Privy на публичном HTTPS origin. Fixture и desktop-only automation не заменяют это доказательство.

Exit criteria:

- Connect, wrong-network, chain/account change, reject, pending, revert, reload/reconnect и clean-wallet first action показывают точный recoverable state без silent no-op.
- Перед отправкой action повторно валидируются chain/account; malformed provider responses не считаются безопасной сменой контекста и не уничтожают pending intent.
- Mobile layout остаётся usable для overlay, side panel, rewards/jackpot, числовой типографики и error/recovery paths.
- Privacy/session boundaries соблюдены: нет секретов в UI, URL, client logs или support artifacts.

### P1.8 Seven-day staging observation / 7-дневное наблюдение

После успешных коротких кампаний вести семь последовательных дней staging наблюдения в той же topology, с ежедневной проверкой reconciliation, backup viability, alert delivery и bounded artifact retention.

Exit criteria:

- Семь полных календарных суток без необъяснённых critical security/correctness incidents; каждый incident имеет классификацию, owner и закрытый remediation evidence.
- Daily reconciliation сравнивает on-chain/indexer/read model состояния и документирует все расхождения до закрытия.
- Daily restore/readiness check подтверждает backup integrity без воздействия на рабочую среду.
- Alert delivery проверена end-to-end для RPC/indexer/Redis/DB/replica/proof failures; отсутствие сигнала считается failed observation, а не success.

## Final evidence boundary / Граница финального доказательства

После закрытия backlog потребуется отдельный clean-checkout, immutable-SHA цикл: reproducible install/build, полный набор локальных gates, supported security scan и sealed P1.17 evidence. Это остаётся отдельной задачей и не заменяется текущими файлами, локальными тестами или историческим `0x98ee...` proof.

Внешние prerequisites по-прежнему включают canonical V10 deployment/cutover evidence, production-like replicas/Redis/external DB, backup/restore, HTTPS/Privy/mobile proof, monitoring/alerting и статусные блокеры. До их независимого подтверждения проект нельзя называть готовым к mainnet.
