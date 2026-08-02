import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildShortcutRefreshScript, getWindowsShortcutIconTargets } from "../../src/main/services/windowsShortcutIconService";

describe("WindowsShortcutIconService", () => {
  it("builds stable and versioned icon targets for Windows shortcuts", () => {
    const targets = getWindowsShortcutIconTargets({
      env: {
        APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
        USERPROFILE: "C:\\Users\\Test"
      },
      productName: "Egoist AI Manager",
      version: "1.9.3"
    });

    expect(targets?.stableIconPath).toBe(path.join("C:\\Users\\Test\\AppData\\Local", "Egoist AI Manager", "icon.ico"));
    expect(targets?.versionedIconPath).toBe(path.join("C:\\Users\\Test\\AppData\\Local", "Egoist AI Manager", "icon-1.9.3.ico"));
    expect(targets?.shortcuts).toContain(path.join("C:\\Users\\Test\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Egoist AI Manager.lnk"));
    expect(targets?.shortcuts).toContain(path.join("C:\\Users\\Test\\AppData\\Roaming", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", "Egoist AI Manager.lnk"));
  });

  it("escapes shortcut and icon paths in the PowerShell refresh script", () => {
    const script = buildShortcutRefreshScript(["C:\\Users\\Test\\O'Brien\\Egoist AI Manager.lnk"], "C:\\Icons\\icon-1.9.3.ico");

    expect(script).toContain("'C:\\Users\\Test\\O''Brien\\Egoist AI Manager.lnk'");
    expect(script).toContain("'C:\\Icons\\icon-1.9.3.ico,0'");
    expect(script).toContain("$shortcut.IconLocation = $icon");
  });
});
