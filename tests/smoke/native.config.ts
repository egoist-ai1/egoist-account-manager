import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const work = process.env.CAM_TEST_WORK_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "egoist-native-ui-"));
export default defineConfig({
  testDir: ".", testMatch: "app.spec.ts", timeout: 60_000, workers: 1,
  outputDir: path.join(work, "native-playwright-results"), reporter: [["list"]],
  use: { trace: "retain-on-failure" }
});
