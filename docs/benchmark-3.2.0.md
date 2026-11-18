# Egoist 3.2.0 — протокол измерения

Версия сценария: 1, 6 октября 2026. Цели ниже не являются уже достигнутыми результатами. Сравнение binaries конкурентов пока не выполнено: отдельного готового Windows guest нет; запуск на основной системе с пользовательскими credentials протоколом запрещён.

## Три независимые группы

1. **Shipping binary, fresh profile, hidden.** Неизменённый упакованный Egoist, собственные SQLite/vault services, пустой отдельный userData и native adapters в isolated mode. `benchmark:native` измеряет эту группу. Внешняя сеть, Credential Manager, autostart, запуск IDE и browser login запрещены; live credentials не копируются.
2. **Development fixtures.** Реальный renderer и синтетический bridge для 1/10/100/200 профилей, длинных имён, разных периодов, ошибок и stale data. Замеры таблицы/inspector не выдаются за native shipping performance.
3. **Shipping binaries в disposable Windows guest.** Egoist и закреплённые версии конкурентов. Guest не содержит host credentials, общих writable folders, рабочих IDE-профилей или browser sessions. Provider-dependent identity проверяется только отдельными тестовыми аккаунтами; без них ставится «не проверено».

Environment redirection сама по себе недостаточна для первой группы. Main проверяет root marker, token, реальные вложенные пути и устанавливает guard до native setup. В третьей группе binaries не меняются: fixture hooks или instrumented build переводят результат в отдельную development группу.

## Доступные команды

В агентской задаче перед проверкой получить собственный runtime work, не использовать runtime другого чата:

```powershell
$brainConfig = Get-Content -LiteralPath "$env:USERPROFILE\.codex\brain-pointer.json" -Raw | ConvertFrom-Json
$taskPaths = & (Join-Path $brainConfig.root 'brain.cmd') task paths --id $env:CODEX_THREAD_ID | ConvertFrom-Json
$env:CAM_TEST_WORK_DIR = $taskPaths.work
$env:CAM_RELEASE_TEST_WORK = $taskPaths.work
pnpm run test:delivery
pnpm run verify:package
pnpm run verify:startup
pnpm run benchmark:native
```

Scripts читают productName/version/output из package.json. Основной пакет: `release/3.2.0-rc.1/win-unpacked/Egoist.exe`; старый `release/win-unpacked` не перезаписывается. Допустимый executable ограничен конкретным output boundary; уже работающий экземпляр этого exact executable вызывает отказ. При запуске используется Hidden.

`verify-packaged-startup.ps1` поддерживает `-SampleSeconds`, `-SampleWarmupSeconds`, `-SampleIntervalMs`, `-ReportPath`, `-ProbeWorkRoot`. Скрипт сохраняет временные данные в принадлежащем task work root. Для самостоятельного неагентского запуска по умолчанию используется системный TEMP.

Готовность задаёт main receipt: nonce token, PID, version, renderer-ready timestamp, process uptime и состояния guard. Скрипт проверяет принадлежность receipt запуску. Polling файла каждые 25 ms определяет время наблюдения; основной показатель launch→renderer-ready вычисляется по timestamp приложения и не округляется до интервала polling. Это `did-finish-load` shell readiness, а не завершение всех provider probes или восстановление данных.

`benchmark-packaged-app.ps1` по умолчанию выполняет 30 fresh-profile starts и один 600-second hidden idle на последнем запуске, с 3-second warmup перед idle. Показатель **не назван cold-cache**: Windows file cache не очищается. Для настоящего cold startup guest откатывается к согласованному snapshot перед каждым повтором.

Результат сохраняется в `artifacts/3.2.0/verification/native-fresh-<UTC timestamp>.json`, включая каждый успешный run, failure, SHA-256 exact EXE, raw samples, p50/p95 и ограничения. Ошибочные run не исключаются из количества attempts и не получают нулевое время. Failure exit code остаётся ненулевым.

## Контролируемый Windows-стенд

Фиксировать OS build, CPU/vCPU, logical cores, RAM, SSD, GPU/renderer settings, power plan, WebView2/runtime versions и network mode. У всех продуктов одинаковые размеры 860×560, 1080×780 и 1460×900, DPI 100/150/200%, fixture seed, freshness и refresh cadence. Порядок продуктов чередовать; snapshot guest не содержит пользовательской истории. Любое изменение background polling записывать вместе с результатом.

Скачивать только pinned official release assets из [матрицы](competitors-3.2.0.json). Сохранять URL/tag, retrieved timestamp, bytes и **локально вычисленный** SHA-256; advertised GitHub digest сверять, но не выдавать за собственной download verification. Authenticode и publisher проверять отдельно от hashes. MSI/external WebView2 и самодостаточный EXE имеют разную комплектацию.

Для каждого поддерживаемого сценария — 30 starts, 100 interaction repeats, десять минут idle и два часа soak. Include: startup с существующим профилем/большой историей, поиск/выбор строки, inspector, tray reopen, quota response→UI, switch phases и failures. Неподдерживаемые функции/fixtures конкурента — N/A; они не записываются как нулевые latency или resource values.

CPU-seconds и Private Bytes собираются для **всего наблюдаемого принадлежащего дереву процессов**, включая GPU/utility/WebView2 и helpers, а не только main PID. Каждый PID привязан к CreationDate; PID reuse не разрешает attribution или cleanup. Суммарный CPU выражается в процентах одного logical core, без деления на число ядер. Private Bytes — частная committed память; это не сумма Working Set и не размер installer.

Скрипт использует [Win32_Process counters](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process) для KernelModeTime/UserModeTime в единицах 100 ns и [Process.PrivateMemorySize64](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.privatememorysize64) для Private Bytes. CreationDate/StartTime проверяются перед чтением private memory; количество успешно прочитанных metrics также записывается. CPU известных завершившихся процессов удерживается в cumulative ledger. Процесс, полностью возникший и завершившийся между samples, может быть не замечен; для publication-grade soak добавить ETW/process-start tracing либо отметить этот предел. Cleanup затрагивает только проверенное owned tree; посторонние приложения не останавливаются.

## Цели и correctness gates

| Сценарий | Начальная цель |
|---|---|
| Existing-profile shell startup | p95 ≤3 s |
| Fresh-profile startup | p95 ≤4 s |
| Search/row selection, 100 profiles | p95 ≤100 ms |
| Inspector | p95 ≤200 ms |
| Tray reopen | p95 ≤150 ms |
| Private Bytes, visible/tray | ≤320 / 220 MiB |
| Idle без refresh | ≤0.5% одного logical core |
| После 1000 операций | стабильный growth ≤20 MiB, без дочерних утечек |

Скорость переключения не принимается без проверки данных. Сценарий profile B/probe B/Desktop A не считается подтверждённым switch. «Runtime не подтверждён» сохраняется в receipts и входит в correctness breakdown. Provider/network latency выделяется из локальной записи, запуска и UI propagation.

Fault scenarios: malformed late import, traversal/conflict, crash на границе каждого write, WAL/locks, отсутствующий файл и CredMan record, offline/401/403/429/Retry-After, stale response из прошлого credential generation, unknown bucket/fraction/arbitrary window/reset без нового наблюдения, auth pending dialog, RU/EN/privacy/keyboard/reduced motion. После каждого аварийного теста проверять restart/recovery и отсутствие plaintext stages.

Исторический `artifacts/3.0/verification/switch-soak.json` описывает synthetic journal transitions. Его millisecond timings не являются Desktop switch benchmark; файл сохраняется как историческое evidence и не перезаписывается новым сценарием.
