import type { AccountPlatform, ManagedAccount, SmartRecommendation } from "./types.js";

export type CommandPaletteGroup = "Навигация" | "Аккаунты" | "Платформы" | "Лимиты" | "Диагностика";
export type AppViewKey = "overview" | "accounts" | "activity" | "settings";

export type CommandPaletteAction =
  | "navigate:overview"
  | "navigate:accounts"
  | "navigate:activity"
  | "navigate:settings"
  | "login"
  | "refreshAll"
  | "switchBest"
  | "switchAccount"
  | "exportVault"
  | "openLogs"
  | "exportDiagnostics"
  | "filterPlatform";

export interface CommandPaletteCommand {
  id: string;
  group: CommandPaletteGroup;
  title: string;
  subtitle: string;
  keywords: string[];
  action: CommandPaletteAction;
  accountId?: string;
  view?: AppViewKey;
  platform?: AccountPlatform;
  disabled?: boolean;
}

export interface BuildCommandPaletteInput {
  accounts: ManagedAccount[];
  activeView: AppViewKey;
  smartRecommendation: SmartRecommendation | null;
  privacyMode?: boolean;
}

const navigation: Array<Pick<CommandPaletteCommand, "id" | "title" | "subtitle" | "keywords" | "action" | "view">> = [
  { id: "nav.overview", title: "Открыть обзор", subtitle: "Активный профиль, лимиты и готовность среды", keywords: ["обзор", "главная", "dashboard"], action: "navigate:overview", view: "overview" },
  { id: "nav.accounts", title: "Открыть аккаунты", subtitle: "Таблица, карточки и инспектор профиля", keywords: ["профили", "таблица", "accounts"], action: "navigate:accounts", view: "accounts" },
  { id: "nav.activity", title: "Открыть активность", subtitle: "Транзакции переключения и восстановление", keywords: ["активность", "история", "transactions"], action: "navigate:activity", view: "activity" },
  { id: "nav.settings", title: "Открыть настройки", subtitle: "Поведение приложения и рабочая папка", keywords: ["настройки", "режим", "settings"], action: "navigate:settings", view: "settings" }
];

function isSwitchTarget(account: ManagedAccount): boolean {
  return !account.isActive && !account.archived && account.status !== "limited" && account.status !== "error";
}

function searchText(command: CommandPaletteCommand): string {
  return [command.title, command.subtitle, command.group, ...command.keywords].join(" ").toLowerCase();
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "email скрыт";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function buildCommandPalette(input: BuildCommandPaletteInput): CommandPaletteCommand[] {
  const commands: CommandPaletteCommand[] = navigation.map((item) => ({
    ...item,
    group: "Навигация",
    disabled: item.view === input.activeView
  }));

  commands.push(
    {
      id: "account.login",
      group: "Аккаунты",
      title: "Добавить ChatGPT-профиль",
      subtitle: "Запустить вход через браузер или код устройства",
      keywords: ["добавить", "логин", "chatgpt", "device"],
      action: "login"
    },
    {
      id: "accounts.refreshAll",
      group: "Лимиты",
      title: "Обновить все лимиты",
      subtitle: "Запросить свежий статус по всем профилям",
      keywords: ["лимиты", "обновить", "refresh", "quota"],
      action: "refreshAll",
      disabled: input.accounts.length === 0
    },
    {
      id: "account.switchBest",
      group: "Аккаунты",
      title: "Переключить на лучший профиль",
      subtitle: input.smartRecommendation?.reason ?? "Нет свежей рекомендации",
      keywords: ["лучший", "умный", "авто", "switch"],
      action: "switchBest",
      accountId: input.smartRecommendation?.accountId,
      disabled: !input.smartRecommendation
    },
    {
      id: "platform.filter.antigravity",
      group: "Платформы",
      title: "Показать профили Antigravity",
      subtitle: "Открыть список профилей с фильтром по Antigravity",
      keywords: ["antigravity", "платформа", "профили", "фильтр"],
      action: "filterPlatform",
      view: "accounts",
      platform: "antigravity"
    },
    {
      id: "platform.filter.codex",
      group: "Платформы",
      title: "Показать профили Codex",
      subtitle: "Открыть список профилей с фильтром по Codex",
      keywords: ["codex", "платформа", "профили", "фильтр"],
      action: "filterPlatform",
      view: "accounts",
      platform: "codex"
    },
    {
      id: "diagnostics.antigravity",
      group: "Диагностика",
      title: "Диагностика Antigravity",
      subtitle: "Открыть аккаунты Antigravity и локальные действия проверки",
      keywords: ["antigravity", "state.vscdb", "storage", "machineid", "диагностика"],
      action: "filterPlatform",
      view: "accounts",
      platform: "antigravity"
    },
    {
      id: "accounts.export",
      group: "Аккаунты",
      title: "Экспортировать профили",
      subtitle: "Создать зашифрованный .cam-export",
      keywords: ["экспорт", "backup", "перенос"],
      action: "exportVault",
      disabled: input.accounts.length === 0
    },
    {
      id: "diagnostics.logs",
      group: "Диагностика",
      title: "Открыть журнал",
      subtitle: "Показать последние события приложения",
      keywords: ["журнал", "логи", "logs"],
      action: "openLogs"
    },
    {
      id: "diagnostics.export",
      group: "Диагностика",
      title: "Сохранить технический отчёт",
      subtitle: "Экспортировать JSON без секретов",
      keywords: ["отчёт", "данные", "health"],
      action: "exportDiagnostics"
    }
  );

  for (const account of input.accounts.filter(isSwitchTarget).slice(0, 12)) {
    const accountKeywords = input.privacyMode
      ? ["переключить", "аккаунт", account.label, account.planType, ...(account.tags ?? [])]
      : ["переключить", "аккаунт", account.label, account.email, account.planType, ...(account.tags ?? [])];

    commands.push({
      id: `account.switch.${account.id}`,
      group: "Аккаунты",
      title: `Переключить: ${account.label}`,
      subtitle: `${input.privacyMode ? maskEmail(account.email) : account.email} · нагрузка ${Math.max(account.fiveHourUsedPercent ?? 0, account.weeklyUsedPercent ?? 0).toFixed(0)}%`,
      keywords: accountKeywords,
      action: "switchAccount",
      accountId: account.id
    });
  }

  return commands;
}

export function filterCommandPalette(commands: CommandPaletteCommand[], query: string): CommandPaletteCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  return commands.filter((command) => searchText(command).includes(needle));
}
