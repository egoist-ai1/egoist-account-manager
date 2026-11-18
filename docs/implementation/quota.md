# Egoist 3.2.0-rc.1 — точность квот, готовность и подтверждения

Дата: 2026-10-06. Исходная точка: `d315ba12c9deb41ad380665a1c618563324bcaa1`. Версия этого результата: `quota-contract-rc1`. Это отчёт об исполненной части общего [контракта реализации](../implementation-3.2.0.md), а не подтверждение точности живых провайдеров или лидерства в benchmark.

## Что изменилось

| Проблема исходной версии | Поведение RC | Доказательство |
|---|---|---|
| Неизвестная квота могла выигрывать выбор профиля; устаревший reset не требовал нового наблюдения | Готовность требует известной применимой квоты не старше 15 минут. Прошедший reset возвращает `needs_refresh`, включая свежее старое наблюдение | [quotaAccuracyRegression.test.ts](../../tests/shared/quotaAccuracyRegression.test.ts), [smartSelection.test.ts](../../tests/shared/smartSelection.test.ts) |
| Один основной bucket скрывал остальные; исчерпание одной модели влияло на другую | Сохраняются все buckets, IDs, явный model slug, scope, периоды и provider flags. Codex aggregate отделён от metered aliases; Antigravity выбирает доступную независимую группу. Запрошенная заблокированная модель недоступна | [codexRpc.test.ts](../../tests/main/codexRpc.test.ts), [antigravityQuotaService.test.ts](../../tests/main/antigravityQuotaService.test.ts), [quotaAccuracyRegression.test.ts](../../tests/shared/quotaAccuracyRegression.test.ts) |
| Дробный положительный остаток округлялся до нуля; период выводился из расстояния до reset | В данных остаются floating values. Округляется только отображение: `null → —`, `0 < остаток < 1 → <1%`. Период берётся только из явного duration/window | [antigravityQuotaService.test.ts](../../tests/main/antigravityQuotaService.test.ts), [liveTray.test.ts](../../tests/shared/liveTray.test.ts) |
| Названия моделей, версии и цифры могли превращаться в тариф или повышенный приоритет | Тариф нормализуется только из явного provider plan. Неизвестные raw значения сохраняются. Сортировка признаёт точные известные/legacy ключи; цифры в произвольном названии не дают приоритета. Legacy названия не доказывают реальные множители квот | [codexRpc.test.ts](../../tests/main/codexRpc.test.ts), [accountListPresentation.test.ts](../../tests/shared/accountListPresentation.test.ts) |
| 403 выглядел как истёкшая авторизация; ошибки могли запускать повторные обходы окружений | Typed errors различают 401 / 403 / 429 и передают `Retry-After`. Эти статусы останавливают запрос сразу после headers, даже при зависшем body. 403/429/offline не аннулируют проверенные credentials | [antigravityGoogleAuthService.test.ts](../../tests/main/antigravityGoogleAuthService.test.ts), [accountManagerAuthValidation.test.ts](../../tests/main/accountManagerAuthValidation.test.ts) |
| Codex RPC сохранял code/data, но координатор не получал typed HTTP status | Явный `statusCode` 401/403/429 или HTTP/status-code строка преобразуются в `ProviderRequestError`. Исходные RPC code/data и retry-after сохраняются; посторонние номера моделей/версий не превращаются в HTTP status | [codexRpc.test.ts](../../tests/main/codexRpc.test.ts) |
| Успешная частичная квота могла потеряться при поиске второго окна | Первый успешный непустой ответ сохраняет все фактически полученные окна. Недостающие окна не придумываются и не добираются с последующим стиранием хороших данных | [antigravityQuotaService.test.ts](../../tests/main/antigravityQuotaService.test.ts) |
| Timeout оставлял запрос выполняться; фоновые context probes могли делать onboarding | Общие deadlines прерывают headers и body через `AbortController`. Есть внешний `signal`. Context read-only по умолчанию, максимум 4 запроса: daily/production, без sandbox. Onboarding требует явного `allowOnboarding: true` | [antigravityGoogleAuthService.test.ts](../../tests/main/antigravityGoogleAuthService.test.ts) |
| Custom OAuth client мог обновляться с чужим bundled secret | В validation и refresh применяется конфигурация, соответствующая сохранённому client ID. Неизвестный custom ID получает `clientSecret: null` | [antigravityGoogleAuthService.test.ts](../../tests/main/antigravityGoogleAuthService.test.ts) |
| Общий capability failure отключал независимые функции; cache оставался после смены CLI | Отдельные признаки initialize/account read/quota read/optional background parameter. Перед cache reuse проверяется версия установленного CLI. Смена версии меняет schema key. Internal/experimental login methods остаются обозначенными | [codexCapabilityService.test.ts](../../tests/main/codexCapabilityService.test.ts) |
| Tray мог сообщать об активном аккаунте, округлять tiny balance или показывать квоту другого провайдера | Egoist, «Выбран», отдельное подтверждение runtime. `unsupported` показывает «Аккаунт работающей IDE не подтверждён». Пустой Codex tray не подменяется Antigravity. Красный для ошибок/критического остатка, общий фиолетовый акцент | [liveTray.test.ts](../../tests/shared/liveTray.test.ts), [trayLabel.test.ts](../../tests/shared/trayLabel.test.ts) |
| Table/list/tray/alerts использовали разные readiness и model selection | Общие selection/readiness; last-good значения можно показать, но текущая ошибка/устаревание/reset исключают рекомендацию и свежие alerts | [accountListPresentation.test.ts](../../tests/shared/accountListPresentation.test.ts), [quotaAlertService.test.ts](../../tests/main/quotaAlertService.test.ts) |

## Общие контракты

В [smartSelection.ts](../../src/shared/smartSelection.ts):

- `getAccountQuotaWindows(account, { modelId? })` возвращает все применимые фактически известные окна с model/scope/label.
- `getAccountQuotaSelection(account, { modelId? })` возвращает окна, определяющие общий остаток. Для Antigravity без запроса модели выбирает известную доступную группу; это не утверждение о поддержке произвольной модели.
- `getAccountReadiness(account, { now?, staleAfterSeconds?, modelId? })` возвращает `state`, `reason`, `remainingPercent`, `canSwitchManually`, `canAutoSwitch`.
- Ручное применение доступно проверенным credentials независимо от отсутствующей runtime identity. Для автоматического решения текущий выбранный профиль требует `runtimeVerification.runtime === verified`, а target — свежей известной применимой квоты. Явно `ordinaryUsageAllowed: null` блокирует автоматическое решение.
- `rankSwitchCandidates`/`selectSmartAccount` принимают `provider` и `modelId`. Codex automatic selection по умолчанию исключает Antigravity.

В [providerAdapter.ts](../../src/shared/providerAdapter.ts) единые `formatQuotaRemaining` и `quotaWindowLabel`. Снимки `antigravity_api` получают отображаемый source `provider_api`, confidence `inferred`; local status и официальный Codex app-server остаются различимыми. Полный raw source сохранён в `quotaSnapshot`.

В [quotaRefreshError.ts](../../src/shared/quotaRefreshError.ts) `ProviderRequestError` содержит safe message, category, HTTP status, retry-after, `requiresReauth` и `retryable`. Координатор refresh/root сохраняет последний хороший snapshot отдельно от текущей ошибки и связывает ответ с account/version/epoch.

`readRateLimits({ excludeResetCreditDetails: true })` посылается только после feature check установленной схемы. Без параметра wire request сохраняет legacy форму. Экспериментальный `supportsLunaReserve` не включается фоновым polling. RPC error code/data не теряются; доказанные HTTP 401/403/429 ошибки проходят через общий `ProviderRequestError`, 401 требует повторной авторизации, 403/429 — нет. Дробный retry-after округляется вверх, чтобы не повторять запрос раньше срока.

## Изоляция и интеграция

[accountManagerAntigravity.test.ts](../../tests/main/accountManagerAntigravity.test.ts) и [accountManagerAuthValidation.test.ts](../../tests/main/accountManagerAuthValidation.test.ts) используют отдельные SQLite/Vault/profile fixtures, fake home/Codex home, in-memory Credential Manager, подставленные process/runtime/userinfo/quota adapters. Незаданные provider requests запрещены. Capability fixtures используют существующий dummy binary и injected command/RPC, без обнаружения пользовательского CLI. OAuth callback transport отдельно проверяется на loopback с искусственным provider response.

Подтверждены: vault-only imports без IDE/keyring attachment; local discovery не становится online proof; ручные credentials авторизуются только после совпадения online email и известного provider ID; runtime unsupported сохраняет применённый профиль и sealed snapshot; rollback возвращает предыдущий выбранный профиль. Hub write до поддержки формата отвергается до credential writes/restart.

Сценарий Desktop A / independent probe B проверяется напрямую: `verifyRuntimeAccount(Codex)` не вызывает `account/read` отдельного app-server, не заявляет B как Desktop identity и возвращает unsupported. Эта возможность остаётся заблокированной до верификации конкретной версии Desktop/runtime binding.

В ходе интеграции тесты выявили и помогли исправить две ошибки координатора: отсутствующий `unsealBackup` для защищённого writer и отсутствующее событие после фонового Antigravity refresh. Исходник координатора менял его отдельный владелец.

## Проверка и воспроизведение

Финальный целевой прогон 2026-10-06, 03:31 MSK: **17 test files / 181 tests passed**, 7.25 s. Scoped ESLint: exit 0, zero warnings. Native SQLite в этом прогоне использовал Node ABI. Electron/native shipping проверки и полный root suite учитываются отдельными receipts.

После последнего изменения Codex RPC отдельно перепроверены его transport/HTTP errors и общие quota-error/auth-state контракты: **3 test files / 21 tests passed**, 03:39 MSK, 571 ms; scoped ESLint exit 0, zero warnings. Это отдельный прогон после изменения, а не повторное заявление о полном наборе из 17 файлов.

```powershell
pnpm exec vitest run `
  tests/main/accountManagerAntigravity.test.ts tests/main/accountManagerAuthValidation.test.ts `
  tests/shared/accountListPresentation.test.ts tests/shared/liveTray.test.ts tests/shared/trayLabel.test.ts `
  tests/main/quotaAlertService.test.ts tests/shared/quotaAccuracyRegression.test.ts tests/shared/smartSelection.test.ts `
  tests/shared/providerAdapter.test.ts tests/shared/quotaFreshness.test.ts tests/shared/quotaRefreshError.test.ts `
  tests/shared/quotaRefreshMessage.test.ts tests/shared/authState.test.ts tests/main/codexRpc.test.ts `
  tests/main/codexCapabilityService.test.ts tests/main/antigravityQuotaService.test.ts `
  tests/main/antigravityGoogleAuthService.test.ts --maxWorkers=1
```

В этой Windows-среде проверка выполнена напрямую bundled Node через `node_modules/vitest/vitest.mjs`; TMP/TEMP направлены в собственный task work. Копирование пользовательских credentials, provider calls и запуск Desktop не требовались.

До исправлений проверяемые регрессии падали: 403 → expired, 99.6% usage → 100, потерянные typed 401/429, tiny tray balance/expired reset/unconfirmed runtime/provider substitution, stale-first sorting/digit plan heuristics, model-level spend flags. Финальный набор проходит после исправлений; это функциональное «до → после», не benchmark скорости.

## Источники и границы доказательства

Локальный первичный источник Codex: офлайн `app-server generate-json-schema` установленного CLI 0.160.0. В `GetAccountRateLimitsResponse` подтверждены response-level `accountId`/`ordinaryUsageAllowed`, snapshot `normalModelSlug`, spend flags/individual limit; в nullable params — `excludeResetCreditDetails`. Повторить на нужной версии можно без user credentials через `generate-json-schema --out <owned-directory>`.

Namespace `GetAccountRateLimitsResponse.accountId` схема не определяет. `account/read` для ChatGPT содержит type/email/planType, без subject ID в возвращаемом account; определение WorkspaceRouting не включено в этот response. Поэтому quota accountId сохраняется как opaque provider metadata и не сравнивается с Google subject или предполагаемым workspace ID. Привязку результата обеспечивает исходный managed account, credential version и operation epoch вместе с проверкой identity отдельного probe. Это не подтверждает аккаунт работающего Desktop.

| Проверенный файл | SHA-256 |
|---|---|
| Generated `GetAccountRateLimitsResponse.json` | `CB9655E68130116F634ED9353E45B336492E6069A6628F424D1CD52E54EDA0E0` |
| Generated `NullableGetAccountRateLimitsParams.json` | `072F813CA1C696831A7F2FBD934FEAA8CAD228A6B3D44A4BE8877547C796341B` |
| RC `smartSelection.ts` | `DDB2B5931E86747613F7EF12054BF809EB1FFCE4FD04C61C0B2D3C8C6BA546A2` |
| RC `codexRpc.ts` | `23A1E74CB4D46D4BB7EA3FD3B765CA8FC7003EEB7AE6608FFC31CB059894E0F8` |
| RC `accountListPresentation.ts` | `1E9FEA1A24332876D59AFA61F43B55C4B05E1ACE21FF60B7701F1776B6B1C726` |
| RC `antigravityQuotaService.ts` | `E05F342CF28F461C01B625A9566E52FEC9A85D664B846FC599F4957810276EB6` |
| RC `antigravityGoogleAuthService.ts` | `982DEE2799C26579FB6A9123CB96DF2B7060D82BC84B801BDF4A1DFE3B788580` |

Общий официальный OAuth контекст: [Google native app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app). Antigravity quota payloads остаются наблюдаемым internal API contract; сценарные fixtures и parsers не доказывают гарантий Google, соответствие каждой IDE версии, billing period или реальную подписку при unknown tier. Endpoint/version changes должны деградировать в unknown/error с сохранением last-good данных.

Не измерены этим worker: живые квоты/сбросы реальных аккаунтов, версия-specific Desktop runtime binding, сравнительные CPU/RAM/latency и стабильность shipping EXE в длительном soak. Никакого inference для измерения квот не запускалось.

Для companion review board общего результата отдельный объект: `quota-contract-rc1` — принять/отклонить/запросить пояснение этой проверенной реализации и оставить комментарий. Отсутствие ответа нейтрально; уже порученная реализация не ждёт дополнительного разрешения.
