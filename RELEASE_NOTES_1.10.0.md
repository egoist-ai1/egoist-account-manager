# Codex Account Manager 1.10.0

## Главное

- Codex Account Manager by Egoist AI возвращает совместимый `appId`, название Windows-ярлыков и артефакты обновления ветки 1.9.x.
- Обновлён vault: больше нет нового plaintext fallback-ключа; доступный legacy-ключ мигрируется в Windows secure storage.
- Новые `.cam-export` используют `scrypt` и AES-256-GCM. Старые v1/v2-файлы остаются импортируемыми.
- Умный режим теперь только предлагает подходящий профиль. Любое переключение требует прямой команды пользователя.
- Anti-Gravity выпускается как Beta: опасный импорт credential-данных требует подтверждения, а OAuth не содержит встроенный client secret.

## Проверка

В архиве релиза находятся NSIS installer, portable EXE, `latest.yml`, blockmap и `SHA256SUMS-1.10.0.txt`. EXE пока не подписан Windows-сертификатом.
