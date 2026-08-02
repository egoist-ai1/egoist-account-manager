# Codex current-session and auth.json import — evidence note

Verified: 2026-08-02 (Europe/Moscow)
Official source snapshot: `openai/codex@2b5bdcf67547860f2e5c5a605009a70026796b2b`

## Product decision

- File-backed `auth.json` can become a fully switchable encrypted Manager profile.
- `keyring` and `auto` without a proven file source can be observed through the official app-server, but cannot be exported through a documented RPC. The UI therefore shows linked-only and offers a fresh official login for switchability.
- `ephemeral` has no durable credential to import.
- Manager must serialize work on a shared `CODEX_HOME`, capture the final file after Codex use and never run independent refresh streams over copied credentials.

## Primary evidence

- Codex caches login in `CODEX_HOME/auth.json` or OS credential storage and treats the file as a secret: [OpenAI authentication — login caching](https://learn.chatgpt.com/docs/auth#login-caching).
- Copying `auth.json` is documented for a trusted/headless environment, but does not cover OS credential storage: [copy auth cache](https://learn.chatgpt.com/docs/auth#fallback-authenticate-locally-and-copy-your-auth-cache).
- One copied cache must have a single runner/serialized stream and refreshed credentials must be persisted: [CI auth operational rules](https://learn.chatgpt.com/docs/auth/ci-cd-auth#operational-rules-that-matter).
- `CODEX_HOME` resolution: [find_codex_home](https://github.com/openai/codex/blob/2b5bdcf67547860f2e5c5a605009a70026796b2b/codex-rs/core/src/config/mod.rs#L4570-L4579).
- Storage modes include file/keyring/auto/ephemeral: [AuthCredentialsStoreMode](https://github.com/openai/codex/blob/2b5bdcf67547860f2e5c5a605009a70026796b2b/codex-rs/config/src/types.rs#L104-L117).
- Auto reads keyring before file fallback: [AutoAuthStorage](https://github.com/openai/codex/blob/2b5bdcf67547860f2e5c5a605009a70026796b2b/codex-rs/login/src/auth/storage.rs#L406-L445).
- Official identity and quota calls are `account/read` and `account/rateLimits/read`: [app-server auth RPC](https://github.com/openai/codex/blob/2b5bdcf67547860f2e5c5a605009a70026796b2b/codex-rs/app-server/README.md#L2132-L2179), [rate limits](https://github.com/openai/codex/blob/2b5bdcf67547860f2e5c5a605009a70026796b2b/codex-rs/app-server/README.md#L2276-L2316).

## Competitor patterns reviewed

- [Sls0n/codex-account-switcher](https://github.com/Sls0n/codex-account-switcher/blob/fad1a4199d448ed9dee7661eab3769aabb15235f/src/lib/accounts/account-service.ts#L11-L72): useful slug/path containment; plain copies and direct overwrite were rejected.
- [bjesuiter/codex-switcher](https://github.com/bjesuiter/codex-switcher/blob/c035734d43bec67db4ebf757cb30f84e9e8158c0/lib/secrets/store.ts#L261-L341): useful platform secret-store abstraction; manual construction of internal auth schema was rejected.
- [Loongphy/codex-auth](https://github.com/Loongphy/codex-auth/blob/0fde29598c2e02e28e0e8bcc33a4bb8d45d7b23a/src/auth/auth.zig#L63-L218): useful size cap, parse and account consistency checks; JWT decode alone is not treated as identity proof.
- [Ducksss/codex-profiles](https://github.com/Ducksss/codex-profiles/blob/b0df2dd0ab955eb712436f234bbab984cc017992/README.md#L19-L56): strong isolated `CODEX_HOME` pattern; requires a separate login and therefore is a fallback, not current-session import.

No competitor code, copy or branding was imported. Only behavioural patterns were evaluated against the official contract.
