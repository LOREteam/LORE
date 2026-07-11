import { spawnSync } from "node:child_process";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = process.env.NEXT_ISOLATED_DIST_DIR?.trim() || ".next-isolated";
const safeDistDirPattern = /^\.next-[a-z0-9-]+$/i;

if (!safeDistDirPattern.test(distDir) || distDir === ".next-dev") {
  throw new Error("NEXT_ISOLATED_DIST_DIR must be a dedicated .next-<name> directory");
}

const env = {
  ...process.env,
  NEXT_DIST_DIR: distDir,
  NEXT_TSCONFIG_PATH: "tsconfig.build.json",
};

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNodeScript(path.join(projectRoot, "scripts", "patch-privy-7702.mjs"));
runNodeScript(path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"), [
  "build",
  "--webpack",
]);
