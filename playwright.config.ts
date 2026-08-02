import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 60_000,
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4188 --strictPort",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: false,
    timeout: 120_000
  },
  use: {
    baseURL: "http://127.0.0.1:4188",
    trace: "retain-on-failure"
  }
});
