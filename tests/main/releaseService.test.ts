import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReleaseService } from "../../src/main/services/releaseService";

function tempReleaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cam-release-"));
}

function writeArtifact(dir: string, fileName: string, content: string) {
  fs.writeFileSync(path.join(dir, fileName), content, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

describe("ReleaseService", () => {
  it("reports missing release artifacts as not ready", () => {
    const releaseDir = tempReleaseDir();
    const service = new ReleaseService({
      projectRoot: path.dirname(releaseDir),
      releaseDir,
      version: "1.6.0",
      productName: "Codex Account Manager",
      packageConfig: { build: { win: { signAndEditExecutable: false, verifyUpdateCodeSignature: false } } },
      env: {}
    });

    const report = service.getReadiness();

    expect(report.ready).toBe(false);
    expect(report.summary).toContain("GitHub Releases ещё не настроен");
    expect(report.artifacts.every((artifact) => artifact.exists === false)).toBe(true);
  });

  it("matches SHA256SUMS entries for release files", () => {
    const releaseDir = tempReleaseDir();
    const setup = "Codex-Account-Manager-Setup-1.6.0.exe";
    const portable = "Codex-Account-Manager-1.6.0.exe";
    const latest = "latest.yml";
    const blockmap = "Codex-Account-Manager-Setup-1.6.0.exe.blockmap";
    const setupHash = writeArtifact(releaseDir, setup, "setup");
    const portableHash = writeArtifact(releaseDir, portable, "portable");
    const latestHash = writeArtifact(releaseDir, latest, "latest");
    const blockmapHash = writeArtifact(releaseDir, blockmap, "blockmap");
    fs.writeFileSync(
      path.join(releaseDir, "SHA256SUMS-1.6.0.txt"),
      `${setupHash}  ${setup}\n${portableHash}  ${portable}\n${latestHash}  ${latest}\n${blockmapHash}  ${blockmap}\n`,
      "utf8"
    );

    const report = new ReleaseService({
      projectRoot: path.dirname(releaseDir),
      releaseDir,
      version: "1.6.0",
      productName: "Codex Account Manager",
      packageConfig: { build: { publish: "https://updates.example.test", win: { signAndEditExecutable: true, signExecutable: true, verifyUpdateCodeSignature: true } } },
      env: {}
    }).getReadiness();

    expect(report.ready).toBe(true);
    expect(report.artifacts.filter((artifact) => artifact.checksumListed)).toHaveLength(5);
  });

  it("accepts a checksum-complete unsigned local release", () => {
    const releaseDir = tempReleaseDir();
    const files = [
      "Codex-Account-Manager-Setup-1.10.0.exe",
      "Codex-Account-Manager-1.10.0.exe",
      "latest.yml",
      "Codex-Account-Manager-Setup-1.10.0.exe.blockmap"
    ];
    const lines = files.map((fileName) => `${writeArtifact(releaseDir, fileName, fileName)}  ${fileName}`);
    fs.writeFileSync(path.join(releaseDir, "SHA256SUMS-1.10.0.txt"), `${lines.join("\n")}\n`, "utf8");

    const report = new ReleaseService({
      projectRoot: path.dirname(releaseDir),
      releaseDir,
      version: "1.10.0",
      productName: "Codex Account Manager",
      packageConfig: { build: { publish: [{ provider: "github" }], win: { signAndEditExecutable: false, verifyUpdateCodeSignature: false } } },
      env: {}
    }).getReadiness();

    expect(report.ready).toBe(true);
    expect(report.summary).toContain("ручной установки");
  });
});
