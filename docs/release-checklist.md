# Проверка выпусков Квессера

RC4 проверен в виде неподписанного предварительного выпуска Windows x64. [Проверки и ограничения RC4](releases/3.2.0-rc.4.md)

## Архивный чек-лист RC2

Текущий выпуск — **локальный неподписанный `3.2.0-rc.2`**. Пройденный пункт требует receipt для точных source/artifact hashes. Отсутствующие native проверки отмечаются «не проверено», неподдерживаемые сценарии — N/A. Итоговая таблица находится в [отчёте RC](releases/3.2.0-rc.2.md); этот checklist не объявляет её заранее пройденной.

## До смены native ABI

- Сверить semver `3.2.0-rc.2`, Win32 `3.2.0.2`, productName `Kvesser`, видимое имя «Квессер» и прежний appId. Branding не должен создавать пустое новое userData.
- Назначить **собственный task work** для `CAM_TEST_WORK_DIR`, `CAM_RELEASE_TEST_WORK`, `CAM_TEST_WORKDIR` по [development](development.md).
- Выполнить `typecheck`, `lint`, `test:node` и обязательный `test:delivery`; сохранить exit codes, исключённые сценарии и receipts.
- Зафиксировать результат dependency audit и применимость обнаруженного к production package; не заменять этот результат старым zero-vulnerability claim.
- Завершить Node проверки перед Electron rebuild. Одна установка `node_modules` имеет один текущий native ABI; параллельные rebuild не допускаются.

## Сборка и exact artifacts

```powershell
pnpm run build
pnpm run smoke
pnpm run verify:package
pnpm run verify:startup
node scripts/verify-installer-owned.mjs
```

Canonical `build` создаёт portable через `electron-builder --win portable --publish never`, затем обязательный custom Setup с ownership manifest. Default Windows target содержит только portable. Ожидаемые output files:

- [Kvesser-Setup-3.2.0-rc.2.exe](../release/3.2.0-rc.2/Kvesser-Setup-3.2.0-rc.2.exe)
- [Kvesser-3.2.0-rc.2.exe](../release/3.2.0-rc.2/Kvesser-3.2.0-rc.2.exe)
- [Setup blockmap](../release/3.2.0-rc.2/Kvesser-Setup-3.2.0-rc.2.exe.blockmap)
- [latest.yml](../release/3.2.0-rc.2/latest.yml)
- [SHA256SUMS](../release/3.2.0-rc.2/SHA256SUMS-3.2.0-rc.2.txt)
- [Custom ownership receipt](../release/3.2.0-rc.2/installer-build/ownership-receipt.json)
- [Unpacked payload](../release/3.2.0-rc.2/win-unpacked/)

Проверять окончательный payload после последней упаковки. Для любого изменения EXE повторно сформировать blockmap/latest/checksums и receipts: результаты от предыдущего SHA-256 не переносятся автоматически.

- Проверить byte parity **всего** generated `dist` и ASAR, package metadata, brand assets и Electron fuses.
- Зафиксировать ASAR и каждый EXE отдельно: bytes, SHA-256, Authenticode status. Сжатый installer size не является RAM или startup measurement.
- Сверить все строки checksum manifest; `release:checksums` пересчитывает manifest, но не заменяет независимую сверку.
- Проверить native install/upgrade/uninstall в `/TEST` с foreign sentinels, отсутствием host integration изменений и custom receipt guard. Driver не запускает приложение; это ограниченное host acceptance, не весь guest lifecycle.
- Startup probe должен предъявить nonce/PID/version-bound readiness и подтверждённые adapter guards. Простая подмена HOME/userData не принимается как изоляция.

## Correctness и интерфейс

- Импорт: traversal/невалидный ID, конфликты, ошибка последней записи, полная preflight проверка, одна транзакция, отсутствие промежуточных plaintext credentials и частичного применения.
- Snapshot/recovery: каждый write boundary, исходное отсутствие файла/credential, WAL, остановка перед записью, отказ запуска, mismatch, ручной откат и отказ самого отката. `recovery_required` блокирует изменения соответствующего провайдера.
- Evidence: профиль, credential method, запуск и runtime identity отображаются отдельно. В сценарии Desktop A / отдельный probe B Desktop B не объявляется подтверждённым; unconfirmed блокирует auto switch.
- Quota: unknown/null, произвольные окна, дробные остатки, смена тарифа, last-good/last-attempt, offline/401/403/429, Retry-After, reset без нового наблюдения и stale generation responses.
- UI fixtures: 1/10/100/200 профилей, таблица и inspector, keyboard/Enter/явная кнопка переключения, focus trap/Escape/возврат фокуса, RU/EN/privacy, pending login и reduced motion.
- Проверить 860×560, 1080×780, 1460×900. Native DPI 100/150/200%, tray reopening/hover и реальные IDE сценарии имеют собственные receipts; browser fixtures их не заменяют.

## Отдельный Windows guest

Guest должен быть disposable и не содержать host credentials, browser sessions или общих writable provider directories. Live identity сценарии выполняются только на явно выделенных тестовых аккаунтах. Не прерывать рабочие пользовательские IDE ради acceptance.

- Проверить first install, GUI walkthrough, existing-profile startup, migration, update/repair и uninstall с сохранением foreign/user files.
- Сравнивать pinned official competitor binaries по [матрице](competitors-3.2.0.json), фиксируя локально вычисленные SHA-256, версии среды, порядок runs и N/A.
- Использовать [benchmark protocol](benchmark-3.2.0.md): всё наблюдаемое дерево процессов, p50/p95, ошибки, CPU-seconds, Private Bytes, старты/интеракции/idle/soak. Отделять hidden shipping, development fixtures и guest shipping.
- При отсутствии guest оставить эти пункты непроверенными. Windows Sandbox/Hyper-V не включаются автоматически в рамках RC.

`verify:sandbox*` и `run-windows-sandbox-*.ps1` сохраняют исторические сценарии **3.1.5/3.1.6**. Они не являются актуальными gates RC; старые fixture paths и собственный rebuild не использовать как доказательство 3.2.0. `verify:tray-native` проверяет синтетический bitmap/nativeImage, а не полный tray lifecycle.

## Публичная стабильная готовность

Требуются пройденные применимые native checks в заявленной среде, корректная Authenticode-подпись installer/portable/inner EXE, timestamp и проверенная signature chain. Чистая установка и поведение Windows security проверяются на exact подписанных artifacts. До этого локальная unsigned RC не объявляется публичной стабильной версией или проверенной для всех Windows/IDE.

Публичная публикация не входит в текущий цикл. Build использует `--publish never`; `release:publish` не принимает RC semver. Не выдавать источниковое исследование конкурентов за замеры их binaries, а исходные performance targets — за достигнутые показатели.

Перед передачей локальной RC сохранить [receipts](../artifacts/3.2.0-rc.2/verification/), отчёт «до → после», ограничения и companion review board с утверждением, отказом, вопросом и комментариями, привязанными к точной версии результата. Test counts и размеры брать только из окончательного release receipt.
