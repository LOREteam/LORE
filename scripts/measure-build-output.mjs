import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const POSITIVE_INTEGER_ENV_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function readPositiveBuildBudgetInteger(name, fallback, env = process.env) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!POSITIVE_INTEGER_ENV_RE.test(raw)) {
    throw new Error(`${name} must be a canonical positive integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be a canonical positive integer`);
  }
  return Number(parsed);
}

export function parseBuildOutputConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const projectRoot = path.resolve(cwd);
  const distDir = path.resolve(projectRoot, env.NEXT_DIST_DIR?.trim() || ".next");
  const relativeDistDir = path.relative(projectRoot, distDir);
  if (
    !relativeDistDir
    || relativeDistDir === ".."
    || relativeDistDir.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeDistDir)
  ) {
    throw new Error("NEXT_DIST_DIR must resolve inside the project");
  }
  return {
    projectRoot,
    distDir,
    staticDir: path.join(distDir, "static"),
    buildIdPath: path.join(distDir, "BUILD_ID"),
    outputPath: path.resolve(
      projectRoot,
      env.BUNDLE_BASELINE_OUT || "artifacts/performance/build-output.json",
    ),
    budget: {
      maxFiles: readPositiveBuildBudgetInteger("BUNDLE_BASELINE_MAX_FILES", 300, env),
      maxTotalBytes: readPositiveBuildBudgetInteger("BUNDLE_BASELINE_MAX_TOTAL_BYTES", 10_500_000, env),
      maxJsBytes: readPositiveBuildBudgetInteger("BUNDLE_BASELINE_MAX_JS_BYTES", 8_800_000, env),
      maxSingleJsBytes: readPositiveBuildBudgetInteger("BUNDLE_BASELINE_MAX_SINGLE_JS_BYTES", 1_250_000, env),
      maxCssBytes: readPositiveBuildBudgetInteger("BUNDLE_BASELINE_MAX_CSS_BYTES", 400_000, env),
      maxWasmBytes: readPositiveBuildBudgetInteger("BUNDLE_BASELINE_MAX_WASM_BYTES", 1_500_000, env),
    },
  };
}

async function collectFiles(directory, distDir, fsApi) {
  const entries = await fsApi.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, distDir, fsApi));
    } else if (entry.isFile()) {
      const stat = await fsApi.stat(absolutePath);
      files.push({
        path: path.relative(distDir, absolutePath).replaceAll(path.sep, "/"),
        bytes: stat.size,
        extension: path.extname(entry.name).toLowerCase() || "none",
      });
    }
  }
  return files;
}

export async function measureBuildOutput({
  cwd = process.cwd(),
  env = process.env,
  fsApi = fs,
  now = () => new Date(),
} = {}) {
  const config = parseBuildOutputConfig({ cwd, env });
  const [buildIdRaw, buildIdStat] = await Promise.all([
    fsApi.readFile(config.buildIdPath, "utf8"),
    fsApi.stat(config.buildIdPath),
  ]);
  const buildId = String(buildIdRaw).trim();
  if (!buildId) {
    throw new Error(`${path.relative(config.projectRoot, config.buildIdPath)} is empty`);
  }

  const files = await collectFiles(config.staticDir, config.distDir, fsApi);
  const jsFiles = files.filter((file) => file.extension === ".js");
  const largestJsFile = [...jsFiles].sort((a, b) => b.bytes - a.bytes)[0] ?? null;
  const bytesByExtension = {};
  for (const file of files) {
    bytesByExtension[file.extension] = (bytesByExtension[file.extension] || 0) + file.bytes;
  }

  const report = {
    schemaVersion: 1,
    measuredAt: now().toISOString(),
    scope: "static production output only",
    distDir: path.relative(config.projectRoot, config.distDir).replaceAll(path.sep, "/"),
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
  const { budget } = config;
  if (report.fileCount > budget.maxFiles) {
    budgetIssues.push(`fileCount ${report.fileCount} > ${budget.maxFiles}`);
  }
  if (report.totalBytes > budget.maxTotalBytes) {
    budgetIssues.push(`totalBytes ${report.totalBytes} > ${budget.maxTotalBytes}`);
  }
  if ((report.bytesByExtension[".js"] ?? 0) > budget.maxJsBytes) {
    budgetIssues.push(`jsBytes ${report.bytesByExtension[".js"]} > ${budget.maxJsBytes}`);
  }
  if ((largestJsFile?.bytes ?? 0) > budget.maxSingleJsBytes) {
    budgetIssues.push(`largestJsBytes ${largestJsFile.bytes} > ${budget.maxSingleJsBytes}`);
  }
  if ((report.bytesByExtension[".css"] ?? 0) > budget.maxCssBytes) {
    budgetIssues.push(`cssBytes ${report.bytesByExtension[".css"]} > ${budget.maxCssBytes}`);
  }
  if ((report.bytesByExtension[".wasm"] ?? 0) > budget.maxWasmBytes) {
    budgetIssues.push(`wasmBytes ${report.bytesByExtension[".wasm"]} > ${budget.maxWasmBytes}`);
  }
  report.budget = budget;
  report.budgetIssues = budgetIssues;
  report.largestJsFile = largestJsFile
    ? { path: largestJsFile.path, bytes: largestJsFile.bytes }
    : null;

  return { config, report, largestJsFile, budgetIssues };
}

export function summarizeBuildOutput({ report, largestJsFile, budgetIssues }) {
  return {
    status: budgetIssues.length === 0 ? "pass" : "fail",
    scope: report.scope,
    distDir: report.distDir,
    buildCompletedAt: report.buildCompletedAt,
    fileCount: report.fileCount,
    totalBytes: report.totalBytes,
    jsBytes: report.bytesByExtension[".js"] ?? 0,
    largestJsBytes: largestJsFile?.bytes ?? 0,
    largestJsFile: largestJsFile
      ? { path: largestJsFile.path, bytes: largestJsFile.bytes }
      : null,
    cssBytes: report.bytesByExtension[".css"] ?? 0,
    wasmBytes: report.bytesByExtension[".wasm"] ?? 0,
    buildIdPresent: true,
    largestFiles: report.largestFiles.slice(0, 5),
    budget: report.budget,
    budgetIssues,
  };
}

export async function runBuildOutputCli({
  cwd = process.cwd(),
  env = process.env,
  argv = process.argv.slice(2),
  fsApi = fs,
  now = () => new Date(),
  log = console.log,
} = {}) {
  const measurement = await measureBuildOutput({ cwd, env, fsApi, now });
  const summaryOnly = argv.includes("--summary-only");
  const exitCode = measurement.budgetIssues.length > 0 ? 1 : 0;
  if (summaryOnly) {
    const summary = summarizeBuildOutput(measurement);
    log(JSON.stringify(summary));
    return { ...measurement, summary, wroteArtifact: false, exitCode };
  }

  await fsApi.mkdir(path.dirname(measurement.config.outputPath), { recursive: true });
  await fsApi.writeFile(
    measurement.config.outputPath,
    `${JSON.stringify(measurement.report, null, 2)}\n`,
    "utf8",
  );
  log(JSON.stringify(measurement.report, null, 2));
  log(`Build output baseline written: ${path.relative(measurement.config.projectRoot, measurement.config.outputPath)}`);
  return { ...measurement, wroteArtifact: true, exitCode };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runBuildOutputCli();
  process.exitCode = result.exitCode;
}
