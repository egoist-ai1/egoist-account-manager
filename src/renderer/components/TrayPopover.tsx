import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCcw, X } from "lucide-react";
import { productName } from "../../shared/branding";
import type { AccountPlatform, AppApi } from "../../shared/types";
import { useTrayState } from "../hooks/useTrayState";
import { TrayQuotaSummary } from "./TrayHoverPopover";
import "../tray-popover.css";

export function TrayPopover({ api }: { api: AppApi }) {
  const tray = useTrayState(api);
  const [refreshing, setRefreshing] = useState(false);
  const [failedRefresh, setFailedRefresh] = useState<{ platform: AccountPlatform; accountId?: string } | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.hideTrayPopover().catch(() => undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api]);

  const refreshLabel = tray.isEnglish ? "Refresh quota" : "Обновить лимит";
  const closeLabel = tray.isEnglish ? "Close" : "Закрыть";
  const accountId = tray.active?.id;
  const showRefreshError = failedRefresh?.platform === tray.platform && failedRefresh?.accountId === accountId;

  const handleRefresh = async () => {
    if (refreshing || !tray.platform) return;
    setRefreshing(true);
    setFailedRefresh(null);
    try {
      if (accountId) {
        await api.refreshAccount(accountId);
      } else {
        await api.refreshAllAccounts();
      }
      await tray.reload();
    } catch {
      setFailedRefresh({ platform: tray.platform, accountId });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <main
      className="tray-live"
      data-status={tray.status}
      role="dialog"
      aria-label={tray.platformName ? `${productName} · ${tray.platformName}` : productName}
      aria-busy={tray.loading}
    >
      <TrayQuotaSummary tray={tray} surface="tray-live" />
      {showRefreshError ? (
        <span className="tray-refresh-error" role="alert">
          {tray.isEnglish ? "Refresh failed. Previous data retained." : "Сбой обновления. Снимок сохранён."}
        </span>
      ) : null}
      <footer className="tray-live-footer">
        <button
          type="button"
          className="tray-btn-refresh"
          disabled={refreshing || tray.loading || !tray.platform}
          aria-busy={refreshing}
          onClick={() => void handleRefresh()}
          aria-label={refreshLabel}
          title={refreshLabel}
        >
          <RefreshCcw size={15} className={refreshing ? "spin" : ""} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="tray-btn-open"
          onClick={() => {
            void api.hideTrayPopover().catch(() => undefined);
            void api.showMainWindow().catch(() => undefined);
          }}
        >
          {productName}
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="tray-btn-close"
          onClick={() => void api.hideTrayPopover().catch(() => undefined)}
          aria-label={closeLabel}
          title={closeLabel}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </footer>
    </main>
  );
}
