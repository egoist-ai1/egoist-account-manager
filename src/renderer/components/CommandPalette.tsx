import { useRef } from "react";
import { Command, X } from "lucide-react";
import type { AppSettings } from "../../shared/types";
import type { CommandPaletteCommand } from "../../shared/commandPalette";
import { filterCommandPalette } from "../../shared/commandPalette";

export function firstAvailableCommand(commands: CommandPaletteCommand[], busy: string | null): CommandPaletteCommand | undefined {
  return busy === null ? commands.find((command) => !command.disabled) : undefined;
}

export function CommandPalette({ open, language, query, commands, busy, onQuery, onClose, onRun }: {
  open: boolean;
  language: AppSettings["language"];
  query: string;
  commands: CommandPaletteCommand[];
  busy: string | null;
  onQuery: (value: string) => void;
  onClose: () => void;
  onRun: (command: CommandPaletteCommand) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  if (!open) return null;
  const en = language === "en";
  const visible = filterCommandPalette(commands, query).slice(0, 18);
  const groups = Array.from(new Set(visible.map((command) => command.group)));
  const buttons = () => [...listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []];
  return <div className="modal-backdrop command-backdrop" role="dialog" aria-modal="true" aria-label={en ? "Command center" : "Командный центр"}>
    <div className="command-palette">
      <div className="command-search"><Command />
        <input ref={searchRef} value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); const command = firstAvailableCommand(visible, busy); if (command) onRun(command); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); (event.key === "ArrowDown" ? buttons()[0] : buttons().at(-1))?.focus(); }
        }} placeholder={en ? "Find a command, profile or action" : "Найти команду, профиль или действие"} aria-label={en ? "Find command" : "Поиск команды"} />
        <button className="icon-btn" aria-label={en ? "Close" : "Закрыть"} onClick={onClose}><X /></button>
      </div>
      <div ref={listRef} className="command-list" onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const available = buttons();
        const index = available.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        if (event.key === "ArrowUp" && index === 0) { searchRef.current?.focus(); return; }
        const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : event.key === "ArrowDown" ? (index + 1) % available.length : index - 1;
        available[next]?.focus();
      }}>
        {visible.length === 0 ? <div className="empty compact-empty">{en ? "No commands found." : "Команд не найдено."}</div> : null}
        {groups.map((group) => <section key={group} className="command-group">
          <span>{en ? ({ "Навигация": "Navigation", "Аккаунты": "Profiles", "Платформы": "Providers", "Лимиты": "Quotas", "Диагностика": "Diagnostics" })[group] : group === "Аккаунты" ? "Профили" : group}</span>
          {visible.filter((command) => command.group === group).map((command) => <button key={command.id} className="command-row" disabled={busy !== null || command.disabled} onClick={() => onRun(command)}><span><strong>{command.title}</strong><small>{command.subtitle}</small></span></button>)}
        </section>)}
      </div>
      <footer className="command-keyboard-hint"><span><kbd>↑</kbd><kbd>↓</kbd>{en ? "navigate" : "выбор"}</span><span><kbd>Enter</kbd>{en ? "run" : "выполнить"}</span><span><kbd>Esc</kbd>{en ? "close" : "закрыть"}</span></footer>
    </div>
  </div>;
}
