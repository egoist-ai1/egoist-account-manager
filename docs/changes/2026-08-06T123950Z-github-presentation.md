# GitHub repository presentation

- Date: `2026-08-06T12:39:50Z`
- Scope: documentation and public repository organization only
- Public binary baseline: `v3.1.5` unchanged

## What changed

- Replaced the internal-handoff-style README with a concise product page: clear positioning, feature table, verified switching flow, official authentication methods, security, install steps and project links.
- Added four anonymized product screenshots for Overview, Accounts, Activity and the Windows tray.
- Removed 38 duplicated root `RELEASE_NOTES_*` files; early history remains recoverable in Git, `CHANGELOG.md` and GitHub Releases.
- Kept detailed notes only for 3.1.4, 3.1.5 and the explicitly marked, unpublished 3.1.6 preview.
- Moved legacy `DESIGN.md` and `PRODUCT_SPECIFICATION.md` to `docs/product/` so the repository root stays product-focused.
- Added a short development entry point.

## Why

The public repository exposed internal status language and dozens of historical files before explaining the product. The new hierarchy makes the purpose, current stable download, safety model and core interface understandable from the first screen without hiding release status.

## Verification

- All selected local README/document links and image targets resolve.
- GitHub's Markdown API rendered the hero, alerts, tables, details and images as GFM.
- PNG metadata: three 1460×900 application views and one 252×144 tray view.
- Screenshots contain synthetic/example profile identities and no tokens, cookies, API keys or personal filesystem paths.
- No application source, package version, release tag or binary artifact changed.

## Contracts and context

- Affected contract: public repository presentation and release-document layout.
- Architecture/runtime contracts: unchanged.
- Durable-context changes: none; this note records a presentation-only reorganization.

## Risks and next safe action

- Preview images are newer than the public stable binary, so README labels them explicitly as 3.1.6 preview and links 3.1.5 as the stable download.
- Run the history manager, independent outcome review, guarded docs-only push and public-page verification.
