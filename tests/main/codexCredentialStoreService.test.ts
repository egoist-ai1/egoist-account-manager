import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectCodexCredentialStore } from "../../src/main/services/codexCredentialStoreService";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-credential-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("inspectCodexCredentialStore", () => {
  it("treats the documented default and explicit file mode as compatible", () => {
    const codexHome = tempDir();
    expect(inspectCodexCredentialStore(codexHome)).toMatchObject({
      configuredMode: "unspecified",
      effectiveStore: "file",
      managerCompatible: true
    });

    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      'cli_auth_credentials_store = "file"\n',
      "utf8"
    );
    expect(inspectCodexCredentialStore(codexHome)).toMatchObject({
      configuredMode: "file",
      effectiveStore: "file",
      managerCompatible: true
    });
  });

  it("detects keyring mode without changing the user config", () => {
    const codexHome = tempDir();
    const config = '# user choice\ncli_auth_credentials_store = "keyring"\n';
    fs.writeFileSync(path.join(codexHome, "config.toml"), config, "utf8");

    expect(inspectCodexCredentialStore(codexHome)).toMatchObject({
      configuredMode: "keyring",
      effectiveStore: "keyring",
      managerCompatible: false
    });
    expect(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8")).toBe(config);
  });

  it("fails closed for auto mode even when a possibly stale auth.json exists", () => {
    const codexHome = tempDir();
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      'cli_auth_credentials_store = "auto"\n',
      "utf8"
    );
    expect(inspectCodexCredentialStore(codexHome)).toMatchObject({
      configuredMode: "auto",
      effectiveStore: "unknown",
      authJsonPresent: false,
      managerCompatible: false
    });

    fs.writeFileSync(path.join(codexHome, "auth.json"), "{}", "utf8");
    expect(inspectCodexCredentialStore(codexHome)).toMatchObject({
      configuredMode: "auto",
      effectiveStore: "unknown",
      authJsonPresent: true,
      managerCompatible: false
    });
  });

  it("fails closed for ephemeral sessions because no durable credential can be switched", () => {
    const codexHome = tempDir();
    fs.writeFileSync(path.join(codexHome, "config.toml"), 'cli_auth_credentials_store = "ephemeral"\n', "utf8");
    expect(inspectCodexCredentialStore(codexHome)).toMatchObject({
      configuredMode: "ephemeral",
      effectiveStore: "unknown",
      managerCompatible: false
    });
  });
});
