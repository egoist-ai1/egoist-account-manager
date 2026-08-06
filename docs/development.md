# Разработка Egoist Account Manager

## Требования

- Windows 11
- Node.js 24
- pnpm 11

## Локальный запуск

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

## Основные проверки

```powershell
pnpm run typecheck
pnpm run lint
pnpm run test:node
pnpm run build:dir
pnpm run smoke
```

Полная release-сборка:

```powershell
pnpm run build
pnpm run verify:package
pnpm run verify:startup
pnpm run verify:tray-native
```

`pnpm run test:node` пересобирает `better-sqlite3` для Node ABI. `pnpm run build` пересобирает его для Electron ABI; эти состояния намеренно разделены.

## Архитектура

- `src/main/` — vault, SQLite, процессы Codex, авторизация и typed IPC.
- `src/renderer/` — React-интерфейс и browser-preview fixtures.
- `src/shared/` — общие контракты, ранжирование, quota и presentation logic.
- `tests/` — Node/integration, UI contracts и Playwright smoke.
- `scripts/` — packaging, exact ASAR, startup, tray и Windows Sandbox gates.

Подробные карты: [архитектура](ARCHITECTURE.md), [карта приложения](APP_MAP.md), [troubleshooting](troubleshooting.md).

## Правила безопасности

- Не добавляйте в fixtures реальные email, токены, cookies, `auth.json`, `.cam-export`, базы или пользовательские пути.
- Не тестируйте переключение на активной пользовательской Codex-сессии.
- Live E2E выполняется только в отдельном Windows Sandbox и на явно выделенных неактивных профилях.
- Не публикуйте содержимое `release/`; binaries прикладываются к GitHub Release отдельно.
