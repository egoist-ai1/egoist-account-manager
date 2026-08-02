import type { AntigravityImportResult, AntigravityProfileStatus } from "../../shared/types.js";
import type { AntigravityPathInput } from "./antigravityPaths.js";
import { getAntigravityDiagnostics } from "./antigravityPaths.js";
import { extractAntigravityLocalIdentity, inspectAntigravityProfile } from "./antigravityProfileReader.js";

const localProfileReason =
  "Antigravity Hub применяет аккаунт через OS Credential Manager; старый state.vscdb используется только для legacy IDE-профилей.";

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
  const legacyWritableProfile = diagnostics.profileKind !== "hub"
    && diagnostics.stateDbExists
    && diagnostics.storageJsonExists
    && diagnostics.machineIdExists;

  return {
    detected,
    readyForWriteActions: legacyWritableProfile,
    message: diagnostics.profileKind === "hub" && detected
      ? "Найден Antigravity Hub. Авторизация применяется через Windows Credential Manager и перезапуск Antigravity; запись state.vscdb не требуется."
      : legacyWritableProfile
        ? "Локальный legacy-профиль Antigravity IDE найден. Доступна guarded-запись state.vscdb с резервной копией."
        : detected
          ? "Профиль Antigravity найден частично. Для Hub достаточно OS Credential Manager; для legacy IDE нужны state.vscdb, storage.json и machineid."
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
        supported: detected,
        reason: localProfileReason
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
