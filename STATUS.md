# Codex Account Manager — status

- Last updated: `2026-08-02T23:57:40Z`
- Version/revision: exact local `3.1.5` release candidate; public stable remains [`v3.1.4`](https://github.com/egoistgorbachev/codex-account-manager/releases/tag/v3.1.4) at `990ef785395b5cff1ea987865097661c4d000284`
- Stage: `release-ready`

## Observable outcome

Локальное Windows-приложение управляет разрешёнными Codex/Anti-Gravity профилями, показывает truthful quotas и выполняет проверяемое переключение с rollback.

## Current milestone

- 3.1.5 исправляет воспроизведённую периодическую блокировку переключения после target reauth; Claude Code scope отложен и продуктовый код Claude не менялся.
- Exact installer/portable и пять publication assets собраны; source/package/UI/Sandbox gates прошли.
- GitHub tag/release 3.1.5 ещё не создавались: следующий шаг — независимый review exact commit/manifest и guarded publication.

## Completed in the latest task

- Production log доказал корень: после `prepare` switch отклонялся из-за незавершённого reauth, а singleton-транзакция оставалась активной до перезапуска.
- Prepare теперь fail-fast для reauth целевого профиля; гонка после prepare и cross-process rejection гарантированно завершают транзакцию terminal state.
- Повторный reauth одного профиля безопасно заменяет старый manager-owned app-server/profile; reauth другого аккаунта не блокирует готовую цель.
- Успешный commit сразу обновляет active card; фоновый reload не удерживает global busy. Кнопка получила явный pointer/disabled cursor.
- Node gate 71/343 + soak1000, typecheck/lint, smoke 15/4, ASAR 78/78, isolated startup, tray 44/44 и Windows Sandbox 16/16 прошли.

## Next safe action

1. Зафиксировать exact source commit и publication manifest.
2. Получить независимый outcome-review `pass`.
3. Только после pass выполнить guarded push/tag/GitHub Release v3.1.5 и публично сверить 5/5 assets.

## Verification

| Date (UTC) | Check | Result | Evidence |
| --- | --- | --- | --- |
| 2026-08-02 | Exact 3.1.5 release gate | pass; 71/343 tests, smoke 15/4, startup, 78/78 ASAR, tray 44/44 | [`docs/releases/3.1.5.md`](./docs/releases/3.1.5.md) |
| 2026-08-02 | Sandbox 3.1.4→3.1.5 lifecycle | pass 16/16 | [`artifacts/sandbox/3.1.5/results/release-lifecycle.json`](./artifacts/sandbox/3.1.5/results/release-lifecycle.json) |
| 2026-08-02 | Public release 3.1.4 | pass; latest stable, 5 assets, exact commit/tag | [GitHub Release](https://github.com/egoistgorbachev/codex-account-manager/releases/tag/v3.1.4) |
| 2026-08-02 | Claude Code provider research | pass; implementation deferred | [`docs/research/claude-code-provider-integration-2026-08-02.md`](./docs/research/claude-code-provider-integration-2026-08-02.md) |

## Blockers and residual risks

- EXE не подписаны; manual GitHub download допускается с SHA-256/SmartScreen disclosure, silent/high-trust доставка требует Authenticode + RFC3161.
- Реальный пользовательский account switch намеренно не запускался: текущая Codex-сессия не закрывалась, tests использовали fake CLI, изолированные process fixtures и Windows Sandbox.
- Четыре production-inspector Playwright сценария недоступны из-за отключённого Node inspect; package boundary закрывают ASAR parity и isolated startup.
- После `test:node` release-порядок обязан выполнять `rebuild:native:electron`; exact 3.1.5 build это выполнил.
- Claude Code продуктового кода пока нет; runtime claims ограничены сохранённым исследованием.

## Durable context

- [Architecture](./docs/ARCHITECTURE.md)
- [Context index](./docs/CONTEXT.md)
- [Application map](./docs/APP_MAP.md)
- [Roadmap](./docs/ROADMAP.md)
- [Claude Code research](./docs/research/claude-code-provider-integration-2026-08-02.md)
- [Change history](./docs/changes/INDEX.md)
- [Release notes](./docs/releases/README.md)
