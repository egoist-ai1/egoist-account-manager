# Codex Account Manager — status

- Last updated: `2026-08-02T15:50:41Z`
- Version/revision: `3.1.0`; tag `v3.1.0` at `25f882c`; [stable GitHub Release published](https://github.com/egoistgorbachev/codex-account-manager/releases/tag/v3.1.0).
- Stage: `active`

## Observable outcome

Локальное Windows-приложение управляет разрешёнными Codex/Anti-Gravity профилями, показывает квоты и выполняет проверяемое переключение с rollback.

## Current milestone

- Milestone: exact 3.1.0 опубликована как stable manual GitHub Release после двух зелёных CI-runs на `main` и tag; silent/high-trust установка остаётся закрыта до Authenticode.
- Active spec: [`docs/product-3.0-spec-2026-07-29.md`](./docs/product-3.0-spec-2026-07-29.md)
- Active ticket: [`docs/product-3.0-tickets-2026-07-29.md`](./docs/product-3.0-tickets-2026-07-29.md), базовые T00–T14 и hardening T15–T23 завершены.

## Completed in the latest task

- Экспериментальные «Текущий Codex» и выбор произвольного `auth.json` удалены из renderer/preload/IPC; публично доступны только browser, device code, API key и Enterprise token.
- Stable double-read и manager-owned DPAPI-vault сохраняют последний корректный auth snapshot при частичной записи либо временном sign-out Codex Desktop; provider revocation остаётся честной границей повторного входа.
- SQLite schema v10 восстанавливает и жёстко обеспечивает один active-профиль на платформу, индексирует горячие identity/quota/switch запросы и использует FULL WAL durability с bounded optimize.
- Startup release discovery читает только stable `releases/latest` фиксированного GitHub repo, проверяет semver/размер/timeout и открывает только allowlisted release page; `electron-updater` удалён.
- Clean build удаляет только проверенный `dist`; exact package содержит 76/76 совпадающих файлов, два referenced renderer entry assets и 0 orphan bundles.
- Независимый gate: typecheck/lint, 69/323 tests + soak1000, smoke 11/4, isolated startup 4/4, hardened fuses, clean audit, SHA-256 4/4 и `latest.yml` SHA-512/size — `SHIP` для manual GitHub Release.

## Next safe action

1. Выполнить clean-VM/manual-account acceptance на опубликованном installer/portable и отдельно решать Authenticode/RFC3161 перед silent/high-trust доставкой.

## Verification

| Date (UTC) | Check | Result | Evidence |
| --- | --- | --- | --- |
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
- Exact production build нельзя подключить к Playwright из-за отключённого Node inspect; это закрывается 76/76 byte-parity, orphan-entry gate и неинструментированным isolated startup probe.
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
