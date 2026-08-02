# 3.1.1 native live tray and isolated release lifecycle

- Date: 2026-08-02T17:30:29Z
- Type: release-candidate
- Status: complete
- Related: `docs/releases/3.1.1.md`, `CTX-008`

## Why

The Windows surface needed a compact live quota indicator without noisy system toasts, while the release path needed observable install, running-upgrade, uninstall, reinstall and portable evidence that never touched the active Codex session.

## What changed

- Replaced Windows toast delivery with a bounded, redacted in-app notification queue and optional result sound.
- Added a native 32×32 live tray renderer, truthful quota states, privacy-aware tooltip, compact popup and independent 1/3/5/10/15-minute active-account cadence.
- Prevented overlapping active/fleet quota probes from refreshing the same account twice while preserving the three-minute fleet cycle.
- Kept official Codex authorization, encrypted vault, SQLite and verified switch/rollback contracts unchanged.
- Added an isolated Windows Sandbox lifecycle harness with disabled network and clipboard, fixture-only user data and retained JSON evidence.
- Corrected update copy so it reports a stable listing in the fixed official repository without claiming signature or artifact verification.

## Verification

| Check | Result |
| --- | --- |
| TypeScript / ESLint | pass |
| Vitest | 70 files / 329 tests; synthetic 1000-switch soak included |
| Playwright smoke | 13 passed / 4 intentional production-inspector skips |
| Exact package | 77/77 ASAR files; two referenced renderer entries; zero orphan bundles |
| Native tray | 9/9 representative states decode as non-empty 32×32 images |
| Packaged startup | pass with isolated userData and exact cleanup |
| Windows Sandbox | 16/16, including captured previous-PID teardown before test cleanup |
| Artifact integrity | four current release files match `SHA256SUMS-3.1.1.txt` and `docs/releases/3.1.1.md` |
| Independent outcome review | `pass`; no blocking or new non-blocking findings |

## Contracts and context

- Promoted `CTX-008`: exact local 3.1.1 now has in-app-only notifications, native live tray and 16/16 isolated lifecycle evidence.
- No current or inactive real account data was copied to Sandbox; DPAPI-bound material is intentionally not portable across Windows identities.
- No GitHub publication, host installation or Codex process manipulation occurred in this task.

## Risks and next action

- EXE files remain unsigned; SmartScreen warning and manual SHA-256 verification remain required.
- Windows controls tray pinning and may place the live icon in overflow.
- A separate authorized user-driven trial can validate a non-active real account; publication and Authenticode remain separate approval gates.

## Files

- `src/shared/liveTray.ts`
- `src/main/main.ts`
- `src/main/services/inAppNotificationService.ts`
- `src/renderer/components/TrayPopover.tsx`
- `src/renderer/pages/SettingsPage.tsx`
- `scripts/windows-sandbox-release-test.ps1`
- `scripts/run-windows-sandbox-release-test.ps1`
- `docs/releases/3.1.1.md`
- `STATUS.md`
