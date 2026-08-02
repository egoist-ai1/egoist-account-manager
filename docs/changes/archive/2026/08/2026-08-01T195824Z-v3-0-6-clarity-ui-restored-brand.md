# 3.0.6 clarity UI and restored brand

- Date (UTC): `2026-08-01T19:58:24Z`
- Scope: `projects/codex-account-manager-gh`
- Release: `3.0.6`, local/manual Windows distribution

## Why

The daily surfaces were functionally complete but still too small, visually noisy and inconsistent at first glance. The simplified 3.0.5 mark also no longer matched the original hood identity requested by the owner.

## What changed

- Added a final `v306.css` visual layer with larger high-contrast typography, coherent black/violet surfaces, keyboard focus, reduced-motion behavior and responsive no-overlap layouts.
- Reworked Overview, Accounts and Activity information hierarchy; corrected activity terminology and Russian plural forms.
- Increased the default window to `1460×900` with measured nine-card capacity while preserving a `920×620` adaptive path.
- Used the original 3.0.4 icon as the ImageGen edit reference, removed chroma to a clean alpha master and made `generate-icons.mjs` derive all PNG/ICO targets from it.
- Bumped product/release metadata to 3.0.6 and produced installer, portable, update metadata, blockmap and SHA-256 manifest.

## Contracts affected

- User-visible window default: `1460×900`; minimum remains `920×620`.
- Accounts first viewport: at least 9 complete cards at the default window, with inner scrolling for additional profiles.
- Brand asset source: `assets/icon-3.0.6.png` instead of the temporary SVG-derived mark.
- Public update remains fail-closed until Authenticode is available; auth/vault/switch contracts are unchanged.

## Verification

- 2026-08-01: TypeScript and ESLint pass.
- 2026-08-01: 62/62 test files and 290/290 tests pass, including the 1000-switch soak.
- 2026-08-01: 6/6 instrumentable Electron smoke scenarios pass; UI gate measures 9-card capacity, no overlap and reduced motion.
- 2026-08-01: exact isolated packaged startup passes at 3.0.6.0; no installed Codex process is touched.
- 2026-08-01: 106/106 ASAR parity; 4/4 SHA-256; fresh-build/release byte parity; fuses and audit pass.
- 2026-08-01: independent read-only verifier returns **SHIP** for local/manual distribution.
- Full evidence: [`artifacts/3.0.6/verification/VERIFICATION.md`](../../artifacts/3.0.6/verification/VERIFICATION.md).

## Risks and next safe action

The EXE files remain unsigned and real repeated account switching was deliberately not automated because it would close the owner's active Codex session. Next, use explicitly dedicated test accounts on a clean Windows 11 VM for install/switch/repair/uninstall acceptance, then complete the separate Authenticode/RFC3161 gate before any public updater is enabled.
