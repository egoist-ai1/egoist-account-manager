import { FileUp, Loader2, X } from "lucide-react";
import type { AccountImportPreview, AppSettings } from "../../shared/types";
import { maskEmailForPrivacy } from "../../shared/privacyDisplay";

import { displayMetadata } from "../displayPrivacy";

export function ImportPreviewDialog({ preview, language, privacyMode, now, busy, onApply, onClose }: { preview: AccountImportPreview; language: AppSettings["language"]; privacyMode: boolean; now: number; busy: boolean; onApply: () => void; onClose: () => void }) {
  const en = language === "en";
  const expired = preview.expiresAt <= now;
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={en ? "Import preview" : "Предварительный импорт"}><div className="transfer-modal import-preview-modal">
    <div className="modal-head"><div><div className="panel-title">{en ? "Review profiles before import" : "Проверьте профили перед импортом"}</div><p className="muted">{en ? "Existing profiles and their credentials are preserved. The whole file has been validated." : "Существующие профили и данные входа сохраняются. Весь файл проверен."}</p></div><button className="icon-btn" disabled={busy} onClick={onClose} aria-label={en ? "Close" : "Закрыть"}><X /></button></div>
    <div className="import-summary"><span>{en ? "In file" : "В файле"}<strong>{preview.total}</strong></span><span>{en ? "New profiles" : "Новых профилей"}<strong>{preview.importableCount}</strong></span><span>{en ? "Skipped" : "Пропущено"}<strong>{preview.skippedCount}</strong></span></div>
    <div className="import-preview-list"><table><thead><tr><th>{en ? "Profile" : "Профиль"}</th><th>{en ? "Action" : "Действие"}</th></tr></thead><tbody>{preview.entries.map((entry, index) => <tr key={`${entry.platform}:${index}`}><td><strong>{displayMetadata(entry.label, privacyMode, language)}</strong><span>{entry.platform === "antigravity" ? "Antigravity" : "Codex"} · {privacyMode ? maskEmailForPrivacy(entry.email) : entry.email}</span></td><td><strong>{entry.action === "import" ? (en ? "Import" : "Импортировать") : (en ? "Skip" : "Пропустить")}</strong>{entry.reason ? <span>{displayMetadata(entry.reason, privacyMode, language)}</span> : null}</td></tr>)}</tbody></table></div>
    {expired ? <p className="form-error" role="alert">{en ? "The preview expired. Select the file again." : "Предварительный просмотр истёк. Выберите файл заново."}</p> : null}
    <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>{en ? "Cancel" : "Отмена"}</button><button className="button" disabled={busy || expired || preview.importableCount === 0} aria-busy={busy} onClick={onApply}>{busy ? <Loader2 className="spin" /> : <FileUp />}{en ? `Import ${preview.importableCount}` : `Импортировать ${preview.importableCount}`}</button></div>
  </div></div>;
}
