# Разработка Квессер 3.2.0 RC4

Сборка `3.2.0-rc.4` рассчитана на Windows x64. Используйте Node.js 24 и **pnpm 11.28.0** из `packageManager`. Для установщика нужны компилятор Windows .NET Framework/WPF и NSIS. Сборка portable подготавливает NSIS для следующего шага. [Результат RC4](releases/3.2.0-rc.4.md)

## Временные каталоги

До tests и probes задайте отдельный временный каталог под системным TEMP; в проект и в репозиторий правил он не кладётся:

```powershell
$devWork = Join-Path ([IO.Path]::GetTempPath()) ('egoist-dev-' + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $devWork | Out-Null
$env:CAM_TEST_WORK_DIR = $devWork
$env:CAM_RELEASE_TEST_WORK = $devWork
$env:CAM_TEST_WORKDIR = $devWork
$env:pnpm_config_store_dir = Join-Path $devWork 'pnpm-store'
$env:pnpm_config_cache_dir = Join-Path $devWork 'pnpm-cache'
$env:npm_config_cache = Join-Path $devWork 'npm-cache'
$env:npm_config_devdir = Join-Path $devWork 'node-gyp'
```

Это три разных имени переменных: `CAM_TEST_WORK_DIR` используют fixtures и startup, `CAM_RELEASE_TEST_WORK` — delivery tests, `CAM_TEST_WORKDIR` — приёмка native-установщика. Исходники и итоговые receipts остаются в проекте; временные fixtures и кэши — в этом каталоге.

Для Vitest используйте короткий путь `CAM_TEST_WORKDIR` под TEMP. Проверка миграции старого установщика создаёт вложенные пути, у которых в .NET Framework действует предел длины. При запуске `test:delivery` из Codex локальные тесты проверки путей требуют отдельного каталога, заканчивающегося на `tasks/<фактический CODEX_THREAD_ID>/work`. Укажите его в `CAM_TEST_WORKDIR` на время этой команды.

В pnpm 11 настройки передаются через `pnpm_config_*`; старый `npm_config_store_dir` игнорируется. Переменные `npm_config_cache/devdir` нужны инструментам нативной сборки. [Официальная конфигурация pnpm 11](https://pnpm.io/11.x/configuring).

## Node и Electron ABI

`better-sqlite3` содержит native module. Один и тот же checkout нельзя одновременно перестраивать для Node и Electron. Node tests выполняются до Electron packaging; CI использует разные jobs и установки зависимостей.

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test:node
pnpm run test:delivery
```

`test:node` делает rebuild для Node ABI. **Delivery tests обязательны**: они проверяют импортируемые packaging helpers, ownership/finalization contracts и release metadata на fixtures. Успех проверок исходников сам по себе не подтверждает shipping EXE.

После Node checks переходите к Electron и не запускайте новый Node rebuild до завершения этого блока:

```powershell
pnpm run build
pnpm run smoke
pnpm run verify:package
pnpm run verify:startup
```

Canonical `build` выполняет typecheck/lint → clean `dist` → main/preload/renderer compilation → Electron native rebuild → **portable** с `--publish never` → **custom Setup с manifest владения**. Стандартный NSIS Setup не входит в default Windows target. `build:dir` оставляет только unpacked payload; отдельный `build:installer` требует уже актуальные payload и portable.

Результат сборки находится в `release/3.2.0-rc.4/`. Установщик и portable имеют отдельные контрольные суммы SHA-256.

## Изоляция probes

`verify:startup` создаёт внутри временный каталог каталог `egoist-probe-<UUID>` и marker `.egoist-probe-root.json` с `schemaVersion:1`, `purpose:egoist-isolated-probe` и совпадающим token. `CAM_USER_DATA_DIR`, `CODEX_HOME`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` дочернего процесса должны указывать на существующие реальные папки внутри этого root; symlinks/reparse points не принимаются.

Main проверяет контракт до native setup. Explicit guards блокируют Credential Manager, autostart, desktop integration, provider network, host discovery, внешние URLs/IDE и остановку Desktop. Готовность подтверждает receipt, связанный с nonce/PID/version и guard state. Один redirect `CAM_USER_DATA_DIR` или `CAM_BACKGROUND_PROBE=1` не является изоляцией; неполный контракт вызывает отказ. Используйте готовый wrapper, не отключайте проверки.

Playwright smoke использует синтетические provider данные и safety adapter. Исходники tests находятся в `tests/smoke` и `tests/helpers/electronSafetyStub.ts`. Обычный `pnpm run dev` запускает полноценное приложение с реальными интеграциями и не считается isolated fixture harness. Фоновая проверка UI и startup не должна копировать host credentials, запускать login или останавливать рабочую IDE.

Native installer acceptance, после успешного custom packaging:

```powershell
node scripts/verify-installer-owned.mjs
```

Driver требует `CAM_TEST_WORKDIR`, сверяет custom ownership receipt и работает в собственном target через `/TEST`. Он проверяет reject чужой папки, install/upgrade/uninstall и foreign sentinels; приложение и IDE не запускает. Это ограниченная проверка установщика на текущем host, не полный clean-Windows guest lifecycle.

GUI regression имеет отдельный compile-defined entry в `tests/installer/InstallerFixtureEntry.cs`: принудительный TEST manifest, блокировка native integration и внешнего запуска, immutable task ID/папки. `scripts/installer-gui-fixture.mjs` проверяет actual `CODEX_THREAD_ID`, фиксированную структуру собственной временный каталог и отсутствие ссылок. Native execution требует `CAM_INSTALLER_FIXTURE_REVIEW_SHA`, совпадающий с composite SHA точных текущих исходников после guard review. Не подставляйте чужой ID или пути и не используйте текстовые замены production-кода для изоляции.

## Измерения и исторические команды

[Benchmark protocol](benchmark-3.2.0.md) разделяет hidden shipping probe, development fixtures и неизменённые binaries в отдельном Windows guest. `benchmark:native` не измеряет cold-cache startup или live Desktop switch. Реальные provider/runtime сценарии и сравнение конкурентов требуют guest без host credentials; версии, SHA-256, ошибки и N/A сохраняются явно.

`verify:sandbox`, `verify:sandbox:apply`, `verify:sandbox:live`, `verify:sandbox:live:apply`, `verify:sandbox:live:finalize` — **исторические сценарии 3.1.5/3.1.6** с прежними paths/fixtures и собственным rebuild. Они не являются gates версии 3.2.0 и не входят в canonical build/CI. Windows Sandbox/Hyper-V не включаются автоматически ради этих scripts.

`verify:tray-native` — отдельная проверка `nativeImage` на синтетических битмапах. Она не доказывает скорость reopening, native hover, доступность tray на разных DPI или реальный остаток аккаунта. Её output/userData также должны находиться в собственном временный каталог.

Структура: [ARCHITECTURE](ARCHITECTURE.md), [APP_MAP](APP_MAP.md), [implementation contract](implementation-3.2.0.md), [release checklist](release-checklist.md). Итоговые подтверждения привязываются к точным hashes результата в companion review board.
