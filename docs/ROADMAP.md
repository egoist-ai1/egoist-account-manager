# Egoist Account Manager — roadmap

## Now

- Public 3.1.5 остаётся latest stable. Local 3.1.6 прошёл build/audit/Node/Electron/package gates, но current clean-Windows Smart App Control блокирует unsigned installer; публикация ждёт CA-trusted Authenticode + RFC 3161 и повтор exact Sandbox lifecycle/live gate. Claude Code Provider Pilot отложен.

## Next

- Наблюдать switch/reauth telemetry только по redacted локальному журналу. Claude Phase 0 возвращается в `Next` лишь по новому явному запросу. Будущий RFC может рассмотреть «переключить после текущего шага» только при официально наблюдаемом idle/turn-completed, checkpoint и запрете replay после первых response bytes.

## Later

- Team/Enterprise analytics, Console/API meters, WSL и IDE требуют отдельных specs. Автоматическая загрузка/установка EXE допускается только после Authenticode, RFC3161 и отдельного ship gate. Credential copying, private quota API, автоматическая ротация подписок для обхода limits и switch посреди turn остаются `NO-SHIP`.

Completed detail belongs in `docs/changes/` or user-facing release notes, not
in this roadmap.
