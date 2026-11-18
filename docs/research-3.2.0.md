# Egoist 3.2.0 — рынок, пользовательские проблемы и доказательства

Дата исследования: **6 октября 2026**, Europe/Moscow. Версии закреплены в [машиночитаемой матрице](competitors-3.2.0.json). Реестр содержит 12 основных продуктов; дополнительно рассмотрены CLI [Pimpmuckl](https://github.com/Pimpmuckl/codex-account-switcher) и IDE-extension [Antigravity Cockpit](https://github.com/at2008/antigravity-cockpit).

Это адресное исследование публичных репозиториев, release notes, выбранных исходников и 20 обсуждений. Закрытые Telegram/X-истории, платные продуктовые функции и полный корпус форумов не собирались. Размер рынка, распространённость ошибок и доля пользователей с десятками аккаунтов по такой выборке не определяются.

## Практическое сравнение

| Продукт и закреплённая версия | Что полезно сравнивать | Ограничение доказательства |
|---|---|---|
| [Cockpit 1.3.65](https://github.com/jlcodes99/cockpit-tools/releases/tag/v1.3.65) | Windows-профили, model quota, bulk import, переключение и экземпляры | Исправления описаны авторами; runtime identity и CPU/RAM не измерены |
| [Antigravity Manager 4.9.4](https://github.com/lbjlaq/Antigravity-Manager/releases/tag/v4.9.4) | Antigravity-профили и модельные квоты | Proxy/routing выходят за текущий scope Egoist |
| [liuzhao1225 0.1.16](https://github.com/liuzhao1225/codex-account-switcher/releases/tag/v0.1.16) | Сохранение outgoing credentials, проверка перед повторным запуском | Проверка credentials перед запуском не доказывает identity Desktop после запуска |
| [korsun009 2.0.0](https://github.com/korsun009/codex-account-switcher) | Shared Codex home, DPAPI, Windows-диагностика | README явно называет релиз unsigned; build signing gate не делает binary подписанным |
| [unkdevv 0.2](https://github.com/unkdevv/codex-switcher/releases/tag/v0.2) | Vault, outgoing credential backfill, repair | Native benchmark и повторно запущенный runtime не проверялись |
| [Lampese 0.2.20](https://github.com/Lampese/codex-switcher/releases/tag/v0.2.20) | Quota UI, tray, сериализация операций | У [licensing issue](https://github.com/Lampese/codex-switcher/issues/121) нет принятого license решения |
| [isxlan0 1.3.18](https://github.com/isxlan0/Codex_AccountSwitch/releases/tag/v1.3.18) | Компактный Win32/WebView2 shell, transfer | Proxy без перезапуска — отдельный сценарий, не доказательство Desktop identity |
| [CC Switch 3.20.4](https://github.com/farion1231/cc-switch/releases/tag/v3.20.4) | Provider/configuration management | Configuration/API routing не равны переключению Desktop sign-in |
| [CodexBar 0.72.0](https://github.com/steipete/CodexBar/releases/tag/v0.72.0) | Источники, freshness, quota UX | Upstream Windows GUI нет; обычный view picker и System Account promotion различаются |
| [Win-CodexBar 0.70.0](https://github.com/nesszer/Win-CodexBar/releases/tag/v0.70.0) | Windows quota monitoring, privacy, tray | Верифицированный Desktop switch не установлен исследованием |
| [Quotio 0.33.1](https://github.com/nguyenphutrong/quotio/releases/tag/v0.33.1) | Last-good snapshot и helper contracts | Windows native comparison N/A; beta.2 — отдельный prerelease от 4 октября |
| [1DevTool 1.76.8](https://github.com/stoicsoft/1devtool-releases/releases/tag/v1.76.8) | Коммерческий multi-CLI workspace | Функции и цены — заявления vendor; платный доступ и native behavior не тестировались |

В группе Windows для реального стенда закреплены Cockpit, Win-CodexBar и liuzhao1225; Antigravity Manager добавляется для применимых Antigravity-сценариев. Это выбор сопоставимых задач, а не рейтинг популярности.

Для трёх основных binaries API опубликованы размеры 37 853 423 / 49 289 938 / 102 317 360 bytes и advertised SHA-256; они записаны в JSON. Файлы ещё не скачаны и не выполнены. Внешний WebView2 и shared runtimes не входят автоматически в installer bytes, поэтому меньший installer не доказывает меньший RAM или CPU.

У Cockpit лицензия **CC-BY-NC-SA-4.0** указана в [manifest закреплённого тега](https://raw.githubusercontent.com/jlcodes99/cockpit-tools/v1.3.65/src-tauri/Cargo.toml), у Antigravity Manager — в [LICENSE](https://raw.githubusercontent.com/lbjlaq/Antigravity-Manager/main/LICENSE). Реализация Egoist самостоятельная; чужой source и assets не копировались.

## 20 обсуждений и превращение их в проверяемые сценарии

Даты — дата открытия; состояние GitHub issues повторно проверено через public API 6 октября. Закрытый issue остаётся regression lesson и не объявляется текущей ошибкой продукта. Открытый issue также не доказывает сохранение дефекта в последнем релизе. Описания ниже — краткий пересказ, не подтверждение всех предположений автора.

| ID | Дата / состояние | Источник | Сценарий для Egoist |
|---|---|---|---|
| F01 | 17.03 / open | [Codex #14880](https://github.com/openai/codex/issues/14880) | `rate_limits=null`: unknown остаётся unknown |
| F02 | 31.07 / open | [Codex #36344](https://github.com/openai/codex/issues/36344) | Dashboard с остатком и фактический отказ: availability отдельно от процента |
| F03 | 04.09 / open | [Codex #42765](https://github.com/openai/codex/issues/42765) | Неожиданная смена недельного остатка: показывать источник, snapshot и scope |
| F04 | 13.05 / open | [Codex #22419](https://github.com/openai/codex/issues/22419) | Local/SSH/WSL identity могут расходиться; local proof не распространяется на remote |
| F05 | 18.08 / open | [Codex #39199](https://github.com/openai/codex/issues/39199) | Refresh invalidation: один credential writer, stale-response rejection |
| F06 | 12.06 / closed 19.06 | [Codex #27848](https://github.com/openai/codex/issues/27848) | Большая история и cold startup входят в ресурсный стенд |
| F07 | 15.08 / open | [Codex #38719](https://github.com/openai/codex/issues/38719) | Отдельно измерять idle и скрытые timers, а не только открытие окна |
| F08 | 27.02 / forum | [Work/personal accounts](https://discuss.ai.google.dev/t/feature-request-multi-account-support-work-personal/127162) | Имя и назначение профиля понятны без технических файловых путей |
| F09 | 28.09 / forum | [Weekly reset postponed](https://discuss.ai.google.dev/t/backend-quota-bug-weekly-reset-date-silently-postponed-to-oct-4th/185371) | Reset timer не гарантирует восстановление доступности |
| F10 | 10.03 / forum | [Pro quota sync](https://discuss.ai.google.dev/t/bug-google-ai-pro-quota-sync-error-7-day-lock-v1-19-6/130313) | Auth success и quota entitlement — разные факты |
| F11 | 13.01 / open | [AG Manager #580](https://github.com/lbjlaq/Antigravity-Manager/issues/580) | Не показывать 100% при неизвестных данных; expose freshness/error |
| F12 | 21.02 / open | [AG Manager #2066](https://github.com/lbjlaq/Antigravity-Manager/issues/2066) | Прозрачность фоновых действий; polling без inference. Утечка/кража не установлена |
| F13 | 29.08 / closed 30.08 | [AG Manager #3345](https://github.com/lbjlaq/Antigravity-Manager/issues/3345) | Malformed persistence не убирает профиль молча; атомарность и recoverable error |
| F14 | 06.09 / closed 08.09 | [AG Manager #3399](https://github.com/lbjlaq/Antigravity-Manager/issues/3399) | Quota refresh не перезапускает IDE |
| F15 | 04.10 / closed 05.10 | [AG Manager #3598](https://github.com/lbjlaq/Antigravity-Manager/issues/3598) | «Выбран» не равен подтверждённому runtime account |
| F16 | 24.03 / closed 05.05 | [CodexBar #591](https://github.com/steipete/CodexBar/issues/591) | Понятное целевое восстановление без полного сброса данных |
| F17 | 05.06 / closed 11.06 | [CodexBar #1311](https://github.com/steipete/CodexBar/issues/1311) | CPU и tray/menu responsiveness включены в soak |
| F18 | 02.09 / closed 28.09 | [CodexBar #3389](https://github.com/steipete/CodexBar/issues/3389) | Смена плана инвалидирует соответствующие cached capabilities/quota mapping |
| F19 | 26.09 / closed 26.09 | [CodexBar #4021](https://github.com/steipete/CodexBar/issues/4021) | Quit/reopen не оставляет лишние tray windows или процессы; macOS report не переносится на Windows как факт |
| F20 | 03.08 / open | [AG Manager #3281](https://github.com/lbjlaq/Antigravity-Manager/issues/3281) | Подпись, hashes и прозрачный release process; report Defender не доказывает ни malware, ни false positive |

Корпус адресный: 17 GitHub issues и 3 Google forum topics. Дубликаты по URL не считались отдельными наблюдениями; comments и screenshots не интерпретировались как независимо воспроизведённые результаты. Полная пагинация форумов и комментариев не выполнена.

## Первичные технические документы

| Источник | Что он меняет в проектном решении |
|---|---|
| [Codex auth](https://learn.chatgpt.com/docs/auth#login-caching) | File/keyring/auto credentials различаются; путь файла не представляет весь auth state |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | Contracts/capabilities проверяются по версии; independent probe не превращается в Desktop identity |
| [Antigravity plans](https://antigravity.google/docs/plans) | Provider-specific доступность и окна нельзя выводить из модели или timer |
| [Electron 41.10.7 safeStorage](https://raw.githubusercontent.com/electron/electron/v41.10.7/docs/api/safe-storage.md) | Windows DPAPI защищает от других пользователей, но не всех приложений текущего пользователя |
| [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance) | Blocking I/O и тяжёлые задачи main thread выносятся; вывод проверяется измерением |
| [Windows DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) | Хранилище и transfer различаются по переносимости и привязке |
| [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) | Authenticode не гарантирует немедленное отсутствие reputation warning |
| [METR, февраль 2026](https://metr.org/blog/2026-02-24-uplift-update/) | У измерений времени есть selection/context effects; исследование не измеряет спрос или эффективность account managers |

## Что следует из исследования

Вывод для Egoist — улучшать проверяемость повседневных действий: плотная таблица сравнивает остаток, свежесть и ошибки, inspector показывает основания статуса, а переключение разделяет запись профиля и runtime identity. Профиль после неподтверждённого runtime сохраняется по выбранному пользователем правилу; автоматический switch остаётся заблокированным.

Рост числа провайдеров, proxy и multi-instance оставлены после стабилизации двух текущих интеграций. Показатели лидерства, экономии RAM или ускорения относительно конкурентов здесь не заявляются: для них необходим [контролируемый стенд](benchmark-3.2.0.md). Название Egoist закреплено пользователем; [Sugar Bytes](https://sugar-bytes.de/egoist) уже использует то же слово, поэтому уникальна собственная графика, а не гарантированно свободное название.
