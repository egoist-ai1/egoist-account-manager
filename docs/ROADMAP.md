# Codex Account Manager — roadmap

## Now

- Exact local package 3.1.4 завершён: прозрачный compositor-safe WhyX hover без прямоугольного halo и минималистичный читаемый single-digit tray glyph. Публичной публикации 3.1.4 в этой задаче нет; стабильным GitHub Release остаётся 3.1.0.

## Next

- При отдельном разрешении — опубликовать 3.1.4 после Authenticode либо как честный manual/unsigned release с SHA-256. Будущий RFC может рассмотреть «переключить после текущего шага» только при официально наблюдаемом idle/turn-completed, checkpoint и запрете replay после первых response bytes.

## Later

- Автоматическая загрузка/установка EXE допускается только после Authenticode, RFC3161 и отдельного независимого ship gate. Автоматическая ротация подписок для обхода usage limits и switch посреди turn остаются `NO-SHIP`.

Completed detail belongs in `docs/changes/` or user-facing release notes, not
in this roadmap.
