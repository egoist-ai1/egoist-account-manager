# Codex Account Manager — architecture

## Scope

Локальное Windows-приложение управляет разрешёнными Codex/Anti-Gravity профилями, показывает квоты и выполняет проверяемое переключение с rollback.

## Verified boundaries

- Electron main process владеет профилями, lifecycle, транзакциями, локальным хранилищем и интеграцией с Codex.
- Preload предоставляет renderer только узкий IPC-контракт; React renderer показывает состояние и запускает разрешённые операции.
- Vault и rollback-материал защищаются через Electron `safeStorage`/Windows DPAPI; SQLite хранит durable journal и metadata.
- Ротация распознанной активной сессии сохраняется в vault локальным snapshot-путём без запуска Codex app-server; неоднозначная или внешняя identity не может перезаписать управляемый профиль.
- Успешный quota snapshot и ошибка его обновления хранятся раздельно; трёхминутный quota probe использует bounded timeout/backoff и не форсирует credential rotation. Только подтверждённая official identity может заменить last-good vault.
- Успешный reauth после подтверждённой provider identity атомарно очищает предыдущие `last_refresh_error*` даже при временном сбое первой quota; потребители считают ошибку актуальной только если её timestamp не старше последнего успешного snapshot.
- Device-code handoff проходит через отдельный typed IPC: main повторно валидирует код, записывает его в системный clipboard до открытия allowlisted HTTPS URL и условно очищает неизменённое значение через 15 минут или при shutdown. Слепая эмуляция клавиатуры во внешнем браузере не используется.
- Публичный auth-контракт принимает только официальные login flows Codex app-server/CLI. Импорт текущей сессии и произвольного `auth.json` отсутствует в renderer, preload и IPC; `keyring`, `auto` и `ephemeral` не извлекаются недокументированным способом.
- Каждая управляемая авторизация живёт в отдельном manager-owned `CODEX_HOME`, а last-known-good auth bundle запечатан DPAPI. Stable-read защищает snapshot/rotation от частично перезаписанного `auth.json`; временный sign-out Codex Desktop не понижает сохранённый профиль до `needs_reauth`, пока официальный app-server не отверг сам vault credential.
- Notification policy работает через типизированные auth/switch/quota/update события и отправляет их только в ограниченную renderer-очередь. Payload проходит redaction, повторные phase/window/release события дедуплицируются, progress остаётся бесшумным, а короткий WebAudio-сигнал допускается только для результата, предупреждения или ошибки при видимом Manager; Windows toast/XML полностью отсутствуют.
- Live tray имеет отдельный active-only polling interval `1/3/5/10/15/off`, не дублирует свежий общий трёхминутный snapshot и не запускает credential refresh. Один logical NativeImage содержит BGRA-представления 16/20/24/32 px для DPI 100/125/150/200%; крупные точные цифры показывают остаток фактически ограничивающего подтверждённого provider window, а `!`, `~`, `—` отделяют error/stale/unknown от фактического `0`. Single-digit glyph не использует периметральную state-рамку: цифра стоит на тёмной плитке, а состояние кодируется коротким нижним rail. Generic primary/secondary данные классифицируются по duration и dedupe до выбора окна: отсутствующая 5h-квота не заполняется недельным процентом. Нативная Windows tooltip намеренно пуста: после короткой hover-задержки показывается отдельное прозрачное, click-through, non-focusable окно 252×144 px с активным Codex-профилем, одной шкалой и reset-time; CSS делает `html/body/#root` прозрачными только для этой surface, исключает внешний box-shadow/backdrop-filter и оставляет нулевую alpha за rounded border. Click/context popup остаётся независимым. Позиционирование ограничивается work area ближайшего дисплея и учитывает все края taskbar. Windows может поместить значок в overflow — принудительное pinning не поддерживается.
- Assisted continuation не подменяет safety transaction: UI ранжирует только fresh protected candidates, но switch остаётся подтверждаемым, атомарным, identity-verified и rollback-capable. Переключение посреди активного turn и автоматическая subscription rotation не входят в поддерживаемый контракт.
- Подготовленная switch-транзакция не может пережить отказ до записи auth bundle: target reauth, provider/cross-process conflict и IPC-visible commit failure переводят её в terminal state. Reauth блокирует только свой целевой профиль; повторный reauth атомарно заменяет прежний manager-owned login session, а provider lock сериализует его сохранение со switch/refresh.
- Production renderer определяется только через `app.isPackaged`: environment-переключатель не может направить packaged preload на localhost, а package-конфигурация не читается из текущей рабочей папки.
- Windows package строится как NSIS installer и portable artifact. При запуске main process проверяет фиксированный GitHub Releases endpoint через Chromium networking, принимает только стабильный semver и строит allowlisted URL нашего репозитория. Установка остаётся ручной: неподписанный EXE не скачивается и не запускается приложением.

## Source of truth

- [`README.md`](../README.md) — observable behavior, security boundary и build commands.
- [`docs/product-3.0-spec-2026-07-29.md`](./product-3.0-spec-2026-07-29.md) — approved product contract.
- [`docs/product-3.0-progress.md`](./product-3.0-progress.md) — latest verified handoff.

## Unknowns

- Любая деталь, не подтверждённая указанными источниками или свежей проверкой,
  считается `not verified` и не должна достраиваться по предположению.
