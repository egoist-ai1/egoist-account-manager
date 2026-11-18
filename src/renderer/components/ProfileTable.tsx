import { ArrowRightLeft, CheckCircle2, CircleDashed, Clock3, KeyRound, Layers3, Loader2, MoreHorizontal, RefreshCcw, Search, ShieldAlert, Star } from "lucide-react";
import { useRef } from "react";
import type { AppSettings, ManagedAccount } from "../../shared/types";
import { maskEmailForPrivacy } from "../../shared/privacyDisplay";
import { displayMetadata } from "../displayPrivacy";
import { profilePresentation } from "../profilePresentation";
import { runtimeLabel } from "./RuntimeEvidence";
import { PlatformMark } from "./PlatformMark";
import { useListMotion } from "../hooks/useSurfaceMotion";
import { usePreservedScroll, type ScrollPosition } from "../hooks/usePreservedScroll";
import "../profile-table.css";

export interface ProfileTableProps {
  accounts: ManagedAccount[];
  selectedId: string | null;
  now: number;
  language: AppSettings["language"];
  privacyMode: boolean;
  busy: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string, trigger: HTMLElement) => void;
  onRefresh: (id: string) => void;
  onRepair: (id: string) => void;
  onReauth: (id: string) => void;
  onSwitch: (id: string, trigger?: HTMLElement) => void;
  onAdd?: () => void;
  scrollPosition?: ScrollPosition;
}

export function ProfileTable({ accounts, selectedId, now, language, privacyMode, busy, onSelect, onInspect, onRefresh, onRepair, onReauth, onSwitch, onAdd, scrollPosition }: ProfileTableProps) {
  const en = language === "en";
  const tableRef = useRef<HTMLDivElement>(null);
  usePreservedScroll(tableRef, scrollPosition);
  useListMotion(tableRef, accounts.map((account) => account.id).join("|"));
  const focusId = accounts.some((account) => account.id === selectedId) ? selectedId : accounts[0]?.id;
  return <div ref={tableRef} className="profile-table-scroll"><table className="profile-table" aria-label={en ? "Profiles" : "Профили"}>
    <caption className="sr-only">{en ? "Arrow keys select a profile. Enter opens details. Use the Switch button to apply a profile." : "Стрелки выбирают профиль. Enter открывает подробности. Для применения профиля используйте кнопку «Переключить»."}</caption>
    <thead><tr><th scope="col">{en ? "Profile" : "Профиль"}</th><th scope="col">{en ? "Remaining" : "Остаток"}</th><th scope="col">{en ? "Freshness" : "Свежесть"}</th><th scope="col">{en ? "State" : "Состояние"}</th><th scope="col">{en ? "Actions" : "Действия"}</th></tr></thead>
    <tbody>{accounts.map((account, index) => {
      const view = profilePresentation(account, now, language);
      const label = displayMetadata(account.label, privacyMode, language);
      const windows = [...view.summaryWindows].sort((a, b) => a.remaining - b.remaining).slice(0, 2);
      const first = windows[0];
      const extraWindows = view.windows.length - windows.length;
      const extraWindowsCompact = view.windows.length - Math.min(windows.length, 1);
      const switchDisabled = busy !== null || (account.isActive && account.runtimeVerification?.runtime === "verified") || !view.readiness.canSwitchManually;
      const repair = account.credentialState !== "ready" || view.refreshFailed;
      const provider = account.platform === "antigravity" ? "antigravity" : "codex";
      const providerLabel = provider === "antigravity" ? "Antigravity" : "Codex";
      const authAction = repair ? (en ? "Repair profile" : "Восстановить профиль") : (en ? "Authorize again" : "Авторизовать заново");
      const runtime = account.runtimeVerification?.runtime;
      const { freshnessState } = view;
      const FreshnessIcon = freshnessState === "error" ? ShieldAlert : freshnessState === "stale" ? Clock3 : freshnessState === "fresh" ? CheckCircle2 : CircleDashed;
      return <tr key={account.id} data-profile-id={account.id} className={`${focusId === account.id ? "is-selected" : ""} ${account.isActive ? "is-applied" : ""}`} tabIndex={focusId === account.id ? 0 : -1} aria-selected={focusId === account.id} onClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; onSelect(account.id); event.currentTarget.focus(); }} onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter") { event.preventDefault(); onInspect(account.id, event.currentTarget); return; }
        const next = event.key === "ArrowDown" ? Math.min(index + 1, accounts.length - 1) : event.key === "ArrowUp" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? accounts.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); onSelect(accounts[next].id);
        const row = event.currentTarget.parentElement?.children[next];
        if (row instanceof HTMLElement) row.focus();
      }}>
        <th scope="row">
          <div className="table-profile">
            <PlatformMark platform={provider} />
            <div className="table-profile-text">
              <div className="table-profile-name">
                <strong title={label}>{label}</strong>
                {account.favorite ? <Star aria-label={en ? "Favorite" : "Избранное"} /> : null}
                {account.isActive ? <span className="selected-profile-chip">{en ? "Applied" : "Применён"}</span> : null}
                {account.archived ? <span className="badge compact">{en ? "Archived" : "Архив"}</span> : null}
              </div>
              <div className="table-profile-meta">
                <span className="table-profile-email" title={privacyMode ? undefined : account.email}>{privacyMode ? maskEmailForPrivacy(account.email) : account.email}</span>
                <span className="table-profile-plan">{providerLabel}{account.planType === "unknown" ? "" : ` · ${account.planType}`}</span>
              </div>
            </div>
          </div>
        </th>
        <td>
          <div className="table-quota-windows">
            {windows.length ? windows.map((window) => (
              <div key={window.id} className={`table-quota ${window.remaining < 10 ? "is-critical" : ""}`} title={privacyMode ? undefined : [window.title, window.modelId, window.scope].filter(Boolean).join(" · ")}>
                <span>{window.title}</span>
                <strong>{view.formatRemaining(window.remaining)}</strong>
                <div className="bar" aria-hidden="true"><span style={{ width: `${window.remaining}%` }} /></div>
              </div>
            )) : <div className="table-quota is-unknown"><span>{en ? "No quota data" : "Нет данных лимита"}</span><strong>—</strong></div>}
          </div>
          {extraWindowsCompact > 0 || first?.resetsAt ? <small className="table-quota-meta">
            {first?.resetsAt ? <span>{first.resetsAt <= now ? (en ? "Reset needs confirmation" : "Сброс требует проверки") : (en ? "Reset" : "Сброс") + " " + new Date(first.resetsAt * 1000).toLocaleTimeString(en ? "en-US" : "ru-RU", { hour: "2-digit", minute: "2-digit" })}</span> : null}
            {extraWindows > 0 ? <span className="table-quota-more">+{extraWindows} {en ? "in details" : "в подробностях"}</span> : null}
            {extraWindowsCompact > 0 ? <span className="table-quota-more-compact">+{extraWindowsCompact} {en ? "in details" : "в подробностях"}</span> : null}
          </small> : null}
        </td>
        <td>
          <span className={`table-freshness is-${freshnessState}`}><FreshnessIcon aria-hidden="true" />{view.freshness}</span>
          <small>{view.ageLabel}</small>
        </td>
        <td>
          {account.isActive ? (
            <span className={`table-runtime-message ${runtime === "mismatch" ? "is-error" : ""}`}>
              {runtime === "verified" ? <CheckCircle2 aria-hidden="true" /> : runtime === "mismatch" ? <ShieldAlert aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
              {runtimeLabel(account.runtimeVerification, language)}
            </span>
          ) : null}
          <span className={`table-credentials ${account.credentialState !== "ready" ? "is-error" : ""}`}>{view.credentialsLabel}</span>
          {!account.isActive && view.readiness.reason !== "ready" && view.readiness.reason !== "needs_reauth" ? <small>{en ? "Refresh before recommendation" : "Для рекомендации нужен свежий снимок"}</small> : null}
        </td>
        <td>
          <div className="table-actions" onClick={(event) => event.stopPropagation()}>
            <button className="icon-btn" disabled={busy !== null} aria-busy={busy === `refresh:${account.id}`} aria-label={en ? `Refresh ${label}` : `Обновить ${label}`} title={en ? "Refresh limits" : "Обновить лимиты"} onClick={() => onRefresh(account.id)}>
              {busy === `refresh:${account.id}` ? <Loader2 className="spin" /> : <RefreshCcw />}
            </button>
            <button className="icon-btn" disabled={busy !== null} aria-label={`${authAction}: ${label}`} title={authAction} onClick={() => repair ? onRepair(account.id) : onReauth(account.id)}>
              {busy === `repair:${account.id}` || busy === `reauth:${account.id}` ? <Loader2 className="spin" /> : <KeyRound />}
            </button>
            <button className="icon-btn" aria-label={en ? `Details for ${label}` : `Подробности ${label}`} title={en ? "Profile details" : "Подробности профиля"} onClick={(event) => onInspect(account.id, event.currentTarget)}><MoreHorizontal /></button>
            <button className={`profile-switch-action ${account.isActive ? "is-active" : ""}`} disabled={switchDisabled} aria-busy={busy === `switch:${account.id}`} onClick={(event) => onSwitch(account.id, event.currentTarget)}>
              {busy === `switch:${account.id}` ? <Loader2 className="spin" /> : account.isActive ? <CheckCircle2 /> : <ArrowRightLeft />}
              <span>{account.isActive ? account.runtimeVerification?.runtime === "verified" ? (en ? "Selected" : "Выбран") : (en ? "Reapply" : "Применить снова") : (en ? "Switch" : "Переключить")}</span>
            </button>
          </div>
        </td>
      </tr>;
    })}</tbody>
  </table>
  {accounts.length === 0 ? onAdd ? (
    <div className="empty-onboarding">
      <span className="empty-icon"><Layers3 aria-hidden="true" /></span>
      <strong>{en ? "No profiles yet" : "Профилей пока нет"}</strong>
      <span>{en ? "Add a profile using an official sign-in method." : "Добавьте профиль одним из официальных способов входа."}</span>
      <button className="button" disabled={busy !== null} onClick={onAdd}>{en ? "Add profile" : "Добавить профиль"}</button>
    </div>
  ) : (
    <div className="empty">
      <span className="empty-icon"><Search aria-hidden="true" /></span>
      <strong>{en ? "No matching profiles" : "Профили не найдены"}</strong>
      <span>{en ? "Change the search or provider filter." : "Измените запрос или фильтр провайдера."}</span>
    </div>
  ) : null}</div>;
}
