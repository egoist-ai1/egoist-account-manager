import crypto from "node:crypto";
import http from "node:http";

export const ANTIGRAVITY_GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
] as const;

const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleUserInfoUrls = [
  "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
  "https://www.googleapis.com/oauth2/v2/userinfo"
] as const;
const codeAssistContextEndpoints = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://autopush-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com"
] as const;
const callbackPath = "/oauth-callback";
const callbackPorts = [0, 36742, 36743, 36744, 36745, 36746] as const;
const antigravityIdeVersion = "1.20.5";
const googleApiNodeClientVersion = "10.3.0";
const googleApiNodeVersion = "22.21.1";

export interface AntigravityGoogleOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string[];
  tokenType: string | null;
}

export interface AntigravityGoogleUserInfo {
  id: string | null;
  email: string;
  verifiedEmail: boolean | null;
  name: string | null;
}

export interface AntigravityGoogleOAuthResult {
  tokens: AntigravityGoogleOAuthTokens;
  user: AntigravityGoogleUserInfo;
  accountContext: AntigravityGoogleAccountContext;
  clientId: string;
  redirectUri: string;
}

export interface AntigravityGoogleAccountContext {
  googleProjectId: string | null;
  tier: "free" | "standard" | "paid" | "unknown";
  tierId: string | null;
  source: "code_assist" | "unavailable";
  errorReason: string | null;
}

export interface AntigravityGoogleOAuthEnv {
  CAM_ANTIGRAVITY_OAUTH_CLIENT_ID?: string;
  CAM_ANTIGRAVITY_OAUTH_CLIENT_SECRET?: string;
  ANTIGRAVITY_OAUTH_CLIENT_ID?: string;
  ANTIGRAVITY_OAUTH_CLIENT_SECRET?: string;
}

export type AntigravityGoogleOAuthStep =
  | "callback_server_ready"
  | "browser_opened"
  | "callback_received"
  | "token_exchange_started"
  | "token_exchange_completed"
  | "userinfo_started"
  | "userinfo_completed"
  | "project_context_started"
  | "project_context_completed"
  | "project_context_unavailable";

export interface AntigravityOAuthCallbackResult {
  code: string;
  state: string;
}

export interface AntigravityOAuthCallbackServer {
  port: number;
  redirectUri: string;
  waitForCallback: Promise<AntigravityOAuthCallbackResult>;
  close(): Promise<void>;
}

export interface AntigravityGoogleOAuthAuthorization {
  authUrl: string;
  redirectUri: string;
  expectedState: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string | null;
  waitForCallback: Promise<AntigravityOAuthCallbackResult>;
  close(): Promise<void>;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface UserInfoResponse {
  id?: unknown;
  email?: unknown;
  verified_email?: unknown;
  name?: unknown;
}

interface LoadCodeAssistTier {
  id?: unknown;
  name?: unknown;
  quotaTier?: unknown;
  isDefault?: unknown;
  is_default?: unknown;
  availableCredits?: unknown;
}

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: unknown;
  currentTier?: LoadCodeAssistTier;
  allowedTiers?: LoadCodeAssistTier[];
  ineligibleTiers?: LoadCodeAssistTier[];
  paidTier?: LoadCodeAssistTier;
  planInfo?: unknown;
}

interface OnboardUserResponse {
  name?: unknown;
  done?: unknown;
  response?: {
    cloudaicompanionProject?: unknown;
  };
}

export function createAntigravityPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createAntigravityOAuthState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function resolveAntigravityOAuthClient(env: AntigravityGoogleOAuthEnv = {}): {
  clientId: string;
  clientSecret: string | null;
  usesBundledPublicClient: false;
} {
  const clientId = env.CAM_ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() || env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("Antigravity Beta OAuth requires your own PKCE desktop client ID. Set CAM_ANTIGRAVITY_OAUTH_CLIENT_ID or use the official Antigravity sign-in.");
  }

  return {
    clientId,
    clientSecret: env.CAM_ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim()
      || env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim()
      || null,
    usesBundledPublicClient: false
  };
}

export function buildAntigravityGoogleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    access_type: "offline",
    scope: ANTIGRAVITY_GOOGLE_OAUTH_SCOPES.join(" "),
    prompt: "consent",
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    state: input.state
  });
  return `${googleAuthUrl}?${params.toString()}`;
}

async function fetchWithHardTimeout(fetchPromise: Promise<Response>, timeoutMs: number, label: string): Promise<Response> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<Response>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds`)), timeoutMs);
  });
  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readJsonWithHardTimeout<T>(response: Response, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds`)), timeoutMs);
  });
  try {
    const bodyPromise = response.text()
      .then((text) => (text ? JSON.parse(text) : {}) as T)
      .catch(() => ({} as T));
    return await Promise.race([bodyPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function authCompleteHtml(success: boolean, message: string): string {
  const tone = success ? "#b78cff" : "#ff8f8f";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Egoist Account Manager</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f0f12; color: #f4f0ff; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    main { width: min(520px, calc(100vw - 40px)); border: 1px solid #302b3a; border-radius: 14px; padding: 28px; background: #17151d; box-shadow: 0 18px 60px rgba(0,0,0,.45); }
    h1 { margin: 0 0 10px; font-size: 20px; color: ${tone}; }
    p { margin: 0; color: #b9b2c7; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${success ? "Код входа получен" : "Вход не завершён"}</h1>
    <p>${escapeHtml(message)}</p>
  </main>
  <script>setTimeout(() => window.close(), 2400);</script>
</body>
</html>`;
}

async function createCallbackServer(timeoutMs = 5 * 60_000): Promise<AntigravityOAuthCallbackServer> {
  let server: http.Server | null = null;
  let settled = false;
  let timeout: NodeJS.Timeout | null = null;
  let resolveCallback!: (value: AntigravityOAuthCallbackResult) => void;
  let rejectCallback!: (reason: Error) => void;

  const waitForCallback = new Promise<AntigravityOAuthCallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const close = async () => {
    if (timeout) clearTimeout(timeout);
    if (!server) return;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  };

  const listenOnPort = (port: number) =>
    new Promise<{ server: http.Server; port: number }>((resolve, reject) => {
      let boundPort = port;
      const candidate = http.createServer((req, res) => {
        const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
        if (req.method !== "GET" || requestUrl.pathname !== callbackPath) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(authCompleteHtml(false, "Google вернул ошибку авторизации. Вернись в приложение и попробуй снова."));
          if (!settled) {
            settled = true;
            rejectCallback(new Error(`Google OAuth failed: ${error}`));
          }
          return;
        }
        if (!code || !state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(authCompleteHtml(false, "Ответ Google не содержит код входа."));
          if (!settled) {
            settled = true;
            rejectCallback(new Error("Google OAuth callback is missing code or state"));
          }
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(authCompleteHtml(true, "Egoist Account Manager завершает привязку аккаунта. Вернись в приложение через несколько секунд."));
        if (!settled) {
          settled = true;
          resolveCallback({ code, state });
        }
      });
      candidate.once("error", reject);
      candidate.listen(port, "127.0.0.1", () => {
        const address = candidate.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        boundPort = actualPort;
        resolve({ server: candidate, port: actualPort });
      });
    });

  let port: number | null = null;
  for (const candidatePort of callbackPorts) {
    try {
      const listener = await listenOnPort(candidatePort);
      server = listener.server;
      port = listener.port;
      break;
    } catch {
      server = null;
    }
  }
  if (!server || port === null) {
    throw new Error("No free localhost port for Antigravity Google login");
  }

  timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCallback(new Error("Antigravity Google login timed out"));
      void close();
    }
  }, timeoutMs);

  return {
    port,
    redirectUri: `http://localhost:${port}${callbackPath}`,
    waitForCallback,
    close
  };
}

export function parseAntigravityGoogleOAuthCallbackUrl(callbackUrl: string): AntigravityOAuthCallbackResult {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl.trim());
  } catch {
    throw new Error("Callback URL is not a valid URL");
  }
  const error = parsed.searchParams.get("error");
  if (error) throw new Error(`Google OAuth failed: ${error}`);
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (!code || !state) {
    throw new Error("Callback URL is missing code or state");
  }
  return { code, state };
}

export async function createAntigravityGoogleOAuthAuthorization(input: {
  env?: AntigravityGoogleOAuthEnv;
  timeoutMs?: number;
}): Promise<AntigravityGoogleOAuthAuthorization> {
  const client = resolveAntigravityOAuthClient(input.env);
  const pkce = createAntigravityPkce();
  const expectedState = createAntigravityOAuthState();
  const callbackServer = await createCallbackServer(input.timeoutMs);
  const authUrl = buildAntigravityGoogleAuthUrl({
    clientId: client.clientId,
    redirectUri: callbackServer.redirectUri,
    state: expectedState,
    codeChallenge: pkce.challenge
  });

  return {
    authUrl,
    redirectUri: callbackServer.redirectUri,
    expectedState,
    codeVerifier: pkce.verifier,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    waitForCallback: callbackServer.waitForCallback,
    close: () => callbackServer.close()
  };
}

export async function finishAntigravityGoogleOAuthAuthorization(input: {
  authorization: AntigravityGoogleOAuthAuthorization;
  callback: AntigravityOAuthCallbackResult;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  resolveAccountContext?: boolean;
  onStep?: (step: AntigravityGoogleOAuthStep) => void;
}): Promise<AntigravityGoogleOAuthResult> {
  if (input.callback.state !== input.authorization.expectedState) {
    throw new Error("Google OAuth state check failed");
  }
  input.onStep?.("token_exchange_started");
  const tokens = await exchangeAntigravityGoogleCode({
    clientId: input.authorization.clientId,
    clientSecret: input.authorization.clientSecret,
    redirectUri: input.authorization.redirectUri,
    code: input.callback.code,
    codeVerifier: input.authorization.codeVerifier,
    fetchImpl: input.fetchImpl,
    requestTimeoutMs: input.requestTimeoutMs
  });
  input.onStep?.("token_exchange_completed");
  input.onStep?.("userinfo_started");
  const user = await fetchAntigravityGoogleUserInfo({
    accessToken: tokens.accessToken,
    fetchImpl: input.fetchImpl,
    requestTimeoutMs: input.requestTimeoutMs
  });
  input.onStep?.("userinfo_completed");
  if (input.resolveAccountContext === false) {
    return {
      tokens,
      user,
      accountContext: {
        googleProjectId: null,
        tier: "unknown",
        tierId: null,
        source: "unavailable",
        errorReason: "Code Assist context deferred until background quota refresh."
      },
      clientId: input.authorization.clientId,
      redirectUri: input.authorization.redirectUri
    };
  }
  input.onStep?.("project_context_started");
  const accountContext = await fetchAntigravityGoogleAccountContext({
    accessToken: tokens.accessToken,
    fetchImpl: input.fetchImpl,
    requestTimeoutMs: input.requestTimeoutMs
  });
  input.onStep?.(accountContext.source === "code_assist" ? "project_context_completed" : "project_context_unavailable");
  return {
    tokens,
    user,
    accountContext,
    clientId: input.authorization.clientId,
    redirectUri: input.authorization.redirectUri
  };
}

export async function exchangeAntigravityGoogleCode(input: {
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}): Promise<AntigravityGoogleOAuthTokens> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier
  });
  if (input.clientSecret) params.set("client_secret", input.clientSecret);

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchWithHardTimeout(
    fetchImpl(googleTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    }),
    input.requestTimeoutMs ?? 20_000,
    "Google token exchange"
  );
  const body = await readJsonWithHardTimeout<TokenResponse>(response, input.requestTimeoutMs ?? 20_000, "Google token response");
  if (!response.ok || typeof body.access_token !== "string") {
    const description = typeof body.error_description === "string"
      ? body.error_description
      : typeof body.error === "string"
        ? body.error
        : "token exchange failed";
    throw new Error(`Google token exchange failed: ${description}.`);
  }
  const nowSeconds = input.now ? input.now() : Math.floor(Date.now() / 1000);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: typeof body.expires_in === "number" ? nowSeconds + body.expires_in : null,
    scope: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
    tokenType: typeof body.token_type === "string" ? body.token_type : null
  };
}

export async function fetchAntigravityGoogleUserInfo(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}): Promise<AntigravityGoogleUserInfo> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let lastError: Error | null = null;
  for (const url of googleUserInfoUrls) {
    const response = await fetchWithHardTimeout(
      fetchImpl(url, {
        headers: { Authorization: `Bearer ${input.accessToken}` }
      }),
      input.requestTimeoutMs ?? 20_000,
      "Google userinfo request"
    );
    const body = await readJsonWithHardTimeout<UserInfoResponse>(response, input.requestTimeoutMs ?? 20_000, "Google userinfo response");
    if (response.ok && typeof body.email === "string" && body.email.includes("@")) {
      return {
        id: typeof body.id === "string" && body.id ? body.id : null,
        email: body.email,
        verifiedEmail: typeof body.verified_email === "boolean" ? body.verified_email : null,
        name: typeof body.name === "string" && body.name ? body.name : null
      };
    }
    lastError = new Error(`Google user info request failed with HTTP ${response.status}`);
  }
  throw lastError ?? new Error("Google user info request failed");
}

function extractProjectId(body: LoadCodeAssistResponse): string | null {
  if (typeof body.cloudaicompanionProject === "string" && body.cloudaicompanionProject.trim()) {
    return body.cloudaicompanionProject.trim();
  }
  if (
    body.cloudaicompanionProject
    && typeof body.cloudaicompanionProject === "object"
    && "id" in body.cloudaicompanionProject
    && typeof body.cloudaicompanionProject.id === "string"
    && body.cloudaicompanionProject.id.trim()
  ) {
    return body.cloudaicompanionProject.id.trim();
  }
  return null;
}

function tierLabel(tier: LoadCodeAssistTier | null | undefined): string | null {
  const values = [tier?.id, tier?.name].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.join(" ").trim() || null;
}

function tierPreferredDisplayValue(tier: LoadCodeAssistTier | null | undefined): string | null {
  const name = typeof tier?.name === "string" && tier.name.trim() ? tier.name.trim() : null;
  const id = typeof tier?.id === "string" && tier.id.trim() ? tier.id.trim() : null;
  if (name && classifyTierLabel(name) === "paid") return name;
  return id ?? name;
}

function classifyTierLabel(label: string | null): "free" | "standard" | "paid" | "unknown" {
  const normalized = (label ?? "").toLowerCase().trim();
  if (!normalized) return "unknown";
  if (normalized.includes("free") || normalized.includes("zero") || normalized === "legacy-tier") return "free";
  if (normalized.includes("standard-tier") || normalized.includes("antigravity standard")) return "standard";
  // Generic values such as `g1-pro-tier` are returned by internal Code Assist
  // eligibility payloads and can describe an available tier, not the user's
  // active subscription. Only strong plan markers are surfaced as paid.
  if (/(google[\s_-]*ai[\s_-]*pro|google[\s_-]*ai[\s_-]*ultra|ultra)/.test(normalized)) return "paid";
  if (/\b(plus|team|business|enterprise|edu)\b/.test(normalized)) return "paid";
  if (/(^|[-_\s])(x?10|x?20)([-_\s]|$)/.test(normalized)) return "paid";
  return "unknown";
}

function collectPlanInfoStrings(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectPlanInfoStrings(item, depth + 1)).slice(0, 32);
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /plan|tier|subscription|sku|product/i.test(key))
    .flatMap(([, item]) => collectPlanInfoStrings(item, depth + 1))
    .slice(0, 32);
}

function strongPlanInfoLabel(body: LoadCodeAssistResponse): string | null {
  for (const label of collectPlanInfoStrings(body.planInfo)) {
    if (classifyTierLabel(label) === "paid") return label;
  }
  return null;
}

function creditNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tierHasUsableCredits(tier: LoadCodeAssistTier | null | undefined): boolean {
  const credits = Array.isArray(tier?.availableCredits) ? tier.availableCredits : [];
  return credits.some((credit) => {
    if (!credit || typeof credit !== "object") return false;
    const record = credit as Record<string, unknown>;
    const amount = creditNumber(record.creditAmount ?? record.amount ?? record.balance);
    const minimum = creditNumber(record.minimumCreditAmountForUsage ?? record.minimumAmount ?? 0) ?? 0;
    return amount !== null && amount > 0 && amount >= minimum;
  });
}

function isActivePaidTier(tier: LoadCodeAssistTier | null | undefined): boolean {
  if (classifyTierLabel(tierLabel(tier)) !== "paid") return false;
  return tierHasUsableCredits(tier);
}

function defaultAllowedTier(body: LoadCodeAssistResponse): LoadCodeAssistTier | null {
  if (!Array.isArray(body.allowedTiers) || body.allowedTiers.length === 0) return null;
  return body.allowedTiers.find((tier) => tier?.isDefault === true || tier?.is_default === true) ?? body.allowedTiers[0] ?? null;
}

function selectedTier(body: LoadCodeAssistResponse): LoadCodeAssistTier | null {
  const currentClass = classifyTierLabel(tierLabel(body.currentTier));
  if (currentClass === "paid") return body.currentTier ?? null;
  if (isActivePaidTier(body.paidTier)) return body.paidTier ?? null;
  if (currentClass !== "unknown") return body.currentTier ?? null;
  const defaultTier = defaultAllowedTier(body);
  if (defaultTier && classifyTierLabel(tierLabel(defaultTier)) !== "unknown") return defaultTier;
  const ineligible = Array.isArray(body.ineligibleTiers)
    ? body.ineligibleTiers.find((tier) => classifyTierLabel(tierLabel(tier)) !== "unknown") ?? null
    : null;
  return ineligible;
}

function extractTier(body: LoadCodeAssistResponse): "free" | "standard" | "paid" | "unknown" {
  const tier = selectedTier(body);
  const selected = classifyTierLabel(tierLabel(tier));
  if (selected !== "unknown") return selected;
  if (strongPlanInfoLabel(body)) return "paid";

  // `allowedTiers` and `paidTier` can describe eligibility or available offers,
  // not the user's active subscription. Without an explicit current tier we keep
  // the plan unknown instead of showing a synthetic Free/Standard/Pro badge.
  return "unknown";
}

function extractTierId(body: LoadCodeAssistResponse): string | null {
  const tier = selectedTier(body);
  if (classifyTierLabel(tierLabel(tier)) !== "unknown") return tierPreferredDisplayValue(tier);
  return strongPlanInfoLabel(body);
}

function codeAssistHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": `antigravity/${antigravityIdeVersion} windows/amd64 google-api-nodejs-client/${googleApiNodeClientVersion}`,
    "X-Goog-Api-Client": `gl-node/${googleApiNodeVersion}`,
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Client-Metadata": JSON.stringify(buildCodeAssistMetadata("GEMINI"))
  };
}

function buildCodeAssistMetadata(pluginType: "ANTIGRAVITY" | "GEMINI", projectId?: string | null): Record<string, string> {
  const metadata: Record<string, string> = {
    ideName: "antigravity",
    ideType: "ANTIGRAVITY",
    ideVersion: antigravityIdeVersion,
    pluginVersion: "2.3.0",
    platform: "WINDOWS_AMD64",
    updateChannel: "stable",
    pluginType
  };
  if (projectId) metadata.duetProject = projectId;
  return metadata;
}

const codeAssistMetadataCandidates: ReadonlyArray<{ metadata?: Record<string, string>; mode?: string }> = [
  { metadata: buildCodeAssistMetadata("GEMINI") },
  { metadata: buildCodeAssistMetadata("ANTIGRAVITY") },
  {
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI"
    },
    mode: "FULL_ELIGIBILITY_CHECK"
  },
  { mode: "FULL_ELIGIBILITY_CHECK" }
] as const;

function buildLoadCodeAssistPayload(payload: { metadata?: Record<string, string>; mode?: string }, projectId?: string | null): Record<string, unknown> {
  return {
    mode: payload.mode ?? "FULL_ELIGIBILITY_CHECK",
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
    ...(projectId ? { cloudaicompanionProject: projectId } : {})
  };
}

function shouldAttemptOnboard(body: LoadCodeAssistResponse): string | null {
  const tier = defaultAllowedTier(body);
  const tierId = tierLabel(tier);
  if (!tierId) return null;
  const classified = classifyTierLabel(tierId);
  if (classified === "free" || tierId.toLowerCase() === "legacy-tier") return tierId;
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function onboardCodeAssistProject(input: {
  endpoint: string;
  accessToken: string;
  tierId: string;
  metadata: Record<string, string>;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
}): Promise<string | null> {
  const body = {
    tierId: input.tierId,
    metadata: input.metadata
  };
  let operationName: string | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const request = operationName
      ? input.fetchImpl(`${input.endpoint}/v1internal/${operationName}`, {
          method: "GET",
          headers: codeAssistHeaders(input.accessToken)
        })
      : input.fetchImpl(`${input.endpoint}/v1internal:onboardUser`, {
          method: "POST",
          headers: codeAssistHeaders(input.accessToken),
          body: JSON.stringify(body)
        });
    const response = await fetchWithHardTimeout(
      request,
      input.requestTimeoutMs,
      operationName ? "Antigravity Code Assist onboarding poll" : "Antigravity Code Assist onboarding request"
    );
    const payload = await readJsonWithHardTimeout<OnboardUserResponse>(response, input.requestTimeoutMs, "Antigravity Code Assist onboarding response");
    if (!response.ok) return null;
    const projectId = extractProjectId({ cloudaicompanionProject: payload.response?.cloudaicompanionProject });
    if (projectId) return projectId;
    if (payload.done === true) return null;
    operationName = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : operationName;
    await delay(500);
  }
  return null;
}

export async function fetchAntigravityGoogleAccountContext(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}): Promise<AntigravityGoogleAccountContext> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const requestTimeoutMs = input.requestTimeoutMs ?? 20_000;
  const errors: string[] = [];
  for (const endpoint of codeAssistContextEndpoints) {
    for (const payload of codeAssistMetadataCandidates) {
      try {
        const response = await fetchWithHardTimeout(
          fetchImpl(`${endpoint}/v1internal:loadCodeAssist`, {
            method: "POST",
            headers: codeAssistHeaders(input.accessToken),
            body: JSON.stringify(buildLoadCodeAssistPayload(payload))
          }),
          requestTimeoutMs,
          "Antigravity Code Assist context request"
        );
        const body = await readJsonWithHardTimeout<LoadCodeAssistResponse>(response, requestTimeoutMs, "Antigravity Code Assist context response");
        if (!response.ok) {
          errors.push(`HTTP ${response.status}`);
          continue;
        }
        let googleProjectId = extractProjectId(body);
        if (!googleProjectId) {
          const tierId = shouldAttemptOnboard(body);
          if (tierId) {
            googleProjectId = await onboardCodeAssistProject({
              endpoint,
              accessToken: input.accessToken,
              tierId,
              metadata: payload.metadata ?? {},
              fetchImpl,
              requestTimeoutMs
            }).catch((error) => {
              errors.push(error instanceof Error ? error.message : String(error));
              return null;
            });
          }
        }
        return {
          googleProjectId,
          tier: extractTier(body),
          tierId: extractTierId(body),
          source: "code_assist",
          errorReason: null
        };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return {
    googleProjectId: null,
    tier: "unknown",
    tierId: null,
    source: "unavailable",
    errorReason: errors.slice(-2).join("; ") || "Code Assist context unavailable"
  };
}

export async function refreshAntigravityGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}): Promise<AntigravityGoogleOAuthTokens> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token"
  });
  if (input.clientSecret) params.set("client_secret", input.clientSecret);

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchWithHardTimeout(
    fetchImpl(googleTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    }),
    input.requestTimeoutMs ?? 20_000,
    "Google refresh token exchange"
  );
  const body = await readJsonWithHardTimeout<TokenResponse>(response, input.requestTimeoutMs ?? 20_000, "Google refresh token response");
  if (!response.ok || typeof body.access_token !== "string") {
    const description = typeof body.error_description === "string"
      ? body.error_description
      : typeof body.error === "string"
        ? body.error
        : "refresh token exchange failed";
    throw new Error(`Google refresh token exchange failed: ${description}.`);
  }
  const nowSeconds = input.now ? input.now() : Math.floor(Date.now() / 1000);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : input.refreshToken,
    expiresAt: typeof body.expires_in === "number" ? nowSeconds + body.expires_in : null,
    scope: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
    tokenType: typeof body.token_type === "string" ? body.token_type : null
  };
}

export async function runAntigravityGoogleOAuthFlow(input: {
  env?: AntigravityGoogleOAuthEnv;
  openExternal(url: string): Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  resolveAccountContext?: boolean;
  onStep?: (step: AntigravityGoogleOAuthStep) => void;
}): Promise<AntigravityGoogleOAuthResult> {
  const client = resolveAntigravityOAuthClient(input.env);
  const pkce = createAntigravityPkce();
  const expectedState = createAntigravityOAuthState();
  const callbackServer = await createCallbackServer(input.timeoutMs);
  input.onStep?.("callback_server_ready");
  try {
    const authUrl = buildAntigravityGoogleAuthUrl({
      clientId: client.clientId,
      redirectUri: callbackServer.redirectUri,
      state: expectedState,
      codeChallenge: pkce.challenge
    });
    await input.openExternal(authUrl);
    input.onStep?.("browser_opened");
    const callback = await callbackServer.waitForCallback;
    input.onStep?.("callback_received");
    if (callback.state !== expectedState) {
      throw new Error("Google OAuth state check failed");
    }
    input.onStep?.("token_exchange_started");
    const tokens = await exchangeAntigravityGoogleCode({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri: callbackServer.redirectUri,
      code: callback.code,
      codeVerifier: pkce.verifier,
      fetchImpl: input.fetchImpl,
      requestTimeoutMs: input.requestTimeoutMs
    });
    input.onStep?.("token_exchange_completed");
    input.onStep?.("userinfo_started");
    const user = await fetchAntigravityGoogleUserInfo({
      accessToken: tokens.accessToken,
      fetchImpl: input.fetchImpl,
      requestTimeoutMs: input.requestTimeoutMs
    });
    input.onStep?.("userinfo_completed");
    if (input.resolveAccountContext === false) {
      return {
        tokens,
        user,
        accountContext: {
          googleProjectId: null,
          tier: "unknown",
          tierId: null,
          source: "unavailable",
          errorReason: "Code Assist context deferred until background quota refresh."
        },
        clientId: client.clientId,
        redirectUri: callbackServer.redirectUri
      };
    }
    input.onStep?.("project_context_started");
    const accountContext = await fetchAntigravityGoogleAccountContext({
      accessToken: tokens.accessToken,
      fetchImpl: input.fetchImpl,
      requestTimeoutMs: input.requestTimeoutMs
    });
    input.onStep?.(accountContext.source === "code_assist" ? "project_context_completed" : "project_context_unavailable");
    return {
      tokens,
      user,
      accountContext,
      clientId: client.clientId,
      redirectUri: callbackServer.redirectUri
    };
  } finally {
    await callbackServer.close();
  }
}
