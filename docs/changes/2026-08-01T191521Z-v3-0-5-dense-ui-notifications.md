# 3.0.5 dense UI, notifications and icon release

Date (UTC): 2026-08-01T19:15:21Z
Version: 3.0.5

## What and why

The supplied screenshots exposed three release defects: collapsed Settings containers painted their children over later sections, Activity text competed with route decoration, and six oversized Account cards hid profiles and recovery actions. Windows toast also reused the raster brand image as a large noisy hero asset. The release needed a dense but readable nine-card work surface, actionable notifications and one clean Windows identity.

## Implementation

- Replaced Settings' compressed grid disclosures with natural document flow and bounded workspace scrolling.
- Raised Activity typography and isolated route/journal geometry from text.
- Removed six-card pagination, set the default window to `1360×800`, and rendered all profiles in a 3-column internally scrollable grid with nine fully visible cards at the default size.
- Kept plan, credential state, quota, freshness and all refresh/reauth/repair/details/switch actions on each card.
- Added success/failure switch notifications and confirmed low-quota alerts; Windows uses the AppUserModelId header icon and omits the duplicate content image.
- Added `assets/icon.svg` and `scripts/generate-icons.mjs` to derive all PNG/ICO assets reproducibly.
- Bumped source/package/release metadata to 3.0.5 and rebuilt installer, portable, blockmap, manifest and unpacked app.

## Verification

- 2026-08-01: typecheck and ESLint passed.
- 2026-08-01: 62 files / 290 Node tests passed, including quota alert behavior and 1000-switch soak.
- 2026-08-01: 6 instrumentable Playwright scenarios passed; four production-inspect cases skipped by the intended fuse policy.
- 2026-08-01: Browser measurements at `1360×800` confirmed 3 columns × 3 fully visible rows and no horizontal overflow; compact Settings/Activity had no measured overlap.
- 2026-08-01: isolated packaged startup passed, version 3.0.5.0, renderer ready; only the exact temporary probe process tree was cleaned.
- 2026-08-01: ASAR parity 101/101, fuses verified through package API, production audit clean, `git diff --check` clean apart from line-ending notices, 4/4 SHA-256 matched.

## Contracts and risks

- User-facing default window dimensions and Accounts information architecture changed; profile/auth/quota data contracts did not.
- Toast wording and icon presentation changed; switching, rollback, vault and updater security contracts remain unchanged.
- EXE files are unsigned and public updater remains fail-closed until Authenticode/RFC3161.
- Real accounts, provider MFA/revocation and clean-machine install/update/uninstall remain explicit manual acceptance boundaries.

## Next safe action

Run the installer on a clean Windows 11 VM and complete repeated switch/repair trials only with explicitly designated test accounts; do not interrupt a live Codex task.
