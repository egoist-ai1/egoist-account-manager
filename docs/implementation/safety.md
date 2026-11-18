# Egoist 3.2.0 RC — защита данных и проверяемые переключения

Версия отчёта: safety-rc-02, 6 октября 2026. Исходная точка: 3.1.10, commit d315ba1. Реализация относится к текущему рабочему дереву; итоговый commit, SHA сборок и общий release gate фиксирует интеграционный отчёт.

Исправлены атомарность хранения и импорта, границы владения файлами, защищённые snapshots и достоверность переключения. Независимая проверка интеграции дополнительно выявила гонки reauthentication, фоновой синхронизации, recovery и runtime proof; корневой агент исправил их в AccountManager/main. Настоящие аккаунты, Credential Manager пользователя и запущенные IDE в этих проверках не использовались.

## Изменения и доказательства

| Исходная проблема | Реализованное поведение | Доказательство |
| --- | --- | --- |
| Импорт мог перезаписать существующий ID и оставлять частичное применение | Root выдаёт новым профилям UUID; AccountStore.importPortableBatch предварительно проверяет записи и выполняет аккаунты и AG details одной immediate SQLite-транзакцией, конфликт — отказ | db-import-safety: существующий ID, traversal/reserved IDs, SQLite trigger на последней AG details-записи; предыдущие данные и выбор сохранены, частичных аккаунтов нет |
| Лексическое владение путём допускало перенаправление | Managed paths проверяют относительное containment, lstat всех существующих предков до корня диска и canonical realpath; UUID/id не становится произвольным путём | paths-safety и AG backup: настоящая Windows directory junction, чужой sentinel сохранён |
| Исчезновение manifest могло оставить plaintext stage | Codex сохраняет sealed previous evidence до plaintext stage; cleanupOrphanedTransientFiles обрабатывает только собственные прямые transaction directories даже без manifest | durableAuthBundle: orphan stage без manifest, чужая junction, три отдельные child-process аварии с exit 87 |
| Возврат старого auth.json ошибочно означал полный откат | verifyPreviousFiles проверяет каждую прежнюю запись и исходное отсутствие; все sealed rollback payloads проверяются до первого восстановления | durableAuthBundle и managerSafetyIntegration: старый auth + новый global-state не объявляются восстановленными; полный предыдущий bundle восстанавливается |
| AG backup охватывал неполный набор, копирование SQLite могло терять WAL | Новый sealed v2 snapshot охватывает 18 фиксированных файлов/состояний отсутствия, обе SQLite, session caches и логическое Credential Manager state | AG backup: неcheckpointed WAL rows, secondary DB, вновь появившийся machineid, damaged final payload |
| Metadata могла исключить Credential Manager при откате | Sealed manifest аутентифицирует весь metadata index, в том числе присутствие Credential Manager snapshot | AG backup: удаление credentialSnapshot из manifest отклоняется до любых target writes |
| Успех SQLite/файловой записи не подтверждал фактическое содержимое | Writer использует FULL SQLite, fsync временных обычных файлов и readback всех state writes/deletions, storage keys и optional machine file | AG writer: hook меняет записанное SQLite значение без ошибки; readback выявляет mismatch и восстанавливает предыдущий профиль |
| Локальная ротация автоматически выглядела успешной авторизацией | Codex sealVerified по умолчанию не подтверждает новую identity; пассивный AG material становится needs_review, lastAuthenticatedAt и runtime proof очищаются, версия увеличивается | Codex vault, store и обе passive AG branches: Credential Manager/state.vscdb |
| Runtime email из постороннего процесса считался аккаунтом IDE | GetUserStatus допускается только после точной OS-привязки endpoint и повторной проверки после ответа | runtime-evidence: PID reuse, неверный профиль, внешняя install path, listener не на loopback, неверная ancestry, несколько endpoints, post-response replacement |
| Применение профиля и identity IDE смешивались | Отдельные evidence: profileApplied, credential method, launch, runtime. Unsupported runtime сохраняет профиль и snapshot; фактический mismatch вызывает rollback | managerSafetyIntegration: unsupported, CredMan readback mismatch, failed CredMan restore → recovery_required |
| Reauthentication и adoption обходили общий координатор | Root: vault-only reauthentication, очистка выбранного профиля при новой material, общий provider/cross-process lock, recovery gate внутри lock и после await | managerSafetyIntegration: отложенный identity read, pending login за failed switch, concurrent current-session adoption, foreign previous profile sentinel |
| Runtime A мог получить credentials B при пассивной AG синхронизации | Root: локальные tokens переносятся только при совпадении сохранённого refreshToken; новое содержимое не получает prior proof | managerSafetyIntegration: A-runtime/B-CredMan; credential version изменена во время runtime RPC, поздний proof отклонён |
| Native operations блокировали main thread | Async quiesce/launch используют execFile, spawn events и timers; не выполняют Atomics.wait/spawnSync. Test mode не изображает реальный успешный запуск | AG process fixtures: event-loop timer работает во время quiesce, чужой explicit profile отклоняется, launch подтверждается новым OS inventory |

## Контракты сервисов

AccountStore:

- importPortableBatch(records: AccountExportRecord[]): ManagedAccount[] — новые записи без overwrite; одна транзакция.
- getRecoveryRequired(platform): SwitchTransaction | null — независимый gate по провайдеру, включая recovery_required.
- setSwitchVerification(transactionId, evidence) — безопасный DTO evidence в журнале и текущем аккаунте, без изменения optimistic transaction version.
- setRuntimeVerification(accountId, evidence | null) — proof аккаунта отдельно от target journal.
- updateObservedAuthMaterial(id, encryptedAuthJson) — атомарные needs_review, version++, null authentication time/runtime proof, unknown status; recovery дополнительно исключён в SQL UPDATE.
- markCredentialVerified(id) — только для принятой online identity проверки; ready и authentication time, отдельная quota error сохраняется. Runtime proof этот метод не выдаёт.
- finalizeSwitchTransactionWithActiveAccount — committed сохраняет новое evidence текущей транзакции; rolled_back не присваивает target proof предыдущему профилю.

SwitchTransactionService предоставляет requireRecovered, setVerification и beginRollback. Ручной возврат committed/recovery_required переводится в rolling_back с optimistic journal update; failed rollback остаётся recovery_required.

CodexProfileVaultService.sealVerified(account, {identityVerified?: boolean}) требует явного true для новой проверенной identity. Managed homes гидратируются при необходимости; portable import не создаёт промежуточный plaintext auth.json.

Antigravity create backup принимает sealBackup и optional credentialSnapshot {existed, value}; writer требует также unsealBackup и может использовать existingBackup, уже сохранённый координатором. Restore получает unsealBackup, pathInput и backupRoot, предварительно проверяет полный v2 snapshot, возвращает логический credentialSnapshot для private async restore/readback adapter. Повторная независимая backup в writer не требуется.

verifyAntigravityRuntimeIdentity(expectedEmail, input) возвращает runtime evidence. OS binding требует: ожидаемую IDE installation executable, language server внутри установки, PID/creation time/ancestry, explicit --user-data-dir нужного профиля, CSRF и единственного loopback listener владельца. Binding повторно проверяется после GetUserStatus. Сопоставляется именно runtime email, не более сильная identity.

quiesceAntigravityAsync/launchAntigravityAsync — production async API с optional явно внедрённым processAdapter для тестов. Набор останавливаемых процессов привязан к installation, PID/creation time и профилю; launch требует наблюдаемого процесса.

DurableAuthBundleService предоставляет verifyTargetFiles, verifyPreviousFiles, rollback, cleanupTransientFiles и cleanupOrphanedTransientFiles. Откат восстанавливает отсутствие, а не только прежние байты.

## Проверки

Окружение: Windows x64, Node v24.19.0, ABI 137, better-sqlite3 12.11.1. Native addon подготовлен корневым агентом; этот поток не менял зависимости/ABI.

Основная серия проверки охватывала 116 сценариев в 13 files:

- antigravityAccountAdapter, antigravityProcessService, antigravityProfileBackup, antigravityProfileReader, antigravityProfileWriter;
- codexProfileVaultService, db-migrations, db-import-safety, durableAuthBundleService, switchTransactionService;
- paths-safety, antigravity-runtime-evidence, managerSafetyIntegration.

Последний общий прогон этих файлов: 115 passed; один тест ожидал другую категорию текста canonical path error. Категория исправлена, затронутый файл повторно: 9/9 passed. Ранее writer readback regression потребовал исправления порядка слов в assertion; после исправления: 4/4 passed. Это исправления ожиданий диагностического текста, не скрытые изменения условий безопасности. Корневой общий release gate должен фиксировать единый final run после freeze.

ESLint для всех принадлежащих потоку source/test files прошёл. TypeScript не показывает ошибок в этом потоке; на момент проверки оставались ошибки notification/smoke fixtures других владельцев, переданные интеграционному агенту.

Все temp fixtures направлены в work текущей задачи. Vault использует process-local test key и явный безопасный adapter; глобальный fetch запрещён. В integration fixtures запрещены настоящие Credential Manager, provider requests, termination/launch IDE; единственные аварийные child processes запускают собственный bundled production service с синтетическими файлами и строгим Electron alias.

Воспроизводимый целевой запуск из корня проекта: node node_modules/vitest/vitest.mjs run --maxWorkers=2 с перечисленными tests/main/*.test.ts. Native SQLite должен соответствовать Node ABI; Electron delivery run выполняется отдельным шагом после serial rebuild.

## Ограничения и компромиссы

- Это доказательства на синтетических fixtures, реальном Windows filesystem и native SQLite. Реальные IDE accounts, CPU/RAM shipping binary, длительный soak, публичная Authenticode подпись и сравнительная VM не проверялись этим потоком.
- Без явного OS profile binding AG runtime identity считается unsupported. Это ожидаемое ограничение: записанный и проверенный профиль сохраняется, UI сообщает «Аккаунт работающей IDE не подтверждён», автоматическое переключение заблокировано.
- Отдельный Codex app-server probe не доказывает Desktop identity. Credentials evidence сохраняет метод probe; runtime остаётся unsupported до доказанной поддержки конкретного Desktop protocol/version.
- Исторические 3.1 AG snapshots не содержат полного write-set/CredMan state. Root исключает их из полноценного rollback до file writes и переводит ситуацию в recovery_required; частичное восстановление нельзя выдавать за подтверждённый полный откат.
- Синхронная SQLite serialization нужна для consistency; её стоимость на реальных больших IDE databases не измерялась. Native process operations уже асинхронны. Общая миграция Electron/SQLite на другой стек этим результатом не обосновывается.
- Проверка deserialize WAL snapshot использует отдельную memory copy с bytes 18/19 = 1 для quick_check; исходные snapshot bytes сохраняются. Это документированный SQLite workaround, а не исправление содержимого пользовательской базы: [sqlite3_deserialize](https://www.sqlite.org/c3ref/deserialize.html).

## Обратная связь

Этот раздел включается в корневой companion review board с точной версией safety-rc-02 и SHA-256 файла. Самостоятельные обсуждаемые объекты: atomic import/managed paths; sealed snapshots/recovery; раздельное switch evidence; ограничения runtime binding и historical snapshots. Подтверждение означает принятие конкретного реализованного поведения в RC, не заявление публичной стабильности. Ответы пользователя не предвыбраны и хранятся корневым проектным реестром.

## Дополнение final review: одинаковое время транзакций

Версия safety-rc-02 включает дополнительную регрессию порядка switch journal. Created time хранится в секундах; две записи за одну секунду раньше могли возвращаться в порядке вставки «старее → новее», хотя rollback/runtime verification выбирают первый подходящий фактический write.

listSwitchTransactions теперь использует created_at DESC, rowid DESC. getRecoveryRequired и reconcileInterruptedSwitchTransactions используют согласованный created_at ASC, rowid ASC. Это сохраняет порядок времени и однозначно разрешает совпадения.

Новый native regression создаёт две committed транзакции с одинаковым now и IDs, не соответствующими времени по алфавиту. До исправления возвращалась предыдущая запись первой — тест воспроизвёл отказ. После исправления list и limit=1 возвращают последнюю вставку; recovery lookup сохраняет старшую запись первой. Проверены только DB regressions: db-import-safety и db-migrations, 23/23 passed. Общее покрытие этого потока теперь 117 сценариев в прежних 13 файлах; единый release run остаётся у корневого агента.
