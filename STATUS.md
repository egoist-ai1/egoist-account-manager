# Codex Account Manager — status

- Last updated: `2026-08-06T12:39:50Z`
- Public stable: [`v3.1.5`](https://github.com/egoistgorbachev/codex-account-manager/releases/tag/v3.1.5)
- Product candidate: `3.1.6` — not published
- Stage: `stable published; repository presentation refreshed`

## Current outcome

- Public repository has a product-first README with four anonymized interface images, installation, feature, security and switching explanations.
- Root release-note sprawl is removed. The canonical history is `CHANGELOG.md`; detailed notes remain only for 3.1.4, 3.1.5 and preview 3.1.6.
- Legacy design/specification documents live under `docs/product/` instead of the public root.
- Stable installers and GitHub `latest` remain 3.1.5; this documentation-only update does not publish or replace Windows binaries.

## Verification

| Date (UTC) | Check | Result |
| --- | --- | --- |
| 2026-08-06 | Local README links and image paths | pass |
| 2026-08-06 | GitHub GFM render through API | pass; headings, alerts, tables and four images rendered |
| 2026-08-06 | Screenshot privacy review | pass; synthetic/example profiles only |
| 2026-08-03 | Public release 3.1.5 | pass; latest stable and release assets preserved |

## Blockers and next action

- 3.1.6 remains blocked from binary publication until the exact CA-trusted signed artifacts pass isolated Windows install/live gates.
- After independent presentation review, publish only this documentation commit through guarded delivery and verify the public GitHub page.

## Durable context

- [Architecture](./docs/ARCHITECTURE.md)
- [Application map](./docs/APP_MAP.md)
- [Context index](./docs/CONTEXT.md)
- [Change history](./docs/changes/INDEX.md)
- [Release notes](./docs/releases/README.md)
