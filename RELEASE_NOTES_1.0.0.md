# Egoist AI Manager 1.0.0

Первая коммерчески чистая v1.0-линия на базе нашего Electron/TypeScript-приложения.

## Главное

- Зафиксирована clean-room политика: внешние проекты используются только как поведенческий референс, без копирования кода, UI, брендинга, installer/updater-метаданных и data-dir схем.
- Добавлен фундамент двух платформ: `codex` и `antigravity`.
- Существующие аккаунты автоматически остаются `codex`.
- Добавлена read-only диагностика локального профиля Antigravity IDE: `state.vscdb`, `storage.json`, `machineid`.
- Добавлен безопасный reader Antigravity: он считает записи `ItemTable`, ключи `storage.json` и показывает короткий SHA-256 префикс `machineid`, не возвращая сохранённые значения.
- Добавлен внутренний backup/restore слой Antigravity для `state.vscdb`, `storage.json`, `machineid`; manifest содержит только метаданные, restore пишет через временный файл и rename.
- Добавлен внутренний allowlist writer Antigravity: запись разрешена только по явно перечисленным ключам, backup выполняется до первой записи, а при ошибке профиль откатывается.
- Добавлен `antigravityAccountAdapter`: он валидирует пакет аккаунта, строит allowlisted write-plan и возвращает только sanitized summary без токенов и `machineid`.
- Интерфейс обновлён под Codex + Antigravity foundation, но Antigravity switch/auth/quota пока не имитируются фальшивыми кнопками.
- Диагностика релиза теперь ожидает реальные дефисные имена артефактов electron-builder.

## Ограничения v1.0

- Полное переключение и refresh лимитов остаются рабочими для Codex.
- Antigravity в v1.0 является безопасным foundation-слоем: пути, диагностика, типы, БД и UI-контур.
- Публичный коммерческий канал требует Windows code signing и включённой проверки подписи обновлений.
