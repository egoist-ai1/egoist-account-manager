# Производительность и tooling — Egoist 3.2.0 RC

Дата: 6 октября 2026. Этот файл фиксирует реализованный delegated stream; итоговые packaged measurements дополняет основной release receipt.

## Изменения

| Исходное поведение | Реализация | Проверка |
|---|---|---|
| Renderer packages попадали в production dependencies | React/react-dom/Lucide/fonts/clsx перенесены в dev; unused date-fns удалён. Runtime dependencies: SQLite, nanoid, zod | Lock importer согласован; verify-package запрещает bundled renderer packages |
| Native SQLite ABI менялся внутри одного CI job | Node и Electron job разделены; каждый использует свой rebuild | CI pnpm 11.28.0; delivery tests включены в Node job |
| Quota probes дублировались и не имели общей очереди | RefreshSchedulerService: generation dedup, active/manual priority, cancellation, максимум два probes | Отдельные тесты concurrency, FIFO, stale completion, failure capacity, pause/dispose |
| Retry-After не задавал минимальный cooldown | Backoff учитывает provider delay сверх ordinary cap; новая ошибка не сокращает прежний minimum | 429/600 s, fractional/invalid/oversized values проверены |
| Windows Credential Manager блокировал main до20 s | Async read/write/restore/delete APIs, bounded helper, stdin secrets, abort | Injected runner tests; live CredMan не вызывался |
| Redirected probe folders оставляли native side effects доступными | Owned marker/token, canonical directory checks, explicit native guards, Node network guards | Реальный callback не вызывается при запрете; junction/path/marker attacks проверены |
| Синхронный Codex discovery работал в main | Отдельный worker reuse существующих discovery functions; каждый helper ограничен2 s, общий timeout15 s | Fake worker reply/deadline/cancel/probe tests |
| Обновление shortcut icon запускало sync PowerShell до окна | Async filesystem + execFile с deadline5 s; проверка owning EXE и changed IconLocation, cache в существующем userData | Offline runner fixtures, cancellation/no-op/probe guard; root подключает после shell |
| Startup readiness округлялась500 ms log polling | Main-written nonce receipt и timestamp; наблюдение файла25 ms | Launch-boundary tests и PowerShell parser; shipping run отдельно |
| Get-FileHash недоступен в дочернем Windows PowerShell из Node toolchain | SHA-256 вычисляется потоковым .NET API; stream и hash algorithm освобождаются в finally | Три fixtures совпали с Node crypto; startup/benchmark/checksum AST проходят, приложение не запускалось |
| Finalizer был привязан к старым именам и release root | Configured artifactName/output, numeric buildVersion3.2.0.1, textual3.2.0-rc.1 | RC fixture finalization сохраняет historical sentinel |
| Основной build мог оставить стандартный NSIS Setup | Electron-builder создаёт только portable; затем обязательный custom installer с ownership manifest. Default Windows target — только portable | Canonical command и CI завершаются custom packaging, automatic publication запрещена |

Синхронные CredMan exports сохранены для совместимости manual/test callers; они тоже соблюдают probe guard. Ошибки не включают raw helper stderr. Backup восстанавливает exact opaque UTF-8 payload; неподдерживаемая byte encoding вызывает отказ до изменений. Предыдущий absent credential восстанавливается delete API.

Завершённый ранее начавшийся probe продолжает занимать slot до фактического завершения после abort. Это ограничивает native/network concurrency; caller/coordinator отвечает за credential epoch и commit результатов. Scheduler сам не пишет credentials или SQLite.

## Исходные данные упаковки

В аудите3.1.10: ASAR53 006 246 bytes, 8846 files. Выделенные Lucide/date-fns/react-dom составляли40.93 MiB и7791 files внутри archive. Setup110 643 041 bytes иPortable94 815 625 bytes.

Эти значения — исходная точка. Перенос зависимостей сам по себе не доказывает такое же уменьшение compressed EXE или startup/RAM. Новые размеры определяет `verify:package` и итоговая сборка, CPU/RAM — [native protocol](../benchmark-3.2.0.md).

## Проверено в delegated stream

- 7 focused Vitest suites: **34/34**, включая5 startup rejection tests; native/provider actions не выполнялись.
- Node delivery tests: **22/22**, fake release files и mocked publication. GitHub release не создавался.
- ESLint delegated services/tests проходит; три актуальных PowerShell scripts проходят parser.
- Дополнительная проверка async shortcut adapter: **14/14** в трёх suites, включая5 новых тестов; реальный COM и пользовательские ярлыки не вызывались. ESLint проходит.
- Canonical Playwright config обнаруживает **44 сценария в 5 файлах** ровно по одному разу; ESLint проходит. Полный прогон выполняет владелец UI после итоговой сборки. Проверки DPI используют browser emulation и не доказывают поведение Windows при системном DPI.
- Общий TypeScript verdict, итоговый smoke и shipping measurements фиксирует основной release receipt.

Read-only проверка дочернего Windows PowerShell 5.1 воспроизвела отсутствие `Get-FileHash`; команды CIM, запуска процессов, JSON и файловой системы доступны. Источники, хэши и результаты .NET SHA-256 сохранены в [receipt](../../artifacts/3.2.0/verification/powershell-tooling-hash.json).

Shipping application, competitor binaries, host autostart и пользовательские profiles этим stream не запускались/не изменялись. Root выполняет сериализованный native rebuild, build, exact package/startup checks и добавляет реальные результаты в общий отчёт. Comparative Windows measurements остаются pending до готовности изолированного guest.

## Последовательность локальной сборки

`pnpm run build` последовательно выполняет typecheck/lint, очищает только `dist`, компилирует main/preload/renderer, перестраивает SQLite для Electron, создаёт portable и упаковывает custom Setup. Стандартный electron-builder NSIS installer не входит ни в эту команду, ни в default Windows target. `nsis.artifactName` остаётся metadata для finalizer, не выбором target.

Эквивалентные отдельные команды для release coordinator:

```powershell
pnpm run typecheck
pnpm run lint
pnpm run clean:dist
pnpm exec tsc -p tsconfig.main.json
pnpm run build:preload
pnpm exec vite build
pnpm run rebuild:native:electron
pnpm exec electron-builder --win portable --publish never
pnpm run build:installer
pnpm run verify:package
pnpm run verify:startup
```

В CI Node ABI остаётся в отдельном job. Electron job выполняет canonical build и проверяет его окончательный unpacked payload; upload включает exact files и ownership receipt. Команда `build:installer` сверяет byte parity dist/ASAR и executable metadata, формирует manifest владения, затем обновляет blockmap/latest/checksums. Она требует уже собранный payload и portable; ошибку нельзя обходить выдачей стандартного Setup.
