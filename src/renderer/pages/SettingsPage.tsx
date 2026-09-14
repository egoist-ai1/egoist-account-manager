import {
  FileDown,
  FolderOpen,
  Gauge,
  Globe,
  Lock,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  Volume2,
  Zap
} from "lucide-react";
import type { AntigravityProfileStatus, AppDiagnostics, AppSettings, ManagedAccount } from "../../shared/types";
import { getUiText } from "../i18n";

const intervals: AppSettings["autoRefreshIntervalMs"][] = [180_000, 600_000, 900_000, 0];
const trayIntervals: AppSettings["trayRefreshIntervalMs"][] = [60_000, 180_000, 300_000, 600_000, 900_000, 0];
const thresholdOptions: number[] = [5, 10, 15, 20];

function minutes(ms: number, language: AppSettings["language"]): string {
  if (ms === 0) return language === "en" ? "Off" : "Выкл";
  return language === "en" ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 60_000)} мин`;
}

function Toggle({
  checked,
  disabled,
  label,
  onClick
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`settings-switch ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export interface SettingsPageProps {
  settings: AppSettings | null;
  diagnostics?: AppDiagnostics | null;
  antigravityStatus?: AntigravityProfileStatus | null;
  accounts?: ManagedAccount[];
  busy?: boolean;
  godModeEnabled?: boolean;
  hygieneBusy?: boolean;
  onToggleGodMode?: (enabled: boolean) => void;
  onCleanHygiene?: () => void;
  onUpdate: (input: Partial<AppSettings>) => void;
  onSelectWorkspace?: () => void;
  onOpenLogViewer?: () => void;
  onExportDiagnosticReport?: () => void;
  displayPath?: (value: string | null | undefined, fallback?: string) => string;
}

export function SettingsPage({
  settings,
  diagnostics,
  antigravityStatus,
  accounts = [],
  busy,
  godModeEnabled = false,
  hygieneBusy = false,
  onToggleGodMode,
  onCleanHygiene,
  onUpdate,
  onSelectWorkspace,
  onOpenLogViewer,
  onExportDiagnosticReport,
  displayPath = (v, f = "не выбрана") => v ?? f
}: SettingsPageProps) {
  const disabled = !settings || Boolean(busy);
  const language = settings?.language ?? "ru";
  const uiText = getUiText(language);
  const isEnglish = language === "en";

  const capabilities = diagnostics?.codexCapabilities;
  const desktopLifecycle = diagnostics?.desktopLifecycle;
  const isCodexReady = capabilities?.protocol?.compatible === true;
  const isAgReady = antigravityStatus?.detected === true || accounts.some((a) => a.platform === "antigravity");

  return (
    <section className="settings-v303 settings-v4-unified" aria-label={uiText.nav.settings}>
      {/* Header */}
      <header className="settings-v303-header">
        <div>
          <span>{isEnglish ? "SYSTEM PREFERENCES" : "НАСТРОЙКИ СИСТЕМЫ"}</span>
          <h2>{isEnglish ? "Configuration & Runtime" : "Конфигурация и среда"}</h2>
        </div>
        <span className="settings-v303-mark">
          <SlidersHorizontal />
        </span>
      </header>

      {/* 4-Card Unified Grid */}
      <div className="settings-v303-grid settings-modern-grid">
        {/* Card 1: Limits & Sync */}
        <section className="settings-group settings-card-unified">
          <div className="settings-group-title">
            <RefreshCcw />
            <div>
              <strong>{isEnglish ? "Limits & Quota Sync" : "Лимиты и синхронизация"}</strong>
              <span>{isEnglish ? "Adaptive background polling" : "Фоновая синхронизация"}</span>
            </div>
          </div>

          <div className="settings-item settings-item-stack">
            <div>
              <strong>{uiText.settings.autoRefresh}</strong>
              <span>
                {isEnglish
                  ? "Adaptive background quota polling interval."
                  : "Интервал фонового обновления квот с адаптивной паузой."}
              </span>
            </div>
            <div className="settings-segments" role="radiogroup" aria-label={isEnglish ? "Auto-refresh interval" : "Интервал автообновления"}>
              {intervals.map((interval) => (
                <button
                  key={interval}
                  className={settings?.autoRefreshIntervalMs === interval ? "is-selected" : ""}
                  role="radio"
                  aria-checked={settings?.autoRefreshIntervalMs === interval}
                  disabled={disabled}
                  onClick={() => onUpdate({ autoRefreshIntervalMs: interval })}
                >
                  {minutes(interval, language)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-item">
            <div>
              <strong>{isEnglish ? "Account suggestions" : "Советовать лучший аккаунт"}</strong>
              <span>
                {isEnglish
                  ? "Suggests switching when active profile quota runs low."
                  : "Рекомендовать профиль с максимальным остатком лимитов."}
              </span>
            </div>
            <Toggle
              checked={settings?.smartSwitchMode !== "off"}
              disabled={disabled}
              label={isEnglish ? "Account suggestions" : "Советовать лучший аккаунт"}
              onClick={() => onUpdate({ smartSwitchMode: settings?.smartSwitchMode === "off" ? "suggest" : "off" })}
            />
          </div>

          {settings?.smartSwitchMode !== "off" && (
            <div className="settings-item settings-item-stack">
              <div>
                <strong>{isEnglish ? "Recommendation threshold" : "Порог рекомендации"}</strong>
                <span>
                  {isEnglish
                    ? "Suggest a switch when active quota drops below this percentage."
                    : "Порог остатка активного профиля для срабатывания подсказки."}
                </span>
              </div>
              <div className="settings-segments" role="radiogroup" aria-label={isEnglish ? "Suggestion threshold" : "Порог рекомендации"}>
                {thresholdOptions.map((pct) => (
                  <button
                    key={pct}
                    className={(settings?.smartSwitchThresholdPercent ?? 10) === pct ? "is-selected" : ""}
                    role="radio"
                    aria-checked={(settings?.smartSwitchThresholdPercent ?? 10) === pct}
                    disabled={disabled}
                    onClick={() => onUpdate({ smartSwitchThresholdPercent: pct })}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Card 2: Windows & System Tray */}
        <section className="settings-group settings-card-unified">
          <div className="settings-group-title">
            <Gauge />
            <div>
              <strong>{isEnglish ? "Desktop & System Tray" : "Windows и системный трей"}</strong>
              <span>{isEnglish ? "Background presence and tray indicator" : "Индикация квот и трей"}</span>
            </div>
          </div>

          <div className="settings-item">
            <div>
              <strong>{isEnglish ? "Start with Windows" : "Запускать вместе с Windows"}</strong>
              <span>
                {isEnglish
                  ? "Start minimized in the tray upon system sign-in."
                  : "Автозапуск в свёрнутом виде при старте Windows."}
              </span>
            </div>
            <Toggle
              checked={settings?.autostartEnabled === true}
              disabled={disabled}
              label={isEnglish ? "Start with Windows" : "Запускать вместе с Windows"}
              onClick={() => onUpdate({ autostartEnabled: !settings?.autostartEnabled })}
            />
          </div>

          <div className="settings-item settings-item-live-tray">
            <div>
              <strong>
                <Gauge />
                {isEnglish ? "Live quota indicator" : "Живой индикатор лимитов"}
              </strong>
              <span>
                {isEnglish
                  ? "Show active quota percentage in the Windows system tray."
                  : "Отображать процент квоты в системном трее рядом с часами."}
              </span>
            </div>
            <Toggle
              checked={settings?.trayEnabled === true}
              disabled={disabled}
              label={isEnglish ? "Live quota indicator" : "Живой индикатор лимитов"}
              onClick={() => onUpdate({ trayEnabled: !settings?.trayEnabled })}
            />
          </div>

          <div className={`settings-item settings-item-stack settings-tray-cadence ${settings?.trayEnabled ? "is-enabled" : ""}`}>
            <div>
              <strong>{isEnglish ? "Active account cadence" : "Частота проверки профиля"}</strong>
              <span>
                {isEnglish
                  ? "Polling interval for the active profile in the system tray."
                  : "Частота фонового опроса активного профиля для трея."}
              </span>
            </div>
            <div className="settings-segments settings-segments-six" role="radiogroup" aria-label={isEnglish ? "Live tray refresh interval" : "Интервал живого индикатора"}>
              {trayIntervals.map((interval) => (
                <button
                  key={interval}
                  className={settings?.trayRefreshIntervalMs === interval ? "is-selected" : ""}
                  role="radio"
                  aria-checked={settings?.trayRefreshIntervalMs === interval}
                  disabled={disabled || !settings?.trayEnabled}
                  onClick={() => onUpdate({ trayRefreshIntervalMs: interval })}
                >
                  {minutes(interval, language)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-item">
            <div>
              <strong>
                <Volume2 />
                {isEnglish ? "Notification sound" : "Звук уведомлений"}
              </strong>
              <span>
                {isEnglish
                  ? "Subtle audio cue on account switch and alerts."
                  : "Звуковое подтверждение при переключениях и оповещениях."}
              </span>
            </div>
            <Toggle
              checked={settings?.notificationSoundEnabled === true}
              disabled={disabled}
              label={isEnglish ? "Notification sound" : "Звук уведомлений"}
              onClick={() => onUpdate({ notificationSoundEnabled: !settings?.notificationSoundEnabled })}
            />
          </div>
        </section>

        {/* Card 3: Switch Safety & Behavior */}
        <section className="settings-group settings-card-unified">
          <div className="settings-group-title">
            <ShieldCheck />
            <div>
              <strong>{isEnglish ? "Switch Safety & Behavior" : "Безопасность переключений"}</strong>
              <span>{isEnglish ? "Session protection and lifecycle" : "Защита сессий"}</span>
            </div>
          </div>

          <div className="settings-item">
            <div>
              <strong>{isEnglish ? "Confirm switching" : "Подтверждать переключение"}</strong>
              <span>
                {isEnglish
                  ? "Prompt confirmation before switching active accounts."
                  : "Подтверждение перед переключением активного профиля."}
              </span>
            </div>
            <Toggle
              checked={settings?.confirmSwitch === true}
              disabled={disabled}
              label={isEnglish ? "Confirm switching" : "Подтверждать переключение"}
              onClick={() => onUpdate({ confirmSwitch: !settings?.confirmSwitch })}
            />
          </div>

          <div className="settings-item">
            <div>
              <strong>
                <Lock />
                {isEnglish ? "Privacy mode" : "Режим приватности"}
              </strong>
              <span>
                {isEnglish
                  ? "Mask emails and local workspace paths in the UI."
                  : "Маскировать email и персональные пути в интерфейсе."}
              </span>
            </div>
            <Toggle
              checked={settings?.privacyMode === true}
              disabled={disabled}
              label={isEnglish ? "Privacy mode" : "Режим приватности"}
              onClick={() => onUpdate({ privacyMode: !settings?.privacyMode })}
            />
          </div>

          <div className="settings-item settings-item-stack">
            <div>
              <strong>{isEnglish ? "Codex close policy" : "Закрытие Codex при переключении"}</strong>
              <span>
                {isEnglish
                  ? "Automatic graceful close with verified process fallback."
                  : "Мягкое закрытие с авто-завершением процесса при таймауте."}
              </span>
            </div>
            <div className="settings-segments">
              <button
                className={settings?.desktopClosePolicy === "exact-tree-fallback" ? "is-selected" : ""}
                disabled={disabled}
                onClick={() => onUpdate({ desktopClosePolicy: "exact-tree-fallback" })}
              >
                {isEnglish ? "Automatic" : "Автоматически"}
              </button>
              <button
                className={settings?.desktopClosePolicy === "graceful-only" ? "is-selected" : ""}
                disabled={disabled}
                onClick={() => onUpdate({ desktopClosePolicy: "graceful-only" })}
              >
                {isEnglish ? "Graceful only" : "Только мягко"}
              </button>
            </div>
          </div>

          {onSelectWorkspace && (
            <div className="settings-item settings-workspace-item">
              <div className="settings-workspace-info">
                <strong>{isEnglish ? "Codex workspace folder" : "Рабочая папка Codex"}</strong>
                <span className="settings-workspace-path" title={diagnostics?.workspacePath ?? undefined}>
                  {displayPath(diagnostics?.workspacePath, isEnglish ? "not selected" : "не выбрана")}
                </span>
              </div>
              <button className="button secondary compact-button" onClick={onSelectWorkspace} disabled={disabled}>
                <FolderOpen size={13} />
                <span>{isEnglish ? "Choose" : "Выбрать"}</span>
              </button>
            </div>
          )}
        </section>

        {/* Card 4: Runtime & Diagnostics */}
        <section className="settings-group settings-card-unified">
          <div className="settings-group-title">
            <TerminalSquare />
            <div>
              <strong>{isEnglish ? "Runtime & Diagnostics" : "Среда и диагностика"}</strong>
              <span>{isEnglish ? "Platform health and diagnostic exports" : "Статус сред, журнал и отчёты"}</span>
            </div>
          </div>

          <div className="settings-item">
            <div>
              <strong>
                <Globe />
                {uiText.settings.language}
              </strong>
              <span>{isEnglish ? "Interface language" : "Язык интерфейса"}</span>
            </div>
            <div className="settings-segments compact" role="radiogroup" aria-label={uiText.settings.language}>
              <button
                role="radio"
                aria-checked={language === "ru"}
                className={language === "ru" ? "is-selected" : ""}
                disabled={disabled}
                onClick={() => onUpdate({ language: "ru" })}
              >
                RU
              </button>
              <button
                role="radio"
                aria-checked={language === "en"}
                className={language === "en" ? "is-selected" : ""}
                disabled={disabled}
                onClick={() => onUpdate({ language: "en" })}
              >
                EN
              </button>
            </div>
          </div>

          {/* Platform Status Strip */}
          <div className="settings-item settings-item-stack">
            <div>
              <strong>{isEnglish ? "Platform health" : "Состояние официальных сред"}</strong>
              <span>
                {isEnglish
                  ? "Real-time readiness for Codex CLI and Antigravity IDE."
                  : "Готовность Codex CLI и локального профиля Antigravity IDE."}
              </span>
            </div>
            <div className="settings-health-badges">
              <div className={`health-badge-item ${isCodexReady ? "is-ok" : "is-warn"}`}>
                <div className="health-badge-header">
                  <span className="health-dot" />
                  <strong>Codex CLI</strong>
                </div>
                <span>
                  {capabilities?.cliVersion ?? (diagnostics?.codexPath ? (isEnglish ? "probing…" : "проверяется…") : (isEnglish ? "not found" : "не найден"))}
                </span>
                <small>
                  {desktopLifecycle?.selected?.version ? `Desktop ${desktopLifecycle.selected.version}` : (isEnglish ? "CLI session" : "CLI сессия")}
                </small>
              </div>

              <div className={`health-badge-item ${isAgReady ? "is-ok" : "is-warn"}`}>
                <div className="health-badge-header">
                  <span className="health-dot" />
                  <strong>Antigravity IDE</strong>
                </div>
                <span>
                  {isAgReady ? (isEnglish ? "Live session synced" : "Сессия синхронизирована") : (isEnglish ? "Not connected" : "Не подключён")}
                </span>
                <small>
                  {antigravityStatus?.diagnostics?.userDataDirExists ? "state.vscdb" : (isEnglish ? "IDE profile" : "Профиль IDE")}
                </small>
              </div>
            </div>
          </div>

          {/* Antigravity God Mode (Zero Confirmations) */}
          <div className="settings-item">
            <div>
              <strong>
                <Zap size={14} />
                {isEnglish ? "God Mode (Zero Confirmations)" : "Режим Бога (Zero Confirmations)"}
              </strong>
              <span>
                {isEnglish
                  ? "Suppresses IDE prompts, auto-allows commands, and disables telemetry."
                  : "Отключает подтверждения команд и телеметрию в Antigravity IDE."}
              </span>
            </div>
            <Toggle
              checked={godModeEnabled === true}
              disabled={disabled || !onToggleGodMode}
              label={isEnglish ? "God Mode" : "Режим Бога"}
              onClick={() => onToggleGodMode?.(!godModeEnabled)}
            />
          </div>

          {/* Context & Session Hygiene */}
          {onCleanHygiene && (
            <div className="settings-item settings-workspace-item">
              <div className="settings-workspace-info">
                <strong>{isEnglish ? "Context & Session Hygiene" : "Гигиена контекста и блокировок"}</strong>
                <span className="settings-workspace-path">
                  {isEnglish
                    ? "Purges stale lockfiles, crash dumps, and GPU shader caches."
                    : "Очистка зависших lockfile, кэшей и дампов сбоев."}
                </span>
              </div>
              <button
                className="button secondary compact-button"
                onClick={onCleanHygiene}
                disabled={disabled || hygieneBusy}
              >
                <Trash2 size={13} />
                <span>{hygieneBusy ? (isEnglish ? "Purging…" : "Очистка…") : (isEnglish ? "Clean" : "Очистить")}</span>
              </button>
            </div>
          )}

          {/* Diagnostics Actions */}
          <div className="settings-item settings-diagnostics-actions-item">
            <div>
              <strong>{isEnglish ? "Diagnostics & Logs" : "Журнал и диагностика"}</strong>
              <span>
                {isEnglish
                  ? "View live event logs or export a sanitized diagnostic report."
                  : "Просмотр системного журнала и сохранение отчёта без персональных данных."}
              </span>
            </div>
            <div className="settings-action-buttons">
              {onOpenLogViewer && (
                <button className="button secondary compact-button" disabled={busy} onClick={onOpenLogViewer}>
                  <TerminalSquare size={13} />
                  <span>{isEnglish ? "View log" : "Журнал"}</span>
                </button>
              )}
              {onExportDiagnosticReport && (
                <button className="button compact-button" disabled={busy} onClick={onExportDiagnosticReport}>
                  <FileDown size={13} />
                  <span>{isEnglish ? "Export report" : "Экспорт отчёта"}</span>
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
