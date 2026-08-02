# 3.0.8 device handoff and profile control closure

- Date: `2026-08-01T22:13:23Z`
- Release: `3.0.8`, local/manual Windows distribution
- Reason: user feedback exposed stale repair state after successful reauthentication, clipped compact typography, an overcomplicated hidden-action inspector and unsafe expectations around browser device-code insertion.

## Changed

- Added a typed main/preload/renderer device-code handoff that validates and copies the code before opening only the official allowlisted URL, offers explicit recopy/reopen actions and conditionally clears the unchanged clipboard at TTL or shutdown.
- Fixed quota repair truthfulness at both boundaries: successful reauthentication explicitly clears historical refresh errors after provider identity proof even without an immediate quota snapshot, while renderer consumers compare error and success timestamps.
- Reworked Accounts into a measured 3×3 desktop grid with clearer plan, credential, freshness and quota hierarchy; repair is a compact accessible key action.
- Replaced hidden inspector disclosure with six always-visible actions in a two-row control grid and added `Escape`, focus trapping, backdrop close and focus return.
- Filled Overview with reserve/readiness signals and replaced the ambiguous Activity line with four semantic switch-stage cards; all measured Activity text is at least 10 px.
- Hardened the exact packaged startup probe with separate runtime/cleanup evidence and bounded retry for transient protocol-cache locks.
- Bumped release metadata, rebuilt installer/portable artifacts and refreshed exact checksums and local/manual release evidence.

## Verification

- `pnpm run test:node`: 66 files / 308 tests passed, including the 1000-switch soak.
- `pnpm run smoke`: 7 passed; 4 production-provider/instrumentation cases skipped by the hardened package boundary.
- Fresh Chromium QA: 9/9 cards fully visible at `1460×900`; inspector 6/6 actions with no scroll/clipping plus Escape/focus return; four Activity stages fully contained with a 10 px visible-text floor.
- Exact packaged startup: four consecutive passes at version `3.0.8.0`, renderer ready, isolated user data, four-process probe and `cleanupPassed=true`.
- Package parity and supply chain: 117/117 ASAR files match; Electron fuses match policy; dependency audit clean; 4/4 SHA-256 and `latest.yml` SHA-512/size match.
- Independent read-only release verifier: **SHIP** for local/manual distribution.
- Full evidence: [`artifacts/3.0.8/verification/VERIFICATION.md`](../../artifacts/3.0.8/verification/VERIFICATION.md).

## Contracts and risks

- Architecture and app map were updated for device-code IPC, stale-error semantics, inspector keyboard behavior and the Activity presentation contract.
- Roadmap now preserves the proven 3.0.8 baseline; product progress records T20 completion.
- Installed Codex, real accounts and user credentials were not touched; rendered and packaged checks used demo or isolated state.
- EXE remain unsigned; public/high-trust delivery still requires Authenticode + RFC3161 and therefore stays fail-closed.
- The official provider does not expose a trusted prefilled device-code URL. Automatic copy plus explicit `Ctrl+V` is intentional; real-account repeated switching and clean-VM install/upgrade/uninstall remain manual acceptance boundaries.

## Next safe action

Run manual acceptance only on explicitly designated test accounts and a clean Windows 11 VM, then decide the signing/public updater gate separately.
