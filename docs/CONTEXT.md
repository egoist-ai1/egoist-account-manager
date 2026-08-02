# Codex Account Manager — durable context

Этот файл — компактный source-linked маршрут к проверенным фактам проекта. Полная истина остаётся в canonical owner и evidence; чат не является источником полномочий.

## Active durable context

| ID | Kind | Scope | Status | Statement / route | Owner | Source | Verified at | Expires |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CTX-001 | fact | `project:codex-account-manager-gh` | active | Продукт — local-first Windows manager разрешённых Codex/Anti-Gravity профилей с truthful quotas и проверяемым rollback. | [`STATUS.md`](../STATUS.md) | [`docs/product-3.0-spec-2026-07-29.md`](./product-3.0-spec-2026-07-29.md) | 2026-08-02 | none |
| CTX-002 | constraint | `project:codex-account-manager-gh` | active | Switch считается успешным только после фактической identity verification; ошибка после live write требует verified rollback или recovery state. | [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) | [`artifacts/3.0.9/verification/VERIFICATION.md`](../artifacts/3.0.9/verification/VERIFICATION.md) | 2026-08-02 | none |
| CTX-003 | fact | `project:codex-account-manager-gh` | active | Exact 3.1.0 прошла source/package gate и независимый SHIP для ручного GitHub Release: 69/323 tests, 11/4 smoke, startup 4/4, 76/76 ASAR parity и 0 orphan bundles. | [`STATUS.md`](../STATUS.md) | [`docs/releases/3.1.0.md`](./releases/3.1.0.md) | 2026-08-02 | none |
| CTX-004 | constraint | `project:codex-account-manager-gh` | active | Mid-turn switch/replay и автоматическая ротация подписок для имитации unlimited usage остаются NO-SHIP. | [`docs/ROADMAP.md`](./ROADMAP.md) | [`docs/research/seamless-switching-market-2026-08-02.md`](./research/seamless-switching-market-2026-08-02.md) | 2026-08-02 | 2026-11-02 |
| CTX-006 | constraint | `project:codex-account-manager-gh` | active | Публичное добавление Codex использует только browser, device code, API key и Enterprise token; импорт текущей сессии и произвольного `auth.json` удалён из renderer/preload/IPC. | [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) | [`docs/decisions/2026-08-02-v3-1-official-auth-github-release.md`](./decisions/2026-08-02-v3-1-official-auth-github-release.md) | 2026-08-02 | none |
| CTX-007 | constraint | `project:codex-account-manager-gh` | active | Manager автоматически обнаруживает stable GitHub Release только в фиксированном repo и открывает allowlisted browser URL; silent EXE install остаётся NO-SHIP до Authenticode. | [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) | [`docs/decisions/2026-08-02-v3-1-official-auth-github-release.md`](./decisions/2026-08-02-v3-1-official-auth-github-release.md) | 2026-08-02 | none |

## Promotion candidates

| ID | Kind | Scope | Status | Statement / route | Owner | Source | Verified at | Expires |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CTX-005 | preference | `project:codex-account-manager-gh` | candidate | Будущий RFC может оценить opt-in действие «Переключить после текущего шага» только на наблюдаемой idle-boundary с checkpoint, identity proof и rollback. | [`docs/ROADMAP.md`](./ROADMAP.md) | [`docs/research/seamless-switching-market-2026-08-02.md`](./research/seamless-switching-market-2026-08-02.md) | 2026-08-02 | 2026-11-02 |
