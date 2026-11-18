import type { AccountPlatform, ManagedAccount } from "./types.js";
import { buildProviderQuotaState, formatQuotaRemaining, quotaWindowLabel } from "./providerAdapter.js";
import { getAccountQuotaSelection, getAccountReadiness } from "./smartSelection.js";
import type { ProviderLimitWindowType } from "./providerAdapter.js";

export type LiveTrayState = "empty" | "fresh" | "critical" | "stale" | "error" | "unknown";

export interface LiveTraySnapshot {
  state: LiveTrayState;
  accountId: string | null;
  accountLabel: string;
  remainingPercent: number | null;
  fiveHourRemaining: number | null;
  weeklyRemaining: number | null;
  activeWindowType: ProviderLimitWindowType | null;
  activeWindowResetAt: number | null;
  iconText: string;
  tooltip: string;
  updatedAt: number | null;
}

export interface PlatformTraySnapshot extends LiveTraySnapshot {
  platform: AccountPlatform;
  planType: string;
}

export interface DualLiveTraySnapshot {
  codex: PlatformTraySnapshot | null;
  antigravity: PlatformTraySnapshot | null;
  primary: PlatformTraySnapshot;
}

export const LIVE_TRAY_REPRESENTATIONS = [
  { scaleFactor: 1, pixelSize: 16 },
  { scaleFactor: 1.25, pixelSize: 20 },
  { scaleFactor: 1.5, pixelSize: 24 },
  { scaleFactor: 2, pixelSize: 32 }
] as const;

function clippedLabel(value: string, max = 26): string {
  const compact = value.trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function ageLabel(updatedAt: number | null, now: number, isEnglish: boolean): string {
  if (!updatedAt) return isEnglish ? "not updated" : "не обновлялось";
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60));
  if (minutes < 1) return isEnglish ? "just now" : "только что";
  if (minutes < 60) return isEnglish ? `${minutes} min ago` : `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  return isEnglish ? `${hours} h ago` : `${hours} ч назад`;
}

export function buildPlatformTraySnapshot(
  accounts: ManagedAccount[],
  platform: AccountPlatform,
  options: { now?: number; staleAfterSeconds?: number; privacyMode?: boolean; language?: "ru" | "en" } = {}
): PlatformTraySnapshot | null {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const isEnglish = options.language === "en";
  const active = accounts.find((account) => account.isActive && (account.platform ?? "codex") === platform) ?? null;
  if (!active) return null;

  const accountLabel = options.privacyMode
    ? (isEnglish ? "Selected profile" : "Выбранный профиль")
    : clippedLabel(active.label);
  const selection = getAccountQuotaSelection(active);
  const selectionIds = new Set(selection.windows.map(window => window.id));
  const readiness = getAccountReadiness(active, { now, staleAfterSeconds: options.staleAfterSeconds });
  const providerWindows = buildProviderQuotaState(active).windows
    .filter((window) => window.remaining !== null && selectionIds.has(window.id))
    .sort((left, right) => {
      const remainingOrder = (left.remaining ?? 101) - (right.remaining ?? 101);
      if (remainingOrder !== 0) return remainingOrder;
      const typeOrder = Number(left.windowType === "unknown") - Number(right.windowType === "unknown");
      if (typeOrder !== 0) return typeOrder;
      if (left.resetAt === null) return right.resetAt === null ? 0 : 1;
      if (right.resetAt === null) return -1;
      return left.resetAt - right.resetAt;
    });
  const fiveHourRemaining = providerWindows.find((window) => window.windowType === "5h")?.remaining ?? null;
  const weeklyRemaining = providerWindows.find((window) => window.windowType === "weekly")?.remaining ?? null;
  const activeWindow = providerWindows[0] ?? null;
  const remainingPercent = activeWindow?.remaining ?? null;
  const state: LiveTrayState = readiness.reason === "refresh_failed" || readiness.state === "needs_reauth"
    || (readiness.state === "unavailable" && (remainingPercent ?? 0) > 0)
    ? "error"
    : readiness.reason === "stale" || readiness.reason === "reset_passed"
      ? "stale"
      : remainingPercent === null || readiness.reason === "missing" || readiness.reason === "model_unknown"
        ? "unknown"
        : remainingPercent <= 10
          ? "critical"
          : "fresh";
  const locale = isEnglish ? "en" : "ru";
  const remainingLabel = formatQuotaRemaining(remainingPercent, locale);
  const iconText = state === "error" ? "!" : state === "stale" ? "~" : state === "unknown" ? "—" : remainingLabel.replace("%", "");
  const platformName = platform === "antigravity" ? "Antigravity" : "Codex";
  const activeWindowName = activeWindow?.windowType === "weekly"
    ? (isEnglish ? "current weekly quota" : "текущий недельный лимит")
    : activeWindow?.windowType === "5h"
      ? (isEnglish ? "current 5-hour quota" : "текущий 5-часовой лимит")
      : activeWindow?.windowDurationMins
        ? (isEnglish ? `current ${quotaWindowLabel(activeWindow.windowDurationMins, locale)} quota` : `текущий лимит (${quotaWindowLabel(activeWindow.windowDurationMins, locale)})`)
        : (isEnglish ? "current quota" : "текущий лимит");
  const status = state === "error"
    ? readiness.state === "needs_reauth"
      ? (isEnglish ? "check sign-in" : "нужно проверить вход")
      : readiness.reason === "blocked"
        ? (isEnglish ? "usage is unavailable" : "использование недоступно")
        : (isEnglish ? "refresh error" : "ошибка обновления")
    : state === "stale"
      ? readiness.reason === "reset_passed"
        ? (isEnglish ? "reset deadline passed; refresh required" : "срок сброса прошёл; нужно обновление")
        : (isEnglish ? "data is stale" : "данные устарели")
      : state === "unknown"
        ? (isEnglish ? "quota unavailable" : "лимиты недоступны")
        : `${activeWindowName} ${remainingLabel}`;
  const updatedAt = active.quotaSnapshot?.capturedAt ?? active.lastRefreshAt;
  const tooltip = [
    `Квессер · ${platformName} · ${accountLabel}`,
    activeWindow ? `${activeWindowName}: ${remainingLabel}${activeWindow.modelId || activeWindow.scope ? ` · ${activeWindow.modelId ?? activeWindow.scope}` : ""}` : (isEnglish ? "Current quota: —" : "Текущий лимит: —"),
    `${status} · ${ageLabel(updatedAt, now, isEnglish)}`,
    active.runtimeVerification?.runtime === "verified"
      ? (isEnglish ? "IDE runtime identity confirmed" : "Аккаунт работающей IDE подтверждён")
      : (isEnglish ? "IDE runtime account is not confirmed" : "Аккаунт работающей IDE не подтверждён")
  ].join("\n");

  return {
    platform,
    planType: active.planType,
    state,
    accountId: active.id,
    accountLabel,
    remainingPercent,
    fiveHourRemaining,
    weeklyRemaining,
    activeWindowType: activeWindow?.windowType ?? null,
    activeWindowResetAt: activeWindow?.resetAt ?? null,
    iconText,
    tooltip,
    updatedAt
  };
}

export function buildDualLiveTraySnapshot(
  accounts: ManagedAccount[],
  options: { now?: number; staleAfterSeconds?: number; privacyMode?: boolean; language?: "ru" | "en" } = {}
): DualLiveTraySnapshot {
  const codex = buildPlatformTraySnapshot(accounts, "codex", options);
  const antigravity = buildPlatformTraySnapshot(accounts, "antigravity", options);
  const primary = codex ?? antigravity ?? emptyPlatformSnapshot("codex", options.language);
  return { codex, antigravity, primary };
}

function emptyPlatformSnapshot(platform: AccountPlatform, language?: "ru" | "en"): PlatformTraySnapshot {
  const isEnglish = language === "en";
  return {
    platform,
    planType: "unknown",
    state: "empty",
    accountId: null,
    accountLabel: isEnglish ? "No selected profile" : "Профиль не выбран",
    remainingPercent: null,
    fiveHourRemaining: null,
    weeklyRemaining: null,
    activeWindowType: null,
    activeWindowResetAt: null,
    iconText: "—",
    tooltip: `Квессер · ${platform === "codex" ? "Codex" : "Antigravity"} · ${isEnglish ? "no selected profile" : "профиль не выбран"}`,
    updatedAt: null
  };
}

export function buildLiveTraySnapshot(
  accounts: ManagedAccount[],
  options: { now?: number; staleAfterSeconds?: number; privacyMode?: boolean; language?: "ru" | "en" } = {},
  platform?: AccountPlatform
): LiveTraySnapshot {
  if (platform) {
    return buildPlatformTraySnapshot(accounts, platform, options) ?? emptyPlatformSnapshot(platform, options.language);
  }
  const dual = buildDualLiveTraySnapshot(accounts, options);
  return dual.primary;
}

type Rgb = readonly [number, number, number];
type Point = readonly [number, number];
type Glyph = { width: number; strokes: readonly (readonly Point[])[] };
type TrayColorScheme = "dark" | "light";

// Координаты штрихов в логическом слоте 16×16, с общей высотой цифр 8.
const glyphs: Record<string, Glyph> = {
  "0": { width: 4.1, strokes: [[[2.05, 0], [3.2, 0.4], [3.9, 1.5], [4.1, 3], [4.1, 5], [3.9, 6.5],
    [3.2, 7.6], [2.05, 8], [0.9, 7.6], [0.2, 6.5], [0, 5], [0, 3], [0.2, 1.5], [0.9, 0.4], [2.05, 0]]] },
  "1": { width: 1.8, strokes: [[[0, 1.55], [1.8, 0], [1.8, 8]]] },
  "2": { width: 4.1, strokes: [[[0, 1.45], [0.8, 0.4], [2.05, 0], [3.35, 0.35], [4, 1.2], [4.1, 2.25],
    [3.65, 3.4], [0, 7.55], [0, 8], [4.1, 8]]] },
  "3": { width: 4.1, strokes: [[[0, 0.8], [0.95, 0.2], [2.15, 0], [3.3, 0.3], [3.95, 1.05], [4, 2.15],
    [3.55, 3.15], [2.55, 3.8], [1.55, 3.8]], [[2.55, 3.8], [3.65, 4.35], [4.1, 5.45], [4, 6.65],
    [3.3, 7.6], [2.05, 8], [0.9, 7.85], [0, 7.2]]] },
  "4": { width: 4.6, strokes: [[[3.4, 8], [3.4, 0], [0, 5.25], [0, 5.55], [4.6, 5.55]]] },
  "5": { width: 4.1, strokes: [[[3.9, 0], [0.5, 0], [0.2, 3.8], [1.1, 3.35], [2.5, 3.3], [3.55, 3.85],
    [4.05, 4.8], [4.1, 6.05], [3.6, 7.2], [2.6, 7.9], [1.3, 8], [0, 7.35]]] },
  "6": { width: 4.1, strokes: [[[3.8, 0.25], [2.55, 0], [1.35, 0.65], [0.55, 1.95], [0.1, 3.6], [0, 5.4],
    [0.35, 6.8], [1.15, 7.7], [2.2, 8], [3.25, 7.65], [3.95, 6.85], [4.1, 5.75], [3.95, 4.55],
    [3.25, 3.75], [2.2, 3.45], [1.05, 3.7], [0.1, 4.6]]] },
  "7": { width: 4.1, strokes: [[[0, 0], [4.1, 0], [1.1, 8]]] },
  "8": { width: 4.1, strokes: [[[2.05, 3.8], [0.85, 3.35], [0.2, 2.45], [0.2, 1.35], [0.95, 0.35], [2.05, 0],
    [3.15, 0.35], [3.9, 1.35], [3.9, 2.45], [3.25, 3.35], [2.05, 3.8], [0.75, 4.35], [0, 5.4],
    [0.1, 6.6], [0.85, 7.55], [2.05, 8], [3.25, 7.55], [4, 6.6], [4.1, 5.4], [3.35, 4.35], [2.05, 3.8]]] },
  "9": { width: 4.1, strokes: [[[0.3, 7.75], [1.55, 8], [2.75, 7.35], [3.55, 6.05], [4, 4.4], [4.1, 2.6],
    [3.75, 1.2], [2.95, 0.3], [1.9, 0], [0.85, 0.35], [0.15, 1.15], [0, 2.25], [0.15, 3.45],
    [0.85, 4.25], [1.9, 4.55], [3.05, 4.3], [4, 3.4]]] },
  "%": { width: 3.6, strokes: [[[0, 2.15]], [[0.2, 7.4], [3.4, 1.25]], [[3.6, 6.5]]] },
  "<": { width: 2.8, strokes: [[[2.8, 1.9], [0, 4], [2.8, 6.1]]] },
  "!": { width: 0, strokes: [[[0, 0], [0, 5.1]], [[0, 8]]] },
  "—": { width: 5, strokes: [[[0, 4], [5, 4]]] },
  "~": { width: 6, strokes: [[[0, 4.65], [1, 3.65], [2, 3.35], [3, 4], [4, 4.65], [5, 4.35], [6, 3.35]]] }
};

function strokeSegment(mask: Uint8Array, size: number, start: Point, end: Point, radius: number): void {
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const radiusSquared = radius * radius;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - radius));
  const maxX = Math.min(size - 1, Math.floor(Math.max(x1, x2) + radius));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - radius));
  const maxY = Math.min(size - 1, Math.floor(Math.max(y1, y2) + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const offsetX = x + 0.5 - x1;
      const offsetY = y + 0.5 - y1;
      const along = lengthSquared ? Math.max(0, Math.min(1, (offsetX * dx + offsetY * dy) / lengthSquared)) : 0;
      if ((offsetX - dx * along) ** 2 + (offsetY - dy * along) ** 2 <= radiusSquared) {
        mask[y * size + x] = 1;
      }
    }
  }
}

/** Рисует сглаженные штрихи в premultiplied BGRA для Electron nativeImage. */
export function renderLiveTrayBitmap(
  snapshot: LiveTraySnapshot,
  targetSize = 32,
  _platform: AccountPlatform = "codex",
  colorScheme: TrayColorScheme = "dark"
): Uint8Array {
  const critical = snapshot.state === "critical" || snapshot.state === "error";
  const ink: Rgb = colorScheme === "dark"
    ? (critical ? [255, 124, 132] : [248, 248, 248])
    : (critical ? [165, 25, 42] : [26, 26, 26]);
  const numeric = snapshot.state === "fresh" || snapshot.state === "critical";
  const text = numeric ? `${snapshot.iconText}%` : snapshot.iconText;
  const characters = [...text].map((character) => glyphs[character]).filter(Boolean);
  const spacing = 1.55;
  const advance = characters.reduce((sum, glyph) => sum + glyph.width + spacing, -spacing);
  const widthScale = advance > 13.35 ? 13.35 / advance : 1;
  const samples = 4;
  const sampleSize = targetSize * samples;
  const scale = sampleSize / 16;
  const mask = new Uint8Array(sampleSize * sampleSize);
  const radius = scale * 0.73 * Math.max(0.83, widthScale);

  let left = (16 - advance * widthScale) / 2;
  for (const glyph of characters) {
    for (const stroke of glyph.strokes) {
      const points = stroke.map(([x, y]): Point => [(left + x * widthScale) * scale, (y + 4) * scale]);
      strokeSegment(mask, sampleSize, points[0], points[0], radius);
      for (let point = 1; point < points.length; point += 1) {
        strokeSegment(mask, sampleSize, points[point - 1], points[point], radius);
      }
    }
    left += (glyph.width + spacing) * widthScale;
  }

  const bitmap = new Uint8Array(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      let coverage = 0;
      for (let row = 0; row < samples; row += 1) {
        for (let column = 0; column < samples; column += 1) {
          coverage += mask[(y * samples + row) * sampleSize + x * samples + column];
        }
      }
      const opacity = coverage / (samples * samples);
      const offset = (y * targetSize + x) * 4;
      bitmap[offset] = Math.round(ink[2] * opacity);
      bitmap[offset + 1] = Math.round(ink[1] * opacity);
      bitmap[offset + 2] = Math.round(ink[0] * opacity);
      bitmap[offset + 3] = Math.round(255 * opacity);
    }
  }
  return bitmap;
}
