# v3.1.4 publication and Claude Code provider research

- Timestamp: `2026-08-02T19:30:06Z`
- Scope: exact public release 3.1.4 plus saved implementation-ready Claude Code research

## What changed

- Published exact commit `990ef785395b5cff1ea987865097661c4d000284` as public latest stable `v3.1.4`.
- Uploaded five manifest-bound assets and verified public size/SHA-256 against exact local artifacts.
- Added `docs/research/claude-code-provider-integration-2026-08-02.md`.
- Updated current status, roadmap and durable context route. Product source code was not changed.

## Why

The user explicitly requested publication of the finished release and selected research plus implementation-ready architecture for Claude Code before any product implementation.

## Research outcome

- GO: native Windows pilot using official `CLAUDE_CONFIG_DIR`, `claude auth login/logout/status`, profile launcher and Pro/Max statusLine snapshots.
- DEFER: background consumer quota for inactive profiles, Team/Enterprise analytics, Console/API meters, WSL and IDE.
- NO-GO: credential/token copying, private OAuth usage endpoint, TUI scraping, false-live freshness, current-session identity replacement and automatic limit-evasion rotation.
- Phase 0 must first fix provider contract, DB unknown→Codex fallback, smart/tray/switch capability leakage and destructive profile deletion.

## Verification

- Publication reviewer: `pass`, no blocking findings.
- Guarded `git push origin HEAD:main`: pass.
- Guarded GitHub release creation: pass.
- Fresh public state: release/tag `v3.1.4`, commit `990ef785`, latest=`v3.1.4`, draft=false, prerelease=false, 5 assets.
- Public/local artifact size and SHA-256: 5/5 match.
- Research outcome reviewer: initial `conditional`; after amendments for freshness, routing, delete policy, official claim scope and data migration, second verdict `pass` with no blockers.
- `git diff --check`: pass before continuity.

## Affected contracts

- Public release pointer changed from 3.1.0 to 3.1.4.
- No runtime/API/DB contract changed in product code.
- Future Claude work is constrained by CTX-012 and the research owner document.

## Durable context

- Promoted CTX-012: safe Claude Code pilot boundary.
- Updated CTX-003: exact public latest release is 3.1.4.

## Risks

- Release remains unsigned/manual; SmartScreen is expected and disclosed.
- 3.1.4 Windows Sandbox and physical multi-DPI hover checks were not rerun.
- Claude runtime was not installed or executed; no real credentials or sessions were read.
- StatusLine freshness is session-observed because upstream response timestamp is absent.

## Next safe action

After separate authorization, implement Claude Phase 0 with fake CLI fixtures and independent tests before any UI or real-account runtime.
