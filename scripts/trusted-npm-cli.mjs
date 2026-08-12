import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNTRUSTED_EXEC_ENV_KEYS = new Set([
  "node_options",
  "node_path",
  "bash_env",
  "env",
  "init_cwd",
  "shellopts",
  "path",
  "pathext",
  "comspec",
  "systemroot",
  "windir",
]);
const UNTRUSTED_NETWORK_ENV_KEYS = new Set([
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "node_extra_ca_certs",
  "node_tls_reject_unauthorized",
  "node_use_env_proxy",
  "node_use_system_ca",
  "openssl_conf",
  "openssl_modules",
  "ssl_cert_dir",
  "ssl_cert_file",
]);
const TRUSTED_NPM_REGISTRY = "https://registry.npmjs.org/";
const SAFE_NPM_CONFIG = Object.freeze({
  npm_config_fund: "false",
  npm_config_global: "false",
  npm_config_ignore_scripts: "true",
  npm_config_offline: "false",
  npm_config_registry: TRUSTED_NPM_REGISTRY,
  npm_config_update_notifier: "false",
});

function sameCanonicalText(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function canonicalRegularFile(filePath, label) {
  const canonicalPath = realpathSync(filePath);
  const stats = lstatSync(canonicalPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must resolve to a regular file`);
  }
  return canonicalPath;
}

function canonicalDirectory(directoryPath, label) {
  const canonicalPath = realpathSync(directoryPath);
  const stats = lstatSync(canonicalPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must resolve to a directory`);
  }
  return canonicalPath;
}

function trustedWindowsRuntime(launcher, sourceEnv) {
  void launcher;
  const osVolumeCandidates = new Set();
  for (const trustedRuntimePath of [process.execPath, process.cwd(), MODULE_REPO_ROOT]) {
    const volumeRoot = parse(resolve(trustedRuntimePath)).root;
    if (/^[a-z]:\\$/i.test(volumeRoot)) osVolumeCandidates.add(volumeRoot.toLowerCase());
  }
  const canonicalSystemRoots = [];
  for (const volumeRoot of osVolumeCandidates) {
    const expectedSystemRoot = resolve(volumeRoot, "Windows");
    try {
      const canonicalSystemRoot = canonicalDirectory(expectedSystemRoot, "Windows installation");
      const nativeKernel = canonicalRegularFile(
        join(canonicalSystemRoot, "System32", "kernel32.dll"),
        "Windows kernel library",
      );
      const relativeKernel = relative(canonicalSystemRoot, nativeKernel);
      if (
        sameCanonicalText(canonicalSystemRoot, expectedSystemRoot) &&
        /^(?:System32[\\/])kernel32\.dll$/i.test(relativeKernel)
      ) {
        canonicalSystemRoots.push(canonicalSystemRoot);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (canonicalSystemRoots.length !== 1) {
    throw new Error("Unable to identify one canonical Windows installation from trusted runtime paths");
  }
  const [canonicalSystemRoot] = canonicalSystemRoots;

  for (const [key, rawValue] of Object.entries(sourceEnv ?? {})) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey !== "systemroot" && normalizedKey !== "windir") continue;
    const value = String(rawValue ?? "").trim();
    if (
      !value ||
      !sameCanonicalText(value, resolve(value)) ||
      !sameCanonicalText(resolve(value), canonicalSystemRoot)
    ) {
      throw new Error(`${key} must match the runtime-derived canonical Windows installation`);
    }
  }

  const commandShell = canonicalRegularFile(
    join(canonicalSystemRoot, "System32", "cmd.exe"),
    "Windows command shell",
  );
  const relativeShell = relative(canonicalSystemRoot, commandShell);
  if (relativeShell.startsWith("..") || !/^(?:System32[\\/])cmd\.exe$/i.test(relativeShell)) {
    throw new Error("Windows command shell must resolve inside the canonical Windows installation");
  }
  return { commandShell, systemRoot: canonicalSystemRoot };
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} must contain valid JSON`, { cause: error });
  }
}

export function resolveTrustedNpmCli({
  repoRoot = MODULE_REPO_ROOT,
  nodeExecutable = process.execPath,
} = {}) {
  const resolvedRepoRoot = realpathSync(resolve(repoRoot));
  const repoPackagePath = canonicalRegularFile(join(resolvedRepoRoot, "package.json"), "Repository package.json");
  const repoPackage = readJsonFile(repoPackagePath, "Repository package.json");
  if (!/^npm@[^\s]+$/.test(String(repoPackage.packageManager ?? ""))) {
    throw new Error("Repository packageManager must select npm explicitly");
  }

  const canonicalNode = canonicalRegularFile(nodeExecutable, "Node executable");
  const nodeDir = dirname(canonicalNode);
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];

  for (const candidate of candidates) {
    let cliPath;
    try {
      cliPath = canonicalRegularFile(candidate, "npm CLI");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const npmRoot = resolve(dirname(cliPath), "..");
    const npmPackagePath = canonicalRegularFile(join(npmRoot, "package.json"), "npm package.json");
    const npmPackage = readJsonFile(npmPackagePath, "npm package.json");
    if (npmPackage.name !== "npm" || npmPackage.bin?.npm !== "bin/npm-cli.js") {
      throw new Error("Resolved package-manager launcher is not the canonical npm CLI");
    }
    const declaredCliPath = canonicalRegularFile(join(npmRoot, npmPackage.bin.npm), "Declared npm CLI");
    if (declaredCliPath !== cliPath) {
      throw new Error("Resolved npm CLI does not match the package manifest launcher");
    }
    return Object.freeze({
      command: canonicalNode,
      cliPath,
      npmRoot,
      repoRoot: resolvedRepoRoot,
      version: String(npmPackage.version ?? "unknown"),
    });
  }

  throw new Error("Unable to locate npm beside the canonical Node installation");
}

export function trustedNpmCommand(args, launcher = resolveTrustedNpmCli()) {
  return {
    command: launcher.command,
    args: [launcher.cliPath, ...args],
  };
}

export function trustedNpmEnvironment(sourceEnv = {}, launcher = resolveTrustedNpmCli()) {
  const env = { ...sourceEnv };
  for (const key of Object.keys(env)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith("npm_") ||
      normalizedKey.startsWith("global_agent_") ||
      UNTRUSTED_EXEC_ENV_KEYS.has(normalizedKey) ||
      UNTRUSTED_NETWORK_ENV_KEYS.has(normalizedKey)
    ) {
      delete env[key];
    }
  }

  const nodeBin = dirname(launcher.command);
  const localBin = join(launcher.repoRoot, "node_modules", ".bin");
  const userConfig = canonicalRegularFile(join(launcher.repoRoot, ".npmrc"), "Repository npm config");
  env.PATH = [nodeBin, localBin].join(delimiter);
  Object.assign(env, SAFE_NPM_CONFIG);
  env.npm_config_userconfig = userConfig;

  if (process.platform === "win32") {
    const { commandShell, systemRoot } = trustedWindowsRuntime(launcher, sourceEnv);
    env.SystemRoot = systemRoot;
    env.WINDIR = systemRoot;
    env.ComSpec = commandShell;
    env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    env.npm_config_script_shell = commandShell;
  } else {
    env.npm_config_script_shell = canonicalRegularFile("/bin/sh", "POSIX command shell");
  }

  return env;
}
