# Codex Account Manager — roadmap

## Now

- Public 3.1.5 устраняет воспроизведённую блокировку switch после reauth; exact build прошёл полный release gate, Sandbox 3.1.4→3.1.5 и guarded publication с публичной сверкой 5/5 assets. Claude Code Provider Pilot отложен, продуктовый код Claude не начат.

## Next

- Наблюдать switch/reauth telemetry только по redacted локальному журналу. Claude Phase 0 возвращается в `Next` лишь по новому явному запросу. Будущий RFC может рассмотреть «переключить после текущего шага» только при официально наблюдаемом idle/turn-completed, checkpoint и запрете replay после первых response bytes.

## Later

- Team/Enterprise analytics, Console/API meters, WSL и IDE требуют отдельных specs. Автоматическая загрузка/установка EXE допускается только после Authenticode, RFC3161 и отдельного ship gate. Credential copying, private quota API, автоматическая ротация подписок для обхода limits и switch посреди turn остаются `NO-SHIP`.

Completed detail belongs in `docs/changes/` or user-facing release notes, not
in this roadmap.
