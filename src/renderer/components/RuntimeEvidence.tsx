import { CheckCircle2, Circle, RefreshCcw, ShieldAlert } from "lucide-react";
import type { AppSettings, SwitchVerificationEvidence } from "../../shared/types";
import { displayMetadata } from "../displayPrivacy";

export function runtimeLabel(evidence: SwitchVerificationEvidence | null | undefined, language: AppSettings["language"]): string {
  const en = language === "en";
  if (evidence?.runtime === "verified") return evidence.runtimeSource?.includes("email") ? (en ? "Runtime email confirmed" : "Email работающей IDE подтверждён") : (en ? "Runtime account confirmed" : "Аккаунт работающей IDE подтверждён");
  if (evidence?.runtime === "mismatch") return en ? "Runtime account mismatch" : "Аккаунт IDE не совпал";
  if (evidence?.runtime === "pending") return en ? "Checking the running IDE account" : "Проверяется аккаунт работающей IDE";
  return en ? "Running IDE account is unconfirmed" : "Аккаунт работающей IDE не подтверждён";
}

export function RuntimeEvidence({ evidence, language, selected, busy = false, onVerify, privacyMode = false }: { evidence?: SwitchVerificationEvidence | null; language: AppSettings["language"]; selected: boolean; busy?: boolean; onVerify?: () => void; privacyMode?: boolean }) {
  const en = language === "en";
  if (!selected && !evidence) return null;
  const label = runtimeLabel(evidence, language);
  const detail = evidence?.runtime !== "verified" && evidence?.message !== label ? evidence?.message : null;
  const launchLabel = evidence?.launch === "window_observed"
    ? (en ? "Application window opened" : "Окно приложения открыто")
    : (en ? "IDE process started" : "Процесс IDE запущен");
  const steps = [
    { label: en ? "Profile applied" : "Профиль применён", complete: evidence?.profileApplied === true },
    { label: en ? "Credentials checked" : "Вход проверен", complete: evidence != null && evidence.credentials !== "not_checked", detail: evidence?.credentialMethod },
    { label: launchLabel, complete: evidence != null && evidence.launch !== "not_requested" },
    { label: en ? "Runtime account confirmed" : "Аккаунт IDE подтверждён", complete: evidence?.runtime === "verified" }
  ];
  return <section className="runtime-evidence" aria-label={en ? "Switch verification levels" : "Уровни подтверждения переключения"}>
    <div className="runtime-evidence-head"><strong>{label}</strong>{selected && onVerify ? <button className="button secondary compact-button" disabled={busy} aria-busy={busy} onClick={onVerify}><RefreshCcw className={busy ? "spin" : ""} />{en ? "Check again" : "Проверить снова"}</button> : null}</div>
    {detail ? <p>{displayMetadata(detail, privacyMode, language)}</p> : null}
    <ol>{steps.map((step) => <li key={step.label} className={step.complete ? "is-confirmed" : ""}>{step.complete ? <CheckCircle2 /> : <Circle />}<span>{step.label}{step.detail ? <small>{displayMetadata(step.detail, privacyMode, language)}</small> : null}</span></li>)}</ol>
    {evidence?.runtime !== "verified" ? <p><ShieldAlert aria-hidden="true" />{en ? "Automatic switching is blocked until the running IDE account is confirmed." : "Автоматическое переключение заблокировано до подтверждения аккаунта работающей IDE."}</p> : null}
  </section>;
}
