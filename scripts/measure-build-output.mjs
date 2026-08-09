import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const summaryOnly = process.argv.includes("--summary-only");
const distDir = path.resolve(projectRoot, process.env.NEXT_DIST_DIR?.trim() || ".next");
const staticDir = path.join(distDir, "static");
const buildIdPath = path.join(distDir, "BUILD_ID");
const outputPath = path.resolve(
  projectRoot,
  process.env.BUNDLE_BASELINE_OUT || "artifacts/performance/build-output.json",
);
const POSITIVE_INTEGER_ENV_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const budget = {
  maxFiles: readPositiveIntegerEnv("BUNDLE_BASELINE_MAX_FILES", 300),
  maxTotalBytes: readPositiveIntegerEnv("BUNDLE_BASELINE_MAX_TOTAL_BYTES", 10_500_000),
  maxJsBytes: readPositiveIntegerEnv("BUNDLE_BASELINE_MAX_JS_BYTES", 8_800_000),
  maxSingleJsBytes: readPositiveIntegerEnv("BUNDLE_BASELINE_MAX_SINGLE_JS_BYTES", 1_250_000),
  maxCssBytes: readPositiveIntegerEnv("BUNDLE_BASELINE_MAX_CSS_BYTES", 400_000),
  maxWasmBytes: readPositiveIntegerEnv("BUNDLE_BASELINE_MAX_WASM_BYTES", 1_500_000),
};

if (!distDir.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error("NEXT_DIST_DIR must resolve inside the project");
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!POSITIVE_INTEGER_ENV_RE.test(raw)) throw new Error(`${name} must be a canonical positive integer`);
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error(`${name} must be a canonical positive integer`);
  return Number(parsed);
}

const [buildId, buildIdStat] = await Promise.all([
  fs.readFile(buildIdPath, "utf8").then((value) => value.trim()),
  fs.stat(buildIdPath),
]);
if (!buildId) throw new Error(`${path.relative(projectRoot, buildIdPath)} is empty`);

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
const jsFiles = files.filter((file) => file.extension === ".js");
const largestJsFile = [...jsFiles].sort((a, b) => b.bytes - a.bytes)[0] ?? null;
const bytesByExtension = {};
for (const file of files) {
  bytesByExtension[file.extension] = (bytesByExtension[file.extension] || 0) + file.bytes;
}

const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  scope: "static production output only",
  distDir: path.relative(projectRoot, distDir).replaceAll(path.sep, "/"),
  buildCompletedAt: buildIdStat.mtime.toISOString(),
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
const budgetIssues = [];
if (report.fileCount > budget.maxFiles) budgetIssues.push(`fileCount ${report.fileCount} > ${budget.maxFiles}`);
if (report.totalBytes > budget.maxTotalBytes) budgetIssues.push(`totalBytes ${report.totalBytes} > ${budget.maxTotalBytes}`);
if ((report.bytesByExtension[".js"] ?? 0) > budget.maxJsBytes) budgetIssues.push(`jsBytes ${report.bytesByExtension[".js"]} > ${budget.maxJsBytes}`);
if ((largestJsFile?.bytes ?? 0) > budget.maxSingleJsBytes) budgetIssues.push(`largestJsBytes ${largestJsFile.bytes} > ${budget.maxSingleJsBytes}`);
if ((report.bytesByExtension[".css"] ?? 0) > budget.maxCssBytes) budgetIssues.push(`cssBytes ${report.bytesByExtension[".css"]} > ${budget.maxCssBytes}`);
if ((report.bytesByExtension[".wasm"] ?? 0) > budget.maxWasmBytes) budgetIssues.push(`wasmBytes ${report.bytesByExtension[".wasm"]} > ${budget.maxWasmBytes}`);
report.budget = budget;
report.budgetIssues = budgetIssues;
report.largestJsFile = largestJsFile ? { path: largestJsFile.path, bytes: largestJsFile.bytes } : null;

if (summaryOnly) {
  console.log(JSON.stringify({
    status: budgetIssues.length === 0 ? "pass" : "fail",
    scope: report.scope,
    distDir: report.distDir,
    buildCompletedAt: report.buildCompletedAt,
    fileCount: report.fileCount,
    totalBytes: report.totalBytes,
    jsBytes: report.bytesByExtension[".js"] ?? 0,
    largestJsBytes: largestJsFile?.bytes ?? 0,
    largestJsFile: largestJsFile ? { path: largestJsFile.path, bytes: largestJsFile.bytes } : null,
    cssBytes: report.bytesByExtension[".css"] ?? 0,
    wasmBytes: report.bytesByExtension[".wasm"] ?? 0,
    buildIdPresent: true,
    largestFiles: report.largestFiles.slice(0, 5),
    budget,
    budgetIssues,
  }));
  if (budgetIssues.length > 0) process.exitCode = 1;
  process.exit();
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`Build output baseline written: ${path.relative(projectRoot, outputPath)}`);
if (budgetIssues.length > 0) process.exitCode = 1;
