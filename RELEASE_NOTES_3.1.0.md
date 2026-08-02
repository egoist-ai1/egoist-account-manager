# Codex Account Manager 3.1.0

## Главное

- Мастер добавления аккаунта снова использует только официальные способы входа Codex: браузер, device code, API key и Enterprise access token. Экспериментальные «Текущий Codex» и выбор произвольного `auth.json` удалены из интерфейса и IPC.
- Сохранённая сессия переживает перезапуск Manager, Codex и Windows благодаря зашифрованному DPAPI-vault. Если глобальный `auth.json` временно отсутствует, Manager проверяет последний защищённый профиль в изолированном `CODEX_HOME`, а не объявляет аккаунт потерянным.
- Чтение auth-файлов защищено от частичной записи: принимается только обычный JSON-object до 1 MiB после двух совпадающих чтений.
- Переключение остаётся транзакционным: точный профиль применяется, Codex запускается тем же package root, личность проверяется через официальный app-server, а при ошибке выполняется проверенный rollback или показывается recovery state.

## Стабильность и данные

- База обновлена до schema v10: только один активный профиль на платформу, восстановление старых дубликатов, индексы identity/history/quota/switch, `WAL`, `synchronous=FULL`, 5-секундный busy timeout и безопасная оптимизация.
- Список аккаунтов загружает tags одним batch-запросом вместо N+1.
- Последний корректный снимок лимитов и зашифрованный вход не удаляются из-за временной сетевой ошибки или кратковременного выхода desktop-клиента.

## Обновления

- При запуске приложение автоматически проверяет последний стабильный GitHub Release проекта.
- Новая версия показывается компактным баннером и Windows-уведомлением. Кнопка открывает строго страницу релиза `egoistgorbachev/codex-account-manager`.
- Скрытая загрузка и автоматический запуск неподписанного EXE не выполняются. До появления Authenticode установка остаётся осознанным действием пользователя.

## Проверка релиза

- TypeScript и ESLint: pass.
- Node/unit/integration: 69 файлов, 323 теста, включая 1000 synthetic switch transitions.
- Chromium UI: 11/11 активных сценариев; Overview `1460×900` без page-scroll, Accounts 3×3, официальный onboarding без клиппинга.
- Exact package: 76/76 source/ASAR parity, ровно два referenced renderer entry assets и ни одного orphan bundle, версия 3.1.0.
- Isolated packaged startup: 4/4, renderer ready, отдельный `userData`, cleanup pass.
- Dependency audit: 0 известных уязвимостей.

## SHA-256

```text
dfa365f3b19122d2a4d5365c9f977f824ca2022f28a562bfa38c4a756b0cf3de  Codex-Account-Manager-Setup-3.1.0.exe
e66f3c6ab59161b2b6018952713e9752e20c4c82de2950374351034cb082f28a  Codex-Account-Manager-3.1.0.exe
55f0cfb7d99746e3ab97c9525d1a9694739fd5557ec53ea766311d4da325e6da  Codex-Account-Manager-Setup-3.1.0.exe.blockmap
56a7e8cb0bf3ce14a2f26bfe53d94c9af755677adbf655e759b2d6b8f4d040f1  latest.yml
```

## Ограничение доверия

EXE 3.1.0 пока не подписаны Authenticode. Проверяйте `SHA256SUMS-3.1.0.txt`; Windows SmartScreen может показать предупреждение. Провайдер также может отозвать токен или потребовать MFA — Manager сохраняет доступные официальные credentials, но не обходит серверное истечение или отзыв.
