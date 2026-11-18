import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

const work = process.env.CAM_TEST_WORK_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "egoist-renderer-"));
fs.mkdirSync(work, { recursive: true });
const server = await createServer({ cacheDir: path.join(work, "vite-cache"), server: { host: "127.0.0.1", port: Number(process.env.CAM_RENDERER_TEST_PORT ?? "4189"), strictPort: true } });
await server.listen();
process.on("SIGTERM", () => { void server.close().finally(() => process.exit(0)); });
