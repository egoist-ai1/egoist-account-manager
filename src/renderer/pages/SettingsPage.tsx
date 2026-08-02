import { ChevronDown, Gauge, RefreshCcw, ShieldCheck, SlidersHorizontal, Volume2, Zap } from "lucide-react";
import type { AppSettings } from "../../shared/types";
import { getUiText } from "../i18n";

const intervals: AppSettings["autoRefreshIntervalMs"][] = [180_000, 600_000, 900_000, 0];
const trayIntervals: AppSettings["trayRefreshIntervalMs"][] = [60_000, 180_000, 300_000, 600_000, 900_000, 0];

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

export function SettingsPage({
  settings,
  busy,
  onUpdate
}: {
  settings: AppSettings | null;
  busy?: boolean;
  onUpdate: (input: Partial<AppSettings>) => void;
}) {
  const disabled = !settings || Boolean(busy);
  const language = settings?.language ?? "ru";
  const uiText = getUiText(language);
  const isEnglish = language === "en";

  return (
    <section className="settings-v303" aria-label={uiText.nav.settings}>
      <header className="settings-v303-header">
        <div>
          <span>{isEnglish ? "BEHAVIOR" : "ПОВЕДЕНИЕ"}</span>
          <h2>{isEnglish ? "Only what matters" : "Только нужные настройки"}</h2>
          <p>{isEnglish ? "Stable defaults are already selected. Change only how the manager fits your workflow." : "Стабильные значения уже выбраны. Здесь осталось только то, что влияет на ежедневную работу."}</p>
        </div>
        <span className="settings-v303-mark"><SlidersHorizontal /></span>
      </header>

      <div className="settings-v303-grid">
        <section className="settings-group settings-group-primary">
          <div className="settings-group-title"><RefreshCcw /><div><strong>{isEnglish ? "Limits" : "Лимиты"}</strong><span>{isEnglish ? "Truthful background refresh" : "Фоновое обновление без лишней нагрузки"}</span></div></div>
          <div className="settings-item settings-item-stack">
            <div><strong>{uiText.settings.autoRefresh}</strong><span>{isEnglish ? "Failed requests back off automatically; the last good snapshot stays visible." : "После сбоя включается пауза, а последний корректный снимок остаётся на экране."}</span></div>
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
        </section>

        <section className="settings-group">
          <div className="settings-group-title"><ShieldCheck /><div><strong>{isEnglish ? "Session" : "Сессия"}</strong><span>{isEnglish ? "Safe switching and restart behavior" : "Безопасное переключение и запуск"}</span></div></div>
          <div className="settings-item">
            <div><strong>{isEnglish ? "Confirm switching" : "Подтверждать переключение"}</strong><span>{isEnglish ? "Prevents an accidental Codex restart." : "Защищает от случайного перезапуска Codex."}</span></div>
            <Toggle checked={settings?.confirmSwitch === true} disabled={disabled} label={isEnglish ? "Confirm switching" : "Подтверждать переключение"} onClick={() => onUpdate({ confirmSwitch: !settings?.confirmSwitch })} />
          </div>
          <div className="settings-item">
            <div><strong>{isEnglish ? "Start with Windows" : "Запускать вместе с Windows"}</strong><span>{isEnglish ? "Keeps session snapshots protected after sign-in." : "Менеджер сразу продолжит защищать снимки сессии."}</span></div>
            <Toggle checked={settings?.autostartEnabled === true} disabled={disabled} label={isEnglish ? "Start with Windows" : "Запускать вместе с Windows"} onClick={() => onUpdate({ autostartEnabled: !settings?.autostartEnabled })} />
          </div>
          <div className="settings-item settings-item-live-tray">
            <div><strong><Gauge />{isEnglish ? "Live quota indicator" : "Живой индикатор лимитов"}</strong><span>{isEnglish ? "A dynamic percentage by the clock; click it for both quota windows." : "Динамический процент рядом с часами; по клику — оба окна лимитов."}</span></div>
            <Toggle checked={settings?.trayEnabled === true} disabled={disabled} label={isEnglish ? "Live quota indicator" : "Живой индикатор лимитов"} onClick={() => onUpdate({ trayEnabled: !settings?.trayEnabled })} />
          </div>
          <div className={`settings-item settings-item-stack settings-tray-cadence ${settings?.trayEnabled ? "is-enabled" : ""}`}>
            <div><strong>{isEnglish ? "Active account cadence" : "Частота активного аккаунта"}</strong><span>{isEnglish ? "Only the active profile is checked; fleet refresh stays independent." : "Проверяется только активный профиль; общее обновление работает отдельно."}</span></div>
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
            <div><strong><Volume2 />{isEnglish ? "Notification sound" : "Звук уведомлений"}</strong><span>{isEnglish ? "A short in-app chime plays only for a result, warning or error." : "Короткий звук внутри приложения только для результата, предупреждения или ошибки."}</span></div>
            <Toggle checked={settings?.notificationSoundEnabled === true} disabled={disabled} label={isEnglish ? "Notification sound" : "Звук уведомлений"} onClick={() => onUpdate({ notificationSoundEnabled: !settings?.notificationSoundEnabled })} />
          </div>
        </section>

        <details className="settings-advanced">
          <summary><span><Zap />{isEnglish ? "Interface and advanced behavior" : "Интерфейс и дополнительные параметры"}</span><ChevronDown /></summary>
          <div className="settings-advanced-body">
            <div className="settings-item">
              <div><strong>{uiText.settings.language}</strong><span>{isEnglish ? "Interface language" : "Язык интерфейса"}</span></div>
              <div className="settings-segments compact" role="radiogroup" aria-label={uiText.settings.language}>
                <button role="radio" aria-checked={language === "ru"} className={language === "ru" ? "is-selected" : ""} disabled={disabled} onClick={() => onUpdate({ language: "ru" })}>RU</button>
                <button role="radio" aria-checked={language === "en"} className={language === "en" ? "is-selected" : ""} disabled={disabled} onClick={() => onUpdate({ language: "en" })}>EN</button>
              </div>
            </div>
            <div className="settings-item">
              <div><strong>{isEnglish ? "Privacy mode" : "Режим приватности"}</strong><span>{isEnglish ? "Masks emails and local paths." : "Скрывает email и локальные пути."}</span></div>
              <Toggle checked={settings?.privacyMode === true} disabled={disabled} label={isEnglish ? "Privacy mode" : "Режим приватности"} onClick={() => onUpdate({ privacyMode: !settings?.privacyMode })} />
            </div>
            <div className="settings-item settings-item-stack">
              <div><strong>{isEnglish ? "Codex close policy" : "Закрытие Codex при переключении"}</strong><span>{isEnglish ? "Automatic mode closes only the exact verified Codex process tree if graceful close times out." : "Автоматический режим завершает только заранее проверенное дерево процессов Codex, если мягкое закрытие не сработало."}</span></div>
              <div className="settings-segments">
                <button className={settings?.desktopClosePolicy === "exact-tree-fallback" ? "is-selected" : ""} disabled={disabled} onClick={() => onUpdate({ desktopClosePolicy: "exact-tree-fallback" })}>{isEnglish ? "Automatic" : "Автоматически"}</button>
                <button className={settings?.desktopClosePolicy === "graceful-only" ? "is-selected" : ""} disabled={disabled} onClick={() => onUpdate({ desktopClosePolicy: "graceful-only" })}>{isEnglish ? "Graceful only" : "Только мягко"}</button>
              </div>
            </div>
            <div className="settings-item">
              <div><strong>{isEnglish ? "Account suggestions" : "Советовать лучший аккаунт"}</strong><span>{isEnglish ? "Recommendations never switch accounts without your click." : "Рекомендация никогда не переключает аккаунт без нажатия."}</span></div>
              <Toggle checked={settings?.smartSwitchMode !== "off"} disabled={disabled} label={isEnglish ? "Account suggestions" : "Советовать лучший аккаунт"} onClick={() => onUpdate({ smartSwitchMode: settings?.smartSwitchMode === "off" ? "suggest" : "off" })} />
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
