# Codex Account Manager — roadmap

## Now

- Завершить exact package gate и GitHub Release 3.1.0: official-login-only onboarding, last-known-good vault fallback, DB v10 invariants/performance и безопасная startup-проверка GitHub Releases.

## Next

- Ручная acceptance-проверка на выделенных тестовых аккаунтах и чистой Windows 11 VM; затем Authenticode и отдельный signed in-app installer gate. Будущий RFC может рассмотреть «переключить после текущего шага» только при официально наблюдаемом idle/turn-completed, checkpoint и запрете replay после первых response bytes.

## Later

- Автоматическая загрузка/установка EXE допускается только после Authenticode, RFC3161 и отдельного независимого ship gate. Автоматическая ротация подписок для обхода usage limits и switch посреди turn остаются `NO-SHIP`.

Completed detail belongs in `docs/changes/` or user-facing release notes, not
in this roadmap.
