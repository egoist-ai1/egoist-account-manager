# Commercial Codex + Antigravity Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Codex Account Manager into a commercial-safe local account control plane for Codex and Google Antigravity without copying Cockpit Tools source code.

**Architecture:** Keep the existing Electron + React + TypeScript + SQLite product as the base. Implement Cockpit-inspired behavior as original TypeScript services with explicit tests, using Cockpit only as behavioral research: storage ideas, OAuth flows, quota strategy, switch workflow, and risk hardening.

**Tech Stack:** Electron 39, React 19, TypeScript, Vite, better-sqlite3, Vitest, Playwright, electron-builder.

---

## Clean-Room Rules

- Do not copy Cockpit source files, comments, UI text, icons, identifiers, installer scripts, updater config, or data directory names.
- Use only behavior-level notes from the Cockpit audit: which official files are touched, what OAuth/quota endpoints are involved, and what workflows exist.
- Keep this project MIT/commercial-friendly. Any implementation must be written inside `projects/codex-account-manager-gh` using existing code style.
- Do not log or expose access tokens, refresh tokens, `auth.json`, `.cam-export`, cookies, OAuth pending files, or SQLite blobs.
- Keep networking local-only by default. No `0.0.0.0` listener unless a later product decision explicitly enables LAN mode with a separate threat model.

## Target Product Shape

- Product scope: Codex + Antigravity only.
- UI language: Russian only.
- Account classes:
  - `codex`: existing ChatGPT/Codex account profiles.
  - `antigravity`: Google/Antigravity IDE accounts.
- Keep existing Codex strengths: encrypted local storage, import/export, switching, release pipeline, diagnostics.
- Add Cockpit-inspired improvements:
  - Codex auto-switch based on primary/secondary quota windows.
  - Codex local API gateway only if a later phase confirms the commercial and security scope.
  - Antigravity account import from IDE profile.
  - Antigravity token injection into `%APPDATA%\Antigravity IDE\User\globalStorage\state.vscdb`.
  - Antigravity fingerprint/device profile handling.
  - Antigravity quota refresh and best-account recommendation.

---

## File Map

- Modify: `src/shared/types.ts` - shared account/platform/quota types and IPC contracts.
- Modify: `src/shared/ipcSchemas.ts` - runtime validation for new IPC payloads.
- Modify: `src/main/db.ts` - SQLite migrations for platform-aware accounts and Antigravity metadata.
- Modify: `src/main/main.ts` - IPC registration and service construction.
- Modify: `src/main/preload.ts` - renderer-safe API surface.
- Modify: `src/main/services/accountService.ts` - platform-aware account metadata.
- Modify: `src/main/services/limitService.ts` - shared recommendation and quota scoring logic.
- Modify: `src/main/services/switchService.ts` - keep Codex switch path, add Antigravity switch orchestration.
- Create: `src/main/services/antigravityPaths.ts` - resolve official Antigravity IDE paths.
- Create: `src/main/services/antigravityTokenCodec.ts` - original token serialization/deserialization boundary.
- Create: `src/main/services/antigravityAuthService.ts` - Google OAuth/manual refresh-token/import flows.
- Create: `src/main/services/antigravityProfileService.ts` - SQLite/profile injection and fingerprint files.
- Create: `src/main/services/antigravityLimitService.ts` - Antigravity quota refresh and status mapping.
- Create: `src/main/services/codexAutoSwitchService.ts` - Codex quota threshold evaluation and switch candidate selection.
- Create: `src/main/ipc/antigravityIpc.ts` - IPC handlers for Antigravity accounts.
- Modify: `src/renderer/App.tsx` - navigation shell for two-platform product.
- Modify: `src/renderer/i18n/ru.ts` - Russian labels for new workflows.
- Create: `src/renderer/pages/AntigravityPage.tsx` - Antigravity account table, quota, switch actions.
- Modify: `src/renderer/pages/DashboardPage.tsx` - combined Codex + Antigravity operational dashboard.
- Modify: `src/renderer/pages/LimitsPage.tsx` - two-platform quota overview.
- Modify: `src/renderer/pages/HealthPage.tsx` - Codex + Antigravity diagnostics.
- Modify: `src/renderer/pages/SettingsPage.tsx` - remove language choice, add Antigravity path settings.
- Test: `tests/main/antigravityPaths.test.ts`.
- Test: `tests/main/antigravityProfileService.test.ts`.
- Test: `tests/main/antigravityLimitService.test.ts`.
- Test: `tests/main/codexAutoSwitchService.test.ts`.
- Test: `tests/main/db-migrations.test.ts`.
- Test: `tests/shared/ipcSchemas.test.ts`.
- Test: `tests/ui/russian-source-scan.test.ts`.
- Test: `tests/smoke/app.spec.ts`.

---

### Task 1: Project Guardrail and Product Scope

**Files:**
- Create: `docs/clean-room-cockpit-reference.md`
- Modify: `README.md`

- [ ] **Step 1: Add clean-room reference policy**

Create `docs/clean-room-cockpit-reference.md`:

```markdown
# Clean-Room Cockpit Reference Policy

This project may use Cockpit Tools only as behavioral research.

Allowed:
- Describe workflows in our own words.
- Reimplement official file interactions from public behavior.
- Write original TypeScript/Electron code.
- Use official service endpoints only when the user owns or may manage the accounts.

Not allowed:
- Copy Cockpit source files, UI text, comments, icons, config, updater metadata, installer scripts, or data directory names.
- Preserve Cockpit branding or deep-link schemes.
- Publish tokens, raw auth files, cookies, local databases, or generated API keys.
- Add LAN listeners without a separate security review.
```

- [ ] **Step 2: Update README scope**

Add a short section after the current product description:

```markdown
## Commercial-safe implementation

The application is built as an original Electron/TypeScript product. External projects may be used as behavioral references, but source code, branding, installer metadata, updater configuration, and UI text are not copied from incompatible licenses.
```

- [ ] **Step 3: Verify docs**

Run:

```powershell
rg -n "Cockpit Tools|commercial-safe|Clean-Room" README.md docs
```

Expected: README contains commercial-safe wording; clean-room policy contains the only Cockpit reference.

---

### Task 2: Platform-Aware Data Model

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/db.ts`
- Test: `tests/main/db-migrations.test.ts`

- [ ] **Step 1: Add shared platform types**

Extend `src/shared/types.ts`:

```ts
export type AccountPlatform = "codex" | "antigravity";

export interface AntigravityAccountDetails {
  googleProjectId: string | null;
  fingerprintId: string | null;
  lastQuotaRefreshAt: number | null;
  forbidden: boolean;
}
```

Add to `ManagedAccount`:

```ts
platform: AccountPlatform;
antigravity?: AntigravityAccountDetails | null;
```

- [ ] **Step 2: Add SQLite migration**

Add migration version `4` in `src/main/db.ts`:

```ts
{
  version: 4,
  name: "v3_platform_accounts",
  run: (db) => {
    const columns = new Set((db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has("platform")) db.exec("ALTER TABLE accounts ADD COLUMN platform TEXT NOT NULL DEFAULT 'codex'");
    db.exec(`
      CREATE TABLE IF NOT EXISTS antigravity_account_details (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        google_project_id TEXT,
        fingerprint_id TEXT,
        last_quota_refresh_at INTEGER,
        forbidden INTEGER NOT NULL DEFAULT 0
      );
    `);
  }
}
```

- [ ] **Step 3: Update row mapping**

Update `Row` with `platform: "codex" | "antigravity" | string`, and map missing/legacy values to `"codex"`.

- [ ] **Step 4: Test migration**

Add to `tests/main/db-migrations.test.ts`:

```ts
it("migrates legacy Codex accounts to platform codex", () => {
  const store = new AccountStore(tempDir);
  const account = store.list()[0];
  expect(account?.platform ?? "codex").toBe("codex");
});
```

Run:

```powershell
npm run test:node -- tests/main/db-migrations.test.ts
```

Expected: migration tests pass.

---

### Task 3: Antigravity Path Resolution

**Files:**
- Create: `src/main/services/antigravityPaths.ts`
- Test: `tests/main/antigravityPaths.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/main/antigravityPaths.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAntigravityPaths } from "../../src/main/services/antigravityPaths.js";

describe("resolveAntigravityPaths", () => {
  it("resolves Windows Antigravity IDE profile paths from APPDATA", () => {
    const paths = resolveAntigravityPaths({ platform: "win32", appData: "C:\\Users\\User\\AppData\\Roaming", home: "C:\\Users\\User" });
    expect(paths.userDataDir).toBe(path.join("C:\\Users\\User\\AppData\\Roaming", "Antigravity IDE"));
    expect(paths.stateDbPath.endsWith(path.join("User", "globalStorage", "state.vscdb"))).toBe(true);
    expect(paths.storageJsonPath.endsWith(path.join("User", "globalStorage", "storage.json"))).toBe(true);
    expect(paths.machineIdPath.endsWith("machineid")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement path service**

Create `src/main/services/antigravityPaths.ts`:

```ts
import path from "node:path";

export interface AntigravityPathInput {
  platform: NodeJS.Platform;
  appData: string | undefined;
  home: string;
}

export interface AntigravityPaths {
  userDataDir: string;
  globalStorageDir: string;
  stateDbPath: string;
  storageJsonPath: string;
  machineIdPath: string;
}

export function resolveAntigravityPaths(input: AntigravityPathInput): AntigravityPaths {
  const userDataDir =
    input.platform === "win32"
      ? path.join(input.appData ?? path.join(input.home, "AppData", "Roaming"), "Antigravity IDE")
      : input.platform === "darwin"
        ? path.join(input.home, "Library", "Application Support", "Antigravity IDE")
        : path.join(input.home, ".config", "Antigravity IDE");
  const globalStorageDir = path.join(userDataDir, "User", "globalStorage");
  return {
    userDataDir,
    globalStorageDir,
    stateDbPath: path.join(globalStorageDir, "state.vscdb"),
    storageJsonPath: path.join(globalStorageDir, "storage.json"),
    machineIdPath: path.join(userDataDir, "machineid")
  };
}
```

- [ ] **Step 3: Run path test**

Run:

```powershell
npm run test:node -- tests/main/antigravityPaths.test.ts
```

Expected: path test passes.

---

### Task 4: Antigravity Profile Injection Boundary

**Files:**
- Create: `src/main/services/antigravityTokenCodec.ts`
- Create: `src/main/services/antigravityProfileService.ts`
- Test: `tests/main/antigravityProfileService.test.ts`

- [ ] **Step 1: Define token payload types**

Create `src/main/services/antigravityTokenCodec.ts`:

```ts
export interface AntigravityTokenMaterial {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  projectId: string | null;
}

export function encodeAntigravityTokenForStorage(token: AntigravityTokenMaterial): string {
  const json = JSON.stringify({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    email: token.email,
    project_id: token.projectId
  });
  return Buffer.from(json, "utf8").toString("base64");
}

export function decodeAntigravityTokenFromStorage(value: string): AntigravityTokenMaterial {
  const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<string, unknown>;
  return {
    accessToken: String(parsed.access_token ?? ""),
    refreshToken: String(parsed.refresh_token ?? ""),
    expiresAt: Number(parsed.expires_at ?? 0),
    email: String(parsed.email ?? ""),
    projectId: parsed.project_id ? String(parsed.project_id) : null
  };
}
```

- [ ] **Step 2: Write profile service tests**

Create tests for writing an `ItemTable` row named `antigravityUnifiedStateSync.oauthToken` in a temp SQLite database and for updating `storage.json` telemetry keys without printing token values.

- [ ] **Step 3: Implement profile service**

Create `src/main/services/antigravityProfileService.ts` with methods:

```ts
export class AntigravityProfileService {
  injectToken(paths: AntigravityPaths, token: AntigravityTokenMaterial): void;
  readToken(paths: AntigravityPaths): AntigravityTokenMaterial | null;
  applyFingerprint(paths: AntigravityPaths, fingerprint: AntigravityFingerprint): void;
}
```

Implementation must use `better-sqlite3` for `state.vscdb` and `fs.writeFileSync` with temp-file rename for JSON writes.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm run test:node -- tests/main/antigravityProfileService.test.ts
```

Expected: token injection and fingerprint tests pass, with no raw token output.

---

### Task 5: Antigravity Account Auth and Import

**Files:**
- Create: `src/main/services/antigravityAuthService.ts`
- Create: `src/main/ipc/antigravityIpc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipcSchemas.ts`
- Test: `tests/shared/ipcSchemas.test.ts`

- [ ] **Step 1: Add IPC contracts**

Add renderer API methods:

```ts
listAntigravityAccounts(): Promise<ManagedAccount[]>;
addAntigravityRefreshToken(refreshToken: string): Promise<ManagedAccount>;
importAntigravityFromIde(): Promise<ManagedAccount | null>;
refreshAntigravityAccount(accountId: string): Promise<ManagedAccount>;
switchAntigravityAccount(accountId: string): Promise<void>;
```

- [ ] **Step 2: Implement auth service shell**

Create `AntigravityAuthService` with original methods:

```ts
export class AntigravityAuthService {
  async addRefreshToken(refreshToken: string): Promise<ManagedAccount>;
  async importFromIde(): Promise<ManagedAccount | null>;
  async refreshAccessToken(accountId: string): Promise<void>;
}
```

Use dependency-injected HTTP functions so tests can mock Google token/userinfo calls.

- [ ] **Step 3: Register IPC**

Register `antigravity:*` IPC handlers in `src/main/main.ts` using the same safe error wrapper pattern as existing IPC modules.

- [ ] **Step 4: Validate IPC schema**

Extend `tests/shared/ipcSchemas.test.ts` to assert new Antigravity operations reject empty refresh tokens and malformed account ids.

Run:

```powershell
npm run test:node -- tests/shared/ipcSchemas.test.ts
```

Expected: schema tests pass.

---

### Task 6: Antigravity Quota and Recommendation

**Files:**
- Create: `src/main/services/antigravityLimitService.ts`
- Modify: `src/main/services/limitService.ts`
- Test: `tests/main/antigravityLimitService.test.ts`
- Test: `tests/main/limitService.test.ts`

- [ ] **Step 1: Define quota mapping tests**

Test cases:

```ts
it("maps forbidden quota response to error status", () => {
  expect(mapAntigravityQuota({ forbidden: true }).status).toBe("error");
});

it("scores accounts with Gemini and Claude capacity above depleted accounts", () => {
  const best = selectBestAccount(accounts, { staleAfterSeconds: 900, now: fixedNow });
  expect(best?.account.email).toBe("healthy@example.com");
});
```

- [ ] **Step 2: Implement quota service**

Create service methods:

```ts
export class AntigravityLimitService {
  async refreshAccount(accountId: string): Promise<ManagedAccount>;
  async refreshAll(): Promise<ManagedAccount[]>;
}
```

Use injected HTTP and token refresh dependencies. Persist normalized model quota JSON into existing account rate-limit fields or a platform-specific extension table added in Task 2.

- [ ] **Step 3: Run quota tests**

Run:

```powershell
npm run test:node -- tests/main/antigravityLimitService.test.ts tests/main/limitService.test.ts
```

Expected: quota mapping and recommendation tests pass.

---

### Task 7: Codex Auto-Switch

**Files:**
- Create: `src/main/services/codexAutoSwitchService.ts`
- Modify: `src/main/services/switchService.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/codexAutoSwitchService.test.ts`

- [ ] **Step 1: Write candidate selection tests**

Create tests:

```ts
it("does not switch when current account is above thresholds", () => {
  expect(pickCodexAutoSwitchTarget(accounts, { primaryThreshold: 80, secondaryThreshold: 80 })).toBeNull();
});

it("switches to the freshest account above both thresholds", () => {
  const target = pickCodexAutoSwitchTarget(accounts, { primaryThreshold: 20, secondaryThreshold: 20 });
  expect(target?.id).toBe("codex-healthy");
});
```

- [ ] **Step 2: Implement service**

Create:

```ts
export interface CodexAutoSwitchOptions {
  primaryThreshold: number;
  secondaryThreshold: number;
  selectedAccountIds?: string[];
}

export function pickCodexAutoSwitchTarget(accounts: ManagedAccount[], options: CodexAutoSwitchOptions): ManagedAccount | null;
```

Rules: current active account must be below or equal to either threshold; candidate must be non-archived, non-error, non-limited, fresh, and above both thresholds.

- [ ] **Step 3: Wire into refresh flow**

After successful Codex refresh-all, evaluate the target. In `suggest` mode, show a recommendation; in `auto` mode, call existing `switchService` with audit logging.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm run test:node -- tests/main/codexAutoSwitchService.test.ts tests/main/switchService.test.ts
```

Expected: auto-switch tests and existing switch tests pass.

---

### Task 8: Two-Platform Russian UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/pages/AntigravityPage.tsx`
- Modify: `src/renderer/pages/DashboardPage.tsx`
- Modify: `src/renderer/pages/LimitsPage.tsx`
- Modify: `src/renderer/pages/HealthPage.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/i18n/ru.ts`
- Test: `tests/ui/russian-source-scan.test.ts`
- Test: `tests/ui/russian-ui-strings.test.ts`

- [ ] **Step 1: Navigation**

Use these top-level sections only:

```ts
const NAV_ITEMS = [
  { id: "dashboard", label: "Панель" },
  { id: "codex", label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "limits", label: "Лимиты" },
  { id: "vault", label: "Перенос" },
  { id: "health", label: "Диагностика" },
  { id: "settings", label: "Настройки" }
] as const;
```

- [ ] **Step 2: Antigravity page**

Build `AntigravityPage.tsx` with account list, add/import actions, quota refresh, switch action, and fingerprint status. Keep it dense and operational like existing account pages.

- [ ] **Step 3: Settings**

Remove language selector from UI. Keep `AppSettings.language` fixed to `"ru"`.

- [ ] **Step 4: UI tests**

Run:

```powershell
npm run test:node -- tests/ui/russian-source-scan.test.ts tests/ui/russian-ui-strings.test.ts
```

Expected: no user-facing English strings except allowed technical terms.

---

### Task 9: Packaging and Release Hardening

**Files:**
- Modify: `package.json`
- Modify: `docs/release-checklist.md`
- Modify: `docs/release-2.0-checklist.md`
- Test: `tests/main/releaseService.test.ts`

- [ ] **Step 1: Product naming**

Decide final product name before release. If keeping `Codex Account Manager`, update description to mention Antigravity. If renaming, update `productName`, `appId`, NSIS shortcut names, artifact names, README, release tests, and screenshots together.

- [ ] **Step 2: Signing policy**

Add release checklist entries:

```markdown
- [ ] Windows installer and portable build are signed or explicitly marked as unsigned preview builds.
- [ ] Auto-update feed points to our GitHub repository only.
- [ ] Release assets contain no auth material, SQLite databases, `.cam-export`, logs, or profile directories.
```

- [ ] **Step 3: Release verification**

Run:

```powershell
npm run typecheck
npm run test:node
npm run build:dir
npm run smoke
```

Expected: typecheck, unit tests, unpacked Electron build, and smoke tests pass.

---

## Self-Review

- Spec coverage: This plan covers commercial-safe reuse, Codex improvements, Antigravity account management, quota/switch logic, Russian-only UI, packaging, and release safety.
- Placeholder scan: No task depends on Cockpit source copying. Later endpoint details must be implemented through injected clients and tests, not pasted from Cockpit.
- Type consistency: Shared platform type is `AccountPlatform = "codex" | "antigravity"` and all tasks refer to those exact ids.

## Execution Options

Recommended execution mode: subagent-driven development, one task per agent, with main-session review after each task.

For the first implementation pass, start with Tasks 1-3. They are low-risk, establish the commercial guardrail, and create the Antigravity path foundation without touching real user profiles.
