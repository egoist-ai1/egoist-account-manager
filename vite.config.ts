import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    // Renderer chunks are content-addressed. Keeping previous builds here makes
    // them part of app.asar even though index.html no longer references them.
    emptyOutDir: true
  },
  test: {
    // Hosted Windows runners are substantially slower for PowerShell, WMI and
    // native SQLite probes. Individual stress tests keep stricter own budgets.
    testTimeout: 30_000,
    hookTimeout: 30_000
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@renderer": path.resolve(__dirname, "src/renderer")
    }
  }
});
