# Квессер 3.2.0 RC2 — установщик

Дата: 2026-10-06. Исходники для `3.2.0-rc.2`, Win32 `3.2.0.2`. Видимое имя — **Квессер**, executable — `Kvesser.exe`, uninstaller — `Uninstall Kvesser.exe`. Совместимость appId, `.egoist-install.json`, uninstall key `AccountManagerEGO` и профилей сохраняется. Финальная shipping сборка и её acceptance выполняются отдельно корневым агентом.

## Подтверждённые причины и изменения

| Наблюдение | Причина / исправление | Доказательство |
| --- | --- | --- |
| MessageBox на screenshot содержал нечитаемую кириллицу, начинающуюся с `РЈС...` | UTF-8 NSIS source без BOM интерпретировался по ANSI codepage. Теперь UTF-8 BOM + явный `/INPUTCHARSET UTF8`; C# собирается с `/codepage:65001` | Tiny NSIS text probe различил оба варианта; GUI final показывает читаемый русский текст |
| Строка screenshot | Декодирована точно как «Установка прервана: конфликт файла или ошибка проверки. Неизвестные файлы сохранены.» Это ветка install-owned, а не отказ создания WPF окна | Сопоставление с source string и encoding probe. Исходный target/установленная версия на момент screenshot не зафиксированы |
| Root воспроизвёл отказ на `better-sqlite3/deps/common.gypi` | Legacy whitelist не включал старые unpacked SQLite extras. Embedded `Legacy311Payload.json` добавляет только конкретные пути с точными доверенными хэшами из `assets/legacy/3.1.10-ownership.json` | Read-only root proof нашёл49 совпавших old files; полный source ASAR reference соответствует зафиксированной исходной версии. Modified/unknown extra остаётся посторонним |
| При ошибке GUI закрывалась с общим сообщением | Helper сохраняет ограниченную structured diagnostic: code, relative app filename, type и HResult. GUI возвращается к выбору папки, показывает конкретную причину и позволяет повторить действие | Actual guarded retry показал `payload-invalid`, `Kvesser.exe`, HResult; окно продолжило работу |
| Повтор завершал установку, но процесс возвращал3 | NSIS сохранял SetErrorLevel первой ошибки. Успешная конечная ветка теперь явно устанавливает0 | Первый GUI receipt воспроизвёл exit3 после gui-complete; final retry вернул0 |
| Параметр `/D=` не передавался в WPF directory textbox | NSIS передаёт выбранный `$INSTDIR` отдельным аргументом; registry/default fallback остаётся проверяемым | initialize/install/retry использовали точную собственную fixture target directory |

Связь конкретного legacy conflict с первым screenshot вероятна, но не доказана отсутствующим snapshot исходной установки. Причина encoding и фактический воспроизведённый overlap различаются и проверены отдельно. Неизвестные/изменённые файлы не принимаются по wildcard; canonical path, reparse/hardlink checks, preflight, журнал отката и защита пользовательских данных сохраняются.

## Guarded GUI acceptance

Компиляция C# и настоящего `setup.nsi` проходит. Новый стенд не редактирует source строки подстановками: `/main:InstallerFixtureEntry` задаёт отдельную compiled entry point с неизменяемой конфигурацией собственного task work. Каждый write target обязан находиться внутри exact scratch. Native integration и external launch запрещены; registry reader и special folders направлены в независимые fixture paths. Даже при production NSIS route устанавливается только TEST manifest. Перед запуском проверяются actual CODEX_THREAD_ID/work, fixed layout, отсутствие ссылок в родителях/дереве и точные reviewed source/binary hashes. BEFORE digest сохраняется до native launch. После ранней ошибки следующий GUI case не запускается до readback.

Final: **8/8 PASS**, без skipped cases, 2026-10-06. Пять отрицательных случаев: foreign namespace, foreign thread ID, escaped TEMP, escaped Setup и nested junction. Три native GUI сценария: initialize/cancel; установка; ошибка payload hash → читаемая inline diagnostic → повторная распаковка payload → успешная установка. Install/retry вернули0; initialize/cancel вернул1. Все записи имеют `testMode: true`, `applicationLaunched: false`; integrationBefore==integrationAfter во всех трёх сценариях. После завершения осталось0 собственных fixture процессов.

Reviewed composite SHA-256: `45c99c835e887e239df268242d46a189e19654c580af46a1dae2efdf9ca61793` —10 точных source hashes, включая test driver и pinned legacy resource. Prepared receipt: [installer-gui-prepared.json](../../artifacts/3.2.0-rc.2/verification/installer-gui-prepared.json). First run **7/8**, retained stale exitCode3: [installer-gui-first.json](../../artifacts/3.2.0-rc.2/verification/installer-gui-first.json). Final **8/8**: [installer-gui-final.json](../../artifacts/3.2.0-rc.2/verification/installer-gui-final.json).

Это проверка настоящего GUI/NSIS protocol с tiny fixture bytes. Приложение, SQLite и IDE не запускались. Production registry/shortcut writes запрещены стендом, поэтому этот receipt их не подтверждает. Shipping RC2 payload, install/upgrade/uninstall и Authenticode ещё не подтверждены этим разделом. Новые ownership regressions предусматривают migration EgoistRC1→Kvesser, точные legacy extras, сохранение изменённого extra и отказ при drift reference hash; результат общего прогона сохраняет root отдельно.

## Shipping verifier RC2

После GUI acceptance корневой агент обнаружил два дефекта driver readback: проверялось удаление прежнего Egoist.exe, а receipt destination допускал только папку3.2.0. Исправление берёт имена Setup/executable/uninstaller из текущего productName (либо package name), evidence directory — из точной package version. Неверная destination отклоняется до native launch. integrationBefore и промежуточный stage receipt сохраняются до первой проверки foreign target и каждого install/upgrade/uninstall; integrationAfter остаётся в финальном JSON. Короткий собственный prefix `ia-` уменьшает путь TEMP; MAX_PATH guard не ослаблен.

C#/NSIS после8/8 GUI результата не менялись. Новый composite исходников driver: `04c38ab96cc77d6fe3af48340edd5bdb214125f880ee3d7ea02379fa782899ed`. [installer-verifier-prepared.json](../../artifacts/3.2.0-rc.2/verification/installer-verifier-prepared.json) подтверждает неизменность compiled core и Node syntax. Четыре pure path regression cases добавлены; новый shipping native acceptance этим receipt не заявляется. GUI receipts сохраняют hash той точной версии, на которой они были выполнены.

## Инцидент стенда и восстановление

Первый диагностический стенд использовал неудачную LF-only подстановку в CRLF source; изоляция registry/integration не включилась. Tiny payload попал в реальный зарегистрированный каталог Account Manager EGO. Это ошибка стенда. Действия были остановлены; incident receipt честно фиксирует отсутствие BEFORE manifest/file snapshots и raw registry/shortcut values. Прежняя установленная версия и bit-exact исходные bytes этим evidence не установлены.

Root выполнил восстановление работоспособного RC1 после двух явных разрешений пользователя:127/127 payload hashes проверены,2 посторонних файла сохранены. Это проверенное восстановление известной RC1 сборки, а не доказательство тождественности неизвестной прежней установке. Incident: [installer-gui-fixture.json](../../artifacts/3.2.0-rc.2/incident/installer-gui-fixture.json). Recovery readback: [recovery-readback.json](../../artifacts/3.2.0-rc.2/incident/recovery-readback.json). Последующие проверки выполнялись только после отдельного root review compiled guards; host installation действия дочерним агентом не повторялись.

Объекты для companion review board: Unicode и inline retry (`3.2.0-rc.2`, exact reviewed composite выше); hashed legacy migration (`assets/legacy/3.1.10-ownership.json`, точный hash в prepared/build receipts). Подтверждение означает принятие этих изменений и их указанного уровня проверки; установка и публичный релиз являются самостоятельными действиями корневого агента.

---

# Исторический отчёт: Egoist 3.2.0 RC1

Дата: 2026-10-06. Видимое имя: **Egoist**. appId и HKCU uninstall key сохранены для совместимости.

## Изменение поведения

| До | После |
| --- | --- |
| Введённая папка принималась после GetFullPath; NSIS писал в неё через File /r | Новая пустая выделенная папка либо проверенная существующая установка; полный preflight всех путей, хешей и конфликтов до первой записи |
| Uninstall выполнял RMDir /r для выбранной папки | Удаляются только перечисленные в `.egoist-install.json` обычные файлы с совпавшим SHA-256; неизвестные и изменённые файлы сохраняются |
| Нет собственника каталога и защиты от junction | Manifest содержит appId, абсолютный installRoot, версию и точные относительные пути/хеши; reparse points, hardlinks, traversal, корни диска и общие пользовательские папки отклоняются |
| Устаревший скомпилированный helper и старый встроенный логотип | Helper собирается из исходников для текущей версии в release installer-build; собственный Egoist icon/wordmark, без AI и старых подписей |

## Установка и обновление

NSIS сначала распаковывает payload в свой временный каталог. C# helper проверяет все исходные bytes и все назначения, включая конфликты с посторонними файлами. Существующие папки удерживаются directory handles без share-delete; каждый путь проверяется повторно. Файлы заменяются через проверенную временную копию и File.Replace/File.Move.

Старый installer 3.1.10 распознаётся только при совпадении HKCU InstallLocation и ProductName/ProductVersion его executable. Берётся явный список известных Electron/application файлов, а не весь каталог. Старый небезопасный uninstaller удаляется как известный файл; неизвестные файлы и пользовательские preferences остаются. Старые версии с другой identity автоматически не принимаются.

Перед изменением старых файлов записываются резервные копии и recovery journal в уникальную `.egoist-recovery-<id>` внутри целевого каталога. При проверенном откате копии удаляются по точным именам; при отказе самого отката они остаются с путями и хешами. Деинсталлятор не очищает такую папку рекурсивно. Это сохраняет материалы для восстановления; отдельная автоматическая recovery-команда установщика пока не добавлена.

Registry и ярлыки связаны с проверенной папкой. Чужой shortcut с тем же именем не перезаписывается. UserData и профили провайдеров не удаляются. Работающий менеджер проверяется по executable path; никакие процессы не останавливаются и elevation не запрашивается.

## Интерфейс и упаковка

- ProductName, Setup, shortcuts и uninstaller — Egoist; внутренние compatibility IDs сохраняются.
- Win32 FileVersion `3.2.0.1`, semver `3.2.0-rc.1`; generated manifest и assembly metadata согласованы. Electron-builder 26.15.3 записывает application ProductVersion как `3.2.0.0`: этот вариант принимается только после полного совпадения ASAR/package/dist/icons и при точной числовой FileVersion. Точная prerelease identity остаётся в ASAR. Отдельная неподтверждённая числовая ProductVersion не проходит проверку.
- NSIS и plugins разрешаются штатными `getMakeNsisPath/getNsisPluginsPath` установленного electron-builder через его dependency context; случайные suffix папок кэша не зашиты. Сохраняются `NSISDIR`, pinned checksums bootstrap и явные tool overrides.
- Встроен новый PNG/ICO бренда. Старые generated binary/base64 logo удалены из source tree.
- Installer toggles используют native CheckBox semantics, клавиатуру и focus state. Закрытие прогресса не изображает отмену записи; reduced motion учитывается; проценты не растут независимо от сообщённой стадии.
- Build выдаёт ownership receipt с точными hash Setup, NSIS и исходников helper/UI. Native acceptance отказывается запускать обычный electron-builder Setup под тем же filename либо stale receipt.

## Проверено

`tests/installer/installerOwnership.test.ts` и `installerSafety.test.ts`: первоначально **48/48 PASS**, после исправления short stage и late conflict — **50/50 PASS**, 2 файла. Актуальный consolidated receipt ниже. WPF C# и production ownership helper реально компилируются в тестах; embedded brand resource входит в compilation. ESLint для изменённых tests проходит, release scripts проходят Node syntax check.

Сценарии: чужая непустая папка, whole-payload preflight, late invalid entry без частичной записи, owned upgrade, сохранение root/nested foreign files, modified-owned preservation, exact legacy 3.1.10 fixture, скопированный manifest, другой appId, traversal, junction до/внутри install root, hardlinks, drive/user roots, TEST/production boundary, injected post-write rollback, retry после fresh-install rollback, сохранение recovery backups после отказа отката, custom Setup receipt guard.

Legacy fixture использует отдельный executable с проверяемыми version resources и внутренний read-only registry adapter. Tests не пишут в HKCU, не создают пользовательские shortcuts, не запускают Egoist/IDE и не обращаются к credentials.

Evidence: [installer-tests.json](../../artifacts/3.2.0/verification/installer-tests.json).

Дополнительно **10/10 Node delivery-тестов PASS**: точная ASAR RC identity и FileVersion, запрет непроверенной/устаревшей RC, другой ревизии или продукта, привязка proof к package identity, отзыв proof после неудачной перепроверки, совместимость stable metadata, resolver установленного builder, сохранение NSISDIR и явных overrides. Фактический shipping payload `Egoist / 3.2.0.1 / 3.2.0.0`, ASAR/dist/icons parity и штатные NSIS paths проверены read-only. SQLite/native ABI не затрагивались. Receipt: [installer-delivery-metadata.json](../../artifacts/3.2.0/verification/installer-delivery-metadata.json).

## Изоляция native verifier

Первый shipping acceptance остановился до установки: дочерний Windows PowerShell не находил `Get-FileHash`. Read-only воспроизведение подтвердило `CommandNotFoundException`. Verifier теперь хеширует ярлыки через .NET SHA256 без зависимости от этого cmdlet и возвращает только digest в UTF-8. Ошибки сохраняют stage, exit code, категорию, тип/код исключения, позицию и fingerprint stderr; содержимое registry, пути ярлыков и произвольные exception messages не выводятся. Ошибка начального preflight теперь сохраняет receipt и путь own scratch.

**8/8 первоначальных verifier Node tests PASS**, включая настоящий Windows PowerShell с намеренно недоступным Get-FileHash и исключением с приватным сообщением; после добавления проверки NSIS invocation — **10/10 PASS**. Read-only digest и повторное наблюдение без изменений проходят. Guard точного custom Setup повторно PASS; installer/product source и Setup bytes не менялись. Receipt: [installer-verifier-boundary.json](../../artifacts/3.2.0/verification/installer-verifier-boundary.json). Первоначальный receipt подтверждает verifier. Итоговый shipping native `/TEST` подтверждён отдельным receipt ниже.

## NSIS /D и предел длины пути

Фактический tiny NSIS probe подтвердил: обработанный `/D=` отсутствует в `$CMDLINE/GetParameters`, поэтому прежний registry fallback заменял уже выбранный `$INSTDIR`. Второй отказ локализован до запуска helper: NSIS GetFullPathName возвращал пустые строки для отсутствующих fresh/default folders, и comparison ошибочно признавал их одинаковыми. [Документация NSIS](https://nsis.sourceforge.io/Reference/%24CMDLINE) подтверждает исключение `/D=` из `$CMDLINE`; [правила invocation](https://nsis.sourceforge.io/Docs/Chapter3.html) требуют последний unquoted `/D=`.

Теперь наличие explicit `/D=` определяется по GetCommandLineW, встроенно выбранный `$INSTDIR` сохраняется, отсутствие параметра разрешает только обычный registry fallback. `/TEST` требует explicit `/D=` и silent mode. Win32 GetFullPathNameW нормализует ещё не существующие пути с обязательной проверкой результата/длины. Native verifier передаёт `/D=` последним без quotes через CreateProcess, сохраняя quoted argv0 executable; пути с кириллицей и пробелами проходят.

В actual shipping manifest SQLite relative path имеет 89 символов. При корне 133 символа прежний stage `destination + .egoist-GUID.tmp` достигал 267; новый короткий basename в той же папке — 244. Все stage paths проверяются до создания target; .NET Framework MAX_PATH не обходится. Stage создаётся CreateNew, cleanup удаляет только созданный stage. Повторная проверка destination и учёт фактически применённых записей сохраняют late foreign file при конфликте и откате.

**4/4 actual tiny production-source NSIS tests PASS**, **50/50 ownership tests PASS** и **24/24 scoped Node delivery tests PASS**. Tiny payload и native-module bytes являются fixtures: приложение и SQLite не запускались, host integration digest остался прежним. Слишком длинный путь отклоняется до создания target; late foreign file остаётся. Receipt: [installer-route-stage-tests.json](../../artifacts/3.2.0/verification/installer-route-stage-tests.json). Root отдельно пересобрал custom Setup на прежнем Egoist.exe/ASAR; итоговая shipping native проверка приведена ниже.

## Проверка shipping artifact

Root serial pipeline: сначала актуальный build:dir/portable, затем `node scripts/package-branded-installer.mjs`. Только после успешного ownership receipt запускается `node scripts/verify-installer-owned.mjs` с `CAM_TEST_WORKDIR`, указывающим собственный runtime текущего root task.

Native сценарий: reject чужой target → `/S /TEST` install → проверки всех manifest hashes → owned upgrade → uninstall с foreign sentinels. NSIS extraction TEMP/TMP находятся внутри task work. До/после сравниваются hashes registry/shortcuts; приложение не запускается. Итоговый результат сохранён в [installer-native.json](../../artifacts/3.2.0/verification/installer-native.json).

Финальная compilation custom Setup завершена успешно. Проверенный `Egoist-Setup-3.2.0-rc.1.exe`: **107 360 699 байт**, SHA-256 `1fd2d2108c6ced8bdeb8576567b7ab1a9a1e487fac0bbdc20bc0f54efd06c3b5`.

Shipping native `/S /TEST` acceptance: **5/5 PASS**, 2026-10-06, 01:35:59–01:36:34 UTC. Чужая непустая папка отклонена (exit 3); fresh install проверил хеши всех **127 manifest files**; повторная установка той же версии прошла; uninstall сохранил посторонние root/nested sentinels. Наблюдаемые registry/shortcut boundaries не изменились (`integrationUnchanged: true`), приложение не запускалось (`applicationLaunched: false`). Receipt относится к точному SHA-256 Setup выше. Проверка выполнена в отдельном task scratch с TEST integration adapter; обычные пользовательские registry/shortcut действия и native GUI walkthrough ею не подтверждаются.

Authenticode-подпись этим отчётом не подтверждается. Объект для общего companion review board проекта: безопасный установщик `3.2.0-rc.1`, привязанный к этому разделу, точному SHA-256 Setup и фактическому native receipt. Подтверждение означает принятие проверенного локального результата; публичная готовность требует отдельной проверки production integration и подписи.