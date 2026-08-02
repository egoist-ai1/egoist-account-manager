# Codex Account Manager — application map

## Actors and flows

- Пользователь добавляет или импортирует разрешённый профиль, отдельно видит сохранность входа и свежесть quotas, затем выбирает активный аккаунт.
- Switch flow: capture exact Codex lifecycle → staged auth activation → relaunch → runtime identity proof → commit или verified rollback.
- Session sync: распознанная активная Codex-сессия локально снимается в DPAPI-vault каждые 30 секунд и перед suspend/lock/quit; операция не запускает app-server и не управляет процессами Codex.
- Quota refresh: каждые 3 минуты выполняется non-rotating probe; последний успешный снимок сохраняется отдельно от transient transport error, exponential backoff подавляет повторный spam, а зависшие запросы ограничены timeout.
- Repair flow: validate sealed auth → repeat official quota probe → при provider revoke открыть device-code reauth того же профиля без удаления или дубля.
- Device-code flow: main копирует валидированный код → открывает официальный allowlisted URL → пользователь выбирает аккаунт и вставляет `Ctrl+V`; неизменённый код очищается по TTL или при выходе.
- Current-session/file import: renderer получает только sanitized preview; main определяет effective `CODEX_HOME`, проверяет identity/limits официальным app-server без forced refresh, принимает только стабильный regular `auth.json` до 1 MiB и сразу запечатывает его в DPAPI-vault. `keyring`/`auto`/`ephemeral` остаются linked-only и требуют нового официального входа для switchability.
- Overview показывает live quota/source/readiness и «План продолжения»: кандидат считается готовым только при защищённом входе, fresh official snapshot и известном минимальном остатке; stale/unknown/error профили получают явную причину и `—`, а не ложный `0%`. Accounts — 3×3 сетку при `1460×900` со статусом входа, планом, quota, компактным repair-key и внутренним scroll для следующих строк; инспектор сразу показывает все шесть действий без accordion, закрывается по `Escape` и возвращает keyboard focus; Activity — единый journal и четыре объяснённые стадии safety-chain без клиппинга; Settings оставляет только ежедневные параметры в естественном прокручиваемом потоке.
- Windows shell: branded toast сообщает о входе/импорте, фактических milestone переключения, rollback/failure и deduplicated quota threshold; промежуточные стадии бесшумны, результат/ошибка имеют системный звук, attribution/action открывают Manager, а ошибка custom XML автоматически переходит на native fallback. AppUserModelId, tray, shortcuts, installer и toast используют единый ICO/PNG, воспроизводимо собранный из ImageGen-master `assets/icon-3.0.6.png`.

## Implementation map

- `src/main/` — privileged lifecycle, vault, storage, diagnostics и IPC.
- `src/renderer/` — React UI; `v306.css` задаёт clarity-first visual system, `v307.css` фиксирует длинную identity, `v308.css` владеет device-code/card/inspector precision layer, `v309.css` — quota/continuation/process feedback, `v310.css` — viewport-fit, onboarding и labeled notification layer; `src/shared/` — contracts shared across process boundary.
- `scripts/generate-icons.mjs` собирает renderer/public PNG и многоразмерный ICO из alpha-master без ручной постобработки отдельных размеров.
- `tests/` и Playwright smoke — deterministic behavior/package evidence; `release/` — generated artifacts.

## States to preserve

- loading/refreshing/stale/current-error quotas, credential ready/needs reauth, active/recommended, archived, recovery required, switch phase, rollback и offline. Историческая ошибка старше свежего snapshot не является repair-state.
- Credential-store modes `file`, `keyring`, `auto`, `ephemeral` сохраняют fail-closed semantics; manager не переписывает пользовательский config.
