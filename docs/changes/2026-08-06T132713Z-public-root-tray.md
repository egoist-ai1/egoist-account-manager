# Public root and native tray presentation

- Date (UTC): `2026-08-06T13:27:13Z`
- Scope: GitHub presentation only; no application source, tag, release or binary publication.

## Changed

- Added a privacy-safe native Windows capture showing the live taskbar percentage and matching hover panel in one image.
- Promoted that tray feature into an immediately visible README section.
- Removed internal control-room entry points from public tracking while retaining them locally through root-level ignore rules.

## Why

The public repository should explain the product at a glance and expose only the files useful to users and contributors. The live tray percentage is a differentiating feature and previously lacked an authentic taskbar-level illustration.

## Verification

- README local-link audit: pass.
- GitHub GFM rendering through the Markdown API: pass.
- Screenshot dimensions/privacy/readability inspection: pass (`410x450`; anonymized account label; identical `49`/`49%` state).
- Public-worktree tests: 71 files and 343 tests passed after rebuilding the Node-native database module.
- `git diff --check`: pass.
- 3.1.6 remains local and unpublished; public `latest` remains 3.1.5.

## Contracts and risk

- Runtime, authorization, switching, updater and installer contracts are unchanged.
- The four removed root files remain recoverable from Git history and remain present in the local project checkout.
- Residual release risk is unchanged: unsigned 3.1.6 artifacts still require the separate signed Windows installation/live gate before publication.

## Durable context

- Candidates/promotions/supersessions: none.
- Next safe action: independent review, guarded documentation-only push, then public post-push verification.
