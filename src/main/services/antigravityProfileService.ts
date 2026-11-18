import type { AntigravityImportResult, AntigravityProfileStatus } from "../../shared/types.js";
import type { AntigravityPathInput } from "./antigravityPaths.js";
import { getAntigravityDiagnostics } from "./antigravityPaths.js";
import { extractAntigravityLocalIdentity, inspectAntigravityProfile } from "./antigravityProfileReader.js";

const localProfileReason =
  "Antigravity использует Windows Credential Manager. Для Antigravity IDE Квессер также проверяет запись локального профиля.";

export function getAntigravityProfileStatus(input: AntigravityPathInput = {}): AntigravityProfileStatus {
  const diagnostics = getAntigravityDiagnostics(input);
  const inspection = inspectAntigravityProfile(input);
  const detected = diagnostics.userDataDirExists
    || diagnostics.stateDbExists
    || diagnostics.storageJsonExists
    || diagnostics.machineIdExists
    || diagnostics.geminiDataDirExists
    || diagnostics.appStorageExists
    || diagnostics.installationIdExists;
  const ideWritableProfile = diagnostics.profileKind !== "hub"
    && diagnostics.stateDbExists
    && diagnostics.storageJsonExists
    && diagnostics.machineIdExists;
  const hubWritableProfile = (input.platform ?? process.platform) === "win32" && diagnostics.appStorageExists;

  return {
    detected,
    readyForWriteActions: diagnostics.profileKind === "hub" ? hubWritableProfile : ideWritableProfile,
    message: diagnostics.profileKind === "hub" && hubWritableProfile
      ? "Найден Antigravity. Квессер применит аккаунт через Windows Credential Manager и перезапустит приложение."
      : ideWritableProfile
        ? "Найден профиль Antigravity IDE. Квессер сохранит снимок и проверит запись перед запуском."
        : detected
          ? "Профиль Antigravity найден частично. Откройте приложение и войдите в аккаунт, чтобы завершить настройку профиля."
          : "Профиль Antigravity пока не найден на этой машине.",
    diagnostics,
    inspection,
    capabilities: {
      diagnostics: {
        supported: true,
        reason: null
      },
      importFromIde: {
        supported: detected,
        reason: detected ? null : "Локальный профиль Antigravity пока не найден"
      },
      switchAccount: {
        supported: hubWritableProfile || ideWritableProfile,
        reason: hubWritableProfile || ideWritableProfile ? localProfileReason : "Требуется настроенный профиль Antigravity"
      },
      refreshQuota: {
        supported: true,
        reason: "Google OAuth Antigravity accounts can refresh Code Assist model quotas"
      }
    }
  };
}

export function importAntigravityFromIde(input: AntigravityPathInput = {}): AntigravityImportResult {
  const status = getAntigravityProfileStatus(input);
  if (!status.detected) {
    return {
      imported: false,
      account: null,
      reason: "Локальный профиль Antigravity не найден. Сначала войди в официальном Antigravity или CLI.",
      status,
      identity: null
    };
  }
  const identity = extractAntigravityLocalIdentity(input);
  return {
    imported: false,
    account: null,
    reason: "Доступна metadata-only идентификация локального профиля Antigravity. Сохранение аккаунта выполняет AccountManager.",
    status,
    identity
  };
}
