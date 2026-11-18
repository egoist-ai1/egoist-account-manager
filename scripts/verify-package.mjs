import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAll } from "@electron/asar";

const projectRoot = process.cwd();
const sourcePackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const output = sourcePackage.build?.directories?.output ?? "release";
const asarPath = path.resolve(process.argv[2] ?? path.join(output, "win-unpacked", "resources", "app.asar"));
const sourceDist = path.join(projectRoot, "dist");
const scratch = fs.mkdtempSync(path.join(process.env.CAM_TEST_WORK_DIR ?? os.tmpdir(), "egoist-asar-verify-"));

function listFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  visit(root);
  return result;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

try {
  if (!fs.existsSync(asarPath)) throw new Error(`ASAR not found: ${asarPath}`);
  extractAll(asarPath, scratch);

  const packedDist = path.join(scratch, "dist");
  const sourceFiles = listFiles(sourceDist);
  const packedFiles = listFiles(packedDist);
  const sourceByRelative = new Map(sourceFiles.map((file) => [path.relative(sourceDist, file), sha256(file)]));
  const packedByRelative = new Map(packedFiles.map((file) => [path.relative(packedDist, file), sha256(file)]));
  const mismatches = [...sourceByRelative].filter(([relative, hash]) => packedByRelative.get(relative) !== hash).map(([relative]) => relative);
  const extras = [...packedByRelative.keys()].filter((relative) => !sourceByRelative.has(relative));

  const packedPackage = JSON.parse(fs.readFileSync(path.join(scratch, "package.json"), "utf8"));
  const rendererOnlyPackages = ["react", "react-dom", "lucide-react", "clsx", "date-fns", "@fontsource-variable/montserrat", "@fontsource-variable/unbounded"];
  const rendererPackagesBundled = rendererOnlyPackages.filter((name) => fs.existsSync(path.join(scratch, "node_modules", name)));
  const allPackedFiles = listFiles(scratch);
  const packedDependencyFiles = allPackedFiles.filter((file) => path.relative(scratch, file).startsWith(`node_modules${path.sep}`));
  const electronIsDevBundled = Boolean(packedPackage.dependencies?.["electron-is-dev"]);
  const rendererIndex = fs.readFileSync(path.join(sourceDist, "renderer", "index.html"), "utf8");
  const rendererAssets = fs.readdirSync(path.join(sourceDist, "renderer", "assets"));
  const rendererEntryAssets = rendererAssets.filter((name) => /^index-.*\.(?:js|css)$/.test(name));
  const referencedRendererEntryAssets = rendererEntryAssets.filter((name) => rendererIndex.includes(`./assets/${name}`));
  const orphanRendererEntryAssets = rendererEntryAssets.filter((name) => !referencedRendererEntryAssets.includes(name));
  const rendererEntryAssetSetIsClean = rendererEntryAssets.filter((name) => name.endsWith(".js")).length === 1
    && rendererEntryAssets.filter((name) => name.endsWith(".css")).length === 1
    && referencedRendererEntryAssets.length === rendererEntryAssets.length
    && orphanRendererEntryAssets.length === 0;
  const passed = mismatches.length === 0
    && extras.length === 0
    && sourceFiles.length === packedFiles.length
    && packedPackage.version === sourcePackage.version
    && !electronIsDevBundled
    && rendererPackagesBundled.length === 0
    && rendererEntryAssetSetIsClean;

  const report = {
    passed,
    asarPath,
    sourceFiles: sourceFiles.length,
    packedFiles: packedFiles.length,
    mismatches,
    extras,
    sourceVersion: sourcePackage.version,
    packedVersion: packedPackage.version,
    electronIsDevBundled,
    asarBytes: fs.statSync(asarPath).size,
    totalPackedFiles: allPackedFiles.length,
    packedDependencyFiles: packedDependencyFiles.length,
    packedDependencyBytes: packedDependencyFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
    rendererPackagesBundled,
    rendererEntryAssets,
    referencedRendererEntryAssets,
    orphanRendererEntryAssets,
    rendererEntryAssetSetIsClean
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
