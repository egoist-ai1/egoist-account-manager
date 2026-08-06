import type { ManagedAccount } from "./types.js";
import { buildQuotaFreshness, hasCurrentQuotaRefreshFailure } from "./quotaFreshness.js";
import { buildProviderQuotaState } from "./providerAdapter.js";
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

function quotaLabel(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

export function buildLiveTraySnapshot(
  accounts: ManagedAccount[],
  options: { now?: number; staleAfterSeconds?: number; privacyMode?: boolean; language?: "ru" | "en" } = {}
): LiveTraySnapshot {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const isEnglish = options.language === "en";
  const active = accounts.find((account) => account.isActive && account.platform === "codex")
    ?? accounts.find((account) => account.isActive)
    ?? null;
  if (!active) {
    return {
      state: "empty",
      accountId: null,
      accountLabel: isEnglish ? "No active account" : "Нет активного аккаунта",
      remainingPercent: null,
      fiveHourRemaining: null,
      weeklyRemaining: null,
      activeWindowType: null,
      activeWindowResetAt: null,
      iconText: "—",
      tooltip: isEnglish ? "Egoist Account Manager · no active account" : "Egoist Account Manager · активный аккаунт не выбран",
      updatedAt: null
    };
  }

  const accountLabel = options.privacyMode
    ? (isEnglish ? "Active profile" : "Активный профиль")
    : clippedLabel(active.label);
  const providerWindows = buildProviderQuotaState(active).windows
    .filter((window) => window.remaining !== null)
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
  const freshness = buildQuotaFreshness(active, {
    now,
    staleAfterSeconds: options.staleAfterSeconds ?? 15 * 60
  });
  const refreshFailed = hasCurrentQuotaRefreshFailure(active);
  const state: LiveTrayState = refreshFailed
    ? "error"
    : freshness.state === "stale"
      ? "stale"
      : remainingPercent === null
        ? "unknown"
        : remainingPercent <= 10
          ? "critical"
          : "fresh";
  const iconText = state === "error" ? "!" : state === "stale" ? "~" : state === "unknown" ? "—" : String(remainingPercent);
  const activeWindowName = activeWindow?.windowType === "weekly"
    ? (isEnglish ? "current weekly quota" : "текущий недельный лимит")
    : activeWindow?.windowType === "5h"
      ? (isEnglish ? "current 5-hour quota" : "текущий 5-часовой лимит")
      : (isEnglish ? "current quota" : "текущий лимит");
  const status = state === "error"
    ? (isEnglish ? "refresh error" : "ошибка обновления")
    : state === "stale"
      ? (isEnglish ? "data is stale" : "данные устарели")
      : state === "unknown"
        ? (isEnglish ? "quota unavailable" : "лимиты недоступны")
        : (isEnglish ? `${activeWindowName} ${remainingPercent}%` : `${activeWindowName} ${remainingPercent}%`);
  const tooltip = [
    `Egoist Account Manager · ${accountLabel}`,
    activeWindow ? `${activeWindowName}: ${quotaLabel(remainingPercent)}` : (isEnglish ? "Current quota: —" : "Текущий лимит: —"),
    `${status} · ${ageLabel(active.lastRefreshAt, now, isEnglish)}`
  ].join("\n");

  return {
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
    updatedAt: active.lastRefreshAt
  };
}

type Rgba = readonly [number, number, number, number];

const glyphs: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "010"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "!": ["010", "010", "010", "000", "010"],
  "—": ["000", "000", "111", "000", "000"],
  "~": ["000", "000", "101", "010", "000"],
  "·": ["000", "000", "000", "000", "010"]
};

function putPixel(buffer: Uint8Array, size: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  // Electron nativeImage.createFromBitmap expects Windows-style BGRA pixels.
  buffer[offset] = color[2];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[0];
  buffer[offset + 3] = color[3];
}

function fillRoundedSquare(buffer: Uint8Array, size: number, inset: number, radius: number, color: Rgba): void {
  const max = size - inset - 1;
  for (let y = inset; y <= max; y += 1) {
    for (let x = inset; x <= max; x += 1) {
      const nearestX = Math.max(inset + radius, Math.min(x, max - radius));
      const nearestY = Math.max(inset + radius, Math.min(y, max - radius));
      if ((x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2) putPixel(buffer, size, x, y, color);
    }
  }
}

function drawGlyphs(buffer: Uint8Array, size: number, text: string, color: Rgba): void {
  const chars = [...text].filter((character) => glyphs[character]);
  if (chars.length === 0) return;
  const edgeInset = Math.max(4, Math.round(size * (chars.length === 1 ? 0.16 : 0.065)));
  const widthUnits = chars.length * 3 + Math.max(0, chars.length - 1);
  const cell = Math.max(2, Math.floor(Math.min(
    (size - edgeInset * 2) / widthUnits,
    (size - edgeInset * 2) / 5
  )));
  const spacing = Math.max(1, Math.round(cell * .55));
  const width = chars.length * 3 * cell + (chars.length - 1) * spacing;
  const height = 5 * cell;
  let left = Math.round((size - width) / 2);
  const top = Math.round((size - height) / 2);
  for (const character of chars) {
    const glyph = glyphs[character];
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, columnIndex) => {
        if (pixel !== "1") return;
        for (let dy = 0; dy < cell; dy += 1) {
          for (let dx = 0; dx < cell; dx += 1) {
            putPixel(buffer, size, left + columnIndex * cell + dx, top + rowIndex * cell + dy, color);
          }
        }
      });
    });
    left += 3 * cell + spacing;
  }
}

function drawStatusRail(buffer: Uint8Array, size: number, color: Rgba): void {
  const height = Math.max(2, Math.round(size * 0.035));
  const inset = Math.round(size * 0.28);
  const top = size - Math.round(size * 0.12) - height;
  for (let y = top; y < top + height; y += 1) {
    for (let x = inset; x < size - inset; x += 1) putPixel(buffer, size, x, y, color);
  }
}

function downsampleBgra(source: Uint8Array, sourceSize: number, targetSize: number): Uint8Array {
  const target = new Uint8Array(targetSize * targetSize * 4);
  const scale = sourceSize / targetSize;
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const sums = [0, 0, 0, 0];
      let samples = 0;
      for (let sy = Math.floor(y * scale); sy < Math.floor((y + 1) * scale); sy += 1) {
        for (let sx = Math.floor(x * scale); sx < Math.floor((x + 1) * scale); sx += 1) {
          const sourceOffset = (sy * sourceSize + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += source[sourceOffset + channel];
          samples += 1;
        }
      }
      const targetOffset = (y * targetSize + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) target[targetOffset + channel] = Math.round(sums[channel] / samples);
    }
  }
  return target;
}

/** Renders a pixel-aligned BGRA representation for one Windows tray DPI scale. */
export function renderLiveTrayBitmap(snapshot: LiveTraySnapshot, targetSize = 32): Uint8Array {
  const scale = 4;
  const size = targetSize * scale;
  const buffer = new Uint8Array(size * size * 4);
  const palette = {
    fresh: { accent: [160, 119, 255, 255] as Rgba, surface: [18, 10, 34, 255] as Rgba },
    critical: { accent: [255, 177, 88, 255] as Rgba, surface: [34, 20, 10, 255] as Rgba },
    stale: { accent: [151, 147, 169, 255] as Rgba, surface: [18, 17, 24, 255] as Rgba },
    error: { accent: [255, 107, 145, 255] as Rgba, surface: [35, 12, 23, 255] as Rgba },
    unknown: { accent: [153, 144, 178, 255] as Rgba, surface: [17, 14, 26, 255] as Rgba },
    empty: { accent: [118, 107, 143, 255] as Rgba, surface: [15, 13, 21, 255] as Rgba }
  }[snapshot.state];
  const outerInset = Math.max(1, Math.round(size * 0.025));
  const outerRadius = Math.round(size * 0.22);
  fillRoundedSquare(buffer, size, outerInset, outerRadius, palette.surface);
  drawGlyphs(buffer, size, snapshot.iconText, [250, 249, 255, 255]);
  drawStatusRail(buffer, size, palette.accent);
  return downsampleBgra(buffer, size, targetSize);
}
