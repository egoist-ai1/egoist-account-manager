import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ReleaseArtifactKind, ReleaseArtifactStatus, ReleaseReadinessReport, UpdateCheckResult } from "../../shared/types.js";

interface ReleaseServiceOptions {
  projectRoot: string;
  version: string;
  productName: string;
  releaseDir?: string;
  packageConfig?: {
    build?: {
      publish?: unknown;
      win?: {
        signAndEditExecutable?: boolean;
        signExecutable?: boolean;
        verifyUpdateCodeSignature?: boolean;
      };
    };
  };
  env?: NodeJS.ProcessEnv;
}

const artifactNames: Array<{ kind: ReleaseArtifactKind; label: string; fileName: (version: string, productName: string) => string }> = [
  { kind: "installer", label: "Установщик NSIS", fileName: (version, productName) => `${productName.replace(/\s+/g, "-")}-Setup-${version}.exe` },
  { kind: "portable", label: "Portable EXE", fileName: (version, productName) => `${productName.replace(/\s+/g, "-")}-${version}.exe` },
  { kind: "latestYml", label: "Манифест обновлений", fileName: () => "latest.yml" },
  { kind: "blockmap", label: "Blockmap установщика", fileName: (version, productName) => `${productName.replace(/\s+/g, "-")}-Setup-${version}.exe.blockmap` },
  { kind: "checksums", label: "SHA256SUMS", fileName: (version) => `SHA256SUMS-${version}.txt` }
];

export class ReleaseService {
  private readonly releaseDir: string;

  constructor(private readonly options: ReleaseServiceOptions) {
    this.releaseDir = options.releaseDir ?? path.join(options.projectRoot, "release");
  }

  getReleaseDir(): string {
    return this.releaseDir;
  }

  getReadiness(): ReleaseReadinessReport {
    const checksums = this.readChecksums();
    const artifacts = artifactNames.map((artifact) => this.getArtifactStatus(artifact.kind, artifact.label, artifact.fileName(this.options.version, this.options.productName), checksums));
    const requiredReady = artifacts.every((artifact) => artifact.exists && (artifact.kind === "checksums" || artifact.checksumListed));
    const updateFeedConfigured = this.hasUpdateFeed();
    const signingEnabled = this.options.packageConfig?.build?.win?.signExecutable === true;
    const codeSignatureVerification = this.options.packageConfig?.build?.win?.verifyUpdateCodeSignature === true;
    const signed = signingEnabled && codeSignatureVerification;
    const ready = requiredReady;

    return {
      version: this.options.version,
      generatedAt: Math.floor(Date.now() / 1000),
      releaseDir: this.releaseDir,
      updateFeedConfigured,
      signingEnabled,
      codeSignatureVerification,
      ready,
      summary: ready
        ? signed && updateFeedConfigured
          ? "Релиз готов: артефакты, обновления и подпись настроены."
          : "Релиз готов: артефакты и SHA256 проверены; GitHub Releases используется для ручной установки без скрытого запуска EXE."
        : updateFeedConfigured
          ? "Релиз собран не полностью: проверь артефакты."
          : "Релиз собран локально, но GitHub Releases ещё не настроен.",
      artifacts
    };
  }

  checkForUpdates(): UpdateCheckResult {
    const feedUrl = this.getFeedUrl();
    if (!feedUrl) {
      return {
        status: "not_configured",
        message: "Канал обновлений пока не настроен. Сборка готова локально, автообновление включается после публикации feed URL.",
        feedUrl: null,
        checkedAt: Math.floor(Date.now() / 1000),
        version: null
      };
    }

    return {
      status: "checking",
      message: "Канал обновлений настроен. Приложение может читать GitHub Release feed.",
      feedUrl,
      checkedAt: Math.floor(Date.now() / 1000),
      version: null
    };
  }

  private getArtifactStatus(kind: ReleaseArtifactKind, label: string, fileName: string, checksums: Map<string, string>): ReleaseArtifactStatus {
    const artifactPath = path.join(this.releaseDir, fileName);
    const exists = fs.existsSync(artifactPath);
    const sizeBytes = exists ? fs.statSync(artifactPath).size : null;
    const sha256 = exists && fs.statSync(artifactPath).isFile() ? this.sha256(artifactPath) : null;
    const listedSha = checksums.get(fileName) ?? null;

    return {
      kind,
      label,
      fileName,
      path: artifactPath,
      exists,
      sizeBytes,
      sha256,
      checksumListed: kind === "checksums" ? exists : Boolean(sha256 && listedSha && listedSha === sha256)
    };
  }

  private readChecksums(): Map<string, string> {
    const checksumPath = path.join(this.releaseDir, `SHA256SUMS-${this.options.version}.txt`);
    const checksums = new Map<string, string>();
    if (!fs.existsSync(checksumPath)) return checksums;
    const content = fs.readFileSync(checksumPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (match) checksums.set(match[2], match[1].toLowerCase());
    }
    return checksums;
  }

  private sha256(filePath: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  }

  private hasUpdateFeed(): boolean {
    return Boolean(this.getFeedUrl());
  }

  private getFeedUrl(): string | null {
    const envUrl = this.options.env?.CAM_UPDATE_FEED_URL?.trim();
    if (envUrl) return envUrl;
    const publish = this.options.packageConfig?.build?.publish;
    if (!publish) return null;
    if (typeof publish === "string") return publish;
    if (Array.isArray(publish)) return publish.length > 0 ? "electron-builder publish" : null;
    return "electron-builder publish";
  }
}
