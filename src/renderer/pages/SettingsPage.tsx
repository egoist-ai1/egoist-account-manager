import { useState, type ReactNode } from "react";
import { ArrowLeftRight, Bell, ChevronDown, FileDown, FolderOpen, Gauge, Globe, Monitor, ShieldCheck, SlidersHorizontal, TerminalSquare } from "lucide-react";
import type { AntigravityProfileStatus, AppDiagnostics, AppSettings, ManagedAccount } from "../../shared/types";
import { getUiText } from "../i18n";
import "../settings-page.css";

const intervals: AppSettings["autoRefreshIntervalMs"][] = [180_000, 600_000, 900_000, 0];
const trayIntervals: AppSettings["trayRefreshIntervalMs"][] = [60_000, 180_000, 300_000, 600_000, 900_000, 0];
const thresholds = [5, 10, 15, 20];

function SettingRow({ label, description, icon, children }: { label: string; description?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="preferences-row">
      <div className="preferences-copy">
        <strong>{icon}{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className="preferences-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, disabled, label, onClick }: { checked: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className="preferences-switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick}>
      <span aria-hidden="true" />
    </button>
  );
}

function adjacentChoice(key: string, index: number, length: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

function Choices<T extends string | number>({ label, value, options, disabled, onChange }: {
  label: string;
  value: T | undefined;
  options: { value: T; text: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  return (
    <div className="preferences-choices" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const next = adjacentChoice(event.key, index, options.length);
            if (next === null) return;
            event.preventDefault();
            const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
            radios?.[next].focus();
            onChange(options[next].value);
          }}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

export interface SettingsPageProps {
  settings: AppSettings | null;
  diagnostics?: AppDiagnostics | null;
  antigravityStatus?: AntigravityProfileStatus | null;
  accounts?: ManagedAccount[];
  busy?: boolean;
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
  onUpdate,
  onSelectWorkspace,
  onOpenLogViewer,
  onExportDiagnosticReport,
  displayPath
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState("general");
  const language = settings?.language ?? "ru";
  const uiText = getUiText(language);
  const en = language === "en";
  const t = (english: string, russian: string) => en ? english : russian;
  const disabled = !settings || Boolean(busy);
  const minutes = (interval: number) => interval ? `${Math.round(interval / 60_000)} ${t("min", "мин")}` : t("Off", "Выкл");
  const codex = diagnostics?.codexCapabilities;
  const desktop = diagnostics?.desktopLifecycle?.selected;
  const hasCodex = codex?.protocol?.compatible === true;
  const hasAntigravity = antigravityStatus?.detected === true;
  const verifiedAntigravity = accounts.some((account) => account.platform === "antigravity" && account.isActive && account.runtimeVerification?.runtime === "verified");
  const workspaceFallback = t("Not selected", "Не выбрана");
  const configuredWorkspace = diagnostics?.workspacePath;
  const workspacePath = displayPath?.(configuredWorkspace, workspaceFallback)
    ?? (settings?.privacyMode && configuredWorkspace ? t("Path hidden", "Путь скрыт") : configuredWorkspace ?? workspaceFallback);
  const confirmLabel = t("Confirm switching", "Подтверждать переключение");
  const suggestionsLabel = t("Account suggestions", "Советовать лучший аккаунт");
  const trayLabel = t("Live quota indicator", "Живой индикатор лимитов");
  const privacyLabel = t("Privacy mode", "Режим приватности");
  const autostartLabel = t("Start with Windows", "Запускать вместе с Windows");
  const notificationLabel = t("Notification sound", "Звук уведомлений");

  const sections = [
    {
      key: "general", title: t("General", "Основные"), icon: SlidersHorizontal,
      content: <>
        <SettingRow label={uiText.settings.language} icon={<Globe aria-hidden="true" />}>
          <Choices label={uiText.settings.language} value={language} options={[{ value: "ru", text: "RU" }, { value: "en", text: "EN" }]} disabled={disabled} onChange={(value) => onUpdate({ language: value })} />
        </SettingRow>
        <SettingRow label={autostartLabel} description={t("Start minimized when you sign in.", "Запускать приложение свёрнутым при входе в систему.")} icon={<Monitor aria-hidden="true" />}>
          <Toggle checked={settings?.autostartEnabled === true} disabled={disabled} label={autostartLabel} onClick={() => onUpdate({ autostartEnabled: !settings?.autostartEnabled })} />
        </SettingRow>
        <SettingRow label={notificationLabel} description={t("Play a sound for account switches and alerts.", "Звук при переключении профиля и для уведомлений.")} icon={<Bell aria-hidden="true" />}>
          <Toggle checked={settings?.notificationSoundEnabled === true} disabled={disabled} label={notificationLabel} onClick={() => onUpdate({ notificationSoundEnabled: !settings?.notificationSoundEnabled })} />
        </SettingRow>
        <SettingRow label={privacyLabel} description={t("Mask email addresses and local paths in the interface.", "Скрывать адреса почты и персональные пути в интерфейсе.")} icon={<ShieldCheck aria-hidden="true" />}>
          <Toggle checked={settings?.privacyMode === true} disabled={disabled} label={privacyLabel} onClick={() => onUpdate({ privacyMode: !settings?.privacyMode })} />
        </SettingRow>
      </>
    },
    {
      key: "limits", title: t("Limits & taskbar", "Лимиты и панель задач"), icon: Gauge,
      content: <>
        <SettingRow label={uiText.settings.autoRefresh} description={t("Refresh profile limits in the background.", "Обновлять лимиты профилей в фоне.")}>
          <Choices label={t("Auto-refresh interval", "Интервал автообновления")} value={settings?.autoRefreshIntervalMs} options={intervals.map((value) => ({ value, text: minutes(value) }))} disabled={disabled} onChange={(value) => onUpdate({ autoRefreshIntervalMs: value })} />
        </SettingRow>
        <SettingRow label={trayLabel} description={t("Show Codex and Antigravity limits on the Windows taskbar.", "Показывать лимиты Codex и Antigravity на панели задач Windows.")}>
          <Toggle checked={settings?.trayEnabled === true} disabled={disabled} label={trayLabel} onClick={() => onUpdate({ trayEnabled: !settings?.trayEnabled })} />
        </SettingRow>
        <SettingRow label={t("Active profile refresh", "Обновление активного профиля")} description={t("How often the taskbar indicator requests limits.", "Частота обновления данных для индикатора.")}>
          <Choices label={t("Live tray refresh interval", "Интервал живого индикатора")} value={settings?.trayRefreshIntervalMs} options={trayIntervals.map((value) => ({ value, text: minutes(value) }))} disabled={disabled || !settings?.trayEnabled} onChange={(value) => onUpdate({ trayRefreshIntervalMs: value })} />
        </SettingRow>
        <SettingRow label={suggestionsLabel} description={t("Suggest another profile when remaining quota drops below the threshold.", "Предлагать профиль с большим остатком, когда лимит опустится ниже порога.")}>
          <Toggle checked={Boolean(settings && settings.smartSwitchMode !== "off")} disabled={disabled} label={suggestionsLabel} onClick={() => onUpdate({ smartSwitchMode: settings?.smartSwitchMode === "off" ? "suggest" : "off" })} />
        </SettingRow>
        {settings && settings.smartSwitchMode !== "off" && (
          <SettingRow label={t("Suggestion threshold", "Порог рекомендации")}>
            <Choices label={t("Suggestion threshold", "Порог рекомендации")} value={settings.smartSwitchThresholdPercent} options={thresholds.map((value) => ({ value, text: `${value}%` }))} disabled={disabled} onChange={(value) => onUpdate({ smartSwitchThresholdPercent: value })} />
          </SettingRow>
        )}
      </>
    },
    {
      key: "switching", title: t("Switching", "Переключение"), icon: ArrowLeftRight,
      content: <>
        <SettingRow label={confirmLabel} description={t("Ask before applying another profile.", "Запрашивать подтверждение перед применением другого профиля.")}>
          <Toggle checked={settings?.confirmSwitch === true} disabled={disabled} label={confirmLabel} onClick={() => onUpdate({ confirmSwitch: !settings?.confirmSwitch })} />
        </SettingRow>
        <SettingRow label={t("Codex close policy", "Закрытие Codex при переключении")} description={t("Automatic mode can stop a verified process after a timeout.", "В автоматическом режиме проверенный процесс можно завершить по таймауту.")}>
          <Choices
            label={t("Codex close policy", "Политика закрытия Codex")}
            value={settings?.desktopClosePolicy}
            options={[{ value: "exact-tree-fallback", text: t("Automatic", "Автоматически") }, { value: "graceful-only", text: t("Graceful only", "Только мягко") }]}
            disabled={disabled}
            onChange={(value) => onUpdate({ desktopClosePolicy: value })}
          />
        </SettingRow>
        {onSelectWorkspace && (
          <SettingRow label={t("Codex workspace folder", "Рабочая папка Codex")} description={workspacePath} icon={<FolderOpen aria-hidden="true" />}>
            <button type="button" className="button secondary" onClick={onSelectWorkspace} disabled={disabled}>{t("Choose", "Выбрать")}</button>
          </SettingRow>
        )}
      </>
    },
    {
      key: "diagnostics", title: t("Diagnostics", "Диагностика"), icon: TerminalSquare,
      content: <>
        <div className="preferences-health">
          <div className="preferences-health-card">
            <strong>Codex CLI</strong>
            <span className={hasCodex ? "is-ready" : codex?.protocol?.compatible === false ? "is-error" : ""}>
              <span className="preferences-health-dot" aria-hidden="true" />
              {hasCodex ? t("Ready", "Готов") : codex?.protocol?.compatible === false ? t("Compatibility check failed", "Проверка совместимости не пройдена") : diagnostics?.codexPath ? t("Checking", "Проверяется") : diagnostics ? t("Not found", "Не найден") : t("Waiting for diagnostics", "Ожидание диагностики")}
            </span>
          </div>
          <div className="preferences-health-card">
            <strong>Antigravity IDE</strong>
            <span className={hasAntigravity ? "is-ready" : ""}>
              <span className="preferences-health-dot" aria-hidden="true" />
              {verifiedAntigravity ? t("Runtime account confirmed", "Аккаунт запущенной IDE подтверждён") : hasAntigravity ? t("Local profile found", "Локальный профиль найден") : antigravityStatus ? t("Not connected", "Не подключён") : t("Waiting for diagnostics", "Ожидание диагностики")}
            </span>
          </div>
        </div>
        {(codex?.cliVersion || desktop?.version || hasAntigravity) && (
          <details className="preferences-details">
            <summary><ChevronDown aria-hidden="true" />{t("Technical details", "Технические сведения")}</summary>
            <dl>
              {codex?.cliVersion && <div><dt>Codex CLI</dt><dd>{codex.cliVersion}</dd></div>}
              {desktop?.version && <div><dt>Codex Desktop</dt><dd>{desktop.version}</dd></div>}
              {hasAntigravity && <div><dt>Antigravity IDE</dt><dd>{antigravityStatus?.diagnostics?.userDataDirExists ? "state.vscdb" : t("IDE profile", "Профиль IDE")}</dd></div>}
            </dl>
          </details>
        )}
        {(onOpenLogViewer || onExportDiagnosticReport) && (
          <SettingRow label={t("Logs and reports", "Журнал и отчёты")} description={t("Open the event log or save a report with personal data removed.", "Откройте журнал событий или сохраните отчёт без персональных данных.")}>
            <div className="preferences-actions">
              {onOpenLogViewer && <button type="button" className="button secondary" disabled={busy} onClick={onOpenLogViewer}><TerminalSquare aria-hidden="true" />{t("View log", "Журнал")}</button>}
              {onExportDiagnosticReport && <button type="button" className="button secondary" disabled={busy} onClick={onExportDiagnosticReport}><FileDown aria-hidden="true" />{t("Export report", "Экспорт отчёта")}</button>}
            </div>
          </SettingRow>
        )}
      </>
    }
  ];

  return (
    <section className="preferences" aria-label={uiText.nav.settings}>
      <header className="page-head preferences-heading">
        <h2>{t("Application preferences", "Настройки приложения")}</h2>
      </header>
      <div className="preferences-layout">
        <div className="preferences-nav" role="tablist" aria-label={t("Settings sections", "Разделы настроек")}>
          {sections.map(({ key, title, icon: Icon }, index) => (
            <button
              key={key}
              id={`preferences-tab-${key}`}
              type="button"
              role="tab"
              tabIndex={activeSection === key ? 0 : -1}
              aria-selected={activeSection === key}
              aria-controls={`preferences-panel-${key}`}
              onClick={() => setActiveSection(key)}
              onKeyDown={(event) => {
                const next = adjacentChoice(event.key, index, sections.length);
                if (next === null) return;
                event.preventDefault();
                const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
                tabs?.[next].focus();
                setActiveSection(sections[next].key);
              }}
            >
              <Icon aria-hidden="true" /><span>{title}</span>
            </button>
          ))}
        </div>

        <div className="preferences-main">
          {sections.map(({ key, title, content }) => (
            <section key={key} id={`preferences-panel-${key}`} className="preferences-panel" role="tabpanel" aria-labelledby={`preferences-tab-${key}`} hidden={activeSection !== key} aria-busy={Boolean(busy)}>
              <h3>{title}</h3>
              {content}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
