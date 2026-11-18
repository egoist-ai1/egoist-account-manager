import { CircleDashed, Cloud, Sparkles } from "lucide-react";
import { productName } from "../../shared/branding";
import type { AppApi } from "../../shared/types";
import { useTrayState } from "../hooks/useTrayState";
import { runtimeLabel } from "./RuntimeEvidence";
import "../tray-hover.css";

type TrayState = ReturnType<typeof useTrayState>;

export function TrayQuotaSummary({ tray, surface }: { tray: TrayState; surface: "tray-hover" | "tray-live" }) {
  const Mark = tray.platform === "antigravity" ? Sparkles : tray.platform === "codex" ? Cloud : CircleDashed;
  const runtime = tray.active ? runtimeLabel(tray.active.runtimeVerification, tray.language) : null;
  const exactReset = tray.resetAt ? new Date(tray.resetAt * 1000) : null;

  return (
    <>
      <header className="tray-summary">
        <div className="tray-brand">
          <Mark size={21} aria-hidden="true" />
          <div className="tray-brand-text">
            <strong>{tray.platformName ?? productName}</strong>
            <span className="tray-status" role="status">{tray.stateLabel}</span>
          </div>
        </div>
        <div className={`${surface}-value tray-value`}>
          <span className="sr-only">{tray.isEnglish ? "Quota remaining" : "Остаток лимита"}: </span>
          <strong>{tray.displayValue}</strong>
        </div>
      </header>

      {!tray.loading && tray.platform ? (
        <div className="tray-metadata">
          <div className={`${surface}-identity tray-identity`}>
            <strong title={tray.accountTitle}>{tray.accountLabel}</strong>
            {tray.planLabel ? <span className="tray-plan" title={tray.planLabel}>{tray.planLabel}</span> : null}
          </div>
          {runtime ? <span className="tray-runtime-message" title={runtime}>{runtime}</span> : null}
        </div>
      ) : null}

      <section className={`${surface}-limit tray-limit`} aria-label={tray.isEnglish ? "Current quota" : "Текущий лимит"}>
        {tray.active ? (
          <div className="tray-limit-timing">
            <time dateTime={exactReset?.toISOString()} title={exactReset?.toLocaleString(tray.language)}>
              {tray.resetText}
            </time>
            {tray.countdown ? <span title={tray.isEnglish ? `Time until reset: ${tray.countdown}` : `До сброса: ${tray.countdown}`}>{tray.countdown}</span> : null}
          </div>
        ) : null}
        <i className="tray-progress-track" aria-hidden="true">
          <span style={{ width: `${tray.progressWidth}%` }} />
        </i>
      </section>
    </>
  );
}

export function TrayHoverPopover({ api }: { api: AppApi }) {
  const tray = useTrayState(api);
  return (
    <main
      className="tray-hover"
      data-status={tray.status}
      aria-label={tray.platformName ? `${productName} · ${tray.platformName}` : productName}
      aria-busy={tray.loading}
    >
      <TrayQuotaSummary tray={tray} surface="tray-hover" />
    </main>
  );
}
