import { useCallback, useEffect, useState } from "react";
import type { AppApi, AppSettings } from "../../shared/types";

export interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  save: (input: Partial<AppSettings>) => Promise<AppSettings | null>;
  refresh: () => Promise<void>;
}

export function useSettings(api?: AppApi): SettingsState {
  const resolvedApi = api ?? window.cam;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!resolvedApi) {
      setLoading(false);
      setError("Мост приложения недоступен.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setSettings(await resolvedApi.getSettings());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить настройки.");
    } finally {
      setLoading(false);
    }
  }, [resolvedApi]);

  const save = useCallback(
    async (input: Partial<AppSettings>) => {
      if (!resolvedApi) {
        setError("Мост приложения недоступен.");
        return null;
      }

      setError(null);
      try {
        const next = await resolvedApi.updateSettings(input);
        setSettings(next);
        return next;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки.");
        return null;
      }
    },
    [resolvedApi]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, loading, error, save, refresh };
}
