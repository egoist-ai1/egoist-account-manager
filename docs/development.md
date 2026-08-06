# Разработка

## Требования

- Windows 11;
- Node.js и pnpm версий из актуального workspace;
- установленный Codex Desktop для ручной проверки интеграции.

## Локальный запуск

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

## Базовая проверка

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke
```

Перед публикацией выполняются дополнительные package, ASAR, startup, tray, Sandbox и live gates. Реальные credentials не должны попадать в fixtures, логи, screenshots или pull requests.

Архитектурная карта находится в [`ARCHITECTURE.md`](ARCHITECTURE.md), правила безопасности — в [`../SECURITY.md`](../SECURITY.md).
