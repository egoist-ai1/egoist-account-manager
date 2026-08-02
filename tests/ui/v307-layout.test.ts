import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve("src/renderer/v307.css"), "utf8");

describe("3.0.7 dense layout safeguards", () => {
  it("gives the labeled repair control its full grid track", () => {
    expect(source).toMatch(/\.profile-main \.row-actions\.card-actions \.icon-btn\.repair-action\.is-labeled\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  });

  it("lets account names use the available header width", () => {
    expect(source).toMatch(/\.profile-main \.profile-card-head \.account-label\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*text-overflow:\s*ellipsis;/s);
  });

  it("keeps both sides of long activity routes bounded", () => {
    expect(source).toContain("grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr)");
    expect(source).toMatch(/\.activity-v306 \.activity-account-route bdi,[\s\S]*?text-overflow:\s*ellipsis;/);
  });

  it("keeps minimum-window actions readable without shrinking icon targets", () => {
    expect(source).toContain("grid-template-columns: 36px 36px minmax(88px, 1fr) 36px");
    expect(source).toMatch(/\.profile-main \.row-actions\.card-actions\.has-repair \.switch-action\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;/s);
  });
});
