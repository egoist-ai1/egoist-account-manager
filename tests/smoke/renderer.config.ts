import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const work = process.env.CAM_TEST_WORK_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "egoist-renderer-"));
const port = process.env.CAM_RENDERER_TEST_PORT ?? "4189";
export default defineConfig({
  testDir: ".", testMatch: ["renderer.spec.ts", "workflow-surfaces.spec.ts", "tray-popover.spec.ts", "dpi.spec.ts"], timeout: 30_000, workers: 1,
  outputDir: path.join(work, "playwright-results"), reporter: [["list"]],
  webServer: { command: "node tests/smoke/renderer-server.mjs", cwd: process.cwd(), env: { CAM_TEST_WORK_DIR: work, CAM_RENDERER_TEST_PORT: port }, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 60_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, channel: process.env.CAM_PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : "msedge"), headless: true, trace: "retain-on-failure" }
});
