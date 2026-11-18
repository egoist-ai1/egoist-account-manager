import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveStoredUserData } from "../../src/main/services/storageIdentityService";

const roots: string[] = [];
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "kvesser-storage-")); roots.push(root); return root; }
function database(root: string, name: string, bytes: number) {
  const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "accounts.sqlite"), Buffer.alloc(bytes)); return folder;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("display brand changes preserve the existing vault location", () => {
  it("fresh install uses the stable storage name", () => {
    const root = fixture(); expect(resolveStoredUserData(root)).toBe(path.join(root, "Account Manager EGO"));
  });
  it.each(["Account Manager EGO", "Egoist Account Manager", "Egoist", "Codex Account Manager"])("keeps the populated %s vault without moving bytes", (name) => {
    const root = fixture(); const selected = database(root, name, 8192);
    const before = fs.readFileSync(path.join(selected, "accounts.sqlite"));
    expect(resolveStoredUserData(root)).toBe(selected);
    expect(fs.readFileSync(path.join(selected, "accounts.sqlite"))).toEqual(before);
    expect(fs.existsSync(path.join(root, "Квессер"))).toBe(false);
  });
  it("an empty stable database cannot hide a populated RC1 Egoist vault", () => {
    const root = fixture(); database(root, "Account Manager EGO", 4096);
    const selected = database(root, "Egoist", 8192); expect(resolveStoredUserData(root)).toBe(selected);
  });
  it("preserves stable preference when both locations contain accounts", () => {
    const root = fixture(); const selected = database(root, "Account Manager EGO", 8192);
    database(root, "Egoist", 16384); expect(resolveStoredUserData(root)).toBe(selected);
  });
});
