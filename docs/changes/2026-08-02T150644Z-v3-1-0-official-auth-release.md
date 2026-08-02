# 3.1.0 official auth, durable storage and GitHub release

- Date: 2026-08-02T15:06:44Z
- Type: release
- Status: complete
- Related: `docs/product-3.0-tickets-2026-07-29.md` T23

## What changed

- Public current-Codex and arbitrary `auth.json` import paths were removed from renderer, preload, shared contracts and main IPC; the add-account wizard now contains only four official Codex login methods.
- Stable auth reads and the encrypted profile vault preserve last-known-good credentials when the desktop cache is temporarily missing or being rewritten.
- SQLite migration 10 repairs duplicate active rows, adds a partial unique active index and hot identity/quota/switch indexes, and enables FULL WAL durability plus bounded optimize.
- Startup update discovery now uses the fixed GitHub latest-release API, strict stable semver, bounded response/timeout and an allowlisted manual release URL; `electron-updater` was removed.
- Windows update notification and compact in-app update states were added without exposing raw network errors or downloading an unsigned executable.
- Build hygiene now removes only the verified `dist` directory before compilation. Package verification rejects orphan content-hash entry bundles, preventing historical UI/auth code from being shipped as unreachable ASAR data.

## Why

The user rejected local-session/file import, requested stable official authorization, durable switching/storage, automatic GitHub release discovery and a final publishable 3.1 release without interrupting the currently installed Codex session.

## Verification

| Check | Result |
| --- | --- |
| Source hygiene | `git diff --check`, typecheck and lint pass |
| Unit/integration | 69 files / 323 tests; synthetic soak 1000 transitions pass |
| Rendered UI | 11 pass / 4 intentional production-inspector skips; official-only onboarding and no default Overview scroll |
| Exact package | 76/76 parity, 0 mismatch, 0 extra, exactly two referenced renderer entries, 0 orphan bundles |
| Packaged startup | independent 4/4 pass with isolated `userData`, renderer ready and cleanup clean |
| Supply chain | dependency audit clean; SHA-256 4/4 and `latest.yml` SHA-512/size match |
| Independent verdict | `SHIP` for exact manual GitHub Release 3.1.0 |

## Contract impact

- Architecture: official-only onboarding, stable-read/vault fallback, DB v10 and fixed GitHub discovery are active.
- Product specification: the 3.0.10 import experiment is explicitly superseded.
- Release trust: manual download with checksums is allowed; silent/high-trust install remains excluded until Authenticode.
- Installed Codex/Manager and real user sessions were never launched, closed or switched by verification.

## Durable context

- Promoted: CTX-003 exact 3.1.0 gate, CTX-006 official-only onboarding, CTX-007 GitHub discovery/manual install boundary.
- Superseded: CTX-003 3.0.10 baseline and CTX-006 file-backed current-session import contract.

## Risks and next action

- Setup, portable and inner EXE remain `NotSigned`; SmartScreen warning and explicit SHA-256 verification are expected.
- Provider-side expiry/revocation/MFA can still require official reauthorization.
- Publish the verified commit/tag and GitHub assets, wait for CI, then perform clean-VM/manual-account acceptance without using production credentials in automation.

## Files

- `src/main/accountManager.ts`, `src/main/db.ts`, `src/main/main.ts`, `src/main/preload.ts`
- `src/main/services/codexProfileVaultService.ts`, `src/main/services/updaterService.ts`
- `src/renderer/App.tsx`, `src/shared/types.ts`, `src/shared/releaseNotes.ts`
- `vite.config.ts`, `scripts/clean-build-output.mjs`, `scripts/verify-package.mjs`, `package.json`, `pnpm-lock.yaml`
- `RELEASE_NOTES_3.1.0.md`, `docs/releases/3.1.0.md`
