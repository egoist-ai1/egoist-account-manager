import { defineConfig } from "@playwright/test";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const configuredWork = process.env.CAM_TEST_WORK_DIR?.trim() || undefined;
if (configuredWork && !path.isAbsolute(configuredWork)) throw new Error("CAM_TEST_WORK_DIR must be an absolute task work path");
const work = configuredWork ?? fs.mkdtempSync(path.join(os.tmpdir(), "egoist-canonical-smoke-"));
fs.mkdirSync(work, { recursive: true });
// Workers and Electron fixtures inherit the same owned work as the fixture server.
process.env.CAM_TEST_WORK_DIR = work;
const rendererOrigin = "http://127.0.0.1:4188";

export default defineConfig({
  testDir: "tests/smoke",
  testMatch: ["app.spec.ts", "renderer.spec.ts", "workflow-surfaces.spec.ts", "tray-popover.spec.ts", "dpi.spec.ts", "design-interactions.spec.ts"],
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: path.join(work, "canonical-smoke-results"),
  reporter: [["list"]],
  webServer: {
    command: "node tests/smoke/renderer-server.mjs",
    cwd: process.cwd(),
    env: { CAM_TEST_WORK_DIR: work, CAM_RENDERER_TEST_PORT: "4188" },
    url: rendererOrigin,
    reuseExistingServer: false,
    timeout: 120_000
  },
  use: {
    baseURL: rendererOrigin,
    // CI installs Playwright Chromium; local Windows uses the installed Edge.
    channel: process.env.CAM_PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" && !process.env.CI ? "msedge" : undefined),
    headless: true,
    trace: "retain-on-failure"
  }
});
