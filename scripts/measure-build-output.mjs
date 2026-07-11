import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.resolve(projectRoot, process.env.NEXT_DIST_DIR || ".next-isolated");
const staticDir = path.join(distDir, "static");
const outputPath = path.resolve(
  projectRoot,
  process.env.BUNDLE_BASELINE_OUT || "artifacts/performance/build-output.json",
);

if (!distDir.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error("NEXT_DIST_DIR must resolve inside the project");
}

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (entry.isFile()) {
      const stat = await fs.stat(absolutePath);
      files.push({
        path: path.relative(distDir, absolutePath).replaceAll(path.sep, "/"),
        bytes: stat.size,
        extension: path.extname(entry.name).toLowerCase() || "none",
      });
    }
  }
  return files;
}

const files = await collectFiles(staticDir);
const bytesByExtension = {};
for (const file of files) {
  bytesByExtension[file.extension] = (bytesByExtension[file.extension] || 0) + file.bytes;
}

const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  scope: "static production output only",
  distDir: path.relative(projectRoot, distDir).replaceAll(path.sep, "/"),
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  bytesByExtension: Object.fromEntries(
    Object.entries(bytesByExtension).sort((a, b) => b[1] - a[1]),
  ),
  largestFiles: [...files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 15)
    .map(({ path: filePath, bytes }) => ({ path: filePath, bytes })),
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`Build output baseline written: ${path.relative(projectRoot, outputPath)}`);
