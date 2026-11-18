import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertManagedPath, getProfileDir } from "../../src/main/paths";
const dirs: string[] = [];
function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-paths-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { force: true, recursive: true }); });
describe("managed path containment", () => {
  it.each(["../foreign", "..\\foreign", "C:\\outside", "foo/bar", "NUL", "con", ".", "trailing "])('rejects profile ID %s', (id) => { expect(() => getProfileDir(tempDir(), id)).toThrow(/profile id/); });
  it("rejects an existing junction redirect and preserves the foreign target", () => {
    const root = tempDir(); const foreign = tempDir(); const profiles = path.join(root, "profiles");
    fs.mkdirSync(profiles); fs.writeFileSync(path.join(foreign, "auth.json"), "foreign-sentinel");
    fs.symlinkSync(foreign, path.join(profiles, "linked"), "junction");
    expect(() => getProfileDir(root, "linked")).toThrow(/reparse/);
    expect(() => assertManagedPath(profiles, path.join(profiles, "linked", "auth.json"))).toThrow(/reparse/);
    expect(fs.readFileSync(path.join(foreign, "auth.json"), "utf8")).toBe("foreign-sentinel");
  });
});
