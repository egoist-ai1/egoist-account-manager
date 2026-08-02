import { z } from "zod";

export const accountIdSchema = z.string().trim().min(1);
export const switchTransactionIdSchema = z.string().trim().min(8).max(120);
export const accountPlatformSchema = z.union([z.literal("codex"), z.literal("antigravity")]);
export const loginTypeSchema = z.union([
  z.literal("chatgpt"),
  z.literal("chatgptDeviceCode"),
  z.literal("apiKey"),
  z.literal("enterpriseAccessToken")
]);
const interactiveLoginInputSchema = z.union([
  z.object({ type: z.literal("chatgpt") }).strict(),
  z.object({ type: z.literal("chatgptDeviceCode") }).strict()
]);
const credentialLoginInputSchema = z.union([
  z.object({ type: z.literal("apiKey"), credential: z.string().trim().min(8).max(512) }).strict(),
  z.object({ type: z.literal("enterpriseAccessToken"), credential: z.string().trim().min(20).max(16_384) }).strict()
]);
export const antigravityRefreshTokenSchema = z.string().trim().min(20).max(4096);
export const antigravityAccessTokenSchema = z.string().trim().min(12).max(8192);
export const antigravityMachineIdSchema = z.string().trim().min(8).max(512);

export const switchAccountInputSchema = z.object({
  accountId: accountIdSchema,
  platform: accountPlatformSchema.optional(),
  transactionId: switchTransactionIdSchema.optional()
}).strict();

export const accountActionInputSchema = z.object({ accountId: accountIdSchema }).strict();
export const switchTransactionActionInputSchema = z.object({ transactionId: switchTransactionIdSchema }).strict();
export const loginStartInputSchema = z.union([interactiveLoginInputSchema, credentialLoginInputSchema]);
export const reauthenticateAccountInputSchema = z.union([
  z.object({ accountId: accountIdSchema, type: z.literal("chatgpt") }).strict(),
  z.object({ accountId: accountIdSchema, type: z.literal("chatgptDeviceCode") }).strict(),
  z.object({
    accountId: accountIdSchema,
    type: z.literal("apiKey"),
    credential: z.string().trim().min(8).max(512)
  }).strict(),
  z.object({
    accountId: accountIdSchema,
    type: z.literal("enterpriseAccessToken"),
    credential: z.string().trim().min(20).max(16_384)
  }).strict()
]);
export const workspaceBindingInputSchema = z.object({ accountId: accountIdSchema.nullable() }).strict();
export const switchEventInputSchema = z.object({ eventId: accountIdSchema }).strict();
export const openExternalInputSchema = z.object({
  url: z
    .string()
    .url()
    .max(4096)
    .refine((value) => new URL(value).protocol === "https:", "Only HTTPS URLs are allowed")
}).strict();

export const deviceCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(64)
  .regex(/^[a-z0-9-]+$/i, "Device code contains unsupported characters");

export const deviceCodeActionInputSchema = z.object({
  userCode: deviceCodeSchema
}).strict();

export const deviceCodeOpenInputSchema = z.object({
  url: openExternalInputSchema.shape.url,
  userCode: deviceCodeSchema
}).strict();

export const validateAuthInputSchema = z.object({
  accountId: accountIdSchema
}).strict();

export const quotaStateInputSchema = z.object({
  accountId: accountIdSchema
}).strict();

export const updateSettingsInputSchema = z.object({
  language: z.union([z.literal("ru"), z.literal("en")]).optional(),
  autoRefreshIntervalMs: z
    .union([
      z.literal(0),
      z.literal(180_000),
      z.literal(600_000),
      z.literal(900_000)
    ])
    .optional(),
  privacyMode: z.boolean().optional(),
  confirmSwitch: z.boolean().optional(),
  desktopClosePolicy: z.union([z.literal("graceful-only"), z.literal("exact-tree-fallback")]).optional(),
  smartSwitchMode: z.union([z.literal("off"), z.literal("suggest")]).optional(),
  smartSwitchThresholdPercent: z.number().int().min(5).max(50).optional(),
  desktopNotifications: z.boolean().optional(),
  trayEnabled: z.boolean().optional(),
  autostartEnabled: z.boolean().optional()
}).strict();

export const importAntigravityCredentialsInputSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(254),
  accountId: z.string().trim().min(1).max(160),
  refreshToken: antigravityRefreshTokenSchema,
  accessToken: antigravityAccessTokenSchema.optional().nullable(),
  expiresAt: z.number().int().nonnegative().optional().nullable(),
  googleProjectId: z.string().trim().min(1).max(160).optional().nullable(),
  fingerprintId: z.string().trim().min(1).max(160).optional().nullable(),
  machineId: antigravityMachineIdSchema.optional().nullable()
}).strict();

export const antigravityOAuthStartInputSchema = z.object({}).strict();

export const antigravityOAuthFinishInputSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  callbackUrl: z.string().trim().min(12).max(4096).optional().nullable()
}).strict();

export const antigravityOAuthCancelInputSchema = z.object({
  sessionId: z.string().trim().min(8).max(120)
}).strict();

export const antigravityCredentialImportSourceSchema = z.union([
  z.literal("token_json"),
  z.literal("local_files"),
  z.literal("cockpit"),
  z.literal("antigravity_tools"),
  z.literal("plugin"),
  z.literal("local_db")
]);

export const antigravityCredentialPayloadImportInputSchema = z.object({
  payload: z.string().min(20).max(2_000_000),
  source: antigravityCredentialImportSourceSchema.optional()
}).strict();

export const antigravityExternalImportInputSchema = z.object({
  source: z.union([
    z.literal("cockpit"),
    z.literal("antigravity_tools"),
    z.literal("plugin"),
    z.literal("local_db")
  ])
}).strict();
