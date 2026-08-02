# Codex Account Manager — agent contract

Этот файл самодостаточен: сессия внутри проекта не должна зависеть от
`../../AGENTS.md` или от истории предыдущего чата.

## Scope and safety

- Наблюдаемый результат: Локальное Windows-приложение управляет разрешёнными Codex/Anti-Gravity профилями, показывает квоты и выполняет проверяемое переключение с rollback.
- Работайте только внутри этого проекта и сохраняйте unrelated changes.
- Answer/review/diagnose/plan остаются read-only; build/change/fix разрешают
  локальные правки и соразмерную проверку.
- Не печатайте secrets, tokens, private data и содержимое пользовательских
  хранилищ. External, destructive, release и publish actions требуют явного
  запроса.

## Entry

1. Прочитайте только этот `STATUS.md`.
2. Откройте активную spec/ticket и лишь нужную карту из `docs/`.
3. Подтвердите факты source/manifests/tests или свежей командой.
4. Не читайте статусы других проектов и не создавайте status выше этого корня.

### Context loadout

| Форма задачи | Дополнительный минимальный контекст |
| --- | --- |
| UI, экран или пользовательский flow | Активная spec/ticket, нужные строки `docs/CONTEXT.md`, `docs/APP_MAP.md` |
| Auth, switching, quotas или notifications | Активная spec/ticket, нужные строки `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, соответствующие tests |
| Build, package или release | `STATUS.md`, `docs/releases/<version>.md`, точный verification artifact |
| Future assisted switching или market research | CTX-004/CTX-005, `docs/research/seamless-switching-market-2026-08-02.md`, `docs/ROADMAP.md` |

## Commands

```powershell
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test:node
pnpm run build
```

## Continuity checkpoint

После каждого авторизованного write-task:

Непосредственно перед пунктом 1 перечитайте `STATUS.md` и
`docs/changes/INDEX.md`. Если другой writer уже продвинул их, объедините
новые факты и не стирайте его note/checks/blockers/next action.

1. Замените текущий снимок в `STATUS.md`; историю туда не дописывайте.
2. Обновите `docs/ARCHITECTURE.md`, `APP_MAP.md`, `ROADMAP.md`, specs,
   tickets или decisions только при изменении соответствующих фактов.
3. Добавьте одну immutable note в `docs/changes/` с UTC-именем: что, зачем,
   как, проверки, влияние на контракты, риски, файлы и следующий шаг.
4. Для выпущенной версии добавьте отдельный `docs/releases/<version>.md`.
5. Выполните
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-project-history.ps1 -ProjectPath . -Mode Apply -KeepRecent 10`.

Read-only задачи bookkeeping-файлы не меняют. Параллельные writers используют
разные worktrees или отдельные копии и согласуют `STATUS.md` при объединении.

## Project gotchas

- `better-sqlite3` требует раздельной пересборки для Node tests и Electron package.
- Auth/vault/export data чувствительны; не читать и не выводить реальные профили.
- Сохранять существующий dirty worktree; commit, tag, push и publish только по явному запросу.
