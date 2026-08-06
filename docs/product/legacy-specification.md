# Спецификация развития Egoist Account Manager

Дата: 2026-05-14  
Проект: `Egoist Account Manager`
Текущая версия: `3.1.0`
Целевая версия после доработки: `3.1.0`

> Поправка 3.1: публичный импорт текущей сессии и произвольного `auth.json` отменён [решением 3.1](../decisions/2026-08-02-v3-1-official-auth-github-release.md). Ниже `auth.json` означает только внутренний переключаемый cache, backup/rollback или зашифрованный `.cam-export`, а не способ добавления нового аккаунта.

## 1. Назначение продукта

Egoist Account Manager должен стать профессиональной Windows-панелью управления локальными Codex ChatGPT-профилями: безопасное хранение авторизаций, быстрый выбор рабочего аккаунта, контроль лимитов, перенос профилей между доверенными ПК, диагностика Codex Desktop/CLI и стабильное переключение активного `auth.json`.

Продукт не должен выглядеть как экспериментальная утилита. Целевое ощущение: аккуратный локальный control plane для ежедневной работы, где пользователь за несколько секунд понимает, какой аккаунт свободен, какой активен, где проблема и какое действие безопасно выполнить дальше.

## 2. Текущее состояние

Проект уже имеет сильную базу:

- Electron + React + TypeScript + Vite.
- Локальная база `better-sqlite3` с WAL.
- Шифрование локального auth-кеша через Electron `safeStorage` и AES-256-GCM.
- Экспорт/импорт `.cam-export` через PBKDF2-SHA256 и AES-256-GCM.
- Авторизация ChatGPT через Codex RPC `app-server`.
- Четыре официальных способа входа Codex в отдельный manager-owned `CODEX_HOME`.
- Обновление лимитов, автообновление каждые 3 минуты.
- Переключение активного аккаунта через запись `auth.json`, backup и синхронизацию account-id в `.codex-global-state.json`.
- Перезапуск Codex Desktop после переключения.
- Современный React-интерфейс с dashboard, таблицей, карточками, инспектором профиля, поиском и фильтрами.
- Windows installer и portable сборки через `electron-builder`.
- Релизная проверка v1.6: локальные crash-отчёты, SHA256 артефактов, статус update-feed и подписи.
- Ежедневный слой v1.7: теги, избранное, архив профилей и история снимков лимитов.
- Публикационный слой 3.1: автоматическая проверка стабильного GitHub Release и ручное открытие allowlisted страницы загрузки без скрытого запуска неподписанного EXE.
- GitHub Actions typecheck.

Ключевые зоны, которые нужно довести до профессионального уровня:

- Устойчивость при ошибках Codex CLI/RPC, зависаниях, битых профилях и нестабильных лимитах.
- Полная UX-полировка: состояния загрузки, ошибки, пустые состояния, подтверждения опасных действий, понятная навигация.
- Дизайн-система вместо разрозненного CSS.
- Тесты, smoke-проверки, сборочная дисциплина, подпись релизов.
- Расширение функций: health center, история лимитов, теги, группы, резервные копии, восстановление, настройки, диагностика.

## 3. Целевые пользователи и сценарии

### 3.1 Основной пользователь

Пользователь Windows 11, активно работающий с Codex Desktop/CLI и несколькими ChatGPT-аккаунтами, которыми он владеет или имеет право управлять.

### 3.2 Главные сценарии

1. Добавить новый ChatGPT-профиль через browser login или device-code.
2. Посмотреть, какой аккаунт сейчас активен.
3. Увидеть лимиты по 5-часовому и недельному окнам.
4. Быстро выбрать лучший свободный аккаунт.
5. Переключить активный аккаунт и корректно перезапустить Codex.
6. Переавторизовать профиль без дублей.
7. Получить уведомление о новой версии и открыть официальный GitHub Release.
8. Экспортировать аккаунты в зашифрованный файл и перенести на другой ПК.
9. Понять, почему аккаунт недоступен: лимит, ошибка auth, Codex CLI не найден, RPC timeout, stale snapshot.
10. Восстановиться после неудачного переключения или битого локального состояния.

## 4. Принципы продукта

- Local-first: никакой облачной синхронизации по умолчанию.
- Secret-safe: токены, `auth.json`, `.cam-export`, SQLite и логи считаются чувствительными.
- Predictable switching: переключение аккаунта должно быть атомарным, проверяемым и обратимым.
- Fast scan: пользователь должен видеть статус всех аккаунтов за 1-2 секунды.
- Calm UI: интерфейс плотный, чистый, профессиональный, без декоративной перегрузки.
- Explicit risk: опасные операции требуют понятного подтверждения.
- Observable by default: ошибки, диагностика и логи доступны без ручного поиска по AppData.

## 5. Функциональная спецификация

### 5.1 Аккаунты и профили

Обязательные функции:

- Добавление профиля через `chatgpt` browser login.
- Добавление профиля через `chatgptDeviceCode`.
- Reauth выбранного профиля без создания дубля.
- Добавление профиля через `apiKey` и `enterpriseAccessToken` official flows.
- Отсутствие публичного current-session/`auth.json` import API.
- Удаление профиля из менеджера.
- Открытие папки профиля.
- Редактирование `label`, `notes`, `subscriptionEndsAt`.
- Отображение email, плана, статуса, активного состояния, времени последнего использования и последнего обновления лимитов.

Доработать:

- Подтверждение удаления с указанием email/label и предупреждением, что локальная запись будет удалена.
- Массовые операции: refresh selected, export selected, delete selected.
- Теги и группы: `work`, `backup`, `personal`, `client`, custom tags.
- Pin/favorite для приоритетных аккаунтов.
- Ручная сортировка или вес аккаунта для рекомендации.
- Архивирование профиля без удаления auth-материала.
- Проверка дублей по подтверждённой provider/workspace identity и email из official app-server response.

### 5.2 Лимиты и рекомендации

Текущая логика `best-next-account` должна стать полноценным recommendation engine.

Требования:

- Отдельно показывать 5-часовое окно, недельное окно и общий статус.
- Учитывать `limited`, `near_limit`, `error`, `unknown`, stale snapshot.
- Показывать причину рекомендации: "минимальная загрузка", "быстрее сброс", "активный профиль", "ошибка исключена".
- Отображать дату/время сброса в локальном формате.
- Подсвечивать stale snapshots старше 15 минут.
- Дать настройку auto-refresh интервала: 1, 3, 5, 10, 15 минут.
- Не запускать конкурентные refresh-задачи для одного профиля.
- Добавить историю снимков лимитов в SQLite.

Новые сущности:

```sql
CREATE TABLE rate_limit_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  captured_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  primary_used_percent REAL,
  primary_resets_at INTEGER,
  primary_window_duration_mins INTEGER,
  secondary_used_percent REAL,
  secondary_resets_at INTEGER,
  secondary_window_duration_mins INTEGER,
  raw_json TEXT NOT NULL
);
```

### 5.3 Переключение аккаунта

Переключение должно быть самым надежным workflow в продукте.

Требования:

- Перед записью активного `auth.json` делать backup.
- Проверять, что target auth валиден JSON и содержит ожидаемый account id.
- Останавливать процессы Codex с таймаутом и понятным fallback.
- Атомарно писать `auth.json`.
- После записи перечитывать файл и сравнивать содержимое.
- Синхронизировать known account-id поля в `.codex-global-state.json` и `.bak`.
- Сохранять запись операции в audit log.
- Перезапускать Codex Desktop через найденный exe или AppUserModelId.
- Показывать пошаговый статус: "закрываю Codex", "создаю backup", "пишу auth.json", "проверяю", "запускаю Codex".
- Давать кнопку rollback к предыдущему `auth.json`, если переключение не завершилось.

Audit log:

```sql
CREATE TABLE switch_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  previous_account_id TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  backup_path TEXT,
  codex_desktop_path TEXT,
  codex_app_user_model_id TEXT
);
```

### 5.4 Импорт, экспорт и перенос

Текущая `.cam-export` модель остается, но UX и безопасность нужно усилить.

Требования:

- Экспорт всех аккаунтов или выбранных.
- Импорт с предварительным preview: сколько аккаунтов, какие email, какие дубли.
- Режимы разрешения конфликтов: skip, replace, import as copy.
- Оценка силы пароля без отправки наружу.
- Явное предупреждение, что экспорт содержит auth-материал после расшифровки.
- Опциональное удаление transfer-файла после успешного импорта.
- Версионирование формата экспорта и миграции при будущих изменениях.
- Сохранение `exportedAt`, app version, platform, schema version.

### 5.5 Диагностика и восстановление

Добавить отдельный раздел `Health`.

Показывать:

- Путь Codex CLI.
- Путь Codex Desktop.
- AppUserModelId.
- Active CODEX_HOME.
- AppData директорию менеджера.
- Путь SQLite.
- Путь логов.
- Версию Codex CLI, если возможно.
- Версию приложения.
- Наличие `auth.json`.
- Последний успешный refresh.
- Последний switch event.

Действия:

- "Проверить Codex CLI".
- "Проверить RPC".
- "Открыть AppData".
- "Открыть логи".
- "Сделать backup всех профилей".
- "Восстановить auth.json из backup".
- "Пересканировать Codex Desktop".
- "Сбросить зависшие login-процессы".

### 5.6 Настройки

Добавить полноценный экран `Settings`.

Настройки:

- Рабочая папка Codex.
- Интервал автообновления лимитов.
- Запускать приложение вместе с Windows.
- Сворачивать в трей.
- Подтверждать переключение аккаунта.
- Подтверждать удаление профиля.
- Автооткрытие Codex после переключения.
- Тема: system, light, dark.
- Язык: ru, en.
- Уровень логирования: normal, verbose.
- Хранить историю лимитов: 7, 30, 90 дней.
- Автоочистка старых backups.

### 5.7 Трей и нативная интеграция Windows

Добавить:

- Tray icon.
- Контекстное меню: active account, best account, refresh all, open app, quit.
- Toast notifications: лимит достигнут, аккаунт переключен, refresh failed.
- Single-instance поведение уже есть, но нужно проверить UX при повторном запуске.
- Опциональный автозапуск Windows.

## 6. UX/UI спецификация

### 6.1 Общая дизайн-цель

Интерфейс должен выглядеть как современная операционная консоль: плотная информация, аккуратная типографика, быстрые действия, четкие статусы. Ориентир из текущих артефактов Lazyweb сохраняется: AI infrastructure/control-plane эстетика, но без лишней "игровой" декоративности.

### 6.2 Визуальная система

Базовые токены:

- Canvas: `#fafaf9`
- Surface: `#ffffff`
- Text primary: `#0c0a09`
- Text secondary: `#78716c`
- Border: `#e5e7eb`
- Accent: `#3ba6f1`
- Success: `#16a34a`
- Warning: `#d97706`
- Danger: `#dc2626`
- Info: `#0284c7`

Требования:

- Радиус карточек не более 8px, кроме модальных окон и крупных shell-блоков.
- Убрать визуальную перегрузку: сократить число акцентных цветов, градиентов и декоративных слоев.
- Сформировать reusable CSS tokens и компоненты: button, icon button, badge, table, input, modal, toast, sidebar, toolbar, status dot, progress meter.
- Иконки только через `lucide-react`, где возможно.
- Все интерактивные иконки имеют `title` или доступный `aria-label`.
- Поддержка `prefers-reduced-motion`.
- Проверка UI на 980x640, 1180x760, 1440x900, 1920x1080.

### 6.3 Информационная архитектура

Целевая навигация:

- `Dashboard`: обзор, рекомендация, быстрые действия, health strip.
- `Accounts`: таблица/карточки, фильтры, bulk actions, inspector.
- `Limits`: история и графики лимитов.
- `Vault`: импорт/экспорт, backups, profile folders.
- `Health`: диагностика Codex, логи, recovery.
- `Settings`: настройки приложения.

Текущий top-nav `Console/Vault/Limits` должен стать реальной навигацией, а не декоративными текстовыми вкладками.

### 6.4 Состояния интерфейса

Для каждого workflow должны быть состояния:

- idle
- loading
- success
- partial success
- empty
- error
- permission/path problem
- Codex not found
- Codex RPC timeout
- auth invalid
- limit data stale

Сообщения должны быть человеческими и конкретными. Пример: не "Account not found", а "Профиль не найден в локальной базе. Возможно, он был удален или база была восстановлена из старой копии."

### 6.5 Локализация

Требования:

- Убрать смешение русского и английского там, где оно не является техническим термином.
- Все UI-строки вынести в словари `ru` и `en`.
- Проверить исходники, сборку и релиз на UTF-8, чтобы кириллица не превращалась в mojibake.
- Формат дат, процентов и относительного времени через `Intl`.

## 7. Архитектура

### 7.1 Слои

Сохранить текущую модель:

- `src/main`: Electron main, IPC, Codex RPC, SQLite, security, process management.
- `src/renderer`: React UI.
- `src/shared`: типы контракта.

Доработать:

- Ввести сервисные модули в `src/main/services`:
  - `accountService`
  - `limitService`
  - `switchService`
  - `backupService`
  - `diagnosticsService`
  - `settingsService`
- Ввести `src/main/ipc` с явной регистрацией каналов.
- Ввести `src/shared/ipcSchemas.ts` на Zod для валидации IPC payloads.
- Разделить `App.tsx` на компоненты и hooks:
  - `useAccounts`
  - `useDiagnostics`
  - `useTransferVault`
  - `DashboardPage`
  - `AccountsPage`
  - `HealthPage`
  - `SettingsPage`

### 7.2 IPC контракт

Все IPC handlers должны:

- Валидировать входные данные через Zod.
- Возвращать typed result.
- Не пробрасывать raw errors с секретными путями/токенами в UI.
- Логировать техническую ошибку локально.
- Возвращать user-facing error code/message.

Пример:

```ts
type AppErrorCode =
  | "CODEX_NOT_FOUND"
  | "RPC_TIMEOUT"
  | "AUTH_INVALID"
  | "ACCOUNT_NOT_FOUND"
  | "EXPORT_PASSWORD_WEAK"
  | "IMPORT_UNSUPPORTED"
  | "SWITCH_FAILED";
```

### 7.3 База данных и миграции

Текущая база создается через `CREATE TABLE IF NOT EXISTS`. Для профессиональной поддержки нужна схема миграций.

Требования:

- Таблица `schema_migrations`.
- Каждая миграция имеет номер, имя, дату, SQL/TS runner.
- Миграции идемпотентны и покрыты тестами.
- Перед risky migration делается backup SQLite.
- Версия схемы отображается в Health.

## 8. Безопасность

### 8.1 Секреты

Запрещено:

- Печатать токены, raw `auth.json`, `.cam-export` содержимое в UI или логи.
- Класть реальные auth-файлы в release artifacts.
- Загружать секретные скриншоты или файлы в сторонние сервисы без явного разрешения.

Требования:

- Маскировать email в privacy mode.
- Маскировать пути, если включен privacy mode.
- Логи проходят redaction перед записью.
- `.cam-export` всегда шифруется.
- Пароль экспорта минимум 8 символов, рекомендовано 12+.
- При невозможности `safeStorage` явно показывать degraded security state.
- Документировать fallback `vault.local.key` и риски.

### 8.2 Threat model

Обязательные угрозы для учета:

- Локальный пользователь с доступом к AppData.
- Утечка `.cam-export`.
- Битый или подмененный `auth.json`.
- Подмена Codex CLI path.
- Неполный switch из-за падения процесса.
- Утечка токенов через логи или crash dumps.

### 8.3 Подпись и релизы

Для публичного профессионального релиза:

- Code signing сертификат для Windows.
- Signed installer и portable exe.
- SHA256 checksums для артефактов.
- Release notes с security notes.
- Отдельно хранить rollback builds, но не смешивать старые артефакты с текущей сборкой.

## 9. Производительность и стабильность

### 9.1 Целевые показатели

- Cold start UI: до 2 секунд на обычной Windows 11 машине.
- Отрисовка списка 100 аккаунтов: без заметных лагов.
- Refresh одного аккаунта: timeout 45 секунд, user feedback сразу.
- Refresh всех аккаунтов: очередь с ограничением concurrency 2-3.
- Switch account: понятный progress, целевой happy path до 15 секунд без учета запуска Codex.
- UI не блокируется во время SQLite/RPC операций.

### 9.2 Стабильность

Требования:

- Защитить все long-running операции от двойного запуска.
- Отменяемые операции там, где возможно: refresh all, login polling.
- Таймауты и retries с backoff для Codex RPC.
- Очередь refresh-задач.
- Crash-safe backups.
- Отдельный renderer error boundary.
- Graceful startup при ошибке базы, vault или Codex CLI.

## 10. Тестирование и качество

### 10.1 Unit tests

Добавить `vitest`.

Покрыть:

- `classifyRateLimit`
- `selectBestRateLimit`
- `pickWindow`
- encryption/decryption `.cam-export`
- import conflict handling
- account recommendation scoring
- settings validation
- redaction логов

### 10.2 Integration tests

Покрыть:

- SQLite migrations.
- AccountStore CRUD.
- SwitchService на временной CODEX_HOME.
- Backup/rollback.
- IPC schemas.
- CodexRpcClient через mock process/stdin/stdout.

### 10.3 E2E/smoke

Добавить Playwright/Electron smoke tests:

- Старт приложения.
- Пустое состояние.
- Demo/mock accounts rendering.
- Фильтры и поиск.
- Модалка экспорта.
- Health screen.
- Settings screen.

### 10.4 CI

Расширить GitHub Actions:

- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build:dir`
- artifact upload для smoke-сборки
- dependency audit с явными исключениями

## 11. Релизный план

### Этап 1. Hardening 1.1

Цель: надежность без крупного редизайна.

- Zod validation для IPC.
- Error codes и нормальные user-facing ошибки.
- Подтверждение удаления.
- Подтверждение switch, если включено в настройках.
- Audit log switch operations.
- Backup/rollback UI.
- Улучшенный Health блок.
- Очередь refresh all.
- Unit tests для лимитов, vault, store.

Критерий готовности: приложение устойчиво обрабатывает Codex not found, RPC timeout, invalid auth, empty database, failed switch.

### Этап 2. Product UX 1.2

Цель: привести интерфейс к профессиональному уровню.

- Реальная навигация Dashboard/Accounts/Limits/Vault/Health/Settings.
- Разделение `App.tsx` на компоненты.
- Дизайн-система CSS tokens/components.
- Полные empty/loading/error states.
- Toast notifications.
- Privacy mode.
- Локализация ru/en.
- Проверка кириллицы в релизной сборке.

Критерий готовности: пользователь может пройти все основные сценарии без догадок и без чтения README.

### Этап 3. Functional Expansion 1.3

Цель: расширить ценность менеджера.

- Tags/groups/favorites.
- Bulk actions.
- История лимитов.
- Limits page с графиками и reset timeline.
- Export/import selected accounts.
- Import preview/conflict resolver.
- Tray menu.
- Windows autostart.

Критерий готовности: менеджер полезен не только для переключения, но и для ежедневного мониторинга парка аккаунтов.

### Этап 4. Professional Release 2.0

Цель: публично качественный релиз.

- Code signing.
- Release checksums.
- Installer QA.
- Portable QA.
- Full CI.
- Electron security checklist.
- Документация пользователя.
- Troubleshooting guide.
- Security model update.
- Clean release artifacts.

Критерий готовности: продукт можно отдавать внешнему пользователю без ручных пояснений и с понятной моделью поддержки.

## 12. Критерии приемки

Продукт считается доведенным до профессионального уровня, если:

- Все текущие функции версии `1.5.0` сохранены.
- Основные сценарии работают в installer и portable сборках.
- Нет утечек auth-материала в UI, логи, release artifacts.
- Переключение аккаунта имеет backup, audit и rollback.
- UI не показывает битую кириллицу.
- Empty/error/loading states покрыты.
- Есть тесты для критичной логики.
- CI проверяет typecheck, tests и build.
- Есть Health screen для самостоятельной диагностики.
- Есть Settings screen для пользовательских параметров.
- Релиз содержит понятные release notes и checksums.

## 13. Рекомендуемая структура задач

### P0

- IPC validation + typed error model.
- Switch audit + rollback.
- Delete confirmation.
- Refresh queue.
- Health diagnostics.
- Unit tests для core logic.

### P1

- UI navigation.
- App.tsx decomposition.
- Design tokens/components.
- Localization ru/en.
- Import preview/conflict resolver.
- Settings persistence.

### P2

- Limit history.
- Graphs/timeline.
- Tags/groups/favorites.
- Tray/autostart.
- Privacy mode.
- Playwright/Electron smoke tests.

### P3

- Code signing.
- Release automation.
- User documentation.
- Advanced backup scheduler.
- Optional encrypted local backup rotation.

## 14. Технические замечания по текущему коду

- `App.tsx` уже несет слишком много ответственности: состояние аккаунтов, transfer modal, dashboard, table, inspector, actions. Его нужно дробить до начала крупного расширения.
- `main.ts` содержит много IPC handler-логики в одном файле. Лучше вынести каналы и сервисы.
- `AccountManager` совмещает auth, import/export, switch, refresh и repair. Это рабоче для 1.x, но будет тормозить развитие.
- `CREATE TABLE IF NOT EXISTS` без миграций опасен для дальнейшего изменения схемы.
- GitHub Actions пока проверяет только typecheck.
- В UI есть смешение русского и английского. Технические термины допустимы, но навигация и действия должны быть последовательными.
- Дизайн уже близок к хорошему направлению, но требует упрощения палитры, реальной навигации, лучших состояний и компонентной дисциплины.

## 15. Первые практические шаги

Рекомендуемый порядок разработки:

1. Ввести `vitest` и покрыть существующую core-логику без изменения поведения.
2. Добавить Zod-схемы IPC и typed errors.
3. Вынести switch workflow в отдельный сервис с audit/rollback.
4. Добавить Health page.
5. Разделить renderer на страницы и компоненты.
6. Перевести строки UI в `i18n`.
7. Сделать Settings page и сохраняемые параметры.
8. Добавить limit history.
9. Расширить CI.
10. Поддерживать versioned release checklist и независимый exact-package gate.
