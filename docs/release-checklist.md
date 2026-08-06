# Чеклист релиза

## Перед сборкой

- Проверить, что версия совпадает в `package.json` и `src/shared/releaseNotes.ts` (lockfile не хранит версию private workspace).
- Запустить `pnpm run typecheck`, `pnpm run lint` и `pnpm run test:node`.
- Запустить полный `pnpm audit`; release gate требует отсутствие известных уязвимостей.
- Проверить DB migration backup, switch recovery и fault-injection тесты.
- Проверить credential-store policy: `file` совместим; `keyring` и `auto` блокируются без изменения user config.
- Убедиться, что интерфейс остаётся полностью русским, кроме технических имён `Codex`, `ChatGPT`, `auth.json`, `CODEX_HOME`.

## Сборка

```powershell
pnpm run build
```

Ожидаемые файлы для версии `<version>`:

- `release/Egoist-Account-Manager-Setup-<version>.exe`
- `release/Egoist-Account-Manager-<version>.exe`
- `release/latest.yml`
- `release/Egoist-Account-Manager-Setup-<version>.exe.blockmap`
- `release/SHA256SUMS-<version>.txt`

## Контрольные суммы

```powershell
pnpm run release:checksums
```

- Сверить каждый файл с `SHA256SUMS-<version>.txt` отдельным fresh gate.
- Зафиксировать точные размеры и SHA-256 в `docs/releases/<version>.md`.

## Packaged gate

```powershell
pnpm run smoke
pnpm run verify:package
pnpm run verify:startup
```

- Проверить package version и byte parity всего generated `dist` внутри `app.asar`.
- Проверить Electron fuses и Authenticode status у installer, portable и inner EXE.
- Получить независимый read-only вердикт по точным финальным артефактам.

## Manual acceptance

- На двух явно разрешённых тестовых аккаунтах выполнить не менее 20 switch-циклов, включая закрытие/открытие Manager и Codex Desktop.
- На чистой Windows 11 VM проверить install, first run, switch, repair/update и uninstall без потери пользовательских данных.
- Не использовать реальные credentials и не прерывать активную Codex-сессию без явного разрешения пользователя.

## Перед публичной публикацией

- Неподписанный release нельзя публиковать как прошедший clean-Windows gate, если текущий Smart App Control блокирует exact artifact. Приложение может автоматически обнаружить новую версию, но не скачивает и не запускает EXE.
- Для публичной high-trust доставки подключить Authenticode, RFC3161 timestamp, `signAndEditExecutable` и `verifyUpdateCodeSignature`, затем проверить всю signature chain.
- Проверить блок `Диагностика → Релиз` в собранном приложении.
