# Version 3.0.4 account repair and control plane

- Date: `2026-08-01T18:35:33Z`
- Type: `release`
- Status: `complete`
- Related: `docs/product-3.0-spec-2026-07-29.md`, T16

## What changed

- Changed the default quota cadence to three minutes while removing forced credential rotation from normal refreshes.
- Classified the real app-server not-authenticated response as `needs_reauth`; added an in-place repair flow that validates, retries quota and falls back to device-code without duplicating the profile.
- Prevented failed validation/finally paths from sealing unverified auth; passive session sync now waits for the provider lock and requires strong identity rather than email alone.
- Preserved `recovery_required` after incomplete rollback and allowed normal ChatGPT fingerprint rotation only after official identity proof.
- Rebuilt Overview as a live control plane and Activity as one compact filtered operation journal; added truthful load/degraded states, stale-response protection and visible repair affordances.
- Hardened packaged renderer selection against `ELECTRON_IS_DEV`/localhost and CWD package-config injection; removed `electron-is-dev`, disabled Node CLI inspect, enabled resource metadata and added reproducible ASAR/startup gates.
- Bumped product metadata to 3.0.4 and generated installer, portable, blockmap, update metadata and SHA-256 manifest.

## Why

Saved profiles could look healthy while the provider app-server returned `Codex profile is not authenticated`. The three-minute refresh path also forced credential reads and could rotate auth far too often. Users needed a truthful distinction between a preserved local vault and a provider session, plus a direct way to repair the existing profile.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Source gate | pass | Typecheck/ESLint; 62 files / 290 tests; 1000 synthetic switch state machines. |
| Rendered UI | pass | Overview, Accounts, Activity and Settings at 1200×700 and 997×679; no horizontal overflow or clipping. |
| UI smoke | pass | 5/5 instrumentable source-shell scenarios; production-Playwright cases skipped by explicit hard-fuse policy. |
| Exact startup | pass | `verify:startup`: isolated 3.0.4.0 main + renderer ready; exact process tree cleaned. |
| Artifact integrity | pass | 96/96 ASAR parity; 4/4 SHA-256 match; package version 3.0.4; final fuses verified. |
| Dependency audit | pass | `pnpm audit --prod --audit-level high`: no known vulnerabilities. |

## Contract impact

- Architecture: updated — non-rotating quota probe, verified vault writes and production renderer trust boundary.
- App map: updated — explicit validate/refresh/reauth repair flow and new Overview/Activity responsibilities.
- Roadmap: updated — 3.0.4 is current; manual account/VM acceptance and signed public delivery are next.
- Release docs: updated — canonical 3.0.4 notes and exact artifact evidence added.

## Risks and next action

- Provider revoke, MFA and organization policy still require official reauthentication; Manager preserves the profile but cannot bypass the provider.
- Executables remain unsigned and public updater remains disabled until Authenticode/RFC3161.
- `GrantFileProtocolExtraPrivileges` is required by the current file/ASAR renderer. A future custom privileged application protocol could remove that compatibility dependency.
- Next: install on a clean Windows 11 VM and run repeated switching only on explicitly allocated test accounts.

## Files

- `src/main/accountManager.ts`, `src/main/main.ts`, `src/main/services/settingsService.ts`
- `src/shared/authState.ts`, `src/shared/quotaRefreshError.ts`, `src/shared/ipcSchemas.ts`, `src/shared/types.ts`
- `src/renderer/App.tsx`, `src/renderer/components/v3/OverviewPage.tsx`, `src/renderer/components/v3/ActivityPage.tsx`, `src/renderer/v3.css`
- `scripts/afterPack.mjs`, `scripts/verify-package.mjs`, `scripts/verify-packaged-startup.ps1`
- `tests/main/accountManagerCodexAuth.test.ts`, `tests/main/settingsService.test.ts`, `tests/shared/`, `tests/smoke/app.spec.ts`
- `package.json`, `pnpm-lock.yaml`, `CHANGELOG.md`, `README.md`, `RELEASE_NOTES_3.0.4.md`
- `docs/ARCHITECTURE.md`, `docs/APP_MAP.md`, `docs/ROADMAP.md`, `docs/product-3.0-progress.md`
- `artifacts/3.0.4/verification/VERIFICATION.md`, `release/SHA256SUMS-3.0.4.txt`
