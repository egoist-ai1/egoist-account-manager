import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
const distPath = path.resolve(projectRoot, "dist");

if (path.dirname(distPath) !== projectRoot || path.basename(distPath) !== "dist") {
  throw new Error(`Refusing to clean unexpected build path: ${distPath}`);
}

fs.rmSync(distPath, { recursive: true, force: true });
process.stdout.write(`Cleaned build output: ${distPath}\n`);
