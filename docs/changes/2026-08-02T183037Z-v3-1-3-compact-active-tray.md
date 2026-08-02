# 3.1.3 compact active-window tray

- Date: 2026-08-02T18:30:37Z
- Type: release-candidate
- Status: complete with native-runtime follow-up
- Related: `docs/releases/3.1.3.md`, `CTX-010`

## Why

The first passive tray surface was too large and visually heavy. It also rendered separate 5h/week cards from compatibility fallbacks, allowing one generic weekly quota to appear twice. The user requested a smaller surface and one truthful active quota.

## What changed

- Reduced the passive BrowserWindow and renderer from 340×196 to 252×144 px, approximately 30% per axis and 46% by area.
- Replaced the two nested dark cards with one current-limit block containing exact remaining percent, progress and reset date/time.
- Kept active Codex identity, freshness, plan and state visible in a denser hierarchy without actions, focus or pointer capture.
- Built quota selection from classified, deduplicated provider windows. Missing 5h data is no longer populated from a generic primary quota; a weekly-only fixture remains weekly-only.
- Preserved the separate click popup and every auth/switch/storage/notification contract.
- Tightened tray digit spacing and introduced state-specific inner surfaces while retaining 16/20/24/32 px DPI representations.
- Advanced exact local artifacts to 3.1.3; no publication, host installation, account switch or active Codex manipulation occurred.

## Verification

| Check | Result |
| --- | --- |
| TypeScript / ESLint | pass |
| Vitest | 71 files / 338 tests; synthetic 1000-switch soak included |
| Provider semantics | weekly-only generic window → `weekly=25`, `fiveHour=null`, selected weekly; active Codex preferred across active platforms |
| Playwright smoke | 15 passed / 4 intentional production-inspector skips |
| Hover render | 252×144, one quota block, reset-time, no gutters/actions/overflow; reduced-motion pass |
| Exact package | 78/78 ASAR files; two referenced renderer entries; zero orphan bundles; source/packed 3.1.3 |
| Native tray | 11 values/states × 4 representations; 44 PNGs at 16/20/24/32 px; `25-16px.png` visually read as 25 |
| Placement | 5/5 pure checks: bottom/top/left/right taskbar and negative-coordinate display |
| Packaged startup | pass with isolated userData and exact cleanup |
| Artifact integrity | four current release files match `SHA256SUMS-3.1.3.txt` and `docs/releases/3.1.3.md`; EXE ProductVersion/FileVersion 3.1.3 |
| Independent outcome review | `pass`; no blocking findings |

## Contracts and context

- Promoted `CTX-010`: the tray now owns one truthful provider-window selection and a compact 252×144 passive surface.
- `CTX-009` remains historical 3.1.2 evidence; its immutable change note was not rewritten.
- No secrets, account payloads or private paths are present in rendered evidence or release notes.

## Risks and next action

- The native Windows mouse-enter/showInactive/mouse-leave lifecycle and real taskbar at 100/125/150/200% DPI remain a manual oracle; deterministic bitmap and renderer coverage passed.
- Sandbox 3.1.3 was not started while four active Sandbox processes were owned by `egoist-shield-1.0`; they were not interrupted. Rerun staged 3.1.2→3.1.3 after the host Sandbox is free.
- EXE files remain unsigned; SmartScreen warning and manual SHA-256 verification remain required.
- Windows controls tray pinning and may place the icon in overflow.

## Files

- `src/shared/liveTray.ts`
- `src/main/main.ts`
- `src/renderer/components/TrayHoverPopover.tsx`
- `src/renderer/tray-hover.css`
- `tests/shared/liveTray.test.ts`
- `tests/shared/traySurfacePosition.test.ts`
- `tests/smoke/tray-popover.spec.ts`
- `scripts/verify-live-tray-native.cjs`
- `docs/releases/3.1.3.md`
- `STATUS.md`
