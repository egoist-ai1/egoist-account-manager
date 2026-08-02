# 3.0.7 interface precision and deterministic packaging

- Date: `2026-08-01T20:58:31Z`
- Release: `3.0.7`, local/manual Windows distribution
- Reason: screenshots exposed a collapsed repair action, over-aggressive account-name truncation and uneven Activity semantics after the 3.0.6 visual redesign.

## Changed

- Added a final `v307.css` layer that gives identity/email real shrink contracts, increases compact text clarity and prevents long Overview/Activity content from crossing sibling bounds.
- Fixed the cascade root cause of «Починить»: the labeled action now fills its 84 px desktop grid track; at the minimum breakpoint repair cards use a two-row action surface with 36 px icon targets and a full-width switch.
- Replaced string-concatenated account routes with bounded bidi-safe nodes and full-value title hints.
- Added a terminal verification summary so Activity no longer repeats the same «Подтверждено» message in two adjacent roles.
- Added layout and presentation regressions, bumped release metadata to 3.0.7 and documented the exact local/manual release.
- Made `pnpm run build` deterministic on this Windows host by selecting the installed unpacked Electron distribution instead of a staging rename that was blocked with `EPERM`.

## Verification

- `pnpm run test:node`: 64 files / 296 tests passed, including the 1000-switch soak.
- `pnpm run smoke`: 6 passed, 4 production-instrumentation cases skipped by the hardened inspect policy.
- `pnpm run build`: passed through the saved configuration after the staging issue was reproduced and diagnosed.
- Exact startup: version 3.0.7.0, isolated user data, renderer ready, four-process tree cleaned.
- ASAR parity: 110/110; fuses hardened; dependency audit clean; 4/4 SHA-256 and `latest.yml` SHA-512/size matched.
- Independent read-only release verifier: **SHIP** for local/manual distribution.
- Full evidence: [`artifacts/3.0.7/verification/VERIFICATION.md`](../../artifacts/3.0.7/verification/VERIFICATION.md).

## Contracts and risks

- No auth, vault, quota or switch protocol was changed in this task.
- Installed Codex and real account data were not touched; rendered/browser and Electron checks used demo or isolated data.
- EXE remain unsigned; public/high-trust delivery still requires Authenticode + RFC3161.
- Real-account repeated switching and clean Windows install/upgrade/uninstall remain manual acceptance.

## Next safe action

Run manual acceptance on explicitly designated test accounts and a clean Windows 11 VM, then decide the signing/public updater gate separately.
