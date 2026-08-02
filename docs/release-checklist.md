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

Ожидаемые файлы для версии 3.1.0:

- `release/Codex-Account-Manager-Setup-3.1.0.exe`
- `release/Codex-Account-Manager-3.1.0.exe`
- `release/latest.yml`
- `release/Codex-Account-Manager-Setup-3.1.0.exe.blockmap`
- `release/SHA256SUMS-3.1.0.txt`

## Контрольные суммы

```powershell
pnpm run release:checksums
```

- Сверить каждый файл с `SHA256SUMS-3.1.0.txt` отдельным fresh gate.
- Зафиксировать точные размеры и SHA-256 в `docs/releases/3.1.0.md`.

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

- До подключения сертификата публиковать GitHub Release с SHA-256 и ручной установкой. Приложение может автоматически обнаружить новую версию, но не скачивает и не запускает EXE.
- Для публичной high-trust доставки подключить Authenticode, RFC3161 timestamp, `signAndEditExecutable` и `verifyUpdateCodeSignature`, затем проверить всю signature chain.
- Проверить блок `Диагностика → Релиз` в собранном приложении.
