# Clean-Room Cockpit Reference Policy

Egoist AI Manager may use Cockpit Tools only as behavioral research.

Allowed:
- Describe workflows in our own words.
- Reimplement official local file interactions from observed behavior.
- Write original Electron, TypeScript, React, and SQLite code.
- Use official account services only for accounts the user owns or is allowed to manage.

Not allowed:
- Copy Cockpit source files, UI text, comments, icons, config, updater metadata, installer scripts, data directory names, or branding.
- Preserve Cockpit deep-link schemes, release channels, or product identifiers.
- Publish tokens, raw auth files, cookies, local databases, OAuth pending files, generated API keys, or logs containing sensitive data.
- Add LAN listeners or token-bearing websocket APIs without a separate security review.

The commercial product direction is original implementation first, reference behavior second.
