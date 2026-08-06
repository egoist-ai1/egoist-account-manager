# 3.0.10 current-session import, viewport closure and compact failure states

- Date: 2026-08-02T13:48:57Z
- Type: release
- Status: complete
- Related: `docs/product-3.0-tickets-2026-07-29.md` T22

## What changed

- Codex onboarding добавил защищённые действия «Текущий Codex» и «Выбрать auth.json» рядом с официальными login methods.
- File-backed auth проходит bounded stable read, официальную app-server identity/limits verification и DPAPI sealing; keyring/auto/ephemeral имеют честный linked-only/needs-login контракт.
- Antigravity onboarding показывает три основных сценария сразу, а расширенное восстановление отделено от ежедневных действий.
- Overview занимает оставшуюся высоту app frame без пустой нижней области и без обязательного вертикального page scroll.
- Runtime failure banner перестал занимать всю свободную строку Settings; raw native error удалён из UI и заменён компактным действием «Журнал».
- Process/Windows notifications получили подписанные стадии, attribution, action и redacted payload.
- Installer и portable 3.0.10 пересобраны после последнего UI fix и прошли exact package gate.

## Why

Пользователь запросил импорт уже активной Codex-сессии и `auth.json`, более компактные и понятные Codex/Antigravity flows, отсутствие лишнего Overview scroll и исправление огромного аварийного уведомления без прерывания текущей рабочей сессии Codex.

## How

Main process владеет чтением auth source и typed IPC; renderer получает только redacted preview/result. Layout `app-frame` переведён на column flex: topbar и условные banners имеют собственную высоту, а `.content` получает только остаток. Raw error остаётся в диагностическом журнале. Release verification использует Node ABI для unit/integration и затем обязательный Electron rebuild перед package/smoke.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck, lint, dependency audit | pass | Final build; `pnpm audit --audit-level=low` — 0 известных уязвимостей. |
| Node/unit/integration | pass | 69 файлов / 323 теста, включая synthetic soak 1000 switch transitions. |
| Rendered UI | pass | Full smoke 11 passed / 4 intentional skips; Overview/default viewport, 3×3 Accounts, add-account wizard and production fallback. |
| Compact failure state | pass | Unit + rendered oracle: non-growing optional banner, flexible content, no overflow and no raw `loadError` in visible UI. |
| Exact package | pass | 124/124 ASAR parity; source/package 3.0.10. |
| Isolated packaged startup | pass | 4/4: `3.0.10.0`, renderer ready, isolated user data and cleanup passed; installed Codex untouched. |
| Supply chain | local/manual pass | SHA-256 4/4; `latest.yml` SHA-512/size match; EXE `NotSigned`, public update remains NO-SHIP. |
| Independent verdict | SHIP | Exact local/manual 3.0.10; no product blocker, overflow or leftover packaged/test process. |

## Contract impact

- Architecture: updated — current-session source modes, guarded import and linked-only boundary.
- App map: updated — Codex/Antigravity primary onboarding and process feedback.
- Roadmap/spec/tickets: updated — T22 complete and unsupported secret extraction excluded.
- Durable context: exact 3.0.10 release evidence replaces 3.0.9 as the current local/manual baseline.

## Durable context

- Candidates: none.
- Promoted: CTX-003, CTX-006.
- Superseded: previous CTX-003 statement for 3.0.9.

## Risks and next action

- Authenticode/RFC3161 is still required before trusted public distribution.
- Native Windows toast appearance and real account lifecycle remain clean-VM/test-account manual acceptance boundaries.
- No test closed, restarted or switched the user's installed Codex session.

## Files

- `src/main/accountManager.ts`, `src/main/paths.ts`, `src/main/services/codexCredentialStoreService.ts`, `src/main/services/desktopNotificationService.ts`
- `src/main/main.ts`, `src/main/preload.ts`, `src/shared/types.ts`
- `src/renderer/App.tsx`, `src/renderer/v310.css`, `src/renderer/components/v3/OverviewPage.tsx`
- `tests/main/accountManagerCodexAuth.test.ts`, `tests/main/desktopNotificationService.test.ts`, `tests/ui/v310-runtime-banner.test.ts`, `tests/smoke/v310-overview-onboarding.spec.ts`
- `docs/research/codex-current-session-import-2026-08-02.md`
- `artifacts/3.0.10/verification/VERIFICATION.md`, `STATUS.md`, `docs/CONTEXT.md`
