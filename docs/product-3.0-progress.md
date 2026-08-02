# Codex Account Manager 3.0 — progress

Updated: 2026-08-02 00:53 MSK
Specification: `docs/product-3.0-spec-2026-07-29.md`
Tickets: `docs/product-3.0-tickets-2026-07-29.md`

## Approvals

| Gate | Status | Evidence |
| --- | --- | --- |
| Specification | approved | User: «Да, продолжай. Делай версию готовую уже отдебаженную 3.0.» |
| Tickets | approved | User instructed to execute the whole plan through final release |
| Implementation | completed | T00–T14 plus hardening T15–T23 completed |
| Release | exact package verified; publication pending | Independent `SHIP` for manual GitHub Release; Authenticode/silent install remains a separate gate |

## Ticket state

| Ticket | Status | Evidence |
| --- | --- | --- |
| T00 Reproducible baseline | completed | pnpm 11 policy and reproducible native dependency workflow |
| T01 Official capability + identity | completed | Versioned schema cache, bounded RPC/command probes, verified current identity, runtime panel |
| T02 First-class auth modes | completed | Browser/device/API key/enterprise token contracts; CLI token via stdin; identity metadata |
| T03 Vault lifecycle + drift | completed | DPAPI fail-closed vault, transient hydration, plaintext eviction, token rotation and drift quarantine |
| T04 Durable transaction journal | completed | DB v8, atomic active+terminal commit, optimistic transitions, single-active constraint and validated migration backup |
| T05 Exact Windows lifecycle | completed | Exact AppX/AppUserModelId resolution, PID+CreationDate tree capture, graceful close and optional exact-tree fallback |
| T06 Durable auth activation | completed | Multi-file staged activation, bounded lock retry, stable-byte checks and DPAPI-sealed rollback manifest |
| T07 Verified relaunch + rollback | completed | Same-package relaunch, visible-window readiness, app-server identity/workspace proof and verified previous-profile rollback |
| T08 Recovery + concurrency | completed | Pre-rollback target quiesce, phase-aware recovery, provider locks, shared `CODEX_HOME` lock and idempotent cleanup |
| T09 UI shell + design system | completed | Second-pass Overview hierarchy, quota cards, honest readiness/recommendation states, fixed brand/version containment and full-height app frame; responsive Browser QA |
| T10 Accounts + auth onboarding | completed | Responsive profile management and four-mode Codex onboarding |
| T11 Switch UX + activity + settings | completed | Real transaction phase stepper, recovery state, lifecycle policy and responsive Settings |
| T12 Tray + alerts + diagnostics | completed | Settings-driven tray/close/autostart, transactional quick switch, quota cooldown and redacted diagnostics |
| T13 Fault/soak/performance gate | completed | 62 files/280 tests; isolated native lifecycle E2E; 1000 switches/9000 events, p95 2.349 ms, +0 active resources |
| T14 Package + release verification | completed | 3.0.2 installer/portable/checksums; 9/9 smoke; independent isolated smoke; 85/85 ASAR parity; independent verifier: SHIP |
| T15 Session, quota and UI hardening | completed | 3.0.3: 30-second DPAPI session snapshot; preserved last-good quota + backoff; bounded explicit updater; compact UI; 62 files/286 tests; 9/9 package smoke; 94/94 ASAR parity |
| T16 Account repair + live control plane | completed | 3.0.4: 3-minute non-rotating refresh; exact auth-error classification; in-place repair; Overview/Activity redesign; production trust-boundary hardening; 62 files/290 tests; 96/96 ASAR parity |
| T17 Dense UI + Windows identity | completed | 3.0.5: natural Settings flow; readable Activity; `1360×800` 3×3 Accounts; actionable switch/quota alerts; SVG-derived icon pipeline; 62 files/290 tests; 101/101 ASAR parity |
| T18 Clarity UI + restored brand master | completed | 3.0.6: clarity-first Overview/Accounts/Activity; `1460×900` measured 3×3 capacity; `920×620` adaptive flow; regenerated original hood mark; reduced-motion; 62 files/290 tests; 106/106 ASAR parity; independent SHIP |
| T19 Interface precision + deterministic packaging | completed | 3.0.7: contained repair action; long identity/route guards; clearer Activity summary; minimum-window two-row repair actions; saved local Electron distribution; 64 files/296 tests; 110/110 ASAR parity |
| T20 Device handoff + state/UI closure | completed | 3.0.8: typed clipboard handoff; reauth stale-error cleanup; keyboard-complete six-action inspector; `1460×900` measured 9/9 cards; explained Activity stages; 66 files/308 tests; 117/117 ASAR parity |
| T21 Continuation plan + notification policy | completed | 3.0.9: truthful fresh-candidate ranking; redesigned quota windows; in-app three-stage process notice; branded/deduplicated Windows auth/switch/quota notifications with XML fallback; `1460×900` + `1080×780` rendered QA; 68 files/317 tests; 120/120 ASAR parity |
| T22 Current-session onboarding + viewport fit | completed | 3.0.10: file-backed current Codex + guarded `auth.json` import; linked-only keyring/auto/ephemeral; Antigravity primary methods; labeled in-app/Windows feedback; compact runtime errors; default Overview no-scroll/fill geometry; 69 files/323 tests; 124/124 ASAR parity |
| T23 Official auth + durable storage + release discovery | completed | 3.1.0 removes current/auth.json import from UI/preload/IPC, preserves last-known-good auth through desktop sign-out, adds DB v10 invariants/indexes/optimize, and checks an allowlisted stable GitHub Release on startup without silent EXE execution |

## Current handoff

The 3.1.0 implementation keeps the verified switch transaction from 3.0.x: exact desktop quiesce, durable auth activation, same-package relaunch, official identity proof, atomic commit and verified rollback. Manager never closes the installed Codex during automated release verification.

Version 3.1.0 supersedes the 3.0.10 import experiment: only the four official Codex login methods are public. Stable auth reads and a manager-owned vault fallback keep saved credentials available through a temporary desktop sign-out without claiming that provider revocation can be bypassed. DB migration 10 repairs duplicate active markers, enforces one active profile per platform, indexes hot history/identity queries and enables FULL WAL durability plus bounded optimize. Startup release discovery uses the fixed public GitHub endpoint, strict stable semver, a 20-second timeout and an allowlisted release URL; download/install remains a deliberate browser action until code signing exists.

The exact clean package contains 76/76 matching `dist`/ASAR files, exactly one referenced renderer JS and CSS entry, and no orphan historical bundles. Independent evidence is recorded in `docs/releases/3.1.0.md`.
