# Egoist 3.2.0 RC — implementation contract
Date: 2026-10-06. Base: d315ba12c9deb41ad380665a1c618563324bcaa1.
User explicitly authorized implementation of the complete plan in this chat.

## Binding decisions
- Visible product Egoist, no AI; keep appId, account IDs, existing storage location and portable formats v1-v3.
- Local product; no monetization, mandatory registration, telemetry or new cloud infrastructure.
- Primary Profiles dense table; secondary Overview, Journal, Settings; cards remain available.
- Profile application, credential checks, launch and runtime identity are distinct evidence levels.
- If writes and launch are verified but runtime identity is unavailable, retain applied profile and sealed backup, show unconfirmed runtime; automatic switching disabled.
- Actual mismatch/write/launch failure -> verified rollback; rollback failure -> recovery_required/provider mutation gate.
- Independent Codex app-server is not Desktop runtime proof. Antigravity GetUserStatus is proof of runtime email only when OS ownership is verified; no fabricated workspace/subject proof.
- Import: whole package preflight, new UUIDs, default skip conflicts, one DB transaction, no temporary plaintext credentials.
- Preserve foreign install files; no recursive uninstall of user-chosen directory.
- Unknown quota != zero usage/free availability. Preserve all scopes, floating precision, last good data and explicit error/freshness.
- No live user credentials/profile copying/IDE stopping during tests. No competitor EXE execution on primary host. Sandbox/Hyper-V disabled; comparative native measurements remain pending until isolated guest exists.
- No signing certificate configured; build unsigned local RC with accurate metadata; do not publish releases.

## File ownership
Root: src/main/accountManager.ts, src/main/main.ts, src/main/preload.ts, src/shared/types.ts, src/shared/schemas.ts, src/shared/ipc.ts, src/shared/releaseNotes.ts, new account import helper and integration tests.
safety_impl: src/main/db.ts, paths.ts, services/durableAuthBundleService.ts, codexProfileVaultService.ts, antigravityProfileBackup.ts, antigravityProfileReader.ts, antigravityProcessService.ts, switchTransactionService.ts + tests covering those files.
quota_impl: shared quota/readiness/auth/capability helpers except types.ts; services quota parser/AG quota/Google auth/capability service + targeted tests. No accountManager/db/renderer writes.
performance_impl: package.json, pnpm-lock.yaml, .github/workflows/checks.yml; tooling/build/benchmark/startup scripts except installer scripts; new probeIsolationService/refreshSchedulerService and async CredentialManager adapter + tests. No main.ts/accountManager/db/renderer writes.
ui_impl: src/renderer/**/*, assets brand/icon SVG and icon assets + UI tests. No shared types/main/package writes.
installer_impl: src/installer/**/*; installer ownership/packaging helpers and tests; no package/renderer/main writes.
Research: performance_impl owns research/competitor/benchmark docs; root owns aggregate report, project maps, final evidence and review board. A sixth implementation slot was unavailable; the research stream was completed by performance_impl after its core work.
Only owner writes each file; request integration through root. Shared contracts first. No worker commits/rebuild shared native module/reinstalls dependencies; root serializes builds and verification.

## Verification
Targeted meaningful fail-to-pass tests per change; root final typecheck/lint/Node suite/delivery tests/renderer smoke/Electron smoke/build/package/startup verification.
Artifacts and final evidence in canonical project. Temporary work only each agent's own task work.
Native shipping comparative benchmark: identical disposable Windows guest, all process tree, fixed refresh/fixture modes, 30 starts, 100 interactions, 2h soak, 10m tray; unsupported fixtures N/A.
Initial targets, not claims: startup existing profile p95<=3s; fresh<=4s; search/select<=100ms; details<=200ms; tray reopen<=150ms; visible/tray private<=320/220MiB; idle no-poll CPU<=0.5% one core; after1000 operations growth<=20MiB.
