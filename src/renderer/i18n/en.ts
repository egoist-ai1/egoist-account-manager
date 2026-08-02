import type { uiText } from "./ru";

type UiTextShape = {
  [Group in keyof typeof uiText]: {
    [Key in keyof typeof uiText[Group]]: string;
  };
};

export const uiTextEn: UiTextShape = {
  nav: {
    dashboard: "Dashboard",
    accounts: "Accounts",
    limits: "Limits",
    vault: "Transfer",
    health: "Diagnostics",
    settings: "Settings"
  },
  actions: {
    refresh: "Refresh",
    refreshAll: "Refresh all",
    switchAccount: "Switch",
    rollback: "Rollback",
    exportSelected: "Export selected",
    importAccounts: "Import",
    deleteAccount: "Delete",
    archiveAccount: "Archive",
    save: "Save",
    cancel: "Cancel",
    retry: "Retry",
    openLogs: "Open logs"
  },
  states: {
    loading: "Loading",
    emptyAccounts: "No accounts added yet",
    error: "Needs attention",
    success: "Ready",
    degradedSecurity: "Vault protection is limited"
  },
  health: {
    title: "Diagnostics",
    codexCli: "Codex CLI found",
    codexDesktop: "Codex Desktop found",
    database: "Database",
    vault: "Vault",
    schema: "Schema version"
  },
  settings: {
    title: "Settings",
    workspacePath: "Codex workspace",
    autoRefresh: "Limit auto-refresh",
    privacyMode: "Privacy mode",
    language: "Interface language"
  },
  inspector: {
    selectedProfile: "selected profile",
    noProfileSelected: "No profile selected",
    noProfileHelp: "Select an account to see live limits and quick actions."
  }
} as const;
