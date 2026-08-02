# 3.0.9 continuation plan, quota clarity and verified notifications

- Date: 2026-08-02T12:58:58Z
- Type: release
- Status: complete
- Related: `docs/product-3.0-tickets-2026-07-29.md` T21

## What changed

- Overview теперь использует читаемые quota widgets и полезный «План продолжения» с active/next route, порогом, очередью кандидатов и честными stale/reauth состояниями.
- Ranking резервов исключает неготовую авторизацию и current quota failures; неизвестные данные отображаются как `—`, а не как доступный нулевой остаток.
- In-app process notice и branded Windows toast отражают фактические стадии auth/switch/restart/verification, deduplicate quota alerts, redaction, sound policy и native fallback.
- Проведено source-linked исследование рынка и официальных ограничений; assisted continuation отделена от небезопасного mid-turn replay и запрещённой ротации для обхода лимитов.
- Версия 3.0.9 собрана как installer/portable, документирована и прошла основной и независимый exact release gate.
- Инициализирован `docs/CONTEXT.md`, а project `AGENTS.md` получил минимальный task-specific context loadout.

## Why

Пользователь запросил устранить пустое/неинформативное место Overview, улучшить читаемость лимитов, дать понятную визуализацию будущего переключения и обеспечить правдивые брендированные уведомления без вмешательства автоматизированных тестов в активный Codex.

## How

UI использует один shared ranking contract для готовности кандидатов, responsive CSS для quota/continuation regions и renderer state для трёхступенчатого process feedback. Main process строит typed redacted notifications из реальных switch/auth events и вызывает native fallback при отказе Windows XML. Исследовательский вывод закреплён в roadmap как safety boundary, а не реализован как скрытая ротация.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck, lint, dependency audit | pass | Независимо повторены; `pnpm audit --audit-level=low` — 0 известных уязвимостей. |
| Node/unit/integration | pass | 68 файлов / 317 тестов, включая synthetic soak 1000 switch transitions. |
| Rendered UI | pass | `tests/smoke/v309-overview.spec.ts` 2/2 на 1460×900 и 1080×780; полный smoke 9 passed / 4 intentional skips. |
| Exact package | pass | 120/120 ASAR parity; source/package 3.0.9; Electron fuses соответствуют hardened policy. |
| Isolated packaged startup | pass | 4/4: `3.0.9.0`, renderer ready, isolated user data, cleanup passed; installed Codex не затронут. |
| Supply chain | local/manual pass | SHA-256 4/4, `latest.yml` SHA-512/size match; EXE `NotSigned`, поэтому public update остаётся NO-SHIP. |
| Independent verdict | SHIP | Exact local/manual 3.0.9; clean-VM/manual account acceptance остаётся внешней границей. |

## Contract impact

- Architecture: updated — добавлены truthful notification milestone/fallback и assisted-continuation boundary.
- App map: updated — добавлены новая Overview lane, quota states и Windows shell feedback.
- Roadmap: updated — 3.0.9 baseline и отдельно gated future assisted continuation.
- Specs/tickets: updated — T21 фиксирует завершённую реализацию и release gate.

## Durable context

- Candidates: CTX-005.
- Promoted: CTX-001, CTX-002, CTX-003, CTX-004.
- Superseded: none.

## Risks and next action

- Installer/portable/inner EXE не подписаны; Authenticode + RFC3161 обязательны до публичного trusted update.
- Реальные provider accounts, Windows notification center и clean install/upgrade/uninstall не автоматизировались, чтобы не закрыть текущую пользовательскую сессию; проверить только на выделенной VM/test accounts.
- После Node tests перед Electron smoke/package нужен штатный `pnpm run rebuild:native:electron`.
- Следующий безопасный продуктовый шаг — отдельный RFC для opt-in «Переключить после текущего шага», без mid-turn replay и автоматической subscription rotation.

## Files

- `src/shared/smartSelection.ts`
- `src/main/services/desktopNotificationService.ts`, `src/main/main.ts`
- `src/renderer/App.tsx`, `src/renderer/v309.css`, `src/renderer/components/v3/OverviewPage.tsx`
- `tests/shared/smartSelection.test.ts`, `tests/main/desktopNotificationService.test.ts`, `tests/ui/v309-experience.test.ts`, `tests/smoke/v309-overview.spec.ts`
- `package.json`, `CHANGELOG.md`, `README.md`, `RELEASE_NOTES_3.0.9.md`
- `docs/APP_MAP.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/releases/3.0.9.md`, `docs/research/seamless-switching-market-2026-08-02.md`
- `artifacts/3.0.9/verification/VERIFICATION.md`, `STATUS.md`, `docs/CONTEXT.md`, `AGENTS.md`
