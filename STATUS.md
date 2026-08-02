# Codex Account Manager — status

- Last updated: `2026-08-02T18:53:39Z`
- Version/revision: exact local `3.1.4`; not committed, tagged or published. Public stable remains [`v3.1.0`](https://github.com/egoistgorbachev/codex-account-manager/releases/tag/v3.1.0) at `25f882c`.
- Stage: `active`

## Observable outcome

Локальное Windows-приложение управляет разрешёнными Codex/Anti-Gravity профилями, показывает квоты и выполняет проверяемое переключение с rollback.

## Current milestone

- Milestone: exact local 3.1.4 готова к ручной установке после transparent-hover, single-digit tray, package и startup gates; публикация и silent/high-trust установка остаются закрыты до отдельного разрешения и Authenticode.
- Active spec: [`docs/product-3.0-spec-2026-07-29.md`](./docs/product-3.0-spec-2026-07-29.md)
- Active ticket: [`docs/product-3.0-tickets-2026-07-29.md`](./docs/product-3.0-tickets-2026-07-29.md), базовые T00–T14 и hardening T15–T27 завершены.

## Completed in the latest task

- Корень чёрного прямоугольника устранён на уровне compositor canvas: `html/body/#root` прозрачны только для passive hover, внешний shadow/backdrop filter/glow удалены. Пиксельный probe 252×144 подтвердил `A=0` во всех четырёх углах.
- Hover остаётся 252×144, click-through, non-focusable и action-free; активный Codex-профиль, один фактически ограничивающий quota window, точный остаток и reset-time сохранены. Click popup/context menu не менялись.
- Logical tray image сохраняет pixel-aligned 16/20/24/32 px representations. Single-digit `1` получил свободные поля, форму без тяжёлого основания и короткий state-rail вместо периметральной рамки-скобки; native preview и геометрический unit-gate покрывают все четыре DPI.
- Windows toast runtime, redacted in-app queue и отдельный 1/3/5/10/15/off active-account refresh не менялись. Auth/session/switching contracts, DPAPI-vault, SQLite schema v10 и четыре официальных способа входа не менялись.
- Exact package прошёл typecheck/lint, 71/339 tests + soak1000, smoke 15/4, 78/78 ASAR, 11 состояний/значений × 4 native representations, isolated startup и SHA-256 4/4. Независимый outcome review — `pass` без blocking findings.
- Sandbox 3.1.4 не запускался, чужие активные Sandbox-процессы не прерывались. Предыдущий 3.1.1 lifecycle gate остаётся 16/16, а 3.1.4 затрагивает только tray render/hover compositor.

## Next safe action

1. По отдельному разрешению установить exact 3.1.4 вручную и проверить реальный Windows hover на 100/125/150/200% DPI; повторить isolated Sandbox upgrade 3.1.3→3.1.4 после освобождения Sandbox. Публиковать GitHub Release только отдельным действием; Authenticode/RFC3161 обязателен перед silent/high-trust доставкой.

## Verification

| Date (UTC) | Check | Result | Evidence |
| --- | --- | --- | --- |
| 2026-08-02 | 3.1.4 transparent hover + single-digit tray gate | pass; independent outcome review `pass`; native Windows hover runtime and Sandbox 3.1.4 not rerun; not published | [`docs/releases/3.1.4.md`](./docs/releases/3.1.4.md): corner alpha 4/4, 71/339 tests, smoke 15/4, startup pass, 78/78 ASAR, 11×4 native tray representations and exact hashes. |
| 2026-08-02 | 3.1.3 compact active-window tray gate | pass; independent outcome review `pass`; native Windows hover runtime and Sandbox 3.1.3 not rerun; not published | [`docs/releases/3.1.3.md`](./docs/releases/3.1.3.md): 71/338 tests, smoke 15/4, startup pass, 78/78 ASAR, 11×4 native tray representations and exact hashes. |
| 2026-08-02 | 3.1.2 exact local tray/hover gate | source/render/package pass; native Windows hover runtime and Sandbox 3.1.2 not rerun; not published | [`docs/releases/3.1.2.md`](./docs/releases/3.1.2.md): 71/336 tests, smoke 15/4, startup pass, 78/78 ASAR, 10×4 native tray representations and exact hashes. |
| 2026-08-02 | 3.1.1 exact local release gate | pass; independent outcome review `pass`; not published | [`docs/releases/3.1.1.md`](./docs/releases/3.1.1.md): 70/329 tests, smoke 13/4, startup pass, 77/77 ASAR, native tray 9/9, Sandbox 16/16 and exact hashes. |
| 2026-08-02 | 3.1.0 public release gate | pass; stable `v3.1.0`, 5 assets uploaded, public `releases/latest` resolves correctly, tag CI green | [GitHub Release](https://github.com/egoistgorbachev/codex-account-manager/releases/tag/v3.1.0); CI runs `30754796564` and `30755079295`. |
| 2026-08-02 | 3.1.0 exact source/package gate | pass; independent `SHIP`; manual GitHub Release ready | [`docs/releases/3.1.0.md`](./docs/releases/3.1.0.md): 69/323 tests, smoke 11/4, startup 4/4, 76/76 ASAR parity, 0 orphan bundles and exact hashes. |
| 2026-08-02 | 3.0.10 exact source/package gate | pass; independent `SHIP`; local/manual ready | [`artifacts/3.0.10/verification/VERIFICATION.md`](./artifacts/3.0.10/verification/VERIFICATION.md): 69/323 tests, smoke 11 passed / 4 intentional skips, isolated startup 4/4, 124/124 ASAR parity, exact hashes. |
| 2026-08-02 | 3.0.9 exact source/package gate | pass; independent `SHIP`; local/manual ready | [`artifacts/3.0.9/verification/VERIFICATION.md`](./artifacts/3.0.9/verification/VERIFICATION.md): 68/317 tests, smoke 9 passed / 4 intentional skips, 4/4 exact startup cleanup, 120/120 ASAR parity, exact hashes. |
| 2026-08-01 | 3.0.8 exact source/package gate | pass; independent `SHIP`; local/manual ready | [`artifacts/3.0.8/verification/VERIFICATION.md`](./artifacts/3.0.8/verification/VERIFICATION.md): 66/308 tests, 7/7 instrumentable smoke, 4/4 exact startup cleanup, 117/117 ASAR parity, exact hashes. |
| 2026-08-01 | 3.0.7 exact source/package gate | pass; independent `SHIP`; local/manual ready | [`artifacts/3.0.7/verification/VERIFICATION.md`](./artifacts/3.0.7/verification/VERIFICATION.md): 64/296 tests, 6/6 instrumentable smoke, exact startup, 110/110 ASAR parity, exact hashes. |
| 2026-08-01 | 3.0.6 exact source/package gate | pass; independent `SHIP`; local/manual ready | [`artifacts/3.0.6/verification/VERIFICATION.md`](./artifacts/3.0.6/verification/VERIFICATION.md): 62/290 tests, 6/6 instrumentable smoke, exact startup, 106/106 ASAR parity, exact hashes. |
| 2026-08-01 | 3.0.5 exact source/package gate | pass; local/manual ready | [`artifacts/3.0.5/verification/VERIFICATION.md`](./artifacts/3.0.5/verification/VERIFICATION.md): 62/290 tests, 6 instrumentable smoke, exact startup, 101/101 ASAR parity, exact hashes. |
| 2026-08-01 | 3.0.4 exact source/package gate | pass; historical local/manual ready | [`artifacts/3.0.4/verification/VERIFICATION.md`](./artifacts/3.0.4/verification/VERIFICATION.md). |
| 2026-08-01 | 3.0.3 exact source/package gate | pass; historical independent `SHIP` | [`artifacts/3.0.3/verification/VERIFICATION.md`](./artifacts/3.0.3/verification/VERIFICATION.md). |
| 2026-07-31 | Continuity layout audit | pass | `doctor.ps1 -ProjectAudit -ProjectPath projects/codex-account-manager-gh -Strict`. |

## Blockers and residual risks

- EXE не подписаны; GitHub download допускается только как manual flow с SHA-256/SmartScreen warning, а silent/high-trust доставка требует Authenticode и RFC3161.
- `EnableNodeCliInspectArguments` отключён. `GrantFileProtocolExtraPrivileges` остаётся включён для ASAR-backed `loadFile()`; sender validation, sandbox, context isolation, navigation blocking и ASAR-only loading остаются активны.
- Exact production build нельзя подключить к Playwright из-за отключённого Node inspect; source/package boundary закрывается 78/78 byte-parity, orphan-entry gate и неинструментированным isolated startup probe. Нативная Windows hover-последовательность остаётся ручной проверкой.
- Windows может поместить live icon в tray overflow; приложение не может принудительно закрепить его рядом с часами.
- Повторный Sandbox lifecycle 3.1.4 отложен до освобождения экземпляров другого проекта; менеджер их не прерывал.
- Редкий остаточный race при смене active-профиля строго во время уже начатого tray probe не показал отказов, но остаётся кандидатом для отдельного stress gate; переключение и rollback сохраняют собственные проверки личности.
- Реальные повторные account-switch trials оставлены ручной пользовательской границей.
- В release-порядке после `test:node` обязателен `rebuild:native:electron`, потому что `better-sqlite3` переключается с Node ABI обратно на Electron ABI.

## Durable context

- [Architecture](./docs/ARCHITECTURE.md)
- [Context index](./docs/CONTEXT.md)
- [Application map](./docs/APP_MAP.md)
- [Roadmap](./docs/ROADMAP.md)
- [Specifications](./docs/specs/README.md)
- [Tickets](./docs/tickets/README.md)
- [Change history](./docs/changes/INDEX.md)
- [Release notes](./docs/releases/README.md)
