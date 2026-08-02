# 3.1 — official auth and GitHub release discovery

Status: accepted
Date: 2026-08-02

## Decision

- Public Codex onboarding exposes only official browser, device-code, API-key and Enterprise-token flows.
- Current-session and arbitrary `auth.json` import are removed from renderer, preload and IPC. Existing profiles already stored in the encrypted vault remain valid and are not deleted.
- A temporary sign-out of Codex Desktop does not downgrade the manager-owned last-known-good profile; the isolated encrypted profile is checked instead. A real provider rejection still requires official reauthentication.
- SQLite migration 10 repairs duplicate active markers and then enforces one active profile per platform, adds indexes for hot queries, batches tag reads, and uses `WAL + synchronous=FULL + PRAGMA optimize`.
- A packaged app automatically checks the latest stable GitHub Release after startup. It accepts only strict semver and opens only the fixed repository release URL. It never silently downloads or executes an unsigned binary.

## Why

OpenAI credentials can rotate. Independently active copies of the same file-backed session can diverge, while keyring credentials have no documented export RPC. Official per-profile login keeps refresh ownership explicit and switch verification deterministic. Manual installation from a verified GitHub Release provides useful discovery now without weakening the unsigned Windows trust boundary.

## Consequences

- Users authorize each new switchable profile once through an official flow.
- Provider revocation, MFA or policy changes can still require reauthentication; the product does not promise impossible permanent authorization.
- Authenticode and RFC3161 remain prerequisites for a future one-click in-app installer.
