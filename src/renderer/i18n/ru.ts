export const uiText = {
  nav: {
    dashboard: "Панель",
    accounts: "Аккаунты",
    limits: "Лимиты",
    vault: "Перенос",
    health: "Диагностика",
    settings: "Настройки"
  },
  actions: {
    refresh: "Обновить",
    refreshAll: "Обновить все",
    switchAccount: "Переключить",
    rollback: "Откатить",
    exportSelected: "Экспортировать выбранные",
    importAccounts: "Импортировать",
    deleteAccount: "Удалить",
    archiveAccount: "Архивировать",
    save: "Сохранить",
    cancel: "Отмена",
    retry: "Повторить",
    openLogs: "Открыть логи"
  },
  states: {
    loading: "Загрузка",
    emptyAccounts: "Аккаунты еще не добавлены",
    error: "Нужно внимание",
    success: "Готово",
    degradedSecurity: "Защита хранилища ограничена"
  },
  health: {
    title: "Диагностика",
    codexCli: "Codex CLI найден",
    codexDesktop: "Codex Desktop найден",
    database: "База данных",
    vault: "Хранилище",
    schema: "Версия схемы"
  },
  settings: {
    title: "Настройки",
    workspacePath: "Рабочая папка Codex",
    autoRefresh: "Автообновление лимитов",
    privacyMode: "Режим приватности",
    language: "Язык интерфейса"
  },
  inspector: {
    selectedProfile: "выбранный профиль",
    noProfileSelected: "Профиль не выбран",
    noProfileHelp: "Выбери аккаунт в списке, чтобы увидеть живой снимок лимитов и быстрые команды."
  }
} as const;
