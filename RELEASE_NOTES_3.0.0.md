# Codex Account Manager 3.0.0

Версия 3.0 переводит переключение Codex Desktop на проверяемую транзакционную модель и обновляет интерфейс приложения.

## Главное

- Менеджер точно определяет пакет `OpenAI.Codex`, его `AppUserModelId` и дерево процессов; соседние ChatGPT/Codex-пакеты не выбираются как «первый найденный».
- `auth.json` и compatibility-файлы применяются одним staged bundle с read-back, stable checks и DPAPI-sealed rollback manifest.
- После запуска Manager ждёт стабильное видимое окно и подтверждает fingerprint/provider/workspace через официальный Codex app-server.
- Активный профиль и терминальное состояние switch-журнала фиксируются одной SQLite IMMEDIATE-транзакцией; частичный commit невозможен.
- Ошибка запуска, неверная identity/workspace, отозванный вход или несовместимый runtime запускают полный rollback с возвратом и проверкой предыдущего профиля.
- Startup recovery сначала останавливает потенциально живое целевое дерево, затем восстанавливает и повторно проверяет прежний аккаунт.

## Авторизация и сохранность

- Доступны ChatGPT browser login, device-code login, OpenAI API key через локальный app-server и enterprise access token через официальный CLI stdin.
- DPAPI vault работает fail-closed без plaintext fallback; обновлённый Codex token из глобального `CODEX_HOME` сохраняется обратно в зашифрованный профиль.
- Импорт объединяет профили по fingerprint или точной паре provider/workspace: одинаковый email в разных workspace не смешивается.
- Перед DB v8 migration создаётся и проверяется SQLite backup; legacy-профили без доказуемой identity переводятся в `needs_review`.
- Переключение поддерживается только при эффективном `cli_auth_credentials_store = "file"`. Значения `keyring` и `auto` блокируются fail-closed; Manager не меняет пользовательский `config.toml`.
- После успешного switch выполняется best-effort quota probe; временный сбой квот не откатывает уже подтверждённую авторизацию.

## Интерфейс

- Новый responsive shell: Overview, Accounts, Activity и Settings.
- Живые фазы переключения, rollback/recovery status, runtime и credential-store readiness.
- System tray, запуск при входе в Windows, persistent quota alerts и быстрый switch тем же транзакционным путём.
- Предпросмотр обезличенного diagnostic report; адаптация проверена на 980, 1180, 1440 и 1920 px.
- Второй UI-проход переработал Overview: равноправные quota-карточки с временем сброса, более ясная иерархия активной сессии, читаемые readiness-состояния и осмысленная рекомендация, когда лучший профиль уже активен.
- Исправлены выход версии за границы бренда, техническое слово `unspecified`, зарезервированная пустая строка update-banner и перекрытие hero-контента на узком окне.

## Проверка релиза

- 61 test files / 275 tests, TypeScript и ESLint — PASS.
- 1000-switch soak — PASS; p95 2.349 ms, active-resource delta 0.
- `pnpm audit` — no known vulnerabilities.
- Exact packaged smoke — 9/9; ASAR/source parity — 83/83 generated files.

## Важные ограничения

- Провайдер может отозвать token независимо от Manager; тогда потребуется повторный вход.
- Выбор аккаунта на странице browser login контролирует сам провайдер.
- EXE 3.0.0 не подписаны Authenticode. Публичное auto-update отключено; используйте manual update и сверяйте `SHA256SUMS-3.0.0.txt`.
- Испытание с двумя реальными аккаунтами и чистой Windows 11 VM не выполнялось без явного разрешения на приватные credentials и внешней VM; это manual acceptance-gates, а не автоматические доказательства.
