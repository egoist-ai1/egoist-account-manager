# Seamless Codex account switching — market and feasibility

Research snapshot: `2026-08-02`
Scope: public sources and source code only; no real accounts or active Codex sessions were touched.

## Decision

| Scenario | Verdict | Reason |
| --- | --- | --- |
| User-confirmed switch after the current turn | SHIP | Can be checkpointed, applied atomically, identity-verified and rolled back. |
| Separate work/personal profiles with isolated `CODEX_HOME` and app-data | CONDITIONAL SHIP | Strong isolation, but exact Desktop window/thread restoration remains best effort. |
| Automatic rotation of subscription accounts to simulate unlimited usage | NO-SHIP | Conflicts with rate-limit avoidance restrictions and increases account/compatibility risk. |
| Switching or replaying in the middle of a streaming/tool turn | NO-SHIP | Can duplicate partial output, shell commands and other side effects. |

The safe product is **assisted continuation**, not automatic subscription rotation.

## Official constraints

- OpenAI's [account switcher](https://help.openai.com/en/articles/20001068-use-multiple-accounts-with-account-switching) currently covers ChatGPT Web and at most two signed-in accounts; it is not a public control surface for Codex Desktop.
- Codex app-server exposes [`thread/resume`](https://github.com/openai/codex/blob/1e85ca099e4265bf89f4016772d299816e231bb3/codex-rs/app-server/README.md#L329-L335) and official [`account/rateLimits/read`](https://github.com/openai/codex/blob/1e85ca099e4265bf89f4016772d299816e231bb3/codex-rs/app-server/README.md#L2144-L2153), which support checkpoint/resume and truthful quota monitoring.
- [`AuthManager`](https://github.com/openai/codex/blob/1e85ca099e4265bf89f4016772d299816e231bb3/codex-rs/login/src/auth/manager.rs#L1761-L1768) caches authorization; editing `auth.json` does not change the running identity until reload/restart.
- The official login path explicitly [reloads auth and emits `AccountUpdated`](https://github.com/openai/codex/blob/1e85ca099e4265bf89f4016772d299816e231bb3/codex-rs/app-server/src/request_processors/account_processor.rs#L820-L848).
- Before a new request, Codex [obtains the current auth/provider again](https://github.com/openai/codex/blob/1e85ca099e4265bf89f4016772d299816e231bb3/codex-rs/core/src/client.rs#L1418-L1425). A client that owns app-server can therefore switch between turns; an external manager cannot safely promise a hot switch inside Codex Desktop.
- [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/) prohibit circumventing rate limits/restrictions. [Services Agreement](https://openai.com/policies/services-agreement/) separately prohibits configuring services to avoid Usage Limits. This is a product/compliance conclusion, not legal advice.

## Market/code audit

| Product | Mechanism | Useful pattern | Risk/limitation |
| --- | --- | --- | --- |
| [Codex Runway](https://github.com/Licoy/codex-runway/tree/6f191d6471407a683aeed47083c2449abefc2068) | macOS profile library, atomic auth installation, optional restart | Credential validation, temp+replace, clear stale quota immediately | macOS; fixed restart delay can interrupt work |
| [CAAM](https://github.com/Dicklesworthstone/coding_agent_account_manager/tree/f8e42b1fc9e7130bb42df27c7e03869bde8a6ce1) | Vault, profile roots, daemon awareness | Fail-closed behavior, backup/restore, locks, audit | Disk change alone does not reload app-server |
| [codex-multi-auth](https://github.com/ndycode/codex-multi-auth/tree/89ca9696d0f46cce48b28fdaa64a62d4bb521874) | Local Responses proxy with affinity/failover | Routing mutex, affinity, cooldown, bounded attempts | Private/undocumented proxy and subscription rotation risk |
| [Codex Multi Launcher](https://github.com/JqyModi/codex-multi-launcher) | Isolated `CODEX_HOME` and `--user-data-dir` | Clean work/personal separation | Public repository does not expose the full application code; Windows build is unsigned |
| [cdx](https://github.com/bjesuiter/codex-switcher/tree/c035734d43bec67db4ebf757cb30f84e9e8158c0) | Keychain/Credential Manager OAuth profiles | Secure-store adapters, refresh/relogin, mismatch validation | Windows beta; no Desktop lifecycle transaction/rollback |
| [CC Switch](https://github.com/farion1231/cc-switch/tree/ebbf141fc71547a99f669df1be8e345130d1d890) | Tauri configuration and local provider routing | SQLite SSOT, backups, health/circuit UX | Reverse-engineered OAuth routing may violate terms; Codex still requires restart |
| [Sls0n switcher](https://github.com/Sls0n/codex-account-switcher/tree/fad1a4199d448ed9dee7661eab3769aabb15235f) | Simple auth snapshots/copy | Minimal mental model | No daemon awareness, quota, rollback or Desktop orchestration |
| [Codex AccountSwitch](https://github.com/isxlan0/Codex_AccountSwitch/tree/21ac43ff4c2e222ac61aa56295aa76129249d222) | Win32/WebView2 auth swap, proxy, rotation | Windows observability, backup/restore | Private endpoints, raw tokens, protocol transformation and auto-rotation are too fragile |

A strong invariant from `codex-multi-auth`: [never fail over after the first response bytes](https://github.com/ndycode/codex-multi-auth/blob/89ca9696d0f46cce48b28fdaa64a62d4bb521874/lib/request/stream-failover.ts#L114-L116). The same invariant applies here: no account change after a turn has begun producing output or side effects.

## Recommended state machine

```text
Monitoring
  → warning at configured threshold
  → wait for turn/completed and no approval/tool child process
  → checkpoint thread + transaction journal
  → atomically activate protected profile
  → reload or graceful Desktop restart
  → verify actual provider account ID
  → best-effort resume of the recorded thread
  → commit
  ↘ restore previous profile and verify rollback on any failure
```

Required invariants:

- Never switch while a turn, approval, tool call or child process is active.
- Never replay after first response bytes.
- Do not kill after a fixed sleep; graceful-close the captured exact process tree and wait with a timeout.
- Journal previous/target account, thread ID, auth hash, PID tree and phase before mutation.
- Stage in the same directory and atomically replace protected files.
- Verify the effective provider account ID, not merely the presence of `auth.json`.
- Roll back and verify the previous identity on timeout or mismatch.
- Do not use private `/backend-api` routes or proxy subscription traffic.
- A quota candidate is eligible only when authorization is ready, the official snapshot is fresh and at least one known window remains above threshold.
- Before any future automatic assisted action, require two consecutive fresh measurements to avoid acting on transient zero/stale data.

## Product recommendation

The next safe feature is **«Переключить после текущего шага»**:

1. Notify at 10%; at a lower configurable threshold offer a queued switch.
2. Wait for an observable idle boundary.
3. Checkpoint the active thread and existing transaction state.
4. Run the current atomic switch/restart/identity verification chain.
5. Attempt `thread/resume` or reopen the previous thread as best effort.
6. Report a verified result or verified rollback.

Do not promise exact preservation of an arbitrary active Desktop task until Codex Desktop exposes a supported lifecycle/thread handoff API. Related open evidence includes [Desktop account switching #18806](https://github.com/openai/codex/issues/18806), [first-class auth profiles #4432](https://github.com/openai/codex/issues/4432) and stale remote auth [#22419](https://github.com/openai/codex/issues/22419).
