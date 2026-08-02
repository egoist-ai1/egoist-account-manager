import type { BrowserWindow } from "electron";
import { app, net, shell } from "electron";
import type { UpdateCheckResult } from "../../shared/types.js";

const repositoryUrl = "https://github.com/egoistgorbachev/codex-account-manager";
const releasesUrl = `${repositoryUrl}/releases`;
const latestReleaseApiUrl = "https://api.github.com/repos/egoistgorbachev/codex-account-manager/releases/latest";
const maximumReleaseResponseBytes = 256 * 1024;
const githubApiVersion = "2026-03-10";

type LogFn = (message: string, error?: unknown) => void;
type ElectronAppLike = { isPackaged: boolean; getVersion?: () => string };
type ReleaseHttpResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
type FetchRelease = (url: string, init: RequestInit) => Promise<ReleaseHttpResponse>;

interface UpdaterServiceOptions {
  app?: ElectronAppLike;
  fetchRelease?: FetchRelease;
  openExternal?: (url: string) => Promise<unknown>;
  onUpdateAvailable?: (result: UpdateCheckResult) => void;
  forceUpdateCheck?: boolean;
  updatesEnabled?: boolean;
}

type GithubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

export class UpdaterService {
  private lastResult: UpdateCheckResult | null = null;
  private checking = false;
  private readonly appRef: ElectronAppLike;
  private readonly fetchRelease: FetchRelease;
  private readonly openExternal: (url: string) => Promise<unknown>;
  private readonly forceUpdateCheck: boolean;
  private readonly updatesEnabled: boolean;
  private readonly onUpdateAvailable: ((result: UpdateCheckResult) => void) | null;
  private lastNotifiedVersion: string | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly log: LogFn,
    options: UpdaterServiceOptions = {}
  ) {
    this.appRef = options.app ?? app;
    this.fetchRelease = options.fetchRelease ?? ((url, init) => net.fetch(url, init) as Promise<ReleaseHttpResponse>);
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url));
    this.onUpdateAvailable = options.onUpdateAvailable ?? null;
    this.forceUpdateCheck = options.forceUpdateCheck ?? process.env.CAM_FORCE_UPDATE_CHECK === "1";
    this.updatesEnabled = options.updatesEnabled
      ?? (process.env.CAM_DISABLE_UPDATE_CHECK !== "1" && process.env.CAM_DISABLE_AUTO_UPDATE !== "1");
  }

  getLastResult(): UpdateCheckResult | null {
    return this.lastResult;
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    if (!this.updatesEnabled) {
      return this.setResult("not_configured", "Проверка обновлений отключена для этого запуска.", null, null);
    }
    if (!this.appRef.isPackaged && !this.forceUpdateCheck) {
      return this.setResult("not_configured", "GitHub Releases проверяется в собранной версии приложения.", null, null);
    }
    if (this.checking) {
      return this.lastResult ?? this.setResult("checking", "Проверка обновлений уже выполняется.", null, null);
    }

    this.checking = true;
    this.setResult("checking", "Проверяю последний стабильный релиз на GitHub.", null, null);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    try {
      const response = await Promise.race([
        this.fetchRelease(latestReleaseApiUrl, {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": githubApiVersion,
            "User-Agent": "Codex-Account-Manager"
          },
          redirect: "error",
          signal: controller.signal
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const timeoutError = new Error("GitHub Releases request timed out");
            timeoutError.name = "AbortError";
            reject(timeoutError);
          }, 20_000);
        })
      ]);
      if (!response.ok) throw new Error(`GitHub Releases ответил HTTP ${response.status}`);
      const declaredSize = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
      if (Number.isFinite(declaredSize) && declaredSize > maximumReleaseResponseBytes) {
        throw new Error("Ответ GitHub Releases превышает безопасный размер");
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > maximumReleaseResponseBytes) {
        throw new Error("Ответ GitHub Releases превышает безопасный размер");
      }
      const release = JSON.parse(body) as GithubRelease;
      if (release.draft === true || release.prerelease === true) {
        throw new Error("GitHub вернул не стабильный релиз");
      }
      const tag = parseStableVersionTag(release.tag_name);
      if (!tag) throw new Error("GitHub вернул неподдерживаемый номер версии");

      const current = this.appRef.getVersion?.() ?? process.env.npm_package_version ?? "0.0.0";
      const releasePage = `${releasesUrl}/tag/${encodeURIComponent(tag.raw)}`;
      if (isNewerVersion(tag.version, current)) {
        return this.setResult(
          "available",
          `Доступна версия ${tag.version}. Открой официальный релиз GitHub, чтобы скачать установщик.`,
          tag.version,
          releasePage
        );
      }
      return this.setResult(
        "not_available",
        `Установлена актуальная версия ${normalizeVersion(current) ?? current}.`,
        tag.version,
        releasesUrl
      );
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      const message = timedOut
        ? "Проверка GitHub Releases не завершилась за 20 секунд."
        : `Не удалось проверить GitHub Releases: ${error instanceof Error ? error.message : String(error)}`;
      return this.setResult("error", message, null, releasesUrl, error);
    } finally {
      if (timer) clearTimeout(timer);
      this.checking = false;
    }
  }

  async openUpdateRelease(): Promise<UpdateCheckResult> {
    let result = this.lastResult;
    if (!result || result.status !== "available") result = await this.checkForUpdates();
    if (result.status !== "available" || !isTrustedReleaseUrl(result.feedUrl)) return result;

    try {
      await this.openExternal(result.feedUrl);
      return this.setResult(
        "available",
        `Открыт официальный релиз ${result.version ?? "GitHub"}. Скачай установщик и запусти его.`,
        result.version,
        result.feedUrl
      );
    } catch (error) {
      return this.setResult(
        "error",
        `Не удалось открыть страницу релиза: ${error instanceof Error ? error.message : String(error)}`,
        result.version,
        releasesUrl,
        error
      );
    }
  }

  private setResult(
    status: UpdateCheckResult["status"],
    message: string,
    version: string | null,
    feedUrl: string | null,
    error?: unknown
  ): UpdateCheckResult {
    const result: UpdateCheckResult = {
      status,
      message,
      feedUrl,
      checkedAt: Math.floor(Date.now() / 1000),
      version,
      progressPercent: null
    };
    this.lastResult = result;
    this.log(`Release check: ${message}`, error);
    this.getWindow()?.webContents.send("release:updateStatus", result);
    if (status === "available" && version && version !== this.lastNotifiedVersion) {
      this.lastNotifiedVersion = version;
      this.onUpdateAvailable?.(result);
    }
    return result;
  }
}

function parseStableVersionTag(value: unknown): { raw: string; version: string } | null {
  if (typeof value !== "string") return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  const version = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
  return { raw: `v${version}`, version };
}

function normalizeVersion(value: string): string | null {
  return parseStableVersionTag(value)?.version ?? null;
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = normalizeVersion(candidate);
  const installed = normalizeVersion(current);
  if (!next || !installed) return false;
  const nextParts = next.split(".").map(Number);
  const installedParts = installed.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (nextParts[index] !== installedParts[index]) return nextParts[index] > installedParts[index];
  }
  return false;
}

function isTrustedReleaseUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && url.pathname.startsWith("/egoistgorbachev/codex-account-manager/releases/tag/v");
  } catch {
    return false;
  }
}
