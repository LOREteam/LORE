import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as safetyPoolClaimThresholdModule from "../app/lib/safetyPoolClaimThreshold.ts";
import * as analyticsDepositsStatusModule from "../app/lib/analyticsDepositsStatus.ts";
import * as liveStateSnapshotModule from "../app/hooks/useGameLiveStateSnapshot.ts";
import * as gameConstantsModule from "../app/lib/constants.ts";
import * as sqliteScopeAuditModule from "./sqlite-scope-audit-lib.mjs";
import * as chatAuthModule from "../app/lib/chatAuth.ts";
import * as chatSessionModule from "../app/api/_lib/chatSession.ts";
import * as indexerNormalizationModule from "./indexerNormalization.mjs";
import {
  createLaunchGatePolicyMaps,
  findLiveCanaryLogPaths,
  MAX_LIVE_CANARY_LOG_PATHS,
} from "./launch-gate-policy.mjs";
import {
  resolveTrustedNpmCli,
  trustedNpmCommand,
  trustedNpmEnvironment,
} from "./trusted-npm-cli.mjs";
import {
  assertCanaryApprovalPostcondition,
  resolveCanaryAllowancePlan,
} from "./live-canary-approval-policy.mjs";

const safetyPoolClaimThreshold = safetyPoolClaimThresholdModule.default ?? safetyPoolClaimThresholdModule;
const analyticsDepositsStatus = analyticsDepositsStatusModule.default ?? analyticsDepositsStatusModule;
const liveStateSnapshot = liveStateSnapshotModule.default ?? liveStateSnapshotModule;
const gameConstants = gameConstantsModule.default ?? gameConstantsModule;
const chatAuth = chatAuthModule.default ?? chatAuthModule;
const chatSession = chatSessionModule.default ?? chatSessionModule;
const indexerNormalization = indexerNormalizationModule.default ?? indexerNormalizationModule;
const packageScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
function campaignFixtureGitEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "NUL";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function runCampaignFixtureGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    cwd: root,
    env: campaignFixtureGitEnvironment(),
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  return String(result.stdout ?? "").trim().toLowerCase();
}

function runCampaignFixturePowerShell(scriptPath, campaignId, { failEventWrite = false } = {}) {
  const powerShellPath = join(
    process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  assert.ok(existsSync(powerShellPath), "Windows PowerShell must be available for the campaign fixture");
  const environment = campaignFixtureGitEnvironment();
  const commonArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
  const args = failEventWrite
    ? [
      ...commonArgs,
      "-Command",
      'function global:Add-Content { throw "fixture event write failure" }; & $env:LORE_CAMPAIGN_FIXTURE_SCRIPT -Hours 1 -IntervalMinutes 15 -MaxIterations 1 -CampaignId $env:LORE_CAMPAIGN_FIXTURE_ID',
    ]
    : [
      ...commonArgs,
      "-File",
      scriptPath,
      "-Hours",
      "1",
      "-IntervalMinutes",
      "15",
      "-MaxIterations",
      "1",
      "-CampaignId",
      campaignId,
    ];
  if (failEventWrite) {
    environment.LORE_CAMPAIGN_FIXTURE_SCRIPT = scriptPath;
    environment.LORE_CAMPAIGN_FIXTURE_ID = campaignId;
  }
  return spawnSync(powerShellPath, args, {
    cwd: resolve(scriptPath, "..", ".."),
    env: environment,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}
export function assertLocalCampaignSourceProvenance() {
  const source = readFileSync("scripts/run-local-test-campaign.ps1", "utf8");
  assert.match(source, /git -C \$repoRoot rev-parse --verify 'HEAD\^\{commit\}'/);
  assert.match(source, /git -C \$repoRoot status --porcelain=v1 --untracked-files=no/);
  assert.match(source, /requires a clean tracked worktree/);
  assert.match(source, /sourceSha = \$sourceSha/);
  assert.match(source, /\$Event\.ContainsKey\('sourceSha'\)/);
  assert.match(source, /function Get-CampaignSourceIntegrityFailure\(/);
  assert.match(source, /sourceIntegrityFailure = \$Failure/);
  assert.match(source, /-Phase 'before-command'/);
  assert.match(source, /-Phase 'before-completed'/);
  assert.match(source, /-Phase 'after-command'/);
  assert.match(source, /New-Item -ItemType Directory -Path \$campaignDirectory -ErrorAction Stop/);
  assert.match(source, /Add-Content -LiteralPath \$summaryPath -Value \$serialized -Encoding utf8 -ErrorAction Stop/);
  assert.match(source, /git -C \$repoRoot worktree add --detach \$snapshotDirectory \$sourceSha/);
  assert.match(source, /Push-Location -LiteralPath \$snapshotDirectory/);
  assert.match(source, /executionSource = 'detached-worktree'/);
  assert.match(source, /git -C \$repoRoot worktree remove --force \$snapshotDirectory/);
  assert.match(source, /source-snapshot-dirty/);
  assert.match(source, /Get-CampaignProtectedDatabaseSnapshot/);
  assert.match(source, /protected-db-drift/);
  assert.match(source, /runtime-dependency-drift/);
  assert.match(source, /source-snapshot-path-drift/);
  assert.match(source, /Test-CampaignSnapshotDependencyLink/);
  assert.match(source, /\[IO\.Directory\]::Delete\(\$snapshotNodeModules, \$false\)/);
  assert.match(source, /Get-CampaignSha256 \$item.FullName/);

  if (process.platform !== "win32") return;

  const root = mkdtempSync(join(tmpdir(), "lore-campaign-provenance-"));
  try {
    const scriptDirectory = join(root, "scripts");
    const scriptPath = join(scriptDirectory, "run-local-test-campaign.ps1");
    mkdirSync(scriptDirectory, { recursive: true });
    copyFileSync("scripts/run-local-test-campaign.ps1", scriptPath);
    for (const script of [
      "business-logic-isolated-runner.mjs",
      "run-p1-hardening-tests.mjs",
      "test-contract-v9-invariants.mjs",
      "test-contract-v10-invariants.mjs",
      "test-hermetic-build.mjs",
    ]) {
      writeFileSync(join(scriptDirectory, script), "process.exit(0);\n", "utf8");
    }
    writeFileSync(join(root, "package-lock.json"), "{}\n", "utf8");
    runCampaignFixtureGit(root, ["init", "--quiet"]);
    runCampaignFixtureGit(root, ["add", "--", "."]);
    runCampaignFixtureGit(root, [
      "-c", "user.name=LORE Campaign Fixture",
      "-c", "user.email=lore-campaign-fixture@example.invalid",
      "commit", "--quiet", "-m", "fixture",
    ]);
    const sourceSha = runCampaignFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const tsxDirectory = join(root, "node_modules", "tsx", "dist");
    mkdirSync(tsxDirectory, { recursive: true });
    writeFileSync(join(tsxDirectory, "cli.mjs"), "process.exit(0);\n", "utf8");

    const runtimeDirectory = join(root, ".tmp-npm-runtime-115");
    mkdirSync(runtimeDirectory, { recursive: true });
    const fixtureRuntime = join(runtimeDirectory, "node.exe");
    copyFileSync(process.execPath, fixtureRuntime);

    const readEvents = (campaignId) => readFileSync(
      join(root, "artifacts", "test-campaign-2026-08-20", campaignId, "local-test-campaign.jsonl"),
      "utf8",
    ).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const assertBoundSourceSha = (events, expectedSourceSha) => {
      for (const event of events) {
        assert.equal(event.sourceSha, expectedSourceSha, "every campaign event must bind the startup commit SHA");
      }
    };
    const commitFixtureCommand = (message, body) => {
      writeFileSync(firstCommandPath, body, "utf8");
      runCampaignFixtureGit(root, ["add", "--", "scripts/business-logic-isolated-runner.mjs"]);
      runCampaignFixtureGit(root, [
        "-c", "user.name=LORE Campaign Fixture",
        "-c", "user.email=lore-campaign-fixture@example.invalid",
        "commit", "--quiet", "-m", message,
      ]);
      return runCampaignFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    };
    const campaignSnapshotDirectory = (campaignId, sourceSha) => join(
      tmpdir(),
      "lore-local-test-campaign-source-snapshots",
      `${campaignId}-${sourceSha}`,
    );
    const assertStoppedForIntegrityFailure = (campaignId, expectedSourceSha, expectedFailure) => {
      const run = runCampaignFixturePowerShell(scriptPath, campaignId);
      assert.equal(run.error, undefined, run.error?.message);
      assert.notEqual(run.status, 0, `${campaignId} must stop rather than continue after identity drift`);
      const events = readEvents(campaignId);
      assertBoundSourceSha(events, expectedSourceSha);
      assert.equal(events.some((event) => event.status === "completed"), false, `${campaignId} must not record completion`);
      assert.equal(events.some((event) => event.status === "passed"), false, `${campaignId} must not admit a post-drift pass`);
      const failure = events.find((event) => event.status === "failed");
      assert.equal(failure?.phase, "after-command", `${campaignId} must reject identity drift immediately after the child`);
      assert.equal(failure?.sourceIntegrityFailure, expectedFailure, `${campaignId} must retain the specific integrity failure`);
      return { run, events };
    };
    const removeFixtureSnapshot = (campaignId, sourceSha) => {
      const snapshot = campaignSnapshotDirectory(campaignId, sourceSha);
      if (!existsSync(snapshot)) return;
      const removed = spawnSync("git", ["-C", root, "worktree", "remove", "--force", snapshot], {
        cwd: root,
        env: campaignFixtureGitEnvironment(),
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      });
      assert.equal(removed.status, 0, `fixture snapshot cleanup failed: ${removed.stderr ?? ""}`);
      assert.equal(existsSync(snapshot), false, "fixture snapshot cleanup must remove only the restored worktree");
    };

    const clean = runCampaignFixturePowerShell(scriptPath, "fixture-clean");
    assert.equal(clean.error, undefined, clean.error?.message);
    assert.equal(clean.status, 0, `${clean.stdout ?? ""}${clean.stderr ?? ""}`);
    const cleanEvents = readEvents("fixture-clean");
    assert.deepEqual(cleanEvents.map((event) => event.status), ["started", ...Array(7).fill("passed"), "completed"]);
    assertBoundSourceSha(cleanEvents, sourceSha);

    const eventWriteFailure = runCampaignFixturePowerShell(scriptPath, "fixture-event-write-failure", { failEventWrite: true });
    assert.equal(eventWriteFailure.error, undefined, eventWriteFailure.error?.message);
    assert.notEqual(eventWriteFailure.status, 0, "an event append failure must stop the campaign");
    assert.match(`${eventWriteFailure.stdout ?? ""}\n${eventWriteFailure.stderr ?? ""}`, /could not record evidence/i);
    assert.equal(
      existsSync(join(root, "artifacts", "test-campaign-2026-08-20", "fixture-event-write-failure", "local-test-campaign.jsonl")),
      false,
      "a failed initial event append must not leave completed evidence",
    );

    const firstCommandPath = join(scriptDirectory, "business-logic-isolated-runner.mjs");
    const p1CommandPath = join(scriptDirectory, "run-p1-hardening-tests.mjs");
    const finalCommandPath = join(scriptDirectory, "test-hermetic-build.mjs");
    const activeP1Path = join(root, "scripts", "run-p1-hardening-tests.mjs");
    const activeP1Original = readFileSync(activeP1Path, "utf8");
    const activeP1Stat = statSync(activeP1Path);
    writeFileSync(firstCommandPath, [
      'import { execFileSync } from "node:child_process";',
      'import { readFileSync, writeFileSync } from "node:fs";',
      `const activeRoot = ${JSON.stringify(root)};`,
      `const target = ${JSON.stringify(activeP1Path)};`,
      'if (process.cwd().toLowerCase() === activeRoot.toLowerCase()) process.exit(23);',
      'const original = readFileSync(target, "utf8");',
      "const escapedTarget = target.replace(/'/g, \"''\");",
      'const powerShell = "powershell.exe";',
      "const ticks = execFileSync(powerShell, [\"-NoProfile\", \"-NonInteractive\", \"-Command\", `([IO.File]::GetLastWriteTimeUtc('${escapedTarget}')).Ticks`], { encoding: \"utf8\" }).trim();",
      'writeFileSync(target, `${original}// transient parent-source fixture drift\\n`, "utf8");',
      'writeFileSync(target, original, "utf8");',
      "execFileSync(powerShell, [\"-NoProfile\", \"-NonInteractive\", \"-Command\", `[IO.File]::SetLastWriteTimeUtc('${escapedTarget}', [DateTime]::new(${ticks}, [DateTimeKind]::Utc))`]);",
    ].join("\n"), "utf8");
    runCampaignFixtureGit(root, ["add", "--", "scripts/business-logic-isolated-runner.mjs"]);
    runCampaignFixtureGit(root, [
      "-c", "user.name=LORE Campaign Fixture",
      "-c", "user.email=lore-campaign-fixture@example.invalid",
      "commit", "--quiet", "-m", "fixture detached snapshot parent transient restore",
    ]);
    const parentTransientSourceSha = runCampaignFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const parentTransient = runCampaignFixturePowerShell(scriptPath, "fixture-parent-transient-restored");
    const parentTransientEvents = readEvents("fixture-parent-transient-restored");
    assert.equal(parentTransient.error, undefined, parentTransient.error?.message);
    assert.equal(parentTransient.status, 0, `${parentTransient.stdout ?? ""}\n${parentTransient.stderr ?? ""}`);
    assert.deepEqual(parentTransientEvents.map((event) => event.status), ["started", ...Array(7).fill("passed"), "completed"]);
    assertBoundSourceSha(parentTransientEvents, parentTransientSourceSha);
    assert.equal(parentTransientEvents[0].executionSource, "detached-worktree");
    assert.equal(readFileSync(activeP1Path, "utf8"), activeP1Original, "the original source must be restored unchanged");
    assert.equal(statSync(activeP1Path).mtimeMs, activeP1Stat.mtimeMs, "the original source mtime must be restored exactly");
    assert.equal(
      runCampaignFixtureGit(root, ["status", "--porcelain=v1", "--untracked-files=no"]),
      "",
      "a transient original-root mutation must not alter detached-source execution evidence",
    );

    writeFileSync(firstCommandPath, [
      'import { execFileSync } from "node:child_process";',
      'import { readFileSync, writeFileSync } from "node:fs";',
      'const target = "scripts/run-p1-hardening-tests.mjs";',
      'const original = readFileSync(target, "utf8");',
      'const changed = original.replace("process.exit(0)", "process.exit(9)");',
      'if (changed.length !== original.length) process.exit(25);',
      'const powerShell = "powershell.exe";',
      'const ticks = execFileSync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", `([IO.File]::GetLastWriteTimeUtc(\'${target}\')).Ticks`], { encoding: "utf8" }).trim();',
      'writeFileSync(target, changed, "utf8");',
      'execFileSync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", `[IO.File]::SetLastWriteTimeUtc(\'${target}\', [DateTime]::new(${ticks}, [DateTimeKind]::Utc))`]);',
    ].join("\n"), "utf8");
    runCampaignFixtureGit(root, ["add", "--", "scripts/business-logic-isolated-runner.mjs"]);
    runCampaignFixtureGit(root, [
      "-c", "user.name=LORE Campaign Fixture",
      "-c", "user.email=lore-campaign-fixture@example.invalid",
      "commit", "--quiet", "-m", "fixture snapshot tracked tree drift child",
    ]);
    const snapshotDirtySourceSha = runCampaignFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const snapshotDirty = runCampaignFixturePowerShell(scriptPath, "fixture-source-snapshot-dirty");
    assert.equal(snapshotDirty.error, undefined, snapshotDirty.error?.message);
    assert.notEqual(snapshotDirty.status, 0, "a snapshot tracked mutation must stop after the child");
    const snapshotDirtyEvents = readEvents("fixture-source-snapshot-dirty");
    assert.deepEqual(snapshotDirtyEvents.map((event) => event.status), ["started", "failed", "stopped-on-failure"]);
    assertBoundSourceSha(snapshotDirtyEvents, snapshotDirtySourceSha);
    assert.equal(snapshotDirtyEvents.at(-2).sourceIntegrityFailure, "source-snapshot-dirty");
    assert.equal(snapshotDirtyEvents.at(-2).phase, "after-command");
    assert.equal(snapshotDirtyEvents.at(-2).command, "business-logic-isolated");
    assert.equal(snapshotDirtyEvents.some((event) => event.status === "passed"), false);
    assert.equal(
      runCampaignFixtureGit(root, ["status", "--porcelain=v1", "--untracked-files=no"]),
      "",
      "a snapshot-only mutation must never dirty the original source root",
    );

    const protectedDbPath = join(root, "data", "lore-v10.sqlite");
    writeFileSync(firstCommandPath, [
      'import { appendFileSync, mkdirSync } from "node:fs";',
      `mkdirSync(${JSON.stringify(join(root, "data"))}, { recursive: true });`,
      `appendFileSync(${JSON.stringify(protectedDbPath)}, "db drift", "utf8");`,
    ].join("\n"), "utf8");
    runCampaignFixtureGit(root, ["add", "--", "scripts/business-logic-isolated-runner.mjs"]);
    runCampaignFixtureGit(root, [
      "-c", "user.name=LORE Campaign Fixture",
      "-c", "user.email=lore-campaign-fixture@example.invalid",
      "commit", "--quiet", "-m", "fixture protected database drift child",
    ]);
    const protectedDbSourceSha = runCampaignFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const protectedDbDrift = runCampaignFixturePowerShell(scriptPath, "fixture-protected-db-drift");
    assert.equal(protectedDbDrift.error, undefined, protectedDbDrift.error?.message);
    assert.notEqual(protectedDbDrift.status, 0, "a protected DB mutation must stop after the child");
    const protectedDbEvents = readEvents("fixture-protected-db-drift");
    assert.deepEqual(protectedDbEvents.map((event) => event.status), ["started", "failed", "stopped-on-failure"]);
    assertBoundSourceSha(protectedDbEvents, protectedDbSourceSha);
    assert.equal(protectedDbEvents.at(-2).sourceIntegrityFailure, "protected-db-drift");
    assert.equal(protectedDbEvents.at(-2).phase, "after-command");
    assert.equal(protectedDbEvents.some((event) => event.status === "passed"), false);

    const runtimeOriginalPath = `${fixtureRuntime}.fixture-original`;
    const runtimeReplacementPath = `${fixtureRuntime}.fixture-replacement`;
    const runtimeSwapMarker = join(root, "runtime-swap-completed");
    copyFileSync(fixtureRuntime, runtimeReplacementPath);
    appendFileSync(runtimeReplacementPath, "fixture runtime replacement", "utf8");
    const runtimeSwapSourceSha = commitFixtureCommand("fixture runtime identity drift", [
      'import { renameSync, writeFileSync } from "node:fs";',
      `renameSync(${JSON.stringify(fixtureRuntime)}, ${JSON.stringify(runtimeOriginalPath)});`,
      `renameSync(${JSON.stringify(runtimeReplacementPath)}, ${JSON.stringify(fixtureRuntime)});`,
      `writeFileSync(${JSON.stringify(runtimeSwapMarker)}, "swapped", "utf8");`,
    ].join("\n"));
    const runtimeSwapId = "fixture-runtime-identity-drift";
    const runtimeSwap = runCampaignFixturePowerShell(scriptPath, runtimeSwapId);
    assert.equal(runtimeSwap.error, undefined, runtimeSwap.error?.message);
    if (existsSync(runtimeSwapMarker)) {
      assert.notEqual(runtimeSwap.status, 0, "a swapped private runtime must stop the campaign");
      const runtimeSwapEvents = readEvents(runtimeSwapId);
      assertBoundSourceSha(runtimeSwapEvents, runtimeSwapSourceSha);
      const runtimeFailure = runtimeSwapEvents.find((event) => event.status === "failed");
      assert.equal(runtimeFailure?.phase, "after-command");
      assert.equal(runtimeFailure?.sourceIntegrityFailure, "runtime-dependency-drift");
      assert.equal(runtimeSwapEvents.some((event) => event.status === "passed"), false);
      assert.equal(runtimeSwapEvents.some((event) => event.status === "completed"), false);
      rmSync(fixtureRuntime, { force: true });
      renameSync(runtimeOriginalPath, fixtureRuntime);
      removeFixtureSnapshot(runtimeSwapId, runtimeSwapSourceSha);
    } else {
      assert.notEqual(runtimeSwap.status, 0, "a locked runtime replacement probe must not be treated as a pass");
      assert.ok(
        `${runtimeSwap.stdout ?? ""}\n${runtimeSwap.stderr ?? ""}`.length > 0,
        "a platform that forbids replacing its running executable must surface the failed fixture action",
      );
      assert.equal(existsSync(runtimeOriginalPath), false, "an unsuccessful runtime replacement must leave the fixture runtime intact");
      rmSync(runtimeReplacementPath, { force: true });
    }

    const lockfilePath = join(root, "package-lock.json");
    const lockfileOriginal = readFileSync(lockfilePath, "utf8");
    const lockfileStat = statSync(lockfilePath);
    const lockfileSourceSha = commitFixtureCommand("fixture package lock metadata drift", [
      'import { readFileSync, writeFileSync } from "node:fs";',
      `const lockfile = ${JSON.stringify(lockfilePath)};`,
      'const original = readFileSync(lockfile, "utf8");',
      'writeFileSync(lockfile, `${original} `, "utf8");',
      'writeFileSync(lockfile, original, "utf8");',
    ].join("\n"));
    assertStoppedForIntegrityFailure("fixture-package-lock-drift", lockfileSourceSha, "tracked-tree-dirty");
    assert.equal(readFileSync(lockfilePath, "utf8"), lockfileOriginal, "package lock fixture must restore tracked content before the next case");
    utimesSync(lockfilePath, lockfileStat.atime, lockfileStat.mtime);

    const nodeModulesPath = join(root, "node_modules");
    const nodeModulesBackup = `${nodeModulesPath}.fixture-original`;
    const nodeModulesSwapMarker = join(root, "node-modules-swap-completed");
    const nodeModulesSourceSha = commitFixtureCommand("fixture node modules identity drift", [
      'import { mkdirSync, renameSync, writeFileSync } from "node:fs";',
      `renameSync(${JSON.stringify(nodeModulesPath)}, ${JSON.stringify(nodeModulesBackup)});`,
      `mkdirSync(${JSON.stringify(nodeModulesPath)});`,
      `writeFileSync(${JSON.stringify(nodeModulesSwapMarker)}, "swapped", "utf8");`,
    ].join("\n"));
    assertStoppedForIntegrityFailure("fixture-node-modules-drift", nodeModulesSourceSha, "runtime-dependency-drift");
    assert.equal(existsSync(nodeModulesSwapMarker), true, "node_modules replacement action must run inside the detached snapshot");
    rmSync(nodeModulesPath, { recursive: true, force: true });
    renameSync(nodeModulesBackup, nodeModulesPath);

    const fixtureDataDirectory = join(root, "data");
    const fixtureDb = join(fixtureDataDirectory, "lore-v10.sqlite");
    const fixtureWal = join(fixtureDataDirectory, "lore-v10.sqlite-wal");
    const fixtureShm = join(fixtureDataDirectory, "lore-v10.sqlite-shm");
    const resetProtectedDatabaseFixture = ({ wal, shm }) => {
      rmSync(fixtureDataDirectory, { recursive: true, force: true });
      mkdirSync(fixtureDataDirectory, { recursive: true });
      writeFileSync(fixtureDb, "fixture-db", "utf8");
      if (wal) writeFileSync(fixtureWal, "fixture-wal", "utf8");
      if (shm) writeFileSync(fixtureShm, "fixture-shm", "utf8");
    };
    const runProtectedDatabaseFault = ({ id, message, baseline, body }) => {
      resetProtectedDatabaseFixture(baseline);
      const faultSourceSha = commitFixtureCommand(message, body);
      assertStoppedForIntegrityFailure(id, faultSourceSha, "protected-db-drift");
    };
    runProtectedDatabaseFault({
      id: "fixture-protected-wal-appearance",
      message: "fixture protected WAL appearance",
      baseline: { wal: false, shm: false },
      body: [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(fixtureWal)}, "unexpected WAL", "utf8");`,
      ].join("\n"),
    });
    runProtectedDatabaseFault({
      id: "fixture-protected-wal-disappearance",
      message: "fixture protected WAL disappearance",
      baseline: { wal: true, shm: true },
      body: [
        'import { rmSync } from "node:fs";',
        `rmSync(${JSON.stringify(fixtureWal)});`,
      ].join("\n"),
    });
    runProtectedDatabaseFault({
      id: "fixture-protected-shm-mutation",
      message: "fixture protected SHM mutation",
      baseline: { wal: true, shm: true },
      body: [
        'import { appendFileSync } from "node:fs";',
        `appendFileSync(${JSON.stringify(fixtureShm)}, "changed", "utf8");`,
      ].join("\n"),
    });
    resetProtectedDatabaseFixture({ wal: false, shm: false });

    const snapshotSubstitutionId = "fixture-snapshot-directory-substitution";
    const snapshotSubstitutionMarker = join(root, "snapshot-directory-substitution-completed");
    const snapshotSubstitutionSourceSha = commitFixtureCommand("fixture snapshot directory substitution", [
      'import { mkdirSync, renameSync, writeFileSync } from "node:fs";',
      'const snapshot = process.cwd();',
      'const backup = `${snapshot}.fixture-original`;',
      'renameSync(snapshot, backup);',
      'mkdirSync(snapshot);',
      `writeFileSync(${JSON.stringify(snapshotSubstitutionMarker)}, "substituted", "utf8");`,
    ].join("\n"));
    const snapshotSubstitution = runCampaignFixturePowerShell(scriptPath, snapshotSubstitutionId);
    assert.equal(snapshotSubstitution.error, undefined, snapshotSubstitution.error?.message);
    const snapshotSubstitutionPath = campaignSnapshotDirectory(snapshotSubstitutionId, snapshotSubstitutionSourceSha);
    const snapshotSubstitutionBackup = `${snapshotSubstitutionPath}.fixture-original`;
    if (existsSync(snapshotSubstitutionMarker)) {
      assert.notEqual(snapshotSubstitution.status, 0, "a substituted snapshot path must stop the campaign");
      const events = readEvents(snapshotSubstitutionId);
      assertBoundSourceSha(events, snapshotSubstitutionSourceSha);
      const failure = events.find((event) => event.status === "failed");
      assert.equal(failure?.phase, "after-command");
      assert.equal(failure?.sourceIntegrityFailure, "source-snapshot-path-drift");
      assert.equal(events.some((event) => event.status === "passed"), false);
      assert.equal(events.some((event) => event.status === "completed"), false);
    } else {
      assert.notEqual(snapshotSubstitution.status, 0, "an unavailable snapshot substitution action must still fail closed");
    }
    if (existsSync(snapshotSubstitutionBackup)) {
      if (existsSync(snapshotSubstitutionPath)) rmSync(snapshotSubstitutionPath, { recursive: true, force: true });
      renameSync(snapshotSubstitutionBackup, snapshotSubstitutionPath);
    }
    removeFixtureSnapshot(snapshotSubstitutionId, snapshotSubstitutionSourceSha);

    const snapshotParentId = "fixture-snapshot-parent-reparse";
    const snapshotParentMarker = join(root, "snapshot-parent-reparse-completed");
    const snapshotParentTarget = join(root, "snapshot-parent-reparse-target");
    const snapshotParentSentinel = join(snapshotParentTarget, "must-survive");
    mkdirSync(snapshotParentTarget, { recursive: true });
    writeFileSync(snapshotParentSentinel, "sentinel", "utf8");
    const snapshotParentSourceSha = commitFixtureCommand("fixture snapshot parent reparse", [
      'import { mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";',
      'import { dirname } from "node:path";',
      'const snapshotParent = dirname(process.cwd());',
      'const backup = `${snapshotParent}.fixture-original`;',
      `mkdirSync(${JSON.stringify(snapshotParentTarget)}, { recursive: true });`,
      'renameSync(snapshotParent, backup);',
      `symlinkSync(${JSON.stringify(snapshotParentTarget)}, snapshotParent, "junction");`,
      `writeFileSync(${JSON.stringify(snapshotParentMarker)}, "reparse", "utf8");`,
    ].join("\n"));
    const snapshotParentRun = runCampaignFixturePowerShell(scriptPath, snapshotParentId);
    assert.equal(snapshotParentRun.error, undefined, snapshotParentRun.error?.message);
    const snapshotParentPath = campaignSnapshotDirectory(snapshotParentId, snapshotParentSourceSha);
    const snapshotParentDirectory = dirname(snapshotParentPath);
    const snapshotParentBackup = `${snapshotParentDirectory}.fixture-original`;
    if (existsSync(snapshotParentMarker)) {
      assert.notEqual(snapshotParentRun.status, 0, "a snapshot parent junction must stop the campaign");
      const events = readEvents(snapshotParentId);
      assertBoundSourceSha(events, snapshotParentSourceSha);
      const failure = events.find((event) => event.status === "failed");
      assert.equal(failure?.phase, "after-command");
      assert.equal(failure?.sourceIntegrityFailure, "source-snapshot-path-drift");
      assert.equal(events.some((event) => event.status === "completed"), false);
      assert.equal(lstatSync(snapshotParentDirectory).isSymbolicLink(), true, "fixture must replace the snapshot parent with a junction");
      assert.equal(existsSync(snapshotParentSentinel), true, "unsafe snapshot cleanup must not follow a substituted parent target");
    } else {
      assert.notEqual(snapshotParentRun.status, 0, "an unavailable snapshot parent replacement action must still fail closed");
    }
    if (existsSync(snapshotParentBackup)) {
      if (existsSync(snapshotParentDirectory)) rmdirSync(snapshotParentDirectory);
      renameSync(snapshotParentBackup, snapshotParentDirectory);
    }
    removeFixtureSnapshot(snapshotParentId, snapshotParentSourceSha);
    rmSync(snapshotParentTarget, { recursive: true, force: true });

    const dependencySwapId = "fixture-snapshot-dependency-junction-swap";
    const dependencySwapMarker = join(root, "snapshot-dependency-junction-swap-completed");
    const dependencySwapTarget = join(root, "snapshot-dependency-junction-target");
    const dependencySwapSentinel = join(dependencySwapTarget, "must-survive");
    mkdirSync(dependencySwapTarget, { recursive: true });
    writeFileSync(dependencySwapSentinel, "sentinel", "utf8");
    const dependencySwapSourceSha = commitFixtureCommand("fixture snapshot dependency junction swap", [
      'import { rmdirSync, symlinkSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const link = join(process.cwd(), "node_modules");',
      'rmdirSync(link);',
      `symlinkSync(${JSON.stringify(dependencySwapTarget)}, link, "junction");`,
      `writeFileSync(${JSON.stringify(dependencySwapMarker)}, "swapped", "utf8");`,
    ].join("\n"));
    const dependencySwapRun = runCampaignFixturePowerShell(scriptPath, dependencySwapId);
    assert.equal(dependencySwapRun.error, undefined, dependencySwapRun.error?.message);
    const dependencySwapPath = campaignSnapshotDirectory(dependencySwapId, dependencySwapSourceSha);
    const dependencySwapLink = join(dependencySwapPath, "node_modules");
    if (existsSync(dependencySwapMarker)) {
      assert.notEqual(dependencySwapRun.status, 0, "a swapped snapshot dependency junction must stop the campaign");
      const events = readEvents(dependencySwapId);
      assertBoundSourceSha(events, dependencySwapSourceSha);
      const failure = events.find((event) => event.status === "failed");
      assert.equal(failure?.phase, "after-command");
      assert.equal(failure?.sourceIntegrityFailure, "source-snapshot-dependency-drift");
      assert.equal(events.some((event) => event.status === "completed"), false);
      assert.equal(existsSync(dependencySwapSentinel), true, "unsafe dependency cleanup must not follow a swapped junction target");
    } else {
      assert.notEqual(dependencySwapRun.status, 0, "an unavailable dependency junction swap must still fail closed");
    }
    if (existsSync(dependencySwapLink)) rmdirSync(dependencySwapLink);
    if (existsSync(dependencySwapPath)) symlinkSync(nodeModulesPath, dependencySwapLink, "junction");
    removeFixtureSnapshot(dependencySwapId, dependencySwapSourceSha);
    rmSync(dependencySwapTarget, { recursive: true, force: true });

    writeFileSync(firstCommandPath, "process.exit(0);\n", "utf8");
    writeFileSync(p1CommandPath, "process.exit(0);\n", "utf8");
    writeFileSync(finalCommandPath, [
      'import { spawnSync } from "node:child_process";',
      'const result = spawnSync("git", ["-c", "user.name=LORE Campaign Fixture", "-c", "user.email=lore-campaign-fixture@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "fixture source snapshot drift"], { cwd: process.cwd(), stdio: "ignore" });',
      'process.exit(result.status ?? 1);',
    ].join("\n"), "utf8");
    runCampaignFixtureGit(root, [
      "add", "--",
      "scripts/business-logic-isolated-runner.mjs",
      "scripts/run-p1-hardening-tests.mjs",
      "scripts/test-hermetic-build.mjs",
    ]);
    runCampaignFixtureGit(root, [
      "-c", "user.name=LORE Campaign Fixture",
      "-c", "user.email=lore-campaign-fixture@example.invalid",
      "commit", "--quiet", "-m", "fixture detached snapshot source drift child",
    ]);
    const completionSourceSha = runCampaignFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const sourceDrift = runCampaignFixturePowerShell(scriptPath, "fixture-source-drift");
    assert.equal(sourceDrift.error, undefined, sourceDrift.error?.message);
    assert.notEqual(sourceDrift.status, 0, "a changed detached snapshot HEAD after the final child must block completed evidence");
    const sourceDriftEvents = readEvents("fixture-source-drift");
    assert.deepEqual(
      sourceDriftEvents.map((event) => event.status),
      ["started", ...Array(6).fill("passed"), "failed", "stopped-on-failure"],
    );
    assertBoundSourceSha(sourceDriftEvents, completionSourceSha);
    assert.equal(sourceDriftEvents.at(-2).sourceIntegrityFailure, "source-snapshot-dirty");
    assert.equal(sourceDriftEvents.at(-2).phase, "after-command");
    assert.equal(sourceDriftEvents.at(-2).command, "hermetic-build");
    assert.equal(sourceDriftEvents.some((event) => event.status === "completed"), false);
    assert.equal(
      runCampaignFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]),
      completionSourceSha,
      "detached snapshot drift must not change the original source HEAD",
    );    const existingDirectory = join(root, "artifacts", "test-campaign-2026-08-20", "fixture-existing-directory");
    mkdirSync(existingDirectory, { recursive: true });
    const existingDirectoryRun = runCampaignFixturePowerShell(scriptPath, "fixture-existing-directory");
    assert.equal(existingDirectoryRun.error, undefined, existingDirectoryRun.error?.message);
    assert.notEqual(existingDirectoryRun.status, 0, "a pre-existing campaign directory must be rejected");
    assert.match(`${existingDirectoryRun.stdout ?? ""}\n${existingDirectoryRun.stderr ?? ""}`, /requires a new campaign directory/i);
    assert.equal(
      existsSync(join(existingDirectory, "local-test-campaign.jsonl")),
      false,
      "an existing campaign directory must never be appended as fresh evidence",
    );

    appendFileSync(scriptPath, "# tracked dirty fixture\n", "utf8");
    const preflightDirty = runCampaignFixturePowerShell(scriptPath, "fixture-preflight-dirty");
    assert.notEqual(preflightDirty.status, 0, "a tracked-dirty worktree must be rejected before campaign startup");
    assert.match(`${preflightDirty.stdout ?? ""}\n${preflightDirty.stderr ?? ""}`, /requires a clean tracked worktree/i);
    assert.equal(
      existsSync(join(root, "artifacts", "test-campaign-2026-08-20", "fixture-preflight-dirty")),
      false,
      "dirty rejection must happen before creating campaign evidence",
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}

function workflowJobBlock(source, jobName) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(startIndex, -1, `CI workflow must include the ${jobName} job`);
  const endOffset = lines.slice(startIndex + 1).findIndex((line) => /^  [a-z0-9_-]+:\s*$/i.test(line));
  const endIndex = endOffset === -1 ? lines.length : startIndex + 1 + endOffset;
  return lines.slice(startIndex, endIndex).join("\n");
}

function withTemporaryEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function runReleaseOperationsTests() {
  assertLocalCampaignSourceProvenance();
  const launchPolicy = createLaunchGatePolicyMaps();
  const verifierLaunchPolicy = createLaunchGatePolicyMaps({ verifier: true });
  assert.deepEqual(launchPolicy.expected, Array.from({ length: 14 }, (_, index) => `G${index + 1}`));
  assert.deepEqual(
    Object.fromEntries(launchPolicy.launchGateGroups),
    {
      G1: "env", G2: "signoff", G3: "signoff", G4: "chain", G5: "host", G6: "host", G7: "indexer",
      G8: "restore", G9: "monitoring", G10: "canary", G11: "canary", G12: "qa", G13: "qa", G14: "qa",
    },
  );
  assert.deepEqual([...launchPolicy.gatesRequiringCanaryLog], ["G10", "G11", "G14"]);
  assert.deepEqual(launchPolicy.requiredProofFilesByGate.get("G1"), ["docs/signoff-proof.json"]);
  assert.deepEqual(launchPolicy.requiredProofFilesByGate.get("G6"), ["docs/host-proof.json"]);
  assert.deepEqual(launchPolicy.requiredProofFilesByGate.get("G7"), ["docs/indexer-proof.json"]);
  assert.deepEqual(launchPolicy.requiredProofFilesByGate.get("G14"), ["docs/qa-proof.json"]);
  assert.deepEqual(
    launchPolicy.statusBoardFirstCheckExpectations.get("G12"),
    ["proof:qa:plan", "--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", "--out=docs/qa-canary-test-plan.draft.md"],
  );
  assert.equal(launchPolicy.compactStatusCheckByGate.get("G1"), "npm.cmd run proof:mainnet:strict:compact");
  assert.equal(launchPolicy.compactStatusCheckByGate.get("G14"), "npm.cmd run proof:files:summary");
  for (const [gate, markers] of Object.entries({
    G1: ["contractEnv", "V10 protected bets"],
    G2: ["ownership.directOwnerReadEvidence", "proof tx"],
    G3: ["randomness.decision", "operator/signer sign-off"],
    G6: ["externalRateLimit", "webReplicaCount", "sharedBucketVerified", "failClosed"],
    G7: ["fresh external DB", "INDEXER_FINALITY_BLOCKS", "chainSnapshot", "rpcChainId", "contractAddress", "finalityLagBlocks", "chainComparison"],
    G8: ["backupSchedule", "retentionDays", "lastSuccessfulBackupAt"],
    G9: ["verified email alert target", "error event"],
    G10: ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "50 successful auto-miner unique epochs"],
    G12: ["Privy allowed origins", "redacted production App ID configured proof", "wrong network"],
    G14: ["final security scan", "no open High/Medium local findings"],
  })) {
    const actualMarkers = launchPolicy.requiredProofMarkerExpectations.get(gate);
    for (const marker of markers) assert.ok(actualMarkers.includes(marker), `${gate} must retain ${marker}`);
  }
  assert.deepEqual(
    verifierLaunchPolicy.requiredProofMarkerExpectations.get("G1"),
    ["contractEnv", "chain ID", "deploy block", "token", "finality", "V10 protected bets flag", "existing saved artifacts"],
  );
  assert.ok(verifierLaunchPolicy.requiredProofMarkerExpectations.get("G8").includes("existing saved artifacts"));
  assert.ok(!launchPolicy.requiredProofMarkerExpectations.get("G8").includes("existing saved artifacts"));
  launchPolicy.requiredProofMarkerExpectations.get("G14").push("mutant");
  assert.ok(!createLaunchGatePolicyMaps().requiredProofMarkerExpectations.get("G14").includes("mutant"));
  const liveCanaryPathFixtures = Array.from(
    { length: MAX_LIVE_CANARY_LOG_PATHS + 4 },
    (_, index) => `data/live-test-runs/canary-${index}.jsonl`,
  );
  assert.deepEqual(
    findLiveCanaryLogPaths(liveCanaryPathFixtures.join(" ")),
    liveCanaryPathFixtures.slice(0, MAX_LIVE_CANARY_LOG_PATHS),
  );
  assert.deepEqual(
    findLiveCanaryLogPaths("artifact: data\\live-test-runs\\windows-canary.jsonl"),
    ["data/live-test-runs/windows-canary.jsonl"],
  );
  assert.deepEqual(findLiveCanaryLogPaths("data/live-test-runs/not-jsonl.log"), []);
  const unboundedCanaryPathMutant = (value) => [
    ...String(value).matchAll(/\bdata\/live-test-runs\/[^|\s`]+\.jsonl\b/gi),
  ].map((match) => match[0]);
  assert.equal(
    unboundedCanaryPathMutant(liveCanaryPathFixtures.join(" ")).length,
    MAX_LIVE_CANARY_LOG_PATHS + 4,
    "overflow fixture must kill unbounded matchAll extraction",
  );

  const launchGateStructure = spawnSync(process.execPath, ["scripts/check-launch-gates.mjs", "--structure-only"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(launchGateStructure.status, 0, `${launchGateStructure.stdout}\n${launchGateStructure.stderr}`);
  assert.match(launchGateStructure.stdout, /Summary: launch gate table structure is consistent\./);
  const remainingLaunch = spawnSync(process.execPath, ["scripts/report-launch-remaining.mjs", "--summary-only"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(remainingLaunch.status, 0, `${remainingLaunch.stdout}\n${remainingLaunch.stderr}`);
  assert.match(remainingLaunch.stdout, /Complete gates: 0\/14[\s\S]*Remaining gates: G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12, G13, G14/);
  assert.match(remainingLaunch.stdout, /Next marker tokens: contractenv, chain-id, deploy-block, token, finality, v10-protected-bets/);

  const liveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
  const liveTestWalletConfigSource = readFileSync("scripts/live-test-wallet-config.mjs", "utf8");
  const keeperBotSource = readFileSync("bot.ts", "utf8");
  const botSupervisorSource = readFileSync("scripts/run-bot-forever.mjs", "utf8");
    const chatSessionSource = readFileSync("app/api/_lib/chatSession.ts", "utf8");
  const cleanupNextCandidatesSource = readFileSync("scripts/cleanup-next-candidates.mjs", "utf8");
  const collectIndexerEvidenceSource = readFileSync("scripts/collect-indexer-evidence.mjs", "utf8");
  const createIndexerDraftSource = readFileSync("scripts/create-indexer-proof-draft.mjs", "utf8");
    const checkIndexerDryRunSource = readFileSync("scripts/check-indexer-dry-run.mjs", "utf8");
    const chainIndexerAuditSource = readFileSync("scripts/audit-chain-indexer-window.mjs", "utf8");
    const sqliteScopeAuditSource = readFileSync("scripts/sqlite-scope-audit-lib.mjs", "utf8");
  const ciWorkflowSource = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const jobName of ["checks", "checks-windows", "dependency-audit"]) {
    const jobSource = workflowJobBlock(ciWorkflowSource, jobName);
    const setupIndex = jobSource.indexOf("- name: Setup Node.js");
    const pinIndex = jobSource.indexOf("- name: Pin exact npm 11.5.1");
    const installIndex = jobSource.indexOf("- name: Install dependencies");
    assert.ok(setupIndex >= 0 && setupIndex < pinIndex && pinIndex < installIndex,
      `${jobName} must pin npm after Node setup and before dependency installation or npm-based gates`);
    const expectedPinStep = [
      "      - name: Pin exact npm 11.5.1",
      ...(jobName === "checks-windows" ? ["        shell: bash"] : []),
      "        run: |",
      "          npm install --global --ignore-scripts npm@11.5.1",
      "          actual_npm_version=\"$(npm --version)\"",
      "          if [ \"$actual_npm_version\" != \"11.5.1\" ]; then",
      "            echo \"::error::Expected npm 11.5.1 but found ${actual_npm_version}\"",
      "            exit 1",
      "          fi",
    ].join("\n");
    assert.ok(
      jobSource.includes(expectedPinStep),
      `${jobName} must install and fail closed unless the executable npm version is exactly 11.5.1`,
    );
  }
  const prelaunchLauncher = resolveTrustedNpmCli();
  if (process.platform === "win32") {
    const trustedWindowsEnv = trustedNpmEnvironment(process.env, prelaunchLauncher);
    const nestedNodeProbe = spawnSync(
      trustedWindowsEnv.ComSpec,
      ["/d", "/s", "/c", "node -p process.execPath"],
      {
        cwd: prelaunchLauncher.repoRoot,
        env: trustedWindowsEnv,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(
      nestedNodeProbe.status,
      0,
      `trusted Windows environment must resolve nested Node successfully: ${nestedNodeProbe.error?.message ?? nestedNodeProbe.stderr}`,
    );
    assert.equal(
      String(nestedNodeProbe.stdout).trim().toLowerCase(),
      prelaunchLauncher.command.toLowerCase(),
      "trusted Windows environment must not resolve a workspace node.exe shadow",
    );
  }
  const prelaunchProbeCommand = trustedNpmCommand([
    "--silent",
    "run",
    "proof:prelaunch:summary",
    "--",
    "--launcher-diagnostic",
  ], prelaunchLauncher);
  const prelaunchLauncherProbe = spawnSync(prelaunchProbeCommand.command, prelaunchProbeCommand.args, {
    cwd: prelaunchLauncher.repoRoot,
    env: trustedNpmEnvironment({
      ...process.env,
      npm_execpath: join(tmpdir(), "untrusted-npm-cli.js"),
      npm_node_execpath: join(tmpdir(), "untrusted-node.exe"),
      PRELAUNCH_CHECK_TIMEOUT_MS: "1000",
    }, prelaunchLauncher),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(
    prelaunchLauncherProbe.status,
    78,
    `prelaunch package alias must reach the non-passing canonical launcher diagnostic: ${prelaunchLauncherProbe.error?.message ?? prelaunchLauncherProbe.stderr}`,
  );
  assert.deepEqual(
    JSON.parse(String(prelaunchLauncherProbe.stdout).trim()),
    { status: "diagnostic-only", nodeMajor: "24", npmVersion: "11.5.1" },
    "prelaunch package alias must bypass workspace node shadows and bind the declared Node/npm runtime",
  );
  const prelaunchManifestProbe = spawnSync(process.execPath, [
    "scripts/report-prelaunch-status.mjs",
    "--manifest-self-test",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PRELAUNCH_CHECK_TIMEOUT_MS: "",
      REQUIRE_P1_PERFORMANCE_RC: "",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(
    prelaunchManifestProbe.status,
    0,
    `prelaunch manifest behavior probe must pass: ${prelaunchManifestProbe.error?.message ?? prelaunchManifestProbe.stderr}`,
  );
  const prelaunchManifestSummary = JSON.parse(String(prelaunchManifestProbe.stdout).trim());
  assert.equal(prelaunchManifestSummary.status, "pass");
  assert.ok(prelaunchManifestSummary.checks >= 60, "prelaunch manifest probe must inspect the complete check set");
  assert.deepEqual(prelaunchManifestSummary.externalSequence, [
    "proof:testnet:canary:strict:summary",
    "proof:testnet:canary:v10:summary",
    "db:backup:summary",
  ]);
  assert.equal(
    prelaunchManifestSummary.faultMutantsRejected,
    4,
    "prelaunch manifest must reject missing, reordered, falsely required-local, and write-capable checks",
  );
  const productionHealthBehaviorProbe = spawnSync(process.execPath, [
    "scripts/check-production-health.mjs",
    "--behavior-self-test",
    "--summary-only",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      LINEA_CHAIN_ID: "",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "",
      PROD_HEALTH_ALLOW_DEGRADED: "0",
      PROD_HEALTH_MAX_INDEXER_STALE_MS: "",
      PROD_HEALTH_MAX_LAG_BLOCKS: "",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(
    productionHealthBehaviorProbe.status,
    0,
    `production health behavior probe must pass: ${productionHealthBehaviorProbe.error?.message ?? productionHealthBehaviorProbe.stderr}`,
  );
  assert.deepEqual(
    JSON.parse(String(productionHealthBehaviorProbe.stdout).trim()),
    {
      status: "pass",
      healthyPayloadAccepted: true,
      faultMutantsRejected: 7,
      runtimeMutantsRejected: 12,
      originCases: 10,
      fakeFetches: 1,
      externalNetworkRequests: 0,
    },
    "production health behavior probe must reject incomplete, malformed, stale, and missing-jackpot evidence without polling an endpoint",
  );
  const productionHealthThresholdFaultProbe = spawnSync(process.execPath, [
    "scripts/check-production-health.mjs",
    "--summary-only",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HEALTH_DIAGNOSTICS_SECRET: "",
      LINEA_CHAIN_ID: "",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "",
      PROD_HEALTH_BASE_URL: "https://health-proof.invalid",
      PROD_HEALTH_MAX_INDEXER_STALE_MS: "",
      PROD_HEALTH_MAX_LAG_BLOCKS: "01",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(productionHealthThresholdFaultProbe.status, 1);
  assert.equal(String(productionHealthThresholdFaultProbe.stderr).trim(), "");
  assert.deepEqual(
    JSON.parse(String(productionHealthThresholdFaultProbe.stdout).trim()),
    {
      status: "fail",
      issues: 1,
      hints: 0,
      firstIssue: "PROD_HEALTH_MAX_LAG_BLOCKS must be a canonical non-negative decimal integer",
    },
    "production health threshold faults must fail before endpoint polling with compact status evidence",
  );
  assert.doesNotMatch(
    productionHealthThresholdFaultProbe.stdout,
    /health-proof|https?:\/\/|\b01\b/i,
    "production health threshold failures must not expose the target origin or raw malformed value",
  );
  const invalidParentProbe = spawnSync(process.execPath, [
    "scripts/report-prelaunch-status.mjs",
    "--launcher-diagnostic",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      npm_node_execpath: join(tmpdir(), "missing-parent-node.exe"),
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(invalidParentProbe.status, 1);
  assert.equal(String(invalidParentProbe.stdout).trim(), "");
  assert.deepEqual(
    JSON.parse(String(invalidParentProbe.stderr).trim()),
    { status: "fail", issue: "trusted-npm-launcher-unavailable" },
    "prelaunch launcher initialization failures must be compact and must not expose raw paths or stacks",
  );
  const invalidTimeoutProbe = spawnSync(process.execPath, [
    "scripts/report-prelaunch-status.mjs",
    "--launcher-diagnostic",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PRELAUNCH_CHECK_TIMEOUT_MS: "..\\private\\wallet.key",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(invalidTimeoutProbe.status, 1);
  assert.equal(String(invalidTimeoutProbe.stdout).trim(), "");
  assert.deepEqual(
    JSON.parse(String(invalidTimeoutProbe.stderr).trim()),
    { status: "fail", issue: "invalid-prelaunch-check-timeout" },
    "malformed prelaunch timeouts must fail with compact machine-readable output and no raw value, path, or stack",
  );
  const unauthenticatedPerformanceRcProbe = spawnSync(process.execPath, [
    "scripts/report-prelaunch-status.mjs",
    "--launcher-diagnostic",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REQUIRE_P1_PERFORMANCE_RC: "1",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(unauthenticatedPerformanceRcProbe.status, 1);
  assert.equal(String(unauthenticatedPerformanceRcProbe.stdout).trim(), "");
  assert.deepEqual(
    JSON.parse(String(unauthenticatedPerformanceRcProbe.stderr).trim()),
    { status: "fail", issue: "p1-performance-rc-external-attestation-required" },
    "an unsigned local performance artifact must never become required release evidence",
  );
  const mismatchedRuntimeRoot = mkdtempSync(join(tmpdir(), "lore-prelaunch-runtime-"));
  try {
    writeFileSync(join(mismatchedRuntimeRoot, "package.json"), JSON.stringify({
      packageManager: "npm@0.0.0",
      engines: { node: "24.x" },
    }), "utf8");
    assert.throws(
      () => resolveTrustedNpmCli({ repoRoot: mismatchedRuntimeRoot }),
      /Resolved npm version does not match repository packageManager/,
      "trusted npm resolution must reject an installed npm version that differs from packageManager",
    );
    writeFileSync(join(mismatchedRuntimeRoot, "package.json"), JSON.stringify({
      packageManager: "npm@11.5.1",
      engines: { node: "23.x" },
    }), "utf8");
    assert.throws(
      () => resolveTrustedNpmCli({ repoRoot: mismatchedRuntimeRoot }),
      /Node runtime does not match the repository engine/,
      "trusted npm resolution must reject a Node runtime outside the declared major",
    );
  } finally {
    rmSync(mismatchedRuntimeRoot, { recursive: true, force: true });
  }
  const sqliteScopeAudit = sqliteScopeAuditModule.default ?? sqliteScopeAuditModule;
  assert.equal(sqliteScopeAudit.normalizeSqliteCount(3), 3);
  assert.equal(sqliteScopeAudit.normalizeSqliteCount(3n), 3);
  assert.equal(sqliteScopeAudit.normalizeSqliteCount("3"), 3);
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(-1));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(1.5));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount("1e3"));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount("01"));
  assert.throws(() => sqliteScopeAudit.normalizeSqliteCount(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
  for (const [label, source] of [
    ["collect-indexer-evidence", collectIndexerEvidenceSource],
    ["create-indexer-proof-draft", createIndexerDraftSource],
  ]) {
    assert.match(
      source,
      /const requestedEpochs = parseInteger\(epochs\)[\s\S]*requestedEpochs !== null && requestedEpochs > 0[\s\S]*uniqueCheckedEpochs\.length >= requestedEpochs/,
      `${label} must reuse canonical parsed --epochs for chain-snapshot coverage checks`,
    );
    assert.doesNotMatch(
      source,
      /Number\(epochs\)/,
      `${label} must not broadly coerce --epochs after validation`,
    );
  }
  assert.match(
    collectIndexerEvidenceSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*requestedEpochs,/,
    "indexer evidence collector must publish the same canonical parsed epoch count it validates",
  );
  assert.match(
    liveRoundCanarySource,
    /APP_NETWORK !== "sepolia" \|\| APP_CHAIN\.id !== 59141/,
    "live canary must fail closed outside Linea Sepolia before transaction-capable setup",
  );
  assert.match(
    liveTestWalletConfigSource,
    /function readIsolatedEnvFile\(cwd, filename, label\)[\s\S]*lstatSync\(filePath\)[\s\S]*stat\.isSymbolicLink\(\) \|\| !stat\.isFile\(\)[\s\S]*openSync\(filePath, "r"\)[\s\S]*fstatSync\(fd\)[\s\S]*export function loadLiveTestExecutionWalletConfig[\s\S]*readIsolatedEnvFile\(cwd, "\.env\.live-test-wallets", "wallet"\)/,
    "execution wallet config must reject non-ordinary or replaced secret files before parsing signing material",
  );
  assert.match(
    liveRoundCanarySource,
    /loadLiveTestExecutionWalletConfig[\s\S]*executionWalletConfig = loadExecutionWalletAdmission\([\s\S]*wallets = loadWallets\(executionWalletConfig\)/,
    "live canary must use the isolated execution-wallet admission before creating signer wallets",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /console\.error\("\[live-canary\] failed", error\)/,
    "live canary fatal handler must not print raw errors",
  );
  assert.match(
    keeperBotSource,
    /function describeKeeperError[\s\S]*sanitizeSentryPayload[\s\S]*console\.error\("\[keeper\] Fatal startup error:", describeKeeperError\(err\)\)/,
    "keeper logs must sanitize provider and alert transport errors before output",
  );
  assert.match(
    keeperBotSource,
    /MAX_ALERT_RESPONSE_BYTES\s*=\s*64\s*\*\s*1024[\s\S]*ALERT_CONTENT_LENGTH_RE\s*=\s*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*async function readBoundedAlertResponseText\(response: Response\)[\s\S]*parseAlertContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*reader\.cancel[\s\S]*function parseAlertContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "keeper Telegram alert failures must bound response body reads before logging transport errors",
  );
  assert.doesNotMatch(
    keeperBotSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "keeper Telegram alert failures must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    keeperBotSource,
    /res\.text\(\)/,
    "keeper Telegram alert failures must not use unbounded response.text",
  );
  assert.match(
    botSupervisorSource,
    /function describeSupervisorError[\s\S]*SECRET_PATTERNS[\s\S]*failed to send alert: \$\{describeSupervisorError\(err\)\}/,
    "bot supervisor alert errors must be redacted before terminal output",
  );
  assert.match(
    botSupervisorSource,
    /process error: \$\{describeSupervisorError\(error\)\}/,
    "bot supervisor process errors must be redacted before terminal output",
  );
  assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000, 100_000), 120_000);
  assert.equal(chatSession.normalizeChatSessionExpiresAt("120000", 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(120_000.5, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(99_999, 100_000), null);
  assert.equal(chatSession.normalizeChatSessionExpiresAt(100_000 + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 60_001, 100_000), null);
  for (const malformedChatCookie of [
    `${"a".repeat(1025)}.sig`,
    "encoded.sig.extra",
    "encoded.signature!",
  ]) {
    assert.equal(
      withTemporaryEnv({ NODE_ENV: "production", CHAT_AUTH_SECRET: undefined, NEXTAUTH_SECRET: undefined }, () =>
        chatSession.readChatSession({ cookies: { get: () => ({ value: malformedChatCookie }) } }),
      ),
      null,
      "malformed chat session cookies must fail before production secret/HMAC lookup",
    );
  }
  for (const [name, source] of [["chat", chatSessionSource]]) {
    assert.match(source, /randomBytes\(32\)\.toString\("hex"\)/, `${name} development sessions must use an ephemeral secret`);
    assert.doesNotMatch(source, /createHash\(|dev-(admin|chat)-session:/, `${name} development sessions must not derive a predictable secret`);
  }
  assert.match(
    collectIndexerEvidenceSource,
    /function normalizeRpcSource\(value\)[\s\S]*!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash[\s\S]*rpcSource must be a redacted label or origin-only URL/,
    "indexer evidence collector must reject credentialed or path-sensitive RPC source URLs",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /MAX_INDEXER_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readOptionalLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "indexer evidence collector must reject directory and oversized log artifacts before reading them",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function readOptionalJson\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*JSON artifact is too large to validate safely[\s\S]*--\$\{name\} must be valid JSON[\s\S]*--\$\{name\} must be a JSON object artifact/,
    "indexer evidence collector must reject directory and oversized JSON artifacts before parsing them",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct indexer evidence files/,
    "indexer evidence collector must reject one artifact reused across indexer evidence inputs",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*CANONICAL_POSITIVE_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isCanonicalNonNegativeInteger[\s\S]*function parseInteger[\s\S]*const parsed = BigInt\(text\)[\s\S]*function isCanonicalPositiveInteger/,
    "indexer evidence collector must define canonical integer parsers",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function requireMatchingChainId[\s\S]*canonical positive decimal integer[\s\S]*must match \$\{expected\}/,
    "indexer evidence collector must strictly parse chain snapshot chain IDs before writing drafts",
  );
  assert.match(
    collectIndexerEvidenceSource,
    /function isCanonicalNonNegativeInteger\(value\)[\s\S]*parseInteger\(value\) !== null[\s\S]*function parseInteger\(value\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*finalityLagIsNumeric = isCanonicalNonNegativeInteger\(healthValues\.finalityLagBlocks\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "indexer evidence collector must BigInt-bound finality lag evidence before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /MAX_INDEXER_EVIDENCE_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*function readRequiredJson\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*stat\.size > MAX_INDEXER_EVIDENCE_BYTES[\s\S]*JSON artifact is too large to validate safely[\s\S]*--\$\{name\} must be valid JSON[\s\S]*--\$\{name\} must be a JSON object artifact/,
    "indexer proof draft generation must reject directory and oversized artifacts before reading or parsing them",
  );
  assert.match(
    createIndexerDraftSource,
    /function requireDistinctArtifactInputs\(entries\)[\s\S]*--\$\{leftName\} and --\$\{rightName\} must point to distinct indexer evidence files/,
    "indexer proof draft generation must reject one artifact reused across indexer evidence inputs",
  );
  assert.match(
    createIndexerDraftSource,
    /function normalizeRpcSource\(value\)[\s\S]*!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash[\s\S]*rpcSource must be a redacted label or origin-only URL[\s\S]*const rpcSource = normalizeRpcSource\(chainSnapshot\?\.rpcSource\) \|\| "TODO"/,
    "indexer proof draft generation must reject credentialed or path-sensitive RPC source URLs before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /CANONICAL_NON_NEGATIVE_INTEGER_RE[\s\S]*CANONICAL_POSITIVE_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseInteger[\s\S]*const parsed = BigInt\(text\)[\s\S]*function isPositiveInteger[\s\S]*function isNonNegativeInteger/,
    "indexer proof draft generation must define canonical integer parsers",
  );
  assert.match(
    createIndexerDraftSource,
    /function requireMatchingChainId[\s\S]*canonical positive decimal integer[\s\S]*must match \$\{expected\}/,
    "indexer proof draft generation must strictly parse chain snapshot chain IDs before writing drafts",
  );
  assert.match(
    createIndexerDraftSource,
    /function parseInteger\(value\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*finalityLagIsNumeric = isNonNegativeInteger\(healthValues\.finalityLagBlocks\)[\s\S]*canonical non-negative decimal finalityLagBlocks=<number>/,
    "indexer proof draft generation must BigInt-bound finality lag evidence before writing drafts",
  );
  for (const [label, source] of [
    ["collect-indexer-evidence", collectIndexerEvidenceSource],
    ["create-indexer-proof-draft", createIndexerDraftSource],
  ]) {
    assert.match(
      source,
      /const MAX_KEY_VALUE_MARKERS = 64[\s\S]*function parseKeyValues\(line = ""\)[\s\S]*pattern\.exec\(line\)[\s\S]*inspected > MAX_KEY_VALUE_MARKERS[\s\S]*too many key\/value markers to validate safely/,
      `${label} must cap key/value parsing before accepting indexer health evidence`,
    );
    assert.doesNotMatch(
      source,
      /line\.matchAll\(/,
      `${label} must not parse indexer health evidence through matchAll`,
    );
  }
  assert.doesNotMatch(
    `${collectIndexerEvidenceSource}\n${createIndexerDraftSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "indexer evidence collector and draft generator must not bypass regularFileStat for resolved artifact paths",
  );
  assert.doesNotMatch(
    `${collectIndexerEvidenceSource}\n${createIndexerDraftSource}`,
    /Number\(value\)\s*===\s*Number\(expected\)|Number\(expectedSnapshotChainId\)|Number\(rpcSnapshotChainId\)|Number\.isFinite\(Number\(healthValues\.finalityLagBlocks\)\)/,
    "indexer evidence draft tooling must not use broad numeric fallback for chain IDs or finalityLagBlocks",
  );
  const proofDraftRegressionSourceForIndexer = readFileSync("scripts/check-proof-drafts.mjs", "utf8");
  assert.ok(
    [
      "hostHealthMalformedFinalityLog",
      "hostHealthUnsafeFinalityLog",
      "9999999999999999",
      "host-collector-malformed-finality-lag",
      "host-collector-unsafe-finality-lag",
      "host-draft-malformed-finality-lag",
      "host-draft-unsafe-finality-lag",
      "canonical non-negative decimal finalityLagBlocks=<number>",
    ].every((marker) => proofDraftRegressionSourceForIndexer.includes(marker)),
    "proof draft regressions must cover malformed and unsafe host finalityLagBlocks in collector and draft paths",
  );
  assert.ok(
    [
      "indexerHealthUnsafeFinalityLog",
      "9999999999999999",
      "indexer-unsafe-finality-artifact",
      "indexer-collector-malformed-finality-lag",
      "indexer-collector-unsafe-finality-lag",
      "indexer-collector-malformed-chain-id",
      "indexer-draft-malformed-finality-lag",
      "indexer-draft-unsafe-finality-lag",
      "indexer-draft-malformed-chain-id",
      "canonical non-negative decimal finalityLagBlocks=<number>",
      "canonical positive decimal integer",
    ].every((marker) => proofDraftRegressionSourceForIndexer.includes(marker)),
    "proof draft regressions must cover malformed and unsafe indexer chain IDs and finalityLagBlocks in collector, draft, and strict artifact paths",
  );
  assert.match(
    checkIndexerDryRunSource,
    /!parsed\.username && !parsed\.password && !parsed\.search && !parsed\.hash/,
    "indexer evidence checker must reject credential-bearing or path-sensitive RPC source URLs",
  );
  assert.match(
    checkIndexerDryRunSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseCanonicalNonNegativeInteger\(value\)[\s\S]*CANONICAL_NON_NEGATIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function parseCanonicalPositiveInteger\(value\)/,
    "indexer proof checker must BigInt-bound canonical integer evidence before strict validation",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function sharedIndexerSectionArtifactIssues\(manifest\)[\s\S]*normalizedArtifactPathSet[\s\S]*indexer evidence sections must use distinct local artifact files across/,
    "indexer proof validation must reject one artifact reused across dry-run, finality, and chain-snapshot sections",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function fmtMtime\(filePath\)[\s\S]*const stats = regularFileStat\(filePath\)[\s\S]*stats \? stats\.mtime\.toISOString\(\) : "missing"[\s\S]*function fileExists\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null/,
    "indexer proof must derive mtime and file presence from a shared regular-file stat boundary",
  );
  assert.match(
    checkIndexerDryRunSource,
    /function localArtifactIsFile\(artifactPath\)[\s\S]*regularFileStat\(resolve\(process\.cwd\(\), artifactPath\)\) !== null/,
    "indexer proof must derive local artifact existence from the shared regular-file stat boundary",
  );
  const analyzeCanarySource = readFileSync("scripts/analyze-live-canary-proof.mjs", "utf8");
  const createCanaryDraftSource = readFileSync("scripts/create-canary-proof-draft.mjs", "utf8");
  const collectSignoffSource = readFileSync("scripts/collect-signoff-evidence.mjs", "utf8");
  const createSignoffDraftSource = readFileSync("scripts/create-signoff-proof-draft.mjs", "utf8");
  assert.match(
    analyzeCanarySource,
    /JSONL_READ_CHUNK_BYTES[\s\S]*function readJsonl[\s\S]*readSync/,
    "live canary proof analysis must read long JSONL artifacts in bounded chunks",
  );
  assert.ok(
    analyzeCanarySource.includes('JSON.parse(line.replace(/^\\uFEFF/, ""))'),
    "live canary proof analysis must tolerate UTF-8 BOM on the first JSONL record",
  );
  assert.equal(
    packageScripts["proof:canary:summary"],
    "node scripts/analyze-live-canary-proof.mjs --summary-only",
    "launch canary proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=testnet --summary-only",
    "testnet canary proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:strict:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=testnet --strict --require-canary-admission --summary-only",
    "testnet canary proof must expose a compact strict summary command for launch checks",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:v10:summary"],
    "node scripts/analyze-live-canary-proof.mjs --profile=v10-matrix --strict --summary-only --require-epoch-bound --require-v10-gas-matrix --require-v10-deployment-manifest",
    "V10 testnet canary matrix proof must expose a compact fail-closed summary command",
  );
  assert.match(
    analyzeCanarySource,
    /function hasNonFutureIsoTimestamp[\s\S]*Date\.now\(\) \+ 5 \* 60 \* 1000[\s\S]*targetNetwork\.checkedAt must not be in the future[\s\S]*recovery\.\$\{check\}\.checkedAt must not be in the future[\s\S]*autoMinerSession\.checkedAt must not be in the future[\s\S]*transactionHealth\.checkedAt must not be in the future/,
    "canary proof analyzer must reject future-dated target, recovery, auto-miner session, and transaction health timestamps",
  );
  assert.match(
    analyzeCanarySource,
    /const canaryLaunchGates = \["G10", "G11"\][\s\S]*const canaryLaunchGateGroups = "canary=2"[\s\S]*function launchGateSummary\(issueCount\)[\s\S]*blocked[\s\S]*covered[\s\S]*launchGateSummary\(strictFailures\.length\)[\s\S]*launchGateSummary\(1\)/,
    "canary proof summary must identify both G10 epoch and G11 recovery gates without printing live log details",
  );
  assert.match(
    analyzeCanarySource,
    /summaryOnly \? manifestSummaryStatus\(\) : \(manifestPath \? resolve\(process\.cwd\(\), manifestPath\) : "not required"\)/,
    "canary proof summary output must avoid printing the absolute manifest path",
  );
  assert.match(
    analyzeCanarySource,
    /function regularFileStat\(filePath\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function isExistingFile\(filePath\)[\s\S]*regularFileStat\(filePath\) !== null[\s\S]*function manifestSummaryStatus\(\)[\s\S]*isExistingFile\(resolve\(process\.cwd\(\), manifestPath\)\) \? "present" : "missing"/,
    "canary proof summary must classify only regular manifest files as present",
  );
  assert.match(
    analyzeCanarySource,
    /MAX_CANARY_PROOF_MANIFEST_BYTES = 512 \* 1024[\s\S]*const manifestStat = regularFileStat\(absolutePath\)[\s\S]*!manifestStat[\s\S]*canary proof manifest must be a file[\s\S]*manifestStat\.size > MAX_CANARY_PROOF_MANIFEST_BYTES[\s\S]*canary proof manifest is too large to validate safely[\s\S]*JSON\.parse\(readFileSync\(absolutePath, "utf8"\)\)/,
    "canary proof analyzer must size-gate proof manifests before parsing JSON",
  );
  assert.match(
    analyzeCanarySource,
    /else if \(!isExistingFile\(resolve\(process\.cwd\(\), logPath\)\)\)[\s\S]*live canary log must be a file/,
    "canary proof analyzer must reject directory live-log inputs before opening them",
  );
  assert.match(
    analyzeCanarySource,
    /function printMissingLogSummary[\s\S]*Log: missing[\s\S]*Summary: 1 proof issue\(s\):/,
    "canary proof summary output must report missing logs without dumping local paths",
  );
  assert.match(
    analyzeCanarySource,
    /function failInvalidJsonl[\s\S]*if \(summaryOnly\)[\s\S]*printMissingLogSummary\(`live canary log contains invalid JSONL at line \$\{lineNumber\}: \$\{summaryDetail\}`\)[\s\S]*Invalid JSONL at \$\{basename\(path\)\}:\$\{lineNumber\}/,
    "canary proof summary output must avoid absolute paths and raw JSONL snippets for parse failures",
  );
  assert.match(
    analyzeCanarySource,
    /if \(failedResolve\.length > 0 && !summaryOnly\)[\s\S]*if \(duplicateSuccessfulTxHashes\.length > 0 && !summaryOnly\)[\s\S]*if \(duplicateKeys\.length > 0 && !summaryOnly\)/,
    "canary proof summary output must avoid tx hash and duplicate-key sample sections",
  );
  assert.match(
    analyzeCanarySource,
    /import \{ closeSync, existsSync, openSync, readFileSync, readSync, statSync \}[\s\S]*function regularFileStat\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function findMissingLocalArtifactRefs[\s\S]*regularFileStat\(resolvedArtifact\)[\s\S]*function artifactBackedEvidenceText[\s\S]*regularFileStat\(resolved\)/,
    "canary proof analyzer must reject directory artifact references before reading manifest-backed evidence",
  );
  assert.match(
    analyzeCanarySource,
    /MAX_CANARY_ARTIFACT_TEXT_BYTES = 256 \* 1024[\s\S]*function readBoundedArtifactText\(resolved\)[\s\S]*openSync\(resolved, "r"\)[\s\S]*readSync\(fd, buffer, 0, buffer\.length, 0\)[\s\S]*closeSync\(fd\)[\s\S]*artifactBackedEvidenceText\(value\)[\s\S]*readBoundedArtifactText\(resolved\)/,
    "canary proof analyzer must read bounded local artifact snippets for manifest-backed evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /readFileSync\(resolved,\s*"utf8"\)\.slice/,
    "canary proof analyzer must not read whole local artifacts before slicing snippets",
  );
  assert.match(
    analyzeCanarySource,
    /function sharedCanarySectionArtifactIssues[\s\S]*targetNetwork[\s\S]*recovery[\s\S]*autoMinerSession[\s\S]*transactionHealth/,
    "canary proof analyzer must reject one artifact reused across independent canary evidence sections",
  );
  assert.ok(
    analyzeCanarySource.includes("canary evidence sections must use distinct local artifact files across"),
    "canary proof analyzer must explain reused canary evidence section artifacts",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /readFileSync\(path,\s*"utf8"\)[\s\S]*\.split\(\s*\/\\r\?\\n\//,
    "live canary proof analysis must not load the full JSONL artifact before parsing",
  );
  assert.match(
    createCanaryDraftSource,
    /JSONL_READ_CHUNK_BYTES[\s\S]*function readJsonlArtifact[\s\S]*readSync/,
    "live canary proof draft generation must read long JSONL artifacts in bounded chunks",
  );
  assert.ok(
    createCanaryDraftSource.includes('JSON.parse(line.replace(/^\\uFEFF/, ""))'),
    "live canary proof draft generation must tolerate UTF-8 BOM on the first JSONL record",
  );
  assert.match(
    createCanaryDraftSource,
    /const displayPath = path\.basename\(filePath\)[\s\S]*Invalid JSONL at \$\{displayPath\}:\$\{lineNumber\}: parse error/,
    "live canary proof draft generation must avoid absolute paths and raw JSONL snippets for parse failures",
  );
  assert.match(
    createCanaryDraftSource,
    /import \{ closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync \}[\s\S]*MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*function requireExistingArtifact\(name\)[\s\S]*const stats = regularFileStat\(resolved\)[\s\S]*if \(!stats\)[\s\S]*stats\.size > MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES[\s\S]*too large to reference safely/,
    "live canary proof draft generation must reject directory artifact inputs before reading them",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "live canary proof draft generation must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    createCanaryDraftSource,
    /function requireDistinctArtifactInputs[\s\S]*distinct canary evidence files[\s\S]*target-artifact[\s\S]*recovery-artifact[\s\S]*session-artifact[\s\S]*tx-artifact/,
    "live canary proof draft generation must reject reused target, recovery, session, and transaction artifacts",
  );
  assert.match(
    createCanaryDraftSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveInteger\(value\)[\s\S]*CANONICAL_POSITIVE_INTEGER_RE\.test\(text\)[\s\S]*const parsed = BigInt\(text\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT \? Number\(parsed\) : null[\s\S]*const parsedChainId = parsePositiveInteger\(chainId\)[\s\S]*chainId: parsedChainId/,
    "live canary proof draft generation must publish the same safe parsed chain id it validates",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /readFileSync\(path\.resolve\(process\.cwd\(\), filePath\),\s*"utf8"\)[\s\S]*\.split\(\s*\/\\r\?\\n\/|chainId:\s*Number\(chainId\)/,
    "live canary proof draft generation must not load the full JSONL artifact before parsing or broadly coerce chain id evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /GENERIC_RPC_LABEL_RE[\s\S]*LIVE_CANARY_RPC_LABEL must be a concrete redacted RPC label/,
    "live canary must fail before transactions when the redacted RPC label is missing or generic",
  );
  assert.match(
    liveRoundCanarySource,
    /http request[\s\S]*rpc[\s\S]*connection[\s\S]*socket/,
    "live canary must classify common provider transport failures as network errors",
  );
  assert.match(
    chainIndexerAuditSource,
    /decoded\.eventName === "ResolverRewardAccrued" && inEpochWindow[\s\S]*decoded\.eventName === "ResolverRewardClaimed"/,
    "chain/indexer audit must keep epoch-scoped resolver accruals inside the selected epoch window",
  );
  assert.match(
    analyzeCanarySource,
    /BET_MODES\.has\(event\.mode\)/,
    "canary analyzer must not count preflight, resolve, wait, or summary events as bet transactions",
  );
  assert.match(
    readFileSync("scripts/canary-proof-profile.mjs", "utf8"),
    /launch:[\s\S]*requiredRoles:\s*\["MANUAL",\s*"AUTOMINER_A",\s*"AUTOMINER_B"\][\s\S]*testnet:[\s\S]*requiredRoles:\s*\["MANUAL",\s*"AUTOMINER_A",\s*"AUTOMINER_B"\][\s\S]*"v10-matrix":(?![\s\S]*requiredRoles)/,
    "launch/testnet canary proof must require MANUAL/AUTOMINER_A/AUTOMINER_B role coverage while keeping V10 matrix exempt",
  );
  assert.match(
    analyzeCanarySource,
    /requiredCanaryRoles[\s\S]*successfulRoles[\s\S]*missingRequiredCanaryRoles[\s\S]*successful required canary roles missing/,
    "strict canary proof must fail when required live-test roles are missing from successful bets",
  );
  assert.match(
    analyzeCanarySource,
    /unexpectedSuccessfulCanaryRoles[\s\S]*successfulRoles\.filter\(\(role\) => !requiredCanaryRoles\.includes\(role\)\)[\s\S]*unexpected successful canary roles/,
    "strict canary proof must reject successful roles outside the profile-required role set",
  );
  assert.match(
    analyzeCanarySource,
    /autoMinerSession\.requiredRoles[\s\S]*autoMinerSession\.successfulRoles[\s\S]*missingManifestRequiredRoles[\s\S]*missingManifestSuccessfulRoles[\s\S]*unexpectedManifestRequiredRoles[\s\S]*unexpectedManifestSuccessfulRoles/,
    "canary proof manifest must record exactly the required and successful role coverage",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryUnexpectedRoleLog[\s\S]*role: "AUTOMINER_C"[\s\S]*canary-unexpected-successful-role[\s\S]*unexpected successful canary roles: AUTOMINER_C/,
    "proof draft regression suite must reject canary logs with extra successful roles",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canary-future-timestamp[\s\S]*targetNetwork\.checkedAt must not be in the future/,
    "proof draft regression suite must reject strict canary proof with future-dated manifest timestamps",
  );
  assert.match(
    analyzeCanarySource,
    /CANONICAL_POSITIVE_INTEGER_RE[\s\S]*targetNetwork\.chainId must be a canonical positive decimal integer[\s\S]*configured chain id must be a canonical positive decimal integer[\s\S]*function positiveIntegerString/,
    "canary proof analyzer must canonicalize target chain IDs before strict proof acceptance",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(targetNetwork\.chainId\)|Number\(expectedChainId\)|Number\(event\.chainId\)/,
    "canary proof analyzer must not use broad numeric fallback for target or live-log chain IDs",
  );
  assert.match(
    createCanaryDraftSource,
    /CANONICAL_POSITIVE_INTEGER_RE[\s\S]*function positiveIntegerString[\s\S]*--chain-id must be a canonical positive decimal integer/,
    "canary proof draft generation must canonicalize target chain IDs before writing draft evidence",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /Number\(event\.chainId\)|Number\(expectedChainId\)/,
    "canary proof draft generation must not use broad numeric fallback for live-log chain IDs",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canary-malformed-target-chain-id[\s\S]*targetNetwork\.chainId must be a canonical positive decimal integer[\s\S]*canary-live-log-malformed-chain-id[\s\S]*target metadata mismatches[\s\S]*canary-draft-malformed-chain-id[\s\S]*--chain-id must be a canonical positive decimal integer[\s\S]*canary-draft-malformed-live-chain-id[\s\S]*--live-log target metadata must match/,
    "proof draft regression suite must reject malformed canary chain IDs in strict manifest, live-log, and draft paths",
  );
  assert.match(
    analyzeCanarySource,
    /malformedBetTileEvidence[\s\S]*malformed bet tile evidence \$\{malformedBetTileEvidence\.length\}[\s\S]*function parseBetTiles/,
    "canary proof analyzer must fail closed on malformed successful bet tile evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource.match(/function findDuplicateBetKeys\(bets\)[\s\S]*?function findDuplicateTxHashes/)?.[0] ?? "",
    /tiles\.map\(Number\)|Array\.isArray\(event\.tiles\) \? event\.tiles : \[\]/,
    "duplicate bet proof must use canonical parsed tiles instead of raw tile fallback",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTileLog[\s\S]*tiles: \["1\.0"\][\s\S]*canary-live-log-malformed-tile[\s\S]*malformed bet tile evidence 1/,
    "proof draft regression suite must reject malformed canary tile evidence in successful live-log bets",
  );
  assert.match(
    analyzeCanarySource,
    /malformedTxMetricEvidence[\s\S]*malformed successful tx metric evidence \$\{malformedTxMetricEvidence\.length\}[\s\S]*function nonNegativeValue[\s\S]*function hasMalformedSuccessfulTxMetricEvidence/,
    "canary proof analyzer must fail closed on malformed successful tx metric evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(event\.durationMs\)|Number\(event\.gasUsed\)|Number\(event\[field\]\)/,
    "canary proof analyzer must not use broad numeric fallback for successful tx stats or health trends",
  );
  assert.match(
    analyzeCanarySource,
    /manifestAutoMinerRounds = positiveIntegerValue\(manifestSummary\.autoMinerSession\.rounds\)[\s\S]*manifestAutoMinerUniqueEpochs = positiveIntegerValue\(manifestSummary\.autoMinerSession\.uniqueEpochs\)[\s\S]*function positiveIntegerValue/,
    "canary proof analyzer must canonicalize manifest auto-miner counts before comparing live evidence",
  );
  assert.doesNotMatch(
    analyzeCanarySource,
    /Number\(manifestSummary\.autoMinerSession\.rounds\)|Number\(manifestSummary\.autoMinerSession\.uniqueEpochs\)/,
    "canary proof analyzer must not use broad numeric fallback for manifest auto-miner counts",
  );
  assert.match(
    analyzeCanarySource,
    /targetNetworkOk:[\s\S]*normalizeNetwork\(targetNetwork\.network\) === profile\.network[\s\S]*normalizeNetwork\(targetNetwork\.network\) === normalizeNetwork\(expectedNetwork\)[\s\S]*targetChainIdString === String\(profile\.chainId\)[\s\S]*targetChainIdString === expectedChainIdString[\s\S]*normalizeAddress\(targetNetwork\.contractAddress\) === normalizeAddress\(expectedContract\)/,
    "canary manifest summary must mark targetNetwork as issue when configured network, chain id, or contract address mismatches strict validation",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTxMetricLog[\s\S]*durationMs: "1\.5"[\s\S]*gasUsed: "2e1"[\s\S]*canary-live-log-malformed-tx-metric[\s\S]*malformed successful tx metric evidence 1/,
    "proof draft regression suite must reject malformed canary tx metric evidence in successful live-log bets",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedSessionCountsManifest[\s\S]*rounds: "51\.0"[\s\S]*uniqueEpochs: "5\.1e1"[\s\S]*canary-malformed-session-counts[\s\S]*autoMinerSession\.rounds must be a positive integer/,
    "proof draft regression suite must reject malformed canary manifest auto-miner counts",
  );
  assert.match(
    analyzeCanarySource,
    /function duplicateRoleEntries[\s\S]*autoMinerSession\.successfulRoles contains duplicate role entries/,
    "canary proof analyzer must fail closed on duplicate auto-miner role entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryDuplicateSessionRolesManifest[\s\S]*successfulRoles: \["MANUAL", "AUTOMINER_A", "AUTOMINER_A", "AUTOMINER_B"\][\s\S]*canary-duplicate-session-roles[\s\S]*autoMinerSession\.successfulRoles contains duplicate role entries 2/,
    "proof draft regression suite must reject duplicate canary auto-miner role entries",
  );
  assert.match(
    analyzeCanarySource,
    /autoMinerSessionOk:[\s\S]*duplicateManifestRequiredRoles\.length === 0[\s\S]*duplicateManifestSuccessfulRoles\.length === 0[\s\S]*hasAutoMinerSessionProof\(autoMinerSession\)/,
    "canary manifest summary must mark Auto-Miner session as issue when duplicate roles or weak evidence are present",
  );
  assert.match(
    analyzeCanarySource,
    /function malformedTxHashEntries[\s\S]*transactionHealth\.txHashes contains malformed tx hash entries/,
    "canary proof analyzer must fail closed on malformed transactionHealth tx hash entries",
  );
  assert.match(
    analyzeCanarySource,
    /function duplicateTxHashEntries[\s\S]*transactionHealth\.txHashes contains duplicate tx hash entries/,
    "canary proof analyzer must fail closed on duplicate transactionHealth tx hash entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryMalformedTransactionHashesManifest[\s\S]*txHashes: \[canaryFullTxHashes\[0\], "0x1234"\][\s\S]*canary-malformed-transaction-hashes[\s\S]*transactionHealth\.txHashes contains malformed tx hash entries 1/,
    "proof draft regression suite must reject mixed valid and malformed canary manifest tx hash entries",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /canaryDuplicateTransactionHashesManifest[\s\S]*txHashes: \[canaryFullTxHashes\[0\], canaryFullTxHashes\[0\]\][\s\S]*canary-duplicate-transaction-hashes[\s\S]*transactionHealth\.txHashes contains duplicate tx hash entries 1/,
    "proof draft regression suite must reject duplicate canary manifest tx hash entries",
  );
  assert.match(
    analyzeCanarySource,
    /transactionHealthOk:[\s\S]*malformedTransactionHealthTxHashes\.length === 0[\s\S]*duplicateTransactionHealthTxHashes\.length === 0[\s\S]*hasTransactionHealthProof\(transactionHealth\)/,
    "canary manifest summary must mark transaction health as issue when malformed hashes, duplicate hashes, or weak evidence are present",
  );
  assert.match(
    createCanaryDraftSource,
    /requiredRoles = normalizeRoleList\(profile\.requiredRoles\)[\s\S]*requiredRoles,[\s\S]*successfulRoles: summary\.successfulRoles/,
    "canary proof draft must preserve required and observed successful roles",
  );
  assert.match(
    readFileSync("docs/mainnet-status-board.md", "utf8"),
    /Latest aggregate verification:[\s\S]*V10 dry-run Preview[\s\S]*transactionSent=false[\s\S]*preview:canary:v10:authorization-ready:summary[\s\S]*npm\.cmd run proof:prelaunch:summary[\s\S]*all required local rows passed[\s\S]*24 external\/status blockers[\s\S]*0\/14 Complete[\s\S]*residual security follow-up 8\/8[\s\S]*appResolveEpochFiles=0[\s\S]*ABI\/indexer storage[\s\S]*sameBlockEventOrdering=true/,
    "mainnet status board must show the latest aggregate local verification without claiming launch completion",
  );
  assert.match(
    readFileSync("docs/mainnet-status-board.md", "utf8"),
    /Last local verification:[\s\S]*L1-L17[\s\S]*residual security follow-up 8\/8[\s\S]*appResolveEpochFiles=0[\s\S]*G1-G14 remain Missing pending external evidence[\s\S]*G14[\s\S]*fresh final security scan[\s\S]*no open High\/Medium local findings/,
    "mainnet status board must keep L1-L17 local verification and final security scan G14 blocker visible",
  );
  assert.doesNotMatch(
    createCanaryDraftSource,
    /TODO: verified\/pass/,
    "canary draft instructions must not suggest a combined status rejected by the strict validator",
  );
  assert.match(
    collectSignoffSource,
    /randomness-decision[\s\S]*randomness-operator[\s\S]*randomness-signed-at[\s\S]*randomness-evidence[\s\S]*randomness-risk-accepted/,
    "signoff collector must support reproducible CLI-provided randomness acceptance evidence",
  );
  assert.match(
    collectSignoffSource,
    /MAX_SIGNOFF_LOG_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_SIGNOFF_LOG_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "signoff collector must reject directory and oversized paths before reading evidence artifacts",
  );
  assert.match(
    createSignoffDraftSource,
    /MAX_SIGNOFF_LOG_BYTES = 512 \* 1024[\s\S]*function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stat\.isFile\(\) \? stat : null[\s\S]*function readRequiredLog\(name, filePath\)[\s\S]*const stat = regularFileStat\(resolved\)[\s\S]*if \(!stat\)[\s\S]*stat\.size > MAX_SIGNOFF_LOG_BYTES[\s\S]*artifact is too large to validate safely[\s\S]*readFileSync\(resolved, "utf8"\)/,
    "signoff proof draft must reject directory and oversized paths before reading evidence artifacts",
  );
  assert.doesNotMatch(
    `${collectSignoffSource}\n${createSignoffDraftSource}`,
    /existsSync\(resolved\)|statSync\(resolved\)\.isFile\(\)/,
    "signoff collector and draft generator must not bypass regularFileStat for resolved artifact paths",
  );
  assert.match(
    collectSignoffSource,
    /function requireChainComparisonLog[\s\S]*proof:chain[\s\S]*direct\[-\\s\]\?chain[\s\S]*jackpot, safetyPool, deposits, rewards, rebates, and resolve/,
    "signoff collector must reject chain logs missing direct-chain comparison coverage",
  );
  assert.match(
    `${readFileSync("docs/mainnet-readiness-checklist.md", "utf8")}\n${readFileSync("docs/production-runbook.md", "utf8")}`,
    /current non-VRF[\s\S]*not a requirement to redesign randomness before mainnet[\s\S]*randomness\.decision=accepted-risk[\s\S]*current non-VRF model/,
    "launch docs must frame randomness as explicit current-model acceptance, not a mandatory pre-mainnet redesign",
  );
  assert.match(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /Local\s+V10 compiler provenance is reproducible and manifest-matched[\s\S]*Final mainnet\s+readiness still requires fresh external/,
    "V10 design doc must distinguish local reproducibility from remaining external launch evidence",
  );
  assert.match(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /local production-build API\/UI smoke pass[\s\S]*Fresh external deployed-bytecode[\s\S]*long-soak evidence remain open/,
    "V10 design doc must not confuse local production-build smoke with final production evidence",
  );
  assert.doesNotMatch(
    readFileSync("docs/v10-contract-design.md", "utf8"),
    /metadata-only Remix source-unit layout mismatch|not yet the final reproducible deployment/,
    "V10 design doc must not preserve stale deployed-provenance blockers after manifest-matched local proof",
  );
  assert.match(
    collectSignoffSource,
    /protected-bets-required[\s\S]*NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*protectedBetsRequired: isTruthyEnvValue/,
    "signoff collector must carry the V10 protected-bet flag into final signoff evidence",
  );
  assert.match(
    collectSignoffSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveIntegerString\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT[\s\S]*finalityBlocksPositive: isPositiveIntegerString\(finalityBlocks\)/,
    "signoff collector must BigInt-bound finality block evidence before setting the finality-positive proof flag",
  );
  assert.match(
    readFileSync("scripts/collect-proof-common.mjs", "utf8"),
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*export function parsePositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*export function isPositiveInteger\(value\)[\s\S]*parsePositiveInteger\(value\) !== null/,
    "proof collectors must share parsed positive-integer evidence with boolean validation",
  );
  assert.match(
    collectSignoffSource,
    /parsePositiveInteger[\s\S]*const requestedEpochs = parsePositiveInteger\(epochs\)[\s\S]*requireCondition\(requestedEpochs !== null[\s\S]*requestedEpochs,/,
    "signoff collector must publish the same canonical parsed --epochs value it validates",
  );
  assert.doesNotMatch(
    `${readFileSync("scripts/collect-proof-common.mjs", "utf8")}\n${collectSignoffSource}`,
    /function (?:parsePositiveInteger|isPositiveIntegerString)\(value\)[\s\S]*\^\[1-9\]\\d\*\$|const requestedEpochs = Number\(epochs\)/,
    "signoff collector must not broadly coerce finality block or requested epoch evidence",
  );
  assert.match(
    readFileSync("scripts/check-proof-drafts.mjs", "utf8"),
    /signoff-collector-unsafe-epochs[\s\S]*9999999999999999[\s\S]*--epochs must be a positive integer/,
    "proof draft regression suite must reject unsafe signoff collector requested epoch evidence",
  );
  assert.match(
    createSignoffDraftSource,
    /randomness-decision[\s\S]*randomness-operator[\s\S]*randomness-signed-at[\s\S]*randomness-evidence[\s\S]*randomness-risk-accepted/,
    "signoff draft generator must support the same reproducible randomness acceptance evidence fields",
  );
  assert.match(
    createSignoffDraftSource,
    /function requireChainComparisonLog[\s\S]*proof:chain[\s\S]*direct\[-\\s\]\?chain[\s\S]*jackpot, safetyPool, deposits, rewards, rebates, and resolve/,
    "signoff draft generator must reject chain logs missing direct-chain comparison coverage",
  );
  assert.match(
    createSignoffDraftSource,
    /protected-bets-required[\s\S]*NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*protectedBetsRequired: isTruthyEnvValue/,
    "signoff draft generator must carry the V10 protected-bet flag into final signoff evidence",
  );
  assert.match(
    createSignoffDraftSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function isPositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*const parsed = BigInt\(normalized\)[\s\S]*parsed <= MAX_SAFE_INTEGER_BIGINT[\s\S]*finalityBlocksPositive: isPositiveInteger\(finalityBlocks\)/,
    "signoff draft generator must BigInt-bound finality block evidence before setting the finality-positive proof flag",
  );
  assert.doesNotMatch(
    createSignoffDraftSource,
    /function isPositiveInteger\(value\)[\s\S]*\^\[1-9\]\\d\*\$|function isPositiveInteger\(value\)[\s\S]*Number\(String\(value \?\? ""\)\.trim\(\)\)[\s\S]*parsed > 0/,
    "signoff draft generator must not broadly coerce finality block evidence",
  );
  assert.match(
    readFileSync("scripts/check-signoff-proof.mjs", "utf8"),
    /contractEnv\.protectedBetsRequired !== true[\s\S]*V10 mainnet launch/,
    "strict signoff proof must reject manifests missing the V10 protected-bet flag",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_RANDOMIZE_ROUNDS/,
    "live canary must support randomized stress rounds for amount/tile coverage",
  );
  assert.match(
    liveRoundCanarySource,
    /CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*placeBatchBetsBitmapForEpoch[\s\S]*\[epoch, tileIdsToMask\(tiles\), plan\.amount\]/,
    "V10 live canary must dispatch the protected bitmap selector with its observed epoch",
  );
  assert.ok(
    liveRoundCanarySource.indexOf("await assertEpochBoundBetCapability(publicClient)") <
      liveRoundCanarySource.indexOf("await runPreflight(logPath, publicClient, wallets, plannedSpendByRole)"),
    "V10 live canary must reject missing protected bytecode before wallet preflight or allowance transactions",
  );
  assert.ok(
    liveRoundCanarySource.indexOf("if (V10_MATRIX_ONLY && !CONTRACT_REQUIRES_EPOCH_BOUND_BETS)") <
      liveRoundCanarySource.indexOf("executionWalletConfig = loadExecutionWalletAdmission"),
    "V10 matrix mode must reject stale runtime configuration before loading wallet secrets",
  );
  assert.match(
    liveRoundCanarySource,
    /const allowancePlan = resolveCanaryAllowancePlan\([\s\S]*const approvalRequired = allowancePlan\.needsApproval[\s\S]*const approvalsRequired = rows\.filter\(\(row\) => row\.approvalRequired\)\.length/,
    "V10 dry-run must report the bounded plan's approval transaction count",
  );
  assert.match(
    liveRoundCanarySource,
    /plannedBetTransactions = TARGET_ROUNDS \* \(REPEAT_SAME_BET \? 2 : 1\)[\s\S]*plannedStake = \[\.\.\.plannedSpendByRole\.values\(\)\][\s\S]*plannedBetTx=\$\{plannedBetTransactions\}[\s\S]*plannedStake=\$\{formatUnits\(plannedStake, 18\)\}/,
    "live canary must report the exact planned stake and bet transaction count",
  );
  assert.match(
    liveRoundCanarySource,
    /MAX_RESOLVE_TRANSACTIONS = V10_MATRIX_ONLY \? TARGET_ROUNDS - 1 : null[\s\S]*submittedResolveTransactions >= MAX_RESOLVE_TRANSACTIONS[\s\S]*submittedResolveTransactions \+= 1/,
    "V10 matrix mode must cap submitted resolve transactions before wallet writes",
  );
  assert.match(
    liveRoundCanarySource,
    /V10_CANARY_MATRIX = \[[\s\S]*tileCount: 1, sparse: false[\s\S]*tileCount: 3, sparse: false[\s\S]*tileCount: 3, sparse: true[\s\S]*tileCount: 5, sparse: false[\s\S]*tileCount: 5, sparse: true[\s\S]*tileCount: 25, sparse: false/,
    "V10 live canary must schedule single, contiguous, sparse, and full-grid gas cases before randomized rounds",
  );
  assert.match(
    liveRoundCanarySource,
    /V10_MATRIX_ONLY = process\.argv\.includes\("--v10-matrix-only"\)[\s\S]*DRY_RUN = [^;]*\(V10_MATRIX_ONLY && !V10_MATRIX_EXECUTE\)[\s\S]*TARGET_ROUNDS = V10_MATRIX_ONLY \? 6[\s\S]*REPEAT_SAME_BET = V10_MATRIX_ONLY/,
    "bounded V10 matrix mode must run six repeated cases and remain transaction-free without explicit --execute",
  );
  assert.equal(
    packageScripts["live:canary:v10:matrix"],
    "tsx scripts/live-round-canary.ts --v10-matrix-only",
    "the bounded V10 matrix command must default to the script's fail-closed dry-run mode",
  );
  assert.equal(
    packageScripts["proof:testnet:canary:v10"],
    "node scripts/analyze-live-canary-proof.mjs --profile=v10-matrix --strict --require-epoch-bound --require-v10-gas-matrix --require-v10-deployment-manifest",
    "V10 testnet proof command must fail closed on epoch-bound and mined-gas matrix evidence",
  );
  const v10CanaryProofDir = mkdtempSync(join(tmpdir(), "lore-v10-canary-proof-"));
  try {
    const baseBetEvent = {
      mode: "bitmap",
      round: 0,
      ok: true,
      txStatus: "success",
      role: "AUTOMINER_A",
      network: "sepolia",
      chainId: 59141,
      contractAddress: `0x${"1".repeat(40)}`,
      epoch: "1",
      hash: `0x${"1".repeat(64)}`,
      nonceLatest: 0,
      noncePending: 0,
      durationMs: 1,
      gasUsed: "1",
      totalAmountWei: "1",
      tileCount: 1,
      tiles: [1],
      timestamp: "2026-07-22T00:00:00.000Z",
    };
    const buildAdmissionEvidence = ({ includeRuntime = true, approvalRequired = false, allowanceWei = "100", allowanceWithinRunCap = true, approvals = [] } = {}) => {
      const target = {
        amount: "0",
        chainId: 59141,
        contractAddress: `0x${"1".repeat(40)}`,
        network: "sepolia",
        ok: true,
        round: -1,
      };
      const evidence = [];
      if (includeRuntime) {
        evidence.push({
          ...target,
          mode: "preflight",
          role: "SYSTEM",
          runtimeIdentity: {
            canonicalProvenanceVerified: true,
            chainId: 59141,
            contractAddress: `0x${"1".repeat(40)}`,
            deployBlock: "0",
            executableBytes: 1,
            executableRuntimeBytes: 1,
            immutableReferences: 0,
            manifestDigest: "b".repeat(64),
            manifestMatched: true,
            normalizedRuntimeSha256: "a".repeat(64),
            observedBlock: "1",
            observedBlockHash: `0x${"f".repeat(64)}`,
          },
        });
      }
      evidence.push({
        ...target,
        allowanceCapWei: "100",
        allowanceWei,
        allowanceWithinRunCap,
        approvalRequired,
        mode: "preflight",
        participant: true,
        role: "AUTOMINER_A",
        totalAmountWei: "100",
      });
      return [...evidence, ...approvals];
    };
    const runV10CanaryProof = (name, events, extraArgs = [], admissionEvidence = buildAdmissionEvidence()) => {
      const logPath = join(v10CanaryProofDir, `${name}.jsonl`);
      const admission = {
        schema: 1,
        runId: "11111111111111111111111111111111",
        execution: "live",
        profile: "v10-matrix",
        network: "sepolia",
        chainId: 59141,
        contractAddress: `0x${"1".repeat(40)}`,
        contractDeployBlock: "0",
        runtimeSha256: "a".repeat(64),
        manifestSha256: "b".repeat(64),
        canonicalProvenanceVerified: true,
        previewSha256: "c".repeat(64),
        walletSetSha256: "d".repeat(64),
        canaryPlanSha256: "e".repeat(64),
        selectedRoles: ["AUTOMINER_A"],
        roleCaps: [{ role: "AUTOMINER_A", spendCapWei: "100", allowanceCapWei: "100" }],
      };
      const admissionSha256 = createHash("sha256").update(JSON.stringify(admission), "utf8").digest("hex");
      const boundEvents = [...admissionEvidence, ...events].map((event) => ({
        admissionSha256,
        runId: admission.runId,
        walletSetSha256: admission.walletSetSha256,
        ...event,
      }));
      writeFileSync(logPath, `${[
        { mode: "admission", admission, admissionSha256 },
        ...boundEvents,
      ].map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      return spawnSync(process.execPath, [
        "scripts/analyze-live-canary-proof.mjs",
        logPath,
        "--profile=v10-matrix",
        "--strict",
        "--require-epoch-bound",
        "--require-v10-gas-matrix",
        ...extraArgs,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
          LINEA_NETWORK: "sepolia",
          NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
          LINEA_CHAIN_ID: "59141",
          NEXT_PUBLIC_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`,
          LIVE_CANARY_MIN_EPOCHS: "1",
          LIVE_CANARY_MIN_AUTOMINER_EPOCHS: "1",
          LIVE_CANARY_MIN_ELAPSED_MS_PER_EPOCH: "1",
        },
        encoding: "utf8",
      });
    };
    const legacyProof = runV10CanaryProof("legacy", [{ ...baseBetEvent, epochBound: false }]);
    assert.equal(legacyProof.status, 1);
    assert.match(legacyProof.stdout, /successful epoch-unbound bets 1/);
    const pendingProof = runV10CanaryProof("pending", [{
      ...baseBetEvent,
      epochBound: true,
      ok: true,
      txStatus: "pending",
    }]);
    assert.equal(pendingProof.status, 1);
    assert.match(pendingProof.stdout, /failed bets 1/);
    const protectedProof = runV10CanaryProof("protected", [{ ...baseBetEvent, epochBound: true }]);
    assert.equal(protectedProof.status, 1, "the synthetic proof still lacks its required gas matrix");
    const manifestBoundProof = runV10CanaryProof("manifest-bound", [{ ...baseBetEvent, epochBound: true }], ["--require-v10-deployment-manifest"]);
    assert.equal(manifestBoundProof.status, 1, "a synthetic non-canonical V10 target must fail the deployment-manifest gate");
    assert.match(manifestBoundProof.stdout, /target does not match current V10 deployment manifest/);
    assert.doesNotMatch(protectedProof.stdout, /successful epoch-unbound bets/);
    assert.match(protectedProof.stdout, /missing V10 gas cases 3-contiguous,3-sparse,5-contiguous,5-sparse,25/);
    const malformedMatrixProof = runV10CanaryProof("malformed-matrix", [{
      ...baseBetEvent,
      epochBound: true,
      tileCount: "1.0",
    }]);
    assert.equal(malformedMatrixProof.status, 1);
    assert.match(malformedMatrixProof.stdout, /malformed V10 gas matrix evidence 1/);
    const unsafeRoleProof = runV10CanaryProof("unsafe-role", [{
      ...baseBetEvent,
      epochBound: true,
      role: "https://rpc.example/?token=secret",
    }]);
    assert.equal(unsafeRoleProof.status, 1);
    assert.match(unsafeRoleProof.stdout, /malformed successful role evidence 1/);
    assert.match(unsafeRoleProof.stdout, /\| roles \| unsafe-token:1 \|/);
    assert.doesNotMatch(unsafeRoleProof.stdout, /rpc\.example|token=secret/);
    const matrixTiles = [[1], [1, 2, 3], [1, 8, 15], [1, 2, 3, 4, 5], [1, 8, 15, 22, 4], Array.from({ length: 25 }, (_, index) => index + 1)];
    const matrixEvents = matrixTiles.flatMap((tiles, index) => {
      const first = {
        ...baseBetEvent,
        epoch: String(index + 1),
        epochBound: true,
        gasUsed: String(100_000 + index),
        hash: `0x${String(index + 1).repeat(64)}`,
        nonceLatest: index * 2,
        noncePending: index * 2,
        round: index,
        tileCount: tiles.length,
        tiles,
        timestamp: new Date(Date.parse("2026-07-22T00:00:00.000Z") + index * 2_000).toISOString(),
      };
      return [first, {
        ...first,
        gasUsed: String(200_000 + index),
        hash: `0x${"abcdef"[index].repeat(64)}`,
        nonceLatest: index * 2 + 1,
        noncePending: index * 2 + 1,
        repeat: true,
        timestamp: new Date(Date.parse(first.timestamp) + 1_000).toISOString(),
      }];
    });
    const matrixProof = runV10CanaryProof("matrix", matrixEvents);
    assert.equal(matrixProof.status, 0, "the complete bounded matrix must not require the 50-epoch soak manifest");
    assert.doesNotMatch(matrixProof.stdout, /missing V10 gas cases/);
    assert.doesNotMatch(matrixProof.stdout, /duplicate role\/epoch\/tile keys [1-9]/);
    assert.match(matrixProof.stdout, /\| 3-sparse \| 2 \| 100002 \| 100002 \| 200002 \|/);
    const expectedRunMatrixProof = runV10CanaryProof(
      "expected-run-matrix",
      matrixEvents,
      ["--summary-only", `--expected-run-id=${"1".repeat(32)}`],
    );
    assert.equal(expectedRunMatrixProof.status, 0, "a fully bound proof must match the expected supervisor run");
    const wrongActionRunIdProof = runV10CanaryProof(
      "wrong-action-run-id",
      [{ ...matrixEvents[0], runId: "2".repeat(32) }, ...matrixEvents.slice(1)],
      ["--summary-only", `--expected-run-id=${"1".repeat(32)}`],
    );
    assert.equal(wrongActionRunIdProof.status, 1, "a post-admission action must not replay under another run id");
    assert.match(wrongActionRunIdProof.stdout, /canary action runId does not match canonical admission/);
    const wrongWalletSetEvidence = buildAdmissionEvidence();
    wrongWalletSetEvidence[1] = { ...wrongWalletSetEvidence[1], walletSetSha256: "f".repeat(64) };
    const wrongWalletSetProof = runV10CanaryProof(
      "wrong-wallet-set",
      matrixEvents,
      ["--summary-only"],
      wrongWalletSetEvidence,
    );
    assert.equal(wrongWalletSetProof.status, 1, "a wallet preflight must bind the admitted wallet set");
    assert.match(wrongWalletSetProof.stdout, /canary action wallet set does not match canonical admission/);
    const unboundDiagnosticProof = runV10CanaryProof(
      "unbound-diagnostic",
      [{
        amount: "0",
        chainId: 59141,
        contractAddress: `0x${"1".repeat(40)}`,
        mode: "diagnostic",
        network: "sepolia",
        ok: true,
        role: "SYSTEM",
        round: -1,
        runId: undefined,
        timestamp: "2026-07-22T00:00:00.500Z",
        walletSetSha256: undefined,
      }, ...matrixEvents],
      ["--summary-only"],
    );
    assert.equal(unboundDiagnosticProof.status, 1, "every post-admission canary record must bind the admitted run and wallet set");
    assert.match(unboundDiagnosticProof.stdout, /canary action is not bound to canonical admission \(round=-1 mode=diagnostic\)/);
    const wrongRuntimeIdentityEvidence = buildAdmissionEvidence();
    wrongRuntimeIdentityEvidence[0] = {
      ...wrongRuntimeIdentityEvidence[0],
      runtimeIdentity: { ...wrongRuntimeIdentityEvidence[0].runtimeIdentity, chainId: 1 },
    };
    const wrongRuntimeIdentityProof = runV10CanaryProof(
      "wrong-runtime-chain",
      matrixEvents,
      ["--summary-only"],
      wrongRuntimeIdentityEvidence,
    );
    assert.equal(wrongRuntimeIdentityProof.status, 1, "runtime identity must bind the admitted chain and target");
    assert.match(wrongRuntimeIdentityProof.stdout, /runtime identity preflight does not match canonical admission/);
    const missingRuntimeSnapshotEvidence = buildAdmissionEvidence();
    missingRuntimeSnapshotEvidence[0] = {
      ...missingRuntimeSnapshotEvidence[0],
      runtimeIdentity: { ...missingRuntimeSnapshotEvidence[0].runtimeIdentity, observedBlockHash: `0x${"0".repeat(64)}` },
    };
    const missingRuntimeSnapshotProof = runV10CanaryProof(
      "invalid-runtime-snapshot",
      matrixEvents,
      ["--summary-only"],
      missingRuntimeSnapshotEvidence,
    );
    assert.equal(missingRuntimeSnapshotProof.status, 1, "runtime identity must include a nonzero observed snapshot hash");
    assert.match(missingRuntimeSnapshotProof.stdout, /runtime identity preflight does not match canonical admission/);
    const resolveTarget = {
      amount: "0",
      chainId: 59141,
      contractAddress: `0x${"1".repeat(40)}`,
      epoch: "7",
      mode: "resolve",
      network: "sepolia",
      ok: true,
      role: "RESOLVER",
      round: -1,
      timestamp: "2026-07-22T00:00:20.000Z",
      txStatus: "success",
    };
    const missingResolveHashProof = runV10CanaryProof(
      "missing-resolve-hash",
      [...matrixEvents, resolveTarget],
      ["--summary-only"],
    );
    assert.equal(missingResolveHashProof.status, 1, "a successful resolver action must retain its transaction hash");
    assert.match(missingResolveHashProof.stdout, /successful canary resolve tx hash is invalid/);
    const unboundResolveProof = runV10CanaryProof(
      "unbound-resolve",
      [...matrixEvents, { ...resolveTarget, admissionSha256: "f".repeat(64), hash: `0x${"3".repeat(64)}` }],
      ["--summary-only"],
    );
    assert.equal(unboundResolveProof.status, 1, "a successful resolver action must bind the canonical admission");
    assert.match(unboundResolveProof.stdout, /canary action is not bound to canonical admission \(round=-1 mode=resolve\)/);
    const missingRuntimeAdmission = runV10CanaryProof(
      "missing-runtime-admission",
      matrixEvents,
      ["--summary-only"],
      buildAdmissionEvidence({ includeRuntime: false }),
    );
    assert.equal(missingRuntimeAdmission.status, 1, "strict proof must require exactly one bound runtime identity preflight");
    assert.match(missingRuntimeAdmission.stdout, /runtime identity preflight count 0 != 1/);
    const unsafeAllowanceAdmission = runV10CanaryProof(
      "unsafe-allowance-admission",
      matrixEvents,
      ["--summary-only"],
      buildAdmissionEvidence({ allowanceWithinRunCap: false }),
    );
    assert.equal(unsafeAllowanceAdmission.status, 1, "strict proof must reject an unsafe allowance preflight");
    assert.match(unsafeAllowanceAdmission.stdout, /wallet preflight exceeds allowance cap for AUTOMINER_A/);
    const incompleteAllowanceAdmission = runV10CanaryProof(
      "incomplete-allowance-admission",
      matrixEvents,
      ["--summary-only"],
      buildAdmissionEvidence({ allowanceWei: "99" }),
    );
    assert.equal(incompleteAllowanceAdmission.status, 1, "a no-approval wallet preflight must prove the exact declared allowance cap");
    assert.match(incompleteAllowanceAdmission.stdout, /wallet preflight allowance is not the exact cap for AUTOMINER_A/);
    const missingApprovalAdmission = runV10CanaryProof(
      "missing-approval-admission",
      matrixEvents,
      ["--summary-only"],
      buildAdmissionEvidence({ approvalRequired: true }),
    );
    assert.equal(missingApprovalAdmission.status, 1, "strict proof must require the declared exact-cap approval receipt");
    assert.match(missingApprovalAdmission.stdout, /admission approval count for AUTOMINER_A 0 != 1/);
    const approvedMatrixProof = runV10CanaryProof(
      "approved-matrix",
      matrixEvents,
      ["--summary-only"],
      buildAdmissionEvidence({
        approvalRequired: true,
        approvals: [{
          amount: "0",
          allowanceCapWei: "100",
          allowanceWei: "100",
          allowanceWithinRunCap: true,
          chainId: 59141,
          contractAddress: `0x${"1".repeat(40)}`,
          hash: `0x${"2".repeat(64)}`,
          mode: "approve",
          network: "sepolia",
          ok: true,
          role: "AUTOMINER_A",
          round: -1,
        }],
      }),
    );
    assert.equal(approvedMatrixProof.status, 0, "a declared approval must bind one exact-cap successful receipt");
    const replayedRunProof = runV10CanaryProof(
      "replayed-run",
      matrixEvents,
      ["--summary-only", `--expected-run-id=${"2".repeat(32)}`],
    );
    assert.equal(replayedRunProof.status, 1, "strict proof must bind admission evidence to the expected supervisor run");
    assert.match(replayedRunProof.stdout, /admission runId does not match the expected supervisor run/);
    const compactCanaryOutput = (result) => `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
    const assertCompactCanaryOutputSafe = (name, result) => {
      const output = compactCanaryOutput(result);
      const normalizedOutput = output.replaceAll("\\\\", "\\").replaceAll("\\/", "/");
      const tempPathVariants = new Set([
        v10CanaryProofDir,
        v10CanaryProofDir.replaceAll("\\", "\\\\"),
        v10CanaryProofDir.replaceAll("\\", "/"),
        v10CanaryProofDir.replaceAll("/", "\\/"),
      ]);
      for (const tempPath of tempPathVariants) {
        assert.equal(
          output.toLowerCase().includes(tempPath.toLowerCase()),
          false,
          `${name} compact output must not expose its raw or escaped temporary evidence directory`,
        );
      }
      assert.doesNotMatch(output, /0x[a-fA-F0-9]{64}/, `${name} compact output must not expose tx hashes`);
      assert.doesNotMatch(
        normalizedOutput,
        /(?:[A-Za-z]:[\\/][^\s|`"']+)|(?:(?:^|[\s|`"'])\/(?:[^/\s|`"']+\/)+[^/\s|`"']+)/im,
        `${name} compact output must not expose absolute filesystem paths`,
      );
      return output;
    };
    const compactMatrixProof = runV10CanaryProof("matrix-summary", matrixEvents, ["--summary-only"]);
    assert.equal(compactMatrixProof.status, 0, "the compact operator path must preserve strict matrix validation");
    assert.equal(String(compactMatrixProof.stderr).trim(), "", "the passing compact operator path must keep stderr empty");
    const compactMatrixOutput = assertCompactCanaryOutputSafe("valid matrix", compactMatrixProof);
    assert.match(compactMatrixOutput, /Summary: live canary proof checks passed; covered gates: G10, G11/);
    assert.doesNotMatch(compactMatrixOutput, /## V10 Mined Gas Matrix/);
    const runMatrixMutant = (name, mutate, expected) => {
      const events = matrixEvents.map((event) => ({ ...event, tiles: [...event.tiles] }));
      mutate(events);
      const result = runV10CanaryProof(name, events, ["--summary-only"]);
      assert.equal(result.status, 1, `${name} must fail strict canary validation`);
      const output = assertCompactCanaryOutputSafe(name, result);
      assert.match(output, expected, `${name} must report its fail-closed reason`);
      assert.match(output, /blocked gates: G10, G11/);
    };
    runMatrixMutant("malformed-nonce", (events) => {
      events[0].noncePending = "2e1";
    }, /malformed nonce evidence 1/);
    runMatrixMutant("malformed-epoch", (events) => {
      events[0].epoch = "1.0";
    }, /malformed bet epoch evidence 1/);
    runMatrixMutant("malformed-timestamp", (events) => {
      events[0].timestamp = "2026-07-22 00:00:00";
    }, /malformed bet timestamp evidence 1/);
    runMatrixMutant("target-chain-mismatch", (events) => {
      events[0].chainId = "59141.0";
    }, /target metadata mismatches 1/);
    runMatrixMutant("duplicate-tx-hash", (events) => {
      events[1].hash = events[0].hash;
    }, /duplicate successful tx hashes 1/);
    const orphanRepeatProof = runV10CanaryProof("orphan-repeat", [{ ...baseBetEvent, epochBound: true, repeat: true }]);
    assert.match(orphanRepeatProof.stdout, /duplicate role\/epoch\/tile keys 1/);
    const duplicateProof = runV10CanaryProof("duplicate", [
      { ...baseBetEvent, epochBound: true },
      {
        ...baseBetEvent,
        epochBound: true,
        hash: `0x${"a".repeat(64)}`,
        nonceLatest: 1,
        noncePending: 1,
        timestamp: "2026-07-22T00:00:01.000Z",
      },
    ]);
    assert.match(duplicateProof.stdout, /duplicate role\/epoch\/tile keys 1/);
  } finally {
    rmSync(v10CanaryProofDir, { recursive: true, force: true });
  }
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_HEALTH_BASE_URL[\s\S]*fetchCanaryHealthPayloadPair\(\{[\s\S]*baseUrl: HEALTH_BASE_URL[\s\S]*secret,[\s\S]*timeoutMs: HEALTH_TIMEOUT_MS[\s\S]*mode: "diagnostic"/,
    "live canary must bind the behavior-tested health client into redacted long-soak telemetry",
  );
  assert.match(
    liveRoundCanarySource,
    /nonceQueueClear = !participates \|\| noncePending <= nonceLatest[\s\S]*enoughEth = !participates \|\| eth >= MIN_ETH_PER_WALLET[\s\S]*enoughToken = !participates \|\| token >= requiredToken[\s\S]*pending-nonce-blocked[\s\S]*insufficient-native-and-token[\s\S]*insufficient-token/,
    "wallet preflight must expose safe balance categories and reject an existing pending nonce queue",
  );
  assert.match(
    liveRoundCanarySource,
    /for \(let attempt = 0; attempt < 2; attempt \+= 1\)[\s\S]*healthRetryCount: attempt[\s\S]*healthRetryCount: 1/,
    "live canary health telemetry must retry one transient timeout while preserving retry evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /estimateGasMs: gasEstimatedAt - preparedAt[\s\S]*nonceReadMs: nonceReadAt - gasEstimatedAt[\s\S]*prepareMs: preparedAt - startedAt[\s\S]*sendMs: sentAt - nonceReadAt[\s\S]*receiptMs: receiptAt - sentAt/,
    "live canary must preserve prepare, estimate, nonce, send, and receipt latency phases",
  );
  assert.match(
    liveRoundCanarySource,
    /noncePending > nonceLatest[\s\S]*Pending transaction blocked by nonce/,
    "live canary must not dispatch another transaction while a wallet already has a pending nonce",
  );
  assert.match(
    liveRoundCanarySource,
    /const sentEvent = \{[\s\S]*hash,[\s\S]*catch \(error\)[\s\S]*\.\.\.sentEvent[\s\S]*errorKind: classified\.kind[\s\S]*txStatus: "pending"/,
    "live canary must retain post-send transaction evidence when receipt polling times out",
  );
  assert.match(
    liveRoundCanarySource,
    /for \(const \[resolverIndex, resolver\] of resolvers\.entries\(\)\)[\s\S]*insufficient-native-gas[\s\S]*mode: "resolver-candidate"[\s\S]*continue;[\s\S]*pendingHash[\s\S]*return;/,
    "live canary may fall back before resolve dispatch but must not switch wallets after an uncertain send",
  );
  assert.match(
    liveRoundCanarySource,
    /mode: "resolve"[\s\S]*resolverFallbackUsed: resolverIndex > 0/,
    "live canary must record successful resolver fallback without classifying pre-send skips as failed resolves",
  );
  assert.match(
    cleanupNextCandidatesSource,
    /candidatePattern = \/\^\\\.next-candidate[\s\S]*dirname\(candidate\.path\) !== root[\s\S]*if \(apply\) rmSync/,
    "generated Next cleanup must default to dry-run and constrain recursive deletion to root candidate directories",
  );
  const v10PreviewRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
  assert.match(
    v10PreviewRunbookSource,
    /soak:testnet:clear-pending:summary[\s\S]*pendingGap=0[\s\S]*wouldSend=false[\s\S]*do not execute anything[\s\S]*--execute --confirm-lowest-pending-nonce-replacement[\s\S]*never calls the game or token contracts[\s\S]*post-execution dry-run reports a zero gap/,
    "production runbook must document the bounded pending-nonce recovery procedure before soak restart",
  );
  function runPendingNonceProbe(args, {
    publicAddressFile,
    signingFile,
    inheritedSigningMaterial,
  } = {}) {
    const cwd = mkdtempSync(join(tmpdir(), "lore-pending-nonce-behavior-"));
    try {
      if (publicAddressFile !== undefined) {
        writeFileSync(join(cwd, ".env.live-test-addresses"), publicAddressFile, "utf8");
      }
      if (signingFile !== undefined) {
        writeFileSync(join(cwd, ".env.live-test-wallets"), signingFile, "utf8");
      }
      const env = { ...process.env };
      for (const name of Object.keys(env)) {
        if (
          /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i.test(name) ||
          /^LORE_LIVE_TEST_(?:MANUAL|AUTOMINER_A|AUTOMINER_B|AUTOMINER_C|RESOLVER)_ADDRESS$/.test(name)
        ) delete env[name];
      }
      if (inheritedSigningMaterial !== undefined) {
        env.LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY = inheritedSigningMaterial;
      }
      return spawnSync(process.execPath, [
        join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
        join(process.cwd(), "scripts", "clear-live-test-pending-nonce.ts"),
        ...args,
      ], {
        cwd,
        env: {
          ...env,
          LINEA_NETWORK: "sepolia",
          NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
          LIVE_TEST_EXECUTE: "0",
        },
        encoding: "utf8",
        timeout: 30_000,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  for (const [name, args, expected] of [
    ["default", ["--behavior-self-test"], { cliExecute: false, cliConfirmed: false, cliAdmitted: true }],
    ["execute-only", ["--behavior-self-test", "--execute"], { cliExecute: true, cliConfirmed: false, cliAdmitted: false }],
    ["confirmation-only", ["--behavior-self-test", "--confirm-lowest-pending-nonce-replacement"], { cliExecute: false, cliConfirmed: true, cliAdmitted: true }],
    ["two-factor", ["--behavior-self-test", "--execute", "--confirm-lowest-pending-nonce-replacement"], { cliExecute: true, cliConfirmed: true, cliAdmitted: true }],
  ]) {
    const result = runPendingNonceProbe(args);
    assert.equal(result.status, 0, `${name} pending-nonce behavior probe failed: ${result.stderr}`);
    assert.equal(String(result.stderr).trim(), "");
    assert.deepEqual(JSON.parse(String(result.stdout).trim()), {
      status: "pass",
      ...expected,
      dryRunDefault: true,
      publicAddressIsolation: true,
      signingMaterialDetection: true,
      wrongChainRejected: true,
      mismatchedSignerRejected: true,
      singleSelfTransfer: true,
      summaryRedacted: true,
      walletClientsCreated: 0,
      networkRequests: 0,
      contractWrites: 0,
      faultMutantsRejected: 23,
    });
    assert.doesNotMatch(result.stdout, /0x[a-fA-F0-9]{40}|0x[a-fA-F0-9]{64}|https?:\/\//i);
  }

  const publicAddress = "0x2222222222222222222222222222222222222222";
  const isolatedAddressProbe = runPendingNonceProbe(["--inspect-public-address-env"], {
    publicAddressFile: `LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=${publicAddress}\n`,
    signingFile: "LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY=wallet-file-must-not-load\n",
  });
  assert.equal(isolatedAddressProbe.status, 0, isolatedAddressProbe.stderr);
  assert.deepEqual(JSON.parse(String(isolatedAddressProbe.stdout).trim()), {
    mode: "dry-run",
    publicAddressKeys: ["LORE_LIVE_TEST_AUTOMINER_A_ADDRESS"],
    signingMaterialLoaded: false,
    walletClientCreated: false,
    contractWriteSubmitted: false,
    transactionSent: false,
  });
  assert.doesNotMatch(`${isolatedAddressProbe.stdout}\n${isolatedAddressProbe.stderr}`, /wallet-file-must-not-load/);

  const contaminatedAddressProbe = runPendingNonceProbe(["--inspect-public-address-env"], {
    publicAddressFile: `LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=${publicAddress}\nLORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY=public-file-secret\n`,
  });
  assert.equal(contaminatedAddressProbe.status, 1);
  assert.match(contaminatedAddressProbe.stderr, /may contain only public live-test role addresses/);
  assert.doesNotMatch(`${contaminatedAddressProbe.stdout}\n${contaminatedAddressProbe.stderr}`, /public-file-secret/);

  const inheritedSigningProbe = runPendingNonceProbe(["--inspect-public-address-env"], {
    publicAddressFile: `LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=${publicAddress}\n`,
    inheritedSigningMaterial: "inherited-signing-secret",
  });
  assert.equal(inheritedSigningProbe.status, 1);
  assert.match(inheritedSigningProbe.stderr, /inspection refuses inherited signing material/);
  assert.doesNotMatch(`${inheritedSigningProbe.stdout}\n${inheritedSigningProbe.stderr}`, /inherited-signing-secret/);

  const pendingNonceRedactionFault = runPendingNonceProbe(["--behavior-self-test", "--self-test-secret-fault"]);
  assert.equal(pendingNonceRedactionFault.status, 1);
  assert.equal(String(pendingNonceRedactionFault.stdout).trim(), "");
  assert.doesNotMatch(
    pendingNonceRedactionFault.stderr,
    /wallet-secret|private-token|rpc\.invalid|https?:\/\//i,
    "pending-nonce CLI failures must redact credentialed RPC input",
  );

  function runSoakBehaviorProbe({ envConfirmation = false, cliConfirmation = false, secretFault = false } = {}) {
    const behaviorDir = mkdtempSync(join(tmpdir(), "lore-soak-behavior-"));
    try {
      const result = spawnSync(process.execPath, [
        "scripts/run-testnet-soak-supervisor.mjs",
        "--behavior-self-test",
        ...(cliConfirmation ? ["--execute-live"] : []),
        ...(secretFault ? ["--self-test-secret-fault"] : []),
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SOAK_BEHAVIOR_SELF_TEST_DIR: behaviorDir,
          SOAK_OUT_DIR: behaviorDir,
          SOAK_EXECUTE_LIVE: envConfirmation ? "1" : "",
          SOAK_PORT: "",
          SOAK_SERVER_READY_TIMEOUT_MS: "",
          SOAK_DISK_CHECK_INTERVAL_MS: "",
          SOAK_MIN_DISK_FREE_BYTES: "1",
        },
        encoding: "utf8",
        timeout: 30_000,
      });
      return { ...result, behaviorDir };
    } finally {
      rmSync(behaviorDir, { recursive: true, force: true });
    }
  }

  for (const [name, options, expected] of [
    ["default", {}, { dryRun: true, liveExecutionConfirmed: false, canaryDryRun: true, canaryExecute: false }],
    ["env-only", { envConfirmation: true }, { dryRun: true, liveExecutionConfirmed: false, canaryDryRun: true, canaryExecute: false }],
    ["flag-only", { cliConfirmation: true }, { dryRun: true, liveExecutionConfirmed: false, canaryDryRun: true, canaryExecute: false }],
    ["two-factor", { envConfirmation: true, cliConfirmation: true }, { dryRun: false, liveExecutionConfirmed: true, canaryDryRun: false, canaryExecute: true }],
  ]) {
    const result = runSoakBehaviorProbe(options);
    assert.equal(result.status, 0, `${name} soak behavior probe failed: ${result.stderr}`);
    assert.equal(String(result.stderr).trim(), "", `${name} soak behavior probe must keep stderr empty`);
    const summary = JSON.parse(String(result.stdout).trim());
    assert.deepEqual(
      summary,
      {
        status: "pass",
        ...expected,
        defaultRoles: "MANUAL,AUTOMINER_A,AUTOMINER_B",
        ephemeralDiagnosticsSecret: true,
        atomicStatus: true,
        managedChildrenStarted: 0,
        networkRequests: 0,
        faultMutantsRejected: 39,
      },
      `${name} soak admission behavior must remain transaction-free unless both live confirmations are present`,
    );
    assert.doesNotMatch(result.stdout, /https?:\/\/|wallet-secret|private-token|0x[a-fA-F0-9]{40}/i);
  }

  const redactionFaultProbe = runSoakBehaviorProbe({ secretFault: true });
  assert.equal(redactionFaultProbe.status, 1, "soak behavior redaction fault must fail closed");
  assert.equal(String(redactionFaultProbe.stdout).trim(), "");
  assert.match(redactionFaultProbe.stderr, /behavior self-test failed:/);
  assert.doesNotMatch(
    redactionFaultProbe.stderr,
    /wallet-secret|private-token|rpc\.invalid|https?:\/\//i,
    "soak CLI failures must redact credentialed RPC input",
  );

  const soakStatusDir = mkdtempSync(join(tmpdir(), "lore-soak-status-"));
  try {
    const soakStatusFixtureMinimumDiskBytes = 1;
    const soakStatusEnv = {
      ...process.env,
      SOAK_OUT_DIR: soakStatusDir,
      // Status aggregation fixtures must not inherit the host's capacity
      // threshold; the low-capacity branch is asserted explicitly below.
      SOAK_MIN_DISK_FREE_BYTES: String(soakStatusFixtureMinimumDiskBytes),
    };
    const soakLiveLogPath = join(soakStatusDir, "live.jsonl");
    writeFileSync(soakLiveLogPath, `${JSON.stringify({
      mode: "preflight",
      ok: false,
      role: "AUTOMINER_C",
      enoughEth: false,
      enoughToken: true,
      errorKind: "untrusted raw error text",
      timestamp: "2026-07-18T00:00:00.000Z",
    })}\n${JSON.stringify({
      mode: "preflight",
      ok: false,
      role: "AUTOMINER_A",
      enoughEth: true,
      enoughToken: true,
      errorKind: "pending-nonce-blocked",
      timestamp: "2026-07-18T00:00:01.000Z",
    })}\n${JSON.stringify({
      mode: "diagnostic",
      sampleKind: "health",
      ok: true,
      rssBytes: 100,
      heapUsedBytes: 40,
      dbBytes: 20,
      walBytes: 4,
      diskFreeBytes: 1_000,
      gasEstimateRetryCount: 2,
      rpcFailoverInjected: true,
      timestamp: "2026-07-18T00:00:01.100Z",
    })}\n${JSON.stringify({
      mode: "diagnostic",
      sampleKind: "health",
      ok: true,
      rssBytes: 125,
      heapUsedBytes: 45,
      dbBytes: 24,
      walBytes: 5,
      diskFreeBytes: 900,
      timestamp: "2026-07-18T00:00:01.200Z",
    })}\n${JSON.stringify({
      mode: "resolve",
      ok: true,
      resolverFallbackUsed: true,
      timestamp: "2026-07-18T00:00:01.300Z",
    })}\n${JSON.stringify({
      mode: "bitmap",
      ok: true,
      round: 0,
      epochBound: true,
      txStatus: "success",
      role: "MANUAL",
      epoch: "1",
      hash: `0x${"2".repeat(64)}`,
      noncePending: 0,
      durationMs: 400,
      prepareMs: 10,
      estimateGasMs: 20,
      nonceReadMs: 30,
      sendMs: 20_000,
      receiptMs: 340,
      timestamp: "2026-07-18T00:00:01.500Z",
    })}\n${JSON.stringify({
      mode: "single",
      ok: false,
      round: 0,
      errorKind: "network",
      role: "MANUAL",
      timestamp: "2026-07-18T00:00:02.000Z",
    })}\n${JSON.stringify({
      mode: "bitmap",
      ok: false,
      round: 1,
      errorKind: "untrusted raw error text",
      role: "AUTOMINER_A",
      timestamp: "2026-07-18T00:00:03.000Z",
    })}\n${JSON.stringify({
      mode: "arrays",
      ok: false,
      round: 2,
      errorKind: "receipt-timeout",
      role: "AUTOMINER_A",
      hash: `0x${"1".repeat(64)}`,
      txStatus: "pending",
      timestamp: "2026-07-18T00:00:04.000Z",
    })}\n${JSON.stringify({
      mode: "sameAmount",
      ok: false,
      round: 3,
      errorKind: "pending-nonce-blocked",
      role: "AUTOMINER_B",
      timestamp: "2026-07-18T00:00:05.000Z",
    })}\n`, "utf8");
    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "failed",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:01.000Z",
      exitCode: 1,
      stopReason: "canary-1",
      supervisorPid: -1,
      artifacts: { liveLog: soakLiveLogPath },
    })}\n`, "utf8");
    const soakStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakStatusResult.status, 0, soakStatusResult.stderr);
    const safeSoakStatus = JSON.parse(soakStatusResult.stdout);
    assert.deepEqual(safeSoakStatus.progress.preflightFailures, [
      { role: "AUTOMINER_C", reason: "insufficient-native-gas" },
      { role: "AUTOMINER_A", reason: "pending-nonce-blocked" },
    ]);
    assert.equal(safeSoakStatus.progress.successfulBets, 1);
    assert.equal(safeSoakStatus.progress.epochBoundBets, 1);
    assert.equal(safeSoakStatus.progress.epochUnboundBets, 0);
    assert.equal(safeSoakStatus.progress.failedBets, 4);
    assert.deepEqual(safeSoakStatus.progress.failedBetErrorKinds, {
      network: 1,
      unknown: 1,
      "receipt-timeout": 1,
      "pending-nonce-blocked": 1,
    });
    assert.deepEqual(safeSoakStatus.progress.failedBetFamilies, { network: 2, "missing-error": 1, "nonce-state": 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetModes, { single: 1, bitmap: 1, arrays: 1, sameAmount: 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetRoles, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.consecutiveFailedBetsByRole, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.maxConsecutiveFailedBetsByRole, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakStatus.progress.failedBetStages, { "pre-send": 3, "post-send-unconfirmed": 1 });
    assert.equal(safeSoakStatus.progress.healthSamples, 2);
    assert.equal(safeSoakStatus.progress.estimateGasRetries, 2);
    assert.equal(safeSoakStatus.progress.rpcFailoverInjectionEvents, 1);
    assert.equal(safeSoakStatus.progress.resolverFallbacks, 1);
    assert.equal(safeSoakStatus.progress.slowSendCount, 1);
    assert.deepEqual(safeSoakStatus.progress.latencyMs, { samples: 1, p50: 400, p95: 400, p99: 400, max: 400 });
    assert.deepEqual(safeSoakStatus.progress.phaseLatencyMs.sendMs, {
      samples: 1,
      p50: 20_000,
      p95: 20_000,
      p99: 20_000,
      max: 20_000,
    });
    assert.deepEqual(safeSoakStatus.progress.healthGrowth.rssBytes, {
      samples: 2,
      first: 100,
      min: 100,
      max: 125,
      delta: 25,
    });
    assert.equal(Number.isSafeInteger(safeSoakStatus.secondsSinceLastEvent), true);
    assert.equal(safeSoakStatus.secondsSinceLastEvent >= 0, true);
    assert.equal(safeSoakStatus.diskCapacity.diskCapacityAvailable, true);
    assert.equal(Number.isSafeInteger(safeSoakStatus.diskCapacity.diskFreeBytesNow), true);
    assert.equal(safeSoakStatus.diskCapacity.diskFreeMinimumBytes, soakStatusFixtureMinimumDiskBytes);
    assert.doesNotMatch(soakStatusResult.stdout, /untrusted raw error text/);
    const soakSummaryResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakSummaryResult.status, 0, soakSummaryResult.stderr);
    const safeSoakSummary = JSON.parse(soakSummaryResult.stdout);
    assert.equal(safeSoakSummary.progress.successfulBets, 1);
    assert.equal(safeSoakSummary.progress.epochBoundBets, 1);
    assert.equal(safeSoakSummary.progress.epochUnboundBets, 0);
    assert.deepEqual(safeSoakSummary.progress.successfulBetRoles, { MANUAL: 1 });
    assert.equal(safeSoakSummary.progress.failedBets, 4);
    assert.deepEqual(safeSoakSummary.progress.failedBetRoles, { MANUAL: 1, AUTOMINER_A: 2, AUTOMINER_B: 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetErrorKinds, {
      network: 1,
      unknown: 1,
      "receipt-timeout": 1,
      "pending-nonce-blocked": 1,
    });
    assert.deepEqual(safeSoakSummary.progress.failedBetFamilies, { network: 2, "missing-error": 1, "nonce-state": 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetModes, { single: 1, bitmap: 1, arrays: 1, sameAmount: 1 });
    assert.deepEqual(safeSoakSummary.progress.failedBetStages, { "pre-send": 3, "post-send-unconfirmed": 1 });
    assert.deepEqual(safeSoakSummary.progress.maxConsecutiveFailedBetsByRole, {
      MANUAL: 1,
      AUTOMINER_A: 2,
      AUTOMINER_B: 1,
    });
    assert.equal(safeSoakSummary.progress.duplicateNonces, 0);
    assert.equal(safeSoakSummary.progress.estimateGasRetries, 2);
    assert.equal(safeSoakSummary.progress.rpcFailoverInjectionEvents, 1);
    assert.equal(safeSoakSummary.progress.resolverFallbacks, 1);
    assert.equal(safeSoakSummary.progress.slowSendCount, 1);
    assert.equal(safeSoakSummary.progress.latencyMs.p95, 400);
    assert.equal(safeSoakSummary.progress.healthGrowth.rssBytes.delta, 25);
    assert.equal(safeSoakSummary.diskCapacity.diskCapacityAvailable, true);
    assert.equal(Number.isSafeInteger(safeSoakSummary.diskCapacity.diskFreeBytesNow), true);
    assert.equal(safeSoakSummary.diskCapacity.diskFreeMinimumBytes, soakStatusFixtureMinimumDiskBytes);
    assert.doesNotMatch(soakSummaryResult.stdout, /untrusted raw error text/);
    const soakCompactResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--compact"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakCompactResult.status, 0, soakCompactResult.stderr);
    assert.match(
      soakCompactResult.stdout,
      /status=failed dry=true alive=false stop=canary-1 ok=1 bound=1 unbound=0 fail=4 roles=MANUAL=1\/AUTOMINER_A=2,AUTOMINER_B=1,MANUAL=1 epochs=1 tx=1 nonces=1 dupTx=0 dupNonce=0 rev=0 health=0\/0 rpc=1 gas=2 resolver=1 slow=1 p95=400 proof=not-run diskLow=false diskFree=\d+ preflight=AUTOMINER_C:insufficient-native-gas,AUTOMINER_A:pending-nonce-blocked fk=network=1,pending-nonce-blocked=1,receipt-timeout=1,unknown=1 ff=missing-error=1,network=2,nonce-state=1/,
      "managed soak compact status must surface safe one-line aggregates without raw logs or addresses",
    );
    assert.doesNotMatch(soakCompactResult.stdout, /0x[a-fA-F0-9]{40}|untrusted raw error text|\{|\}/);
    const lowDiskSoakSummaryResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: { ...soakStatusEnv, SOAK_MIN_DISK_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) },
      encoding: "utf8",
    });
    assert.equal(lowDiskSoakSummaryResult.status, 1, lowDiskSoakSummaryResult.stderr);
    const lowDiskSoakSummary = JSON.parse(lowDiskSoakSummaryResult.stdout);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskCapacityAvailable, true);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskFreeBelowMinimum, true);
    assert.equal(lowDiskSoakSummary.diskCapacity.diskFreeMinimumBytes, Number.MAX_SAFE_INTEGER);

    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "running",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      supervisorPid: -1,
      artifacts: {},
    })}\n`, "utf8");
    writeFileSync(join(soakStatusDir, "canary.log"), `[live-canary] log=${soakLiveLogPath}\n`, "utf8");
    const recoveredMarkerResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(recoveredMarkerResult.status, 0, recoveredMarkerResult.stderr);
    const recoveredMarkerSummary = JSON.parse(recoveredMarkerResult.stdout);
    assert.equal(recoveredMarkerSummary.hasLiveLog, true, "bounded wrapper-log marker must recover the JSONL artifact");
    assert.equal(recoveredMarkerSummary.progress.successfulBets, 1);

    writeFileSync(
      join(soakStatusDir, "canary.log"),
      `${"x".repeat(64 * 1024)}\n[live-canary] log=${soakLiveLogPath}\n`,
      "utf8",
    );
    const lateMarkerResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(lateMarkerResult.status, 0, lateMarkerResult.stderr);
    const lateMarkerSummary = JSON.parse(lateMarkerResult.stdout);
    assert.equal(lateMarkerSummary.hasLiveLog, false, "markers beyond the bounded wrapper-log prefix must not be scanned");
    assert.equal(lateMarkerSummary.progress.successfulBets, 0);

    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "failed",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:00:01.000Z",
      exitCode: 1,
      stopReason: "canary-directory-log",
      supervisorPid: -1,
      artifacts: { liveLog: soakStatusDir },
    })}\n`, "utf8");
    const soakDirectoryLogResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(soakDirectoryLogResult.status, 0, soakDirectoryLogResult.stderr);
    const safeDirectoryLogSummary = JSON.parse(soakDirectoryLogResult.stdout);
    assert.equal(safeDirectoryLogSummary.hasLiveLog, false, "directory live-log paths must not be reported as present");
    assert.equal(safeDirectoryLogSummary.progress.successfulBets, 0, "directory live-log paths must not be streamed");

    writeFileSync(join(soakStatusDir, "status.json"), `${JSON.stringify({
      status: "running",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      supervisorPid: "1e3",
      artifacts: { liveLog: soakLiveLogPath },
    })}\n`, "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), `${JSON.stringify({
      pid: "1e3",
      startedAt: "2026-07-18T00:00:00.000Z",
    })}\n`, "utf8");
    const malformedPidStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(malformedPidStatusResult.status, 0, malformedPidStatusResult.stderr);
    const malformedPidStatus = JSON.parse(malformedPidStatusResult.stdout);
    assert.equal(malformedPidStatus.supervisorAlive, false, "malformed matching PID strings must not count as an alive managed supervisor");
    writeFileSync(join(soakStatusDir, "status.json"), JSON.stringify({
      status: "running",
      supervisorPid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
      padding: "x".repeat(128 * 1024),
    }), "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), JSON.stringify({
      pid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
    }), "utf8");
    const oversizedStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(oversizedStatusResult.status, 0, oversizedStatusResult.stderr);
    const oversizedStatus = JSON.parse(oversizedStatusResult.stdout);
    assert.equal(oversizedStatus.status, "not-started", "oversized status JSON must not be parsed as trusted running state");
    assert.equal(oversizedStatus.supervisorAlive, false, "oversized status JSON must not combine with lock evidence to mark a supervisor alive");
    writeFileSync(join(soakStatusDir, "status.json"), JSON.stringify({
      status: "running",
      dryRun: true,
      supervisorPid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
    }), "utf8");
    writeFileSync(join(soakStatusDir, "supervisor.lock"), JSON.stringify({
      pid: String(process.pid),
      startedAt: "2026-07-18T00:00:00.000Z",
      padding: "x".repeat(4 * 1024),
    }), "utf8");
    const oversizedLockStatusResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs", "--status", "--summary-only"], {
      cwd: process.cwd(),
      env: soakStatusEnv,
      encoding: "utf8",
    });
    assert.equal(oversizedLockStatusResult.status, 0, oversizedLockStatusResult.stderr);
    const oversizedLockStatus = JSON.parse(oversizedLockStatusResult.stdout);
    assert.equal(oversizedLockStatus.status, "running", "oversized lock JSON must not hide the bounded status JSON");
    assert.equal(oversizedLockStatus.supervisorAlive, false, "oversized lock JSON must not be parsed as matching supervisor evidence");
  } finally {
    rmSync(soakStatusDir, { recursive: true, force: true });
  }
  const soakPreflightDir = mkdtempSync(join(tmpdir(), "lore-soak-preflight-"));
  try {
    const previousStatusText = `${JSON.stringify({
      status: "completed",
      dryRun: true,
      startedAt: "2026-07-18T00:00:00.000Z",
      finishedAt: "2026-07-18T00:01:00.000Z",
      exitCode: 0,
      stopReason: "dry-run-complete",
      artifacts: { liveLog: "preserved-redacted-evidence-pointer" },
    }, null, 2)}\n`;
    writeFileSync(join(soakPreflightDir, "status.json"), previousStatusText, "utf8");
    const diskPreflightResult = spawnSync(process.execPath, ["scripts/run-testnet-soak-supervisor.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SOAK_OUT_DIR: soakPreflightDir,
        SOAK_EXECUTE_LIVE: "",
        SOAK_MIN_DISK_FREE_BYTES: String(Number.MAX_SAFE_INTEGER),
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(diskPreflightResult.status, 1, "unsafe disk capacity must stop before managed runtime startup");
    assert.equal(readFileSync(join(soakPreflightDir, "status.json"), "utf8"), previousStatusText);
    assert.equal(existsSync(join(soakPreflightDir, "supervisor.lock")), false);
    assert.equal(existsSync(join(soakPreflightDir, "server.log")), false);
    assert.equal(existsSync(join(soakPreflightDir, "canary.log")), false);
    assert.match(diskPreflightResult.stderr, /requires at least 9007199254740991 free bytes/);
    assert.equal(diskPreflightResult.stderr.toLowerCase().includes(soakPreflightDir.toLowerCase()), false);
  } finally {
    rmSync(soakPreflightDir, { recursive: true, force: true });
  }
  assert.match(
    analyzeCanarySource,
    /successful health samples[\s\S]*failed health samples/,
    "strict canary proof must reject incomplete health telemetry when sampling was enabled",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_ROLES \?\? "MANUAL,AUTOMINER_A,AUTOMINER_B"/,
    "live canary default role set must stay MANUAL/AUTOMINER_A/AUTOMINER_B unless explicitly overridden",
  );
  assert.match(
    liveRoundCanarySource,
    /SAFE_ROLE_NAMES[\s\S]*MANUAL[\s\S]*AUTOMINER_A[\s\S]*AUTOMINER_B[\s\S]*AUTOMINER_C[\s\S]*LIVE_TEST_ROLES contains unsupported role/,
    "live canary must reject unsupported role overrides before wallet lookup",
  );
  assert.match(
    liveRoundCanarySource,
    /ROLES\.length === 0[\s\S]*LIVE_TEST_ROLES must include at least one supported role[\s\S]*new Set\(ROLES\)\.size !== ROLES\.length[\s\S]*LIVE_TEST_ROLES contains duplicate roles/,
    "live canary must reject empty and duplicate role overrides before wallet lookup",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_INJECT_RPC_FAILOVER[\s\S]*Injected RPC transport failure before dispatch[\s\S]*fallback\(transports\)/,
    "live canary RPC injection must fail before dispatch and exercise the configured fallback transport",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_MIN_TOTAL_BET_AMOUNT/,
    "live canary stress mode must configure a minimum total bet amount per tx",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_MAX_TOTAL_BET_AMOUNT/,
    "live canary stress mode must configure a maximum total bet amount per tx",
  );
  assert.match(
    liveRoundCanarySource,
    /targetTotalAmount/,
    "live canary logs must preserve requested total amount before per-tile normalization",
  );
  assert.match(
    liveRoundCanarySource,
    /tileCount/,
    "live canary logs must include tile count for stress analysis",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_VERBOSE_WALLETS/,
    "live canary must keep detailed wallet inventory behind an explicit opt-in",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_VERBOSE_TARGETS[\s\S]*contract=\$\{VERBOSE_TARGETS \? CONTRACT_ADDRESS : "configured"\}[\s\S]*token=\$\{VERBOSE_TARGETS \? LINEA_TOKEN_ADDRESS : "configured"\}/,
    "live canary must keep contract and token addresses behind an explicit opt-in for routine dry-runs",
  );
  assert.match(
    liveRoundCanarySource,
    /CANONICAL_INTEGER_ENV_RE[\s\S]*function parseIntegerEnv\(name: string, fallbackValue: number, min: number, max: number\)[\s\S]*CANONICAL_INTEGER_ENV_RE\.test\(raw\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "live canary integer env parsing must require canonical safe integers before dry-run or live setup",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /function parseIntegerEnv\(name: string, fallbackValue: number, min: number, max: number\)[\s\S]*const parsed = Number\(raw\);\s*if \(!Number\.isInteger\(parsed\)/,
    "live canary integer env parsing must not accept exponent, fractional, or leading-zero values through broad Number(raw) coercion",
  );
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_REPEAT_SAME_BET[\s\S]*repeat: true[\s\S]*if \(REPEAT_SAME_BET\) throw error/,
    "live canary fee measurement must be explicit and stop after a failed duplicate bet",
  );
  assert.match(
    liveRoundCanarySource,
    /walletPreflight ready=.*roles=.*\n.*if \(VERBOSE_WALLET_PREFLIGHT\) console\.table\(rows\)/s,
    "live canary must default to a redacted wallet preflight summary",
  );
  assert.match(
    liveRoundCanarySource,
    /let emptyResolveBootstrapUsed = false[\s\S]*emptyEpoch && \(!ALLOW_EMPTY_RESOLVE \|\| emptyResolveBootstrapUsed\)\) return[\s\S]*emptyEpoch && receipt\.status === "success"\) emptyResolveBootstrapUsed = true/,
    "live canary must allow at most one explicit empty-epoch bootstrap",
  );
  assert.match(
    liveRoundCanarySource,
    /RESOLVE_GAS_FLOOR[\s\S]*gasEstimate > RESOLVE_GAS_FLOOR \? gasEstimate : RESOLVE_GAS_FLOOR[\s\S]*gasEstimate: gasEstimate\.toString\(\)[\s\S]*gasLimit: gas\.toString\(\)/,
    "resolver canary must protect variable randomness branches with a floor and preserve estimate-versus-limit evidence",
  );
  assert.match(
    liveRoundCanarySource,
    /function bigintDeltaToBoundedSeconds\(upper: bigint, lower: bigint\)[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*Number\.MIN_SAFE_INTEGER[\s\S]*const secondsLeft = bigintDeltaToBoundedSeconds\(endTime, block\.timestamp\)/,
    "live canary must bound epoch-window second deltas before safe-window decisions",
  );
  assert.doesNotMatch(
    liveRoundCanarySource,
    /(^|[^A-Za-z0-9_])Number\(endTime - block\.timestamp\)/,
    "live canary must not broadly coerce epoch-window second deltas",
  );
  assert.match(
    liveRoundCanarySource,
    /window\.secondsLeft <= 0[\s\S]*epochData\[0\] === 0n\) return \{ \.\.\.window, atomicAdvance: true \}[\s\S]*recordedEpoch = atomicAdvance && receipt\.status === "success" \? epoch \+ 1n : epoch/,
    "live canary must atomically advance an expired empty epoch without paying the resolver",
  );
  assert.match(
    liveRoundCanarySource,
    /window\.secondsLeft <= 0[\s\S]*params\.afterEpoch == null \|\| window\.epoch >= params\.afterEpoch[\s\S]*epochData\[0\] === 0n\) return \{ \.\.\.window, atomicAdvance: true \}/,
    "live canary must recover from a reverted bet that leaves the same expired epoch empty",
  );
  assert.match(
    liveRoundCanarySource,
    /errorKind: receipt\.status === "reverted" \? "contract-revert" : undefined/,
    "live canary must classify confirmed receipt reverts without preserving raw provider errors",
  );

  const indexerSource = readFileSync("scripts/indexer.ts", "utf8");
  assert.match(
    indexerSource,
    /function filterLogsByTopics[\s\S]*topics\.every/,
    "indexer reconciliation must locally verify every requested topic",
  );
  assert.match(
    indexerSource,
    /fetchAllLogs[\s\S]*fetchLogsByTopicsAdaptive\(\[\], "ContractEvents"/,
    "indexer must fetch each contract chunk once per independent RPC, then classify topics locally",
  );
  assert.match(
    indexerSource,
    /const REPAIR_CHUNK_BLOCKS = 10_000n/,
    "indexer repair must stay within the confirmed Sepolia RPC log range",
  );
  assert.match(
    indexerSource,
    /RECONCILE_SCAN_CHUNK_BLOCKS = CHUNK_BLOCKS[\s\S]*recentCandidate[\s\S]*recentCandidate > INDEXER_START_BLOCK/,
    "indexer reconcile must stay within the supported log range and never scan before deployment",
  );
  assert.match(
    indexerSource,
    /recordIndexerWatchFailure\(consecutiveFailures, WATCH_FAILURE_LIMIT\)[\s\S]*Persistent watch failure threshold reached; exiting for supervisor restart[\s\S]*process\.exit\(1\)/,
    "persistent indexer watch failures must exit for supervisor restart",
  );
  assert.match(
    indexerSource,
    /watchTimer = setInterval[\s\S]*await runIndexerPass\(\);[\s\S]*consecutiveFailures = 0;/,
    "a successful indexer watch cycle must reset the failure threshold",
  );
  assert.match(
    indexerSource,
    /function parseChainCurrentEpochNumber\(value: bigint, observedBlock: bigint\)[\s\S]*parsePlausibleCurrentEpoch\(value, INDEXER_START_BLOCK, observedBlock\)[\s\S]*const currentEpochNumber = parseChainCurrentEpochNumber\(currentEpoch, currentBlock\)[\s\S]*storagePut\("gamedata\/_meta\/currentEpoch", currentEpochNumber\)[\s\S]*createReconcileEpochPlan\(\{[\s\S]*currentEpoch: currentEpochNumber/,
    "indexer must safely narrow chain currentEpoch before metadata writes and reconcile range construction",
  );
  const validTxHash = `0x${"ab".repeat(32)}`;
  assert.equal(indexerNormalization.parseIndexedEpochKey("1"), 1);
  assert.equal(indexerNormalization.parseIndexedEpochKey(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const invalidEpochKey of ["0", "01", "1e3", "+1", "1 ", "9007199254740992", 1, null]) {
    assert.equal(indexerNormalization.parseIndexedEpochKey(invalidEpochKey), null);
  }
  assert.equal(indexerNormalization.buildNormalizedEventId(` ${validTxHash.toUpperCase()} `, 7), `${validTxHash}_7`);
  assert.equal(indexerNormalization.buildNormalizedEventId(validTxHash, 0n), `${validTxHash}_0`);
  assert.equal(indexerNormalization.buildNormalizedEventIdForLog({ transactionHash: validTxHash, logIndex: 7 }), `${validTxHash}_7`);
  assert.equal(indexerNormalization.buildNormalizedEventIdForLog({ transactionHash: ` ${validTxHash.toUpperCase()} `, logIndex: 0n }), `${validTxHash}_0`);
  for (const [hash, logIndex] of [[undefined, 0], ["0xab", 0], [`0x${"gg".repeat(32)}`, 0], [validTxHash, null], [validTxHash, -1], [validTxHash, 1.5], [validTxHash, Number.MAX_SAFE_INTEGER + 1], [validTxHash, BigInt(Number.MAX_SAFE_INTEGER) + 1n], [validTxHash, "0"]]) {
    assert.equal(indexerNormalization.buildNormalizedEventId(hash, logIndex), null);
    assert.equal(indexerNormalization.buildNormalizedEventIdForLog({ transactionHash: hash, logIndex }), null);
  }
  assert.equal(indexerNormalization.buildNormalizedEventIdForLog(null), null);
  const broadEpochMutant = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const shortHashMutant = (hash, logIndex) => /^0x[0-9a-f]+$/i.test(String(hash)) ? `${String(hash).toLowerCase()}_${logIndex ?? 0}` : null;
  const unboundedBigintIndexMutant = (hash, logIndex) => typeof logIndex === "bigint" && logIndex >= 0n ? `${hash}_${logIndex}` : null;
  assert.notEqual(broadEpochMutant("01"), indexerNormalization.parseIndexedEpochKey("01"));
  assert.notEqual(broadEpochMutant("1e3"), indexerNormalization.parseIndexedEpochKey("1e3"));
  assert.notEqual(shortHashMutant("0xab", null), indexerNormalization.buildNormalizedEventId("0xab", null));
  assert.notEqual(unboundedBigintIndexMutant(validTxHash, BigInt(Number.MAX_SAFE_INTEGER) + 1n), indexerNormalization.buildNormalizedEventId(validTxHash, BigInt(Number.MAX_SAFE_INTEGER) + 1n));
  assert.equal(
    indexerSource.match(/parseIndexedEpochKey\((?:key|value)\)/g)?.length,
    2,
    "both stored-epoch production paths must use the shared canonical epoch-key parser",
  );
  assert.doesNotMatch(
    indexerSource,
    /function parseIndexedEpochKey\(|const n = Number\(key\)|Number\.isInteger\(Number\(key\)\)/,
    "indexer must not locally reimplement or broadly coerce stored epoch keys",
  );
  assert.equal(
    indexerSource.match(/buildNormalizedEventIdForLog\(log\)/g)?.length,
    8,
    "all eight normalized indexer event branches must use the shared log adapter",
  );
  assert.doesNotMatch(
    indexerSource,
    /function (?:buildNormalizedEventIdForLog|normalizedEventIdForLog)\(/,
    "indexer must not locally reimplement the shared log adapter",
  );
  assert.doesNotMatch(
    indexerSource,
    /(^|[^A-Za-z0-9_])Number\(currentEpoch\)/,
    "indexer must not broadly coerce chain currentEpoch evidence",
  );
  assert.match(
    indexerSource,
    /buildIndexerBetIdentity,[\s\S]*const identity = buildIndexerBetIdentity\([\s\S]*normalizedBet\.logIndex[\s\S]*if \(identity === null\) continue;[\s\S]*patch\[identity\.id\]/,
    "indexer bet writes must use the shared transaction-hash and log-index identity boundary",
  );
  assert.doesNotMatch(
    indexerSource,
    /\/\^0x\[0-9a-f\]\+\$\/\.test\(normalizedHash\)/,
    "indexer bet storage keys must not accept short or malformed tx hashes as tx identity",
  );
  assert.doesNotMatch(
    indexerSource,
    /id:\s*`\$\{log\.transactionHash \?\? "nohash"\}_\$\{log\.logIndex\?\.toString\(\) \?\? "0"\}`/,
    "indexer normalized claim/dust/resolver/fee events must not collapse partial logs into nohash_0 ids",
  );
  assert.match(
    liveRoundCanarySource,
    /afterEpoch\?: bigint \| null[\s\S]*window\.epoch > params\.afterEpoch[\s\S]*lastAttemptedEpoch = BigInt\(event\.epoch \?\? epoch\)/,
    "canary must require a strictly newer epoch and retain the actual epoch after an atomic advance",
  );
  const walletPlaytestSource = readFileSync("scripts/playtest-wallet.ts", "utf8");
  assert.match(
    walletPlaytestSource,
    /rpcCount=\$\{rpcUrls\.length\}/,
    "wallet playtest must report only RPC count by default",
  );
  assert.doesNotMatch(
    walletPlaytestSource,
    /rpc=\$\{rpcUrls\[0\]\}|depositsJson:|rebatesJson:/,
    "wallet playtest must not print raw RPC URLs or API payloads",
  );
  assert.match(
    walletPlaytestSource,
    /^(?=[\s\S]*from "\.\/playtest-wallet-policy\.mjs")(?=[\s\S]*resolveWalletPlaytestAdmission\(\{)(?=[\s\S]*hasWalletSigningMaterial\(process\.env\))(?=[\s\S]*fetchPlaytestJson\(\{)(?=[\s\S]*fetchPlaytestStatus\(\{)(?=[\s\S]*describeWalletPlaytestError)/,
    "wallet playtest must bind the behavior-tested admission, HTTP deadline, and diagnostic policies",
  );
  assert.match(
    walletPlaytestSource,
    /supportsEpochBoundBets[\s\S]*getBytecode[\s\S]*CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*placeBatchBetsBitmapForEpoch[\s\S]*\[epoch, tileIdsToMask\(tiles\), amount\]/,
    "wallet playtest must detect and use the protected epoch-bound bitmap path",
  );
  assert.match(
    walletPlaytestSource,
    /const singleTx = useEpochBoundBets[\s\S]*const batchTx = useEpochBoundBets/,
    "wallet playtest must keep both V10 sends on the protected path",
  );
  assert.match(
    liveRoundCanarySource,
    /const DRY_RUN = !LIVE_EXECUTION_CONFIRMED[\s\S]*DRY_RUN && hasSigningMaterialInEnvironment\(\)[\s\S]*async function main\(\)[\s\S]*const publicWalletConfig = loadLiveTestPublicWalletConfig\([\s\S]*if \(DRY_RUN\) \{[\s\S]*wallets = loadDryRunWallets\(publicWalletConfig\);[\s\S]*\} else \{[\s\S]*executionWalletConfig = loadExecutionWalletAdmission\([\s\S]*wallets = loadWallets\(executionWalletConfig\);/,
    "live canary dry-run must read only public role addresses and defer wallet-key loading to explicit execution",
  );
  assert.match(
    liveRoundCanarySource,
    /await runPreflight\(logPath, publicClient, wallets, plannedSpendByRole\);\s*if \(DRY_RUN\) return;[\s\S]*executionWalletConfig\.accountsByRole\.get\("RESOLVER"\)/,
    "live canary dry-run must not parse optional resolver signing material before returning",
  );
  const exactAllowance = resolveCanaryAllowancePlan({ currentAllowance: 2n, plannedSpend: 7n });
  assert.deepEqual(exactAllowance, {
    allowanceWithinRunCap: true,
    approvalTarget: 7n,
    needsApproval: true,
    participant: true,
    rejectReason: null,
  });
  assert.deepEqual(
    resolveCanaryAllowancePlan({ currentAllowance: 7n, plannedSpend: 7n }),
    { allowanceWithinRunCap: true, approvalTarget: 7n, needsApproval: false, participant: true, rejectReason: null },
  );
  assert.deepEqual(
    resolveCanaryAllowancePlan({ currentAllowance: 7n, plannedSpend: 7n, forceApprove: true }),
    { allowanceWithinRunCap: true, approvalTarget: 7n, needsApproval: true, participant: true, rejectReason: null },
  );
  assert.deepEqual(
    resolveCanaryAllowancePlan({ currentAllowance: 8n, plannedSpend: 7n }),
    {
      allowanceWithinRunCap: false,
      approvalTarget: 7n,
      needsApproval: false,
      participant: true,
      rejectReason: "existing allowance exceeds the declared run cap",
    },
  );
  assert.deepEqual(
    resolveCanaryAllowancePlan({ currentAllowance: 999n, plannedSpend: 0n }),
    { allowanceWithinRunCap: true, approvalTarget: 0n, needsApproval: false, participant: false, rejectReason: null },
    "a role with no planned spend must not inherit or change an existing allowance",
  );
  assert.throws(
    () => assertCanaryApprovalPostcondition({ actualAllowance: 8n, approvalTarget: 7n }),
    /exact declared run cap/,
  );
  assert.doesNotMatch(liveRoundCanarySource, /parseTokenAmountEnv\("LIVE_TEST_APPROVE_AMOUNT", "1000000000"\)/);
  assert.match(
    liveRoundCanarySource,
    /LIVE_TEST_APPROVE_AMOUNT is no longer supported[\s\S]*resolveCanaryAllowancePlan\([\s\S]*allowanceWithinRunCap[\s\S]*Preflight wallet allowance exceeds declared run cap/,
    "live canary approvals must be exact per-role run caps, persist readiness, and reject excess allowance",
  );
  assert.match(
    liveRoundCanarySource,
    /assertCanaryApprovalPostcondition\(\{ actualAllowance, approvalTarget: approveAmount \}\)/,
    "live canary must verify the exact allowance after every approval receipt",
  );
  const v10DryRunPreviewSource = readFileSync("scripts/create-v10-canary-dry-run-preview.mjs", "utf8");
  const v10DryRunPreviewCheckSource = readFileSync("scripts/check-v10-dry-run-preview.mjs", "utf8");
  assert.equal(
    packageScripts["preview:canary:v10:dry-run"],
    "node scripts/create-v10-canary-dry-run-preview.mjs",
    "V10 dry-run Preview must expose a one-command reproducible operator path",
  );
  assert.equal(
    packageScripts["preview:canary:v10:dry-run:summary"],
    "node scripts/check-v10-dry-run-preview.mjs",
    "V10 dry-run Preview must expose a lightweight validator for autonomous status without rerunning live dry-run commands",
  );
  assert.equal(
    packageScripts["preview:canary:v10:authorization-ready:summary"],
    "node scripts/check-v10-dry-run-preview.mjs --require-fresh-authorization",
    "V10 dry-run Preview must expose a strict freshness validator before requesting real-transaction authorization",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /staleError\.previewAgeMinutes = Math\.floor\(ageMs \/ 60_000\)[\s\S]*previewAgeMinutes[\s\S]*ageMinutes: previewAgeMinutes/,
    "V10 dry-run Preview stale authorization failures must report the actual Preview age instead of letting dashboards show ageMinutes=0",
  );
  assert.match(
    v10DryRunPreviewSource,
    /plan:canary:v10:postdeploy:summary[\s\S]*soak:testnet:clear-pending:summary[\s\S]*live:canary:v10:matrix[\s\S]*analyze-live-canary-proof\.mjs[\s\S]*--profile=v10-matrix[\s\S]*--require-epoch-bound[\s\S]*--require-v10-gas-matrix/,
    "V10 dry-run Preview must compose the read-only planner, pending nonce dry-run, V10 matrix dry-run, and strict analyzer",
  );
  assert.match(
    v10DryRunPreviewSource,
    /LIVE_TEST_DRY_RUN: "1"[\s\S]*LIVE_TEST_EXECUTE: "0"[\s\S]*SOAK_EXECUTE_LIVE: "0"[\s\S]*TEST_WALLET_EXECUTE: "0"/,
    "V10 dry-run Preview must force child commands into non-executing dry-run mode",
  );
  assert.match(
    v10DryRunPreviewSource,
    /parseSummaryTimeoutEnv[\s\S]*V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS", 240_000[\s\S]*timeout: CHILD_TIMEOUT_MS/,
    "V10 dry-run Preview timeout env must be canonical decimal and range checked before child process execution",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /Number\.parseInt\(process\.env\.V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS|Number\.isFinite\(CHILD_TIMEOUT_MS\)/,
    "V10 dry-run Preview timeout env must not use partial parseInt or broad numeric fallback",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /--execute-live|--execute"|--confirm-lowest-pending-nonce-replacement|LIVE_TEST_EXECUTE: "1"|SOAK_EXECUTE_LIVE: "1"|TEST_WALLET_EXECUTE: "1"/,
    "V10 dry-run Preview must not contain live execution flags or enabling env values",
  );
  assert.match(
    v10DryRunPreviewSource,
    /redactProofText[\s\S]*docs["'], ["']v10-canary-dry-run-preview\.md[\s\S]*dryRunProofBlocksG10G11[\s\S]*Fresh Consent Boundary/,
    "V10 dry-run Preview must write a redacted markdown Preview and keep G10/G11 blocked until live evidence exists",
  );
  assert.match(
    v10DryRunPreviewSource,
    /MAX_PREVIEW_FIELD_CHARS[\s\S]*function bullet\(label, value\)[\s\S]*formatPreviewField\(value\)[\s\S]*function formatPreviewField\(value\)[\s\S]*redactProofText\(String\(value\)\)[\s\S]*replace\(\/\\s\+\/g, " "\)[\s\S]*<truncated>/,
    "V10 dry-run Preview compact bullet fields must be redacted, single-line, and bounded",
  );
  assert.match(
    v10DryRunPreviewSource,
    /function extractCanaryLog\(output\)[\s\S]*normalizeCanaryLogPath\(raw\)[\s\S]*function safeCanaryLogPath\(value\)[\s\S]*path\.isAbsolute\(normalized\)[\s\S]*data[\s\S]*live-test-runs[\s\S]*\^live-canary-\[0-9TZ-\]\+\\\.jsonl\$[\s\S]*function normalizeCanaryLogPath\(value\)[\s\S]*if \(!path\.isAbsolute\(text\)\) return safeCanaryLogPath\(text\);[\s\S]*assertOrdinaryPath\(absolutePath, "dry-run canary log", false\)/,
    "V10 dry-run Preview must restrict logs to ordinary current live-test-run artifacts before running the analyzer",
  );
  assert.doesNotMatch(
    v10DryRunPreviewSource,
    /function extractCanaryLog\(output\)[\s\S]*return extractValue\(output,[\s\S]*\?\? extractValue\(output,/,
    "V10 dry-run Preview must not pass raw child log paths directly into the analyzer",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /PREVIEW_PATH = path\.join\("docs", "v10-canary-dry-run-preview\.md"\)[\s\S]*MAX_PREVIEW_BYTES = 512 \* 1024[\s\S]*MAX_DRY_RUN_LOG_BYTES = 256 \* 1024[\s\S]*V10_DRY_RUN_PREVIEW_MAX_AGE_MS/,
    "V10 dry-run Preview validator must use bounded artifact reads and a freshness window",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /function parsePositiveIntegerEnv\(name, fallback, min, max\)[\s\S]*DECIMAL_INTEGER_RE[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "V10 dry-run Preview validator freshness env must be BigInt-bound before Number narrowing",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /not an authorization to send transactions[\s\S]*Do not execute any of the following without a fresh exact authorization[\s\S]*requireBullet\(overall, "transactionSent", "false"\)[\s\S]*requireBullet\(overall, "dryRunProofBlocksG10G11", "true"\)/,
    "V10 dry-run Preview validator must preserve non-authorization, fresh consent, no-transaction, and G10/G11 blocked boundaries",
  );
  assert.match(
    v10DryRunPreviewCheckSource,
    /function readBoundedCanaryLogBinding\(relativePath\)[\s\S]*safeCanaryLogPath\(relativePath\)[\s\S]*assertCanonicalDirectory\(runDirectory[\s\S]*MAX_DRY_RUN_LOG_BYTES[\s\S]*function safeCanaryLogPath\(value\)[\s\S]*path\.isAbsolute\(normalized\)[\s\S]*data[\s\S]*live-test-runs[\s\S]*\^live-canary-\[0-9TZ-\]\+\\\.jsonl\$/,
    "V10 dry-run Preview validator must only validate bounded ordinary relative dry-run logs",
  );
  assert.doesNotMatch(
    v10DryRunPreviewCheckSource,
    /preview:canary:v10:dry-run|live:canary:v10:matrix|--execute-live|LIVE_TEST_EXECUTE: "1"|SOAK_EXECUTE_LIVE: "1"/,
    "V10 dry-run Preview validator must not rerun Preview commands or contain live execution flags",
  );
  const v10CompilerMatrixSource = readFileSync("scripts/benchmark-contract-v10.mjs", "utf8");
  const v10BenchmarkSource = readFileSync("scripts/benchmark-v10-linea-gas.ts", "utf8");
  assert.match(
    v10CompilerMatrixSource,
    /MAX_BENCHMARK_CONTRACT_SOURCE_BYTES = 2 \* 1024 \* 1024[\s\S]*function readBoundedUtf8File\(filePath, maxBytes, label\)[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to benchmark safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "V10 compiler matrix benchmark must size-gate local contract sources and imports before reading",
  );
  assert.match(
    v10CompilerMatrixSource,
    /function readImport\(importPath\)[\s\S]*path\.resolve\(importPath\)[\s\S]*path\.resolve\("node_modules", importPath\)[\s\S]*readBoundedUtf8File\(candidate, MAX_BENCHMARK_CONTRACT_SOURCE_BYTES[\s\S]*error\?\.code !== "ENOENT"[\s\S]*throw error/,
    "V10 compiler matrix benchmark must keep deterministic import lookup while failing closed on non-file or oversized matches",
  );
  assert.match(
    v10CompilerMatrixSource,
    /function compile\(\{ compiler, contractPath, contractName, runs, viaIR \}\)[\s\S]*readBoundedUtf8File\([\s\S]*contractPath[\s\S]*MAX_BENCHMARK_CONTRACT_SOURCE_BYTES[\s\S]*`contract source \$\{contractPath\}`[\s\S]*replace\(\/\\r\\n\?\//,
    "V10 compiler matrix benchmark must size-gate root contract sources before compiling",
  );
  assert.match(
    v10BenchmarkSource,
    /BEHAVIOR_ONLY_TIMEOUT_MS[\s\S]*withBenchmarkTimeout[\s\S]*behavior-benchmark-timeout/,
    "V10 behavior benchmark must fail closed instead of hanging indefinitely",
  );
  assert.match(
    v10BenchmarkSource,
    /DECIMAL_INTEGER_RE[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*BEHAVIOR_ONLY_TIMEOUT_MS = parsePositiveIntegerEnv\("V10_BEHAVIOR_TIMEOUT_MS", 90_000, 1_000, 900_000\)[\s\S]*function parsePositiveIntegerEnv\(name: string, fallback: number, min: number, max: number\): number[\s\S]*function parsePositiveIntegerValue\(name: string, raw: string, min: number, max: number\): number[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*Number\.isSafeInteger\(numeric\)/,
    "V10 behavior benchmark timeout env must be canonical decimal and range checked before the timeout guard",
  );
  assert.match(
    v10BenchmarkSource,
    /function parsePositiveIntegerValue\(name: string, raw: string, min: number, max: number\): number[\s\S]*must be a canonical decimal integer[\s\S]*const parsed = BigInt\(raw\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*const numeric = Number\(parsed\)[\s\S]*Number\.isSafeInteger\(numeric\)[\s\S]*v10RunsArg !== undefined[\s\S]*parsePositiveIntegerValue\("--v10-runs", v10RunsArg, 1, 1_000_000\)/,
    "V10 gas benchmark optimizer run CLI override must reject partial, malformed, and out-of-range values",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /behaviorOnlyTimeoutOverride|Number\.parseInt\(process\.env\.V10_BEHAVIOR_TIMEOUT_MS|Number\.parseInt\(v10RunsArg|const parsed = Number\(raw\)/,
    "V10 behavior benchmark timeout env and optimizer run override must not use partial parseInt coercion",
  );
  assert.match(
    v10BenchmarkSource,
    /type BenchmarkRow = \{[\s\S]*gasLimit: number;[\s\S]*gasDeltaVsV9\?: number;[\s\S]*function toSafeDisplayInteger\(value: bigint, label: string\): number[\s\S]*value < 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(value\)[\s\S]*const rows: BenchmarkRow\[\] = \[\][\s\S]*gasLimitNumber = toSafeDisplayInteger\(gasLimit[\s\S]*gasLimit: gasLimitNumber[\s\S]*gasLimit: toSafeDisplayInteger\(BigInt\(estimate\.gasLimit\)[\s\S]*baselineByCase[\s\S]*row\.gasLimit - baseline[\s\S]*row\.gasDeltaVsV9 >= 0/,
    "V10 gas benchmark must safely narrow RPC gas limits before report rows and regression deltas",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /Number\(BigInt\((?:estimate|jackpotCheckEstimate|jackpotAwardEstimate|emptyAdvanceEstimate)\.gasLimit\)\)|Number\((?:v9Deployment|v10Deployment)\.gasLimit\)|Number\(row\.gasLimit\)|Number\(row\.gasDeltaVsV9\)/,
    "V10 gas benchmark must not broadly coerce gas-limit or delta fields after parsing",
  );
  assert.match(
    v10BenchmarkSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*MAX_RPC_RESPONSE_BYTES[\s\S]*CONTENT_LENGTH_RE[\s\S]*function parseContentLengthHeader\(value: string \| null\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*async function readBoundedJsonResponse[\s\S]*parseContentLengthHeader\(response\.headers\.get\("content-length"\)\)[\s\S]*new TextDecoder\("utf-8", \{ fatal: true \}\)[\s\S]*reader\.cancel[\s\S]*rpcRequest/,
    "V10 Linea gas benchmark RPC reads must strictly parse and bound JSON response bodies in the shared helper",
  );
  assert.match(
    v10BenchmarkSource,
    /MAX_BENCHMARK_SOURCE_BYTES = 2 \* 1024 \* 1024;[\s\S]*MAX_BENCHMARK_COMPILER_CONFIG_BYTES = 512 \* 1024;[\s\S]*MAX_PREPARED_INITCODE_BYTES = 256 \* 1024;[\s\S]*function readBoundedUtf8File\(filePath: string, maxBytes: number, label: string\): string[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to benchmark safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "V10 gas benchmark must size-gate local source, compiler config, and prepared initcode reads",
  );
  assert.match(
    v10BenchmarkSource,
    /JSON\.parse\([\s\S]*readBoundedUtf8File\([\s\S]*"contracts\/LineaOreV10\.compiler-config\.json"[\s\S]*MAX_BENCHMARK_COMPILER_CONFIG_BYTES[\s\S]*"V10 compiler config"/,
    "V10 gas benchmark must size-gate the compiler config before JSON parsing",
  );
  assert.match(
    v10BenchmarkSource,
    /function readImport\(importPath: string\)[\s\S]*path\.resolve\(importPath\)[\s\S]*path\.resolve\("node_modules", importPath\)[\s\S]*readBoundedUtf8File\(candidate, MAX_BENCHMARK_SOURCE_BYTES[\s\S]*NodeJS\.ErrnoException[\s\S]*code !== "ENOENT"[\s\S]*throw error/,
    "V10 gas benchmark must keep deterministic import lookup while failing closed on non-file or oversized matches",
  );
  assert.match(
    v10BenchmarkSource,
    /function compileContract\([\s\S]*readBoundedUtf8File\([\s\S]*contractPath[\s\S]*MAX_BENCHMARK_SOURCE_BYTES[\s\S]*`contract source \$\{contractPath\}`[\s\S]*replace\(\/\\r\\n\?\//,
    "V10 gas benchmark must size-gate root contract sources before compiling",
  );
  assert.match(
    v10BenchmarkSource,
    /if \(deploymentOnly\) \{[\s\S]*readBoundedUtf8File\([\s\S]*"\.tmp\/v10-canonical-initcode\.hex"[\s\S]*MAX_PREPARED_INITCODE_BYTES[\s\S]*"prepared V10 initcode"[\s\S]*prepared V10 initcode does not match/,
    "V10 deployment gas benchmark must size-gate prepared initcode before comparing it",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /Number\(response\.headers\.get\("content-length"\)\)/,
    "V10 Linea gas benchmark RPC reads must not broadly coerce content-length headers",
  );
  assert.doesNotMatch(
    v10BenchmarkSource,
    /response\.json\(\)/,
    "V10 Linea gas benchmark RPC reads must not use unbounded response.json",
  );
  const v10PostdeployPlanSource = readFileSync("scripts/plan-v10-postdeploy-canary.ts", "utf8");
  const v10RuntimeIdentitySource = readFileSync("scripts/v10-runtime-identity.ts", "utf8");
  const sharedGameFunctions = new Set(
    gameConstants.GAME_ABI
      .filter((item) => item.type === "function")
      .map((item) => item.name),
  );
  const sharedGameEvents = new Set(
    gameConstants.GAME_EVENTS_ABI
      .filter((item) => item.type === "event")
      .map((item) => item.name),
  );
  const sharedTokenFunctions = new Set(
    gameConstants.TOKEN_ABI
      .filter((item) => item.type === "function")
      .map((item) => item.name),
  );
  assert.equal(
    sharedGameFunctions.has("epochRewardClaimed"),
    true,
    "the shared game ABI must expose aggregate reward claims for solvency planning",
  );
  assert.equal(
    sharedTokenFunctions.has("decimals"),
    true,
    "the shared token ABI must expose the 18-decimal runtime boundary",
  );
  const indexedFinancialEvents = [
    "BetPlaced",
    "BatchBetsPlaced",
    "BatchBetsSameAmountPlaced",
    "BatchBetsBitmapPlaced",
    "EpochResolved",
    "DailyJackpotAwarded",
    "WeeklyJackpotAwarded",
    "RewardClaimed",
    "RewardBatchClaimed",
    "RebateClaimed",
    "RebateBatchClaimed",
    "RewardDustSettled",
    "RebateDustSettled",
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "ProtocolFeesFlushed",
  ];
  const indexerAbiSource = readFileSync("scripts/indexer.ts", "utf8");
  for (const eventName of indexedFinancialEvents) {
    assert.equal(
      sharedGameEvents.has(eventName),
      true,
      `shared GAME_EVENTS_ABI must preserve ${eventName} for frontend/indexer compatibility`,
    );
    assert.match(
      indexerAbiSource,
      new RegExp(`eventName: "${eventName}"|eventName !== "${eventName}"|eventName === "${eventName}"|eventName, "${eventName}"`),
      `indexer must keep an explicit ${eventName} decode/handler reference`,
    );
  }
  for (const aggregateDustEvent of ["RewardDustBatchSettled", "RebateDustBatchSettled"]) {
    assert.equal(
      sharedGameEvents.has(aggregateDustEvent),
      true,
      `shared GAME_EVENTS_ABI must preserve ${aggregateDustEvent} for frontend compatibility`,
    );
    assert.doesNotMatch(
      indexerAbiSource,
      new RegExp(aggregateDustEvent),
      `${aggregateDustEvent} is aggregate-only and must not double-count the per-epoch dust settlement index`,
    );
  }
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /createWalletClient|privateKey|writeContract|sendTransaction|\bwalletClient\b/,
    "V10 post-deploy planning must remain transaction-free and must not load signing material",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /\.env\.live-test-wallets/,
    "V10 post-deploy planning must never read the secret-bearing live wallet file",
  );
  assert.match(
    v10PostdeployPlanSource,
    /\.env\.live-test-addresses[\s\S]*replace\(\/\^\\uFEFF\/[\s\S]*public-only/,
    "V10 post-deploy planning must use a dedicated public-address file when process env is absent",
  );
  assert.match(
    v10PostdeployPlanSource,
    /function parsePublicAddressEnvLine\(line: string\)[\s\S]*replace\(\/\^export\\s\+\/[\s\S]*match\(\/\^\(\[A-Z0-9_\]\+\)\\s\*=\\s\*\(\.\*\?\)\\s\*\(\?:#\.\*\)\?\$\/\)[\s\S]*replace\(\/\^\["'\]\|\["'\]\$\/g, ""\)/,
    "V10 post-deploy planning must parse normal dotenv public-address lines without requiring exact KEY=value formatting",
  );
  assert.match(
    v10PostdeployPlanSource,
    /MAX_V10_PUBLIC_ADDRESS_FILE_BYTES = 64 \* 1024;[\s\S]*function readBoundedUtf8File\(filePath: string, maxBytes: number, label: string\)[\s\S]*const stats = statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to validate safely[\s\S]*readFileSync\(filePath, "utf8"\)/,
    "V10 post-deploy planning must size-gate public-address artifacts before reading",
  );
  assert.match(
    v10RuntimeIdentitySource,
    /readV10RuntimeIdentityManifest[\s\S]*readBoundedV10Utf8File\(\s*manifestPath,\s*MAX_V10_COMPILATION_MANIFEST_BYTES,\s*"Canonical V10 compilation manifest"[\s\S]*normalizeV10ExecutableRuntime[\s\S]*normalizedExecutableRuntimeSha256/,
    "shared V10 runtime identity must size-gate and normalize the canonical compilation manifest",
  );
  assert.match(
    v10PostdeployPlanSource,
    /\.env\.live-test-addresses[\s\S]*existsSync\(addressFile\)[\s\S]*readBoundedUtf8File\([\s\S]*addressFile[\s\S]*MAX_V10_PUBLIC_ADDRESS_FILE_BYTES[\s\S]*public-only address file[\s\S]*replace\(\/\^\\uFEFF\//,
    "V10 post-deploy planning must reject directory or oversized public-address files before reading",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /fallback\([^;]*rank:\s*true/s,
    "one-shot V10 post-deploy planning must not keep the process alive with RPC ranking timers",
  );
  const v10SnapshotReadCalls = v10PostdeployPlanSource.split("client.readContract({").length - 1;
  const v10SnapshotReadPins = v10PostdeployPlanSource.split("...readSnapshot").length - 1;
  assert.equal(
    v10SnapshotReadPins,
    v10SnapshotReadCalls,
    "every V10 post-deploy contract read must use the fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const snapshotBlock = block\.number;[\s\S]*assertV10RuntimeIdentity\(\{[\s\S]*contractAddress: CONTRACT_ADDRESS,[\s\S]*deployBlock: CONTRACT_DEPLOY_BLOCK,[\s\S]*expectedChainId: APP_CHAIN\.id,[\s\S]*snapshotBlock,[\s\S]*snapshotBlockHash: block\.hash,[\s\S]*getBytecode\(\{ address: CONTRACT_ADDRESS, blockNumber: snapshotBlock \}\)[\s\S]*snapshot: \{[\s\S]*blockNumber: snapshotBlock\.toString\(\)/,
    "V10 post-deploy identity must bind configured chain/address/deploy block before snapshot output",
  );
  assert.match(
    v10PostdeployPlanSource,
    /getBytecode\(\{ address: LINEA_TOKEN_ADDRESS, blockNumber: snapshotBlock \}\)[\s\S]*functionName: "decimals"[\s\S]*if \(!tokenBytecode\)[\s\S]*contractToken[\s\S]*if \(tokenDecimals !== 18\)[\s\S]*tokenBoundary: \{[\s\S]*runtimePresent: true[\s\S]*immutableMatch: true[\s\S]*decimals: tokenDecimals/,
    "V10 post-deploy planning must prove token runtime, immutable identity, and decimals before financial output",
  );
  assert.match(
    v10PostdeployPlanSource,
    /async function simulateAndEstimate\([\s\S]*snapshotBlock: bigint[\s\S]*simulateContract\(\{[\s\S]*blockNumber: snapshotBlock[\s\S]*estimateContractGas\(\{[\s\S]*blockNumber: snapshotBlock/,
    "positive V10 simulations and estimates must use the fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /async function requireExpectedRevert\([\s\S]*snapshotBlock: bigint[\s\S]*simulateContract\(\{[\s\S]*blockNumber: snapshotBlock[\s\S]*requireExpectedRevert\(client, call, snapshotBlock\)/,
    "negative V10 simulations must use the same fixed snapshot block",
  );
  assert.match(
    v10PostdeployPlanSource,
    /simulateContract[\s\S]*estimateContractGas[\s\S]*claimRewards[\s\S]*claimEpochsRebate[\s\S]*claimResolverRewards[\s\S]*flushProtocolFees[\s\S]*resolveEpoch/,
    "V10 post-deploy planning must simulate every remaining bounded mutation class",
  );
  assert.match(
    v10PostdeployPlanSource,
    /nextAuthorization: !adminStateClean[\s\S]*blockedBy: adminBlockReason[\s\S]*: resolveReady[\s\S]*transactionLimit: 1[\s\S]*rerunRequiredAfterReceipt: true[\s\S]*invalidatedByResolve: resolveReady/,
    "V10 post-deploy planning must block untrusted governance before isolating resolve from claims",
  );
  const v10ResolveBarrierIndex = v10PostdeployPlanSource.indexOf("const resolveReady =");
  const v10ClaimPlanningIndex = v10PostdeployPlanSource.indexOf("const rolesToPlan =");
  assert.ok(
    v10ResolveBarrierIndex >= 0 && v10ResolveBarrierIndex < v10ClaimPlanningIndex,
    "V10 post-deploy planning must decide the resolve barrier before discovering role claims",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const claimPlanningReady = scanComplete && !resolveReady && adminStateClean;[\s\S]*const rolesToPlan = claimPlanningReady \? roles : \[\];[\s\S]*if \(claimPlanningReady && \(ownerFees > 0n \|\| burnFees > 0n\)\)/,
    "V10 post-deploy planning must skip claim and fee-flush simulations while resolve or governance blocks the phase",
  );
  assert.match(
    v10PostdeployPlanSource,
    /V10_EXPECTED_CURRENT_OWNER[\s\S]*V10_EXPECTED_CURRENT_FEE_RECIPIENT[\s\S]*V10_EXPECTED_CURRENT_EPOCH_DURATION[\s\S]*functionName: "owner"[\s\S]*functionName: "feeRecipient"[\s\S]*functionName: "epochDuration"[\s\S]*const ownerMatches =[\s\S]*const feeRecipientMatches =[\s\S]*const epochDurationMatches =[\s\S]*const adminBlockReason =[\s\S]*const adminStateClean = adminBlockReason === null;[\s\S]*const resolvePlanningReady = resolveReady && adminStateClean;[\s\S]*if \(resolvePlanningReady\)[\s\S]*recommendedResolveGasLimit = resolvePlanningReady/,
    "V10 post-deploy planning must fail closed before recommending mutations under unexpected or pending governance",
  );
  assert.match(
    v10PostdeployPlanSource,
    /function plannedCallCount\(ready: boolean\)[\s\S]*return ready \? 1 : 0[\s\S]*plannedTransactions:[\s\S]*plannedCallCount\(rewardEpochs\.length > 0\)[\s\S]*plannedCallCount\(rebateEpochs\.length > 0\)[\s\S]*plannedCallCount\(resolverReward > 0n\)[\s\S]*admin: \{[\s\S]*clean: adminStateClean[\s\S]*ownerMatch: ownerMatches[\s\S]*feeRecipientMatch: feeRecipientMatches[\s\S]*epochDurationMatch: epochDurationMatches[\s\S]*currentlySimulatedTransactions: claimPhaseTransactions \+ plannedCallCount\(resolvePlanningReady\)/,
    "V10 post-deploy output must expose governance matches without printing addresses and count only permitted simulations through explicit planned-call counters",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /Number\(resolvePlanningReady\)|Number\(rewardEpochs\.length > 0\)|Number\(rebateEpochs\.length > 0\)|Number\(resolverReward > 0n\)/,
    "V10 post-deploy planner must not count authorization calls through broad boolean-to-number coercion",
  );
  assert.match(
    v10PostdeployPlanSource,
    /operationalBoundary: \{[\s\S]*transactionSent: false[\s\S]*signingMaterialLoaded: false[\s\S]*walletClientCreated: false[\s\S]*contractWriteSubmitted: false[\s\S]*outputAddressFree: true[\s\S]*operationalBoundary: output\.operationalBoundary/,
    "V10 post-deploy summary must explicitly state that planning is transaction-free and does not load signing material",
  );
  assert.doesNotMatch(
    v10PostdeployPlanSource,
    /createWalletClient|privateKeyToAccount|sendTransaction|writeContract/,
    "V10 post-deploy planner must remain a read-only public-client planner with no wallet signing or write helpers",
  );
  assert.match(
    v10PostdeployPlanSource,
    /if \(resolveReady\) \{[\s\S]*negativeCalls\.push\([\s\S]*expectedError: "EpochClosing"[\s\S]*label: "funded expired protected bet"/,
    "V10 post-deploy planning must only expect EpochClosing from a currently funded expired epoch",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const firstResolvedEpoch = firstResolved\?\.epoch[\s\S]*const openClaimWindowEpoch = firstResolved[\s\S]*resolvedEpochs\.find\([\s\S]*block\.timestamp < epoch\.resolvedAt \+ DUST_SETTLE_DELAY[\s\S]*expectedError: openClaimWindowEpoch \? "NoWinningBet" : "RewardClaimWindowExpired"[\s\S]*if \(openClaimWindowEpoch\) \{[\s\S]*DustSettlementDelayNotReached[\s\S]*openClaimWindowChecksApplied: Boolean\(openClaimWindowEpoch\)/,
    "V10 post-deploy claim and dust negatives must follow the one-year lifecycle instead of becoming stale",
  );
  assert.match(
    v10PostdeployPlanSource,
    /resolverRewardsByRole = new Map\([\s\S]*pendingResolverRewards[\s\S]*knownResolverLiability[\s\S]*resolverRewardsByRole\.get\(role\.role\)/,
    "V10 post-deploy planning must include known resolver liabilities without rereading them during claim planning",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const claimPhaseCalls: SanitizedPlannedCall\[\] = \[\];[\s\S]*functionName: "claimRewards"[\s\S]*functionName: "claimEpochsRebate"[\s\S]*functionName: "claimResolverRewards"[\s\S]*functionName: "flushProtocolFees"[\s\S]*claimPhaseCalls\.length !== claimPhaseTransactions[\s\S]*calls: claimPhaseCalls/,
    "V10 post-deploy authorization must expose one sanitized exact call per permitted claim or flush transaction",
  );
  assert.match(
    v10PostdeployPlanSource,
    /SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)[\s\S]*output\.nextAuthorization\.calls\.reduce[\s\S]*typeof call === "string" \? call : call\.functionName[\s\S]*callCounts/,
    "V10 post-deploy planner must support compact summary output without dropping resolve-only authorization calls",
  );
  assert.match(
    v10PostdeployPlanSource,
    /claimManifestGas[\s\S]*BigInt\(call\.estimatedGas\)[\s\S]*claimManifestTransfers[\s\S]*parseUnits\(call\.expectedTransferLinea, 18\)[\s\S]*claimManifestGas !== claimPhaseGas[\s\S]*claimManifestTransfers !== claimPhaseTransfers[\s\S]*recommendedGasLimit\) <= BigInt\(call\.estimatedGas\)/,
    "V10 post-deploy authorization must fail closed when exact call totals or gas limits diverge",
  );
  assert.match(
    v10PostdeployPlanSource,
    /type SanitizedPlannedCall = \{[\s\S]*role: RoleName;[\s\S]*functionName: PlannedCall\["functionName"\];[\s\S]*epochs: string\[\];[\s\S]*estimatedGas: string;[\s\S]*recommendedGasLimit: string;[\s\S]*expectedTransferLinea: string;/,
    "V10 post-deploy call manifests must remain address-free while carrying exact gas and transfer bounds",
  );
  assert.match(
    v10PostdeployPlanSource,
    /epochRewardClaimed[\s\S]*epoch\.rewardClaimed > epoch\.rewardPool \|\| epoch\.rebateClaimed > epoch\.rebatePool[\s\S]*outstandingRewardLiability \+= epoch\.rewardPool - epoch\.rewardClaimed[\s\S]*outstandingRebateLiability \+= epoch\.rebatePool - epoch\.rebateClaimed/,
    "V10 post-deploy planning must fail closed on overclaimed pools and retain every unsettled epoch liability",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const lowerBoundLiability =[\s\S]*currentData\[0\][\s\S]*rolloverPool[\s\S]*dailyJackpotPool[\s\S]*weeklyJackpotPool[\s\S]*ownerFees[\s\S]*burnFees[\s\S]*knownResolverLiability[\s\S]*outstandingRewardLiability[\s\S]*outstandingRebateLiability[\s\S]*covered: lowerBoundCovered[\s\S]*if \(!lowerBoundCovered \|\| contractBalance < claimPhaseTransfers\)/,
    "V10 post-deploy planning must enforce the complete observable liability lower bound",
  );
  assert.match(
    v10PostdeployPlanSource,
    /currentClaimPhase: \{[\s\S]*complete: claimPlanningReady[\s\S]*skipped: !claimPlanningReady[\s\S]*skipReason: claimPlanningSkipReason/,
    "V10 post-deploy output must explain when the claim phase was deliberately skipped",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const scanComplete = scanFrom === 1n[\s\S]*truncated: !scanComplete[\s\S]*transactionLimit: 0[\s\S]*resolved-history scan is truncated/,
    "V10 post-deploy planning must block claim and fee-flush authorization when history is truncated",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const READ_BATCH_SIZE = 4;[\s\S]*async function mapInBatches[\s\S]*values\.slice\(offset, offset \+ READ_BATCH_SIZE\)\.map\(mapper\)[\s\S]*readBatchSize: READ_BATCH_SIZE/,
    "V10 post-deploy discovery must expose and enforce bounded read concurrency",
  );
  assert.match(
    v10RuntimeIdentitySource,
    /LineaOreV10\.compilation\.json[\s\S]*verifyCanonicalV10CompilationProvenance[\s\S]*assertV10RuntimeIdentity[\s\S]*getBytecode\(\{ address: contractAddress, blockNumber: deployBlock - 1n \}\)[\s\S]*getBytecode\(\{ address: contractAddress, blockNumber: deployBlock \}\)[\s\S]*getBytecode\(\{ address: contractAddress, blockNumber: snapshotBlock \}\)/,
    "shared V10 identity must verify canonical provenance and bind pre-deploy, deploy-block, and pinned snapshot code",
  );
  const runtimeIdentityGateIndex = v10PostdeployPlanSource.indexOf("assertV10RuntimeIdentity({");
  const firstLiabilityReadIndex = v10PostdeployPlanSource.indexOf('functionName: "accruedOwnerFees"');
  assert.ok(
    runtimeIdentityGateIndex >= 0 &&
      firstLiabilityReadIndex >= 0 &&
      runtimeIdentityGateIndex < firstLiabilityReadIndex,
    "V10 runtime identity must pass before any mutation planning reads or simulations",
  );
  assert.match(
    v10PostdeployPlanSource,
    /runtimeIdentity,[\s\S]*scan:/,
    "V10 post-deploy output must expose the successful executable-runtime identity gate",
  );
  assert.match(
    v10PostdeployPlanSource,
    /const scannedEpochs = await mapInBatches<bigint, ResolvedEpoch \| null>[\s\S]*winningPool = claimPlanningReady[\s\S]*const roleEpochStates = await mapInBatches\(resolvedEpochs/,
    "V10 post-deploy discovery must batch epoch and per-role reads while loading each winning pool once",
  );
  assert.match(
    v10PostdeployPlanSource,
    /expectedResolverReward = \(currentData\[0\] \* 5n\) \/ 10_000n[\s\S]*estimatedResolveFee = resolveGas \* currentGasPrice[\s\S]*breakEvenEthPerLinea/,
    "V10 post-deploy planning must expose resolver break-even without assuming a token price",
  );
  assert.match(
    v10PostdeployPlanSource,
    /RESOLVE_GAS_FLOOR = 500_000n[\s\S]*bufferedResolveGas[\s\S]*recommendedResolveGasLimit[\s\S]*recommendedGasLimit:/,
    "V10 post-deploy planning must separate dynamic resolve estimates from a conservative execution gas limit",
  );
  for (const expectedError of [
    "NotResolved",
    "NoWinningBet",
    "RewardClaimWindowExpired",
    "NothingToClaim",
    "NoRebateAvailable",
    "UnexpectedEpoch",
    "InvalidTile",
    "InvalidTileMask",
    "ArraysMismatch",
    "InvalidEpochDuration",
    "InvalidFeeRecipient",
    "NoPendingEpochDurationChange",
    "NoPendingFeeRecipientChange",
    "OwnershipRenounceDisabled",
    "DustSettlementDelayNotReached",
    "OwnableUnauthorizedAccount",
    "EpochClosing",
  ]) {
    assert.ok(
      v10PostdeployPlanSource.includes(`"${expectedError}"`),
      `V10 post-deploy planning must require exact deployed ${expectedError} errors`,
    );
  }
  assert.equal(
    packageScripts["plan:canary:v10:postdeploy"],
    "node scripts/check-contract-compilation-provenance.mjs --target=v10 && tsx scripts/plan-v10-postdeploy-canary.ts",
    "V10 post-deploy planner must verify canonical provenance before its stable read-only command",
  );
  assert.equal(
    packageScripts["proof:contract-compile:summary"],
    "node scripts/check-contract-compilation-provenance.mjs --summary-only",
    "V9 provenance must expose a compact summary command for routine evidence collection",
  );
  assert.equal(
    packageScripts["proof:contract-compile:v10:summary"],
    "node scripts/check-contract-compilation-provenance.mjs --target=v10 --summary-only",
    "V10 provenance must expose a compact summary command for routine evidence collection",
  );
  assert.equal(
    packageScripts["plan:canary:v10:postdeploy:summary"],
    "node scripts/check-contract-compilation-provenance.mjs --target=v10 --summary-only && tsx scripts/plan-v10-postdeploy-canary.ts --summary-only",
    "V10 post-deploy planner must expose a canonical compact read-only command",
  );
  const contractProvenanceSource = readFileSync("scripts/check-contract-compilation-provenance.mjs", "utf8");
  assert.match(
    contractProvenanceSource,
    /const SUMMARY_ONLY = process\.argv\.includes\("--summary-only"\)/,
    "contract compilation provenance must support compact summary output",
  );
  assert.match(
    contractProvenanceSource,
    /process\.argv\.includes\("--write-manifest"\) && !SUMMARY_ONLY[\s\S]*if \(!SUMMARY_ONLY\) \{[\s\S]*fs\.mkdirSync\(path\.dirname\(OUTPUT_PATH\), \{ recursive: true \}\);[\s\S]*fs\.writeFileSync\(OUTPUT_PATH,[\s\S]*wouldWrite: false/,
    "contract compilation provenance summary must be read-only and skip manifest/output artifact writes",
  );
  assert.match(
    contractProvenanceSource,
    /MAX_CONTRACT_SOURCE_BYTES = 2 \* 1024 \* 1024[\s\S]*MAX_COMPILER_CONFIG_BYTES = 512 \* 1024[\s\S]*MAX_COMPILATION_MANIFEST_BYTES = 512 \* 1024[\s\S]*MAX_PACKAGE_LOCK_BYTES = 5 \* 1024 \* 1024[\s\S]*function readBoundedUtf8File\(filePath, maxBytes, label\)[\s\S]*const stats = fs\.statSync\(filePath\)[\s\S]*!stats\.isFile\(\)[\s\S]*stats\.size > maxBytes[\s\S]*too large to validate safely[\s\S]*fs\.readFileSync\(filePath, "utf8"\)/,
    "contract compilation provenance must size-gate contract sources, config, manifests, and package lock before reading",
  );
  for (const docPath of ["docs/production-runbook.md", "docs/v10-contract-design.md"]) {
    const docSource = readFileSync(docPath, "utf8");
    assert.ok(
      docSource.includes("npm.cmd run plan:canary:v10:postdeploy:summary"),
      `${docPath} must direct routine V10 post-deploy planning to the compact command`,
    );
  }
  const productionRunbookSource = readFileSync("docs/production-runbook.md", "utf8");
  assert.match(
    productionRunbookSource,
    /npm\.cmd run preview:canary:v10:dry-run[\s\S]*npm\.cmd run preview:canary:v10:dry-run:summary[\s\S]*npm\.cmd run preview:canary:v10:authorization-ready:summary/,
    "production runbook must list the V10 dry-run Preview and authorization-ready freshness commands before fresh transaction consent",
  );
  assert.match(
    productionRunbookSource,
    /docs\/v10-canary-dry-run-preview\.md[\s\S]*fresh consent input[\s\S]*not[\s\S]*canary proof/,
    "production runbook must treat the V10 dry-run Preview as fresh consent input without treating it as proof",
  );
  assert.match(
    productionRunbookSource,
    /regular summary command validates the existing Preview[\s\S]*transactionSent=false[\s\S]*G10\/G11 dry-run blocker/,
    "production runbook must document the regular V10 dry-run Preview validator boundary",
  );
  assert.match(
    productionRunbookSource,
    /The authorization-ready summary applies the stricter fresh-consent[\s\S]*window/,
    "production runbook must require and validate the V10 dry-run Preview plus authorization-ready freshness check before fresh transaction consent without treating it as proof",
  );
  const v10PreviewCommandMapSource = readFileSync("docs/launch-evidence-command-map.md", "utf8");
  assert.match(
    v10PreviewCommandMapSource,
    /## Pre-Bet Dry-Run Preview[\s\S]*does not satisfy G10[\s\S]*npm\.cmd run preview:canary:v10:dry-run[\s\S]*npm\.cmd run preview:canary:v10:dry-run:summary[\s\S]*npm\.cmd run preview:canary:v10:authorization-ready:summary/,
    "launch command map must expose the V10 dry-run Preview and authorization-ready freshness commands while keeping G10/G11 live-evidence blocked",
  );
  assert.match(
    v10PreviewCommandMapSource,
    /docs\/v10-canary-dry-run-preview\.md[\s\S]*regular summary command validates the existing Preview[\s\S]*transactionSent=false[\s\S]*The authorization-ready summary applies the[\s\S]*stricter fresh-consent[\s\S]*window[\s\S]*does not satisfy live[\s\S]*canary\/soak proof/,
    "launch command map must expose the V10 dry-run Preview artifact, validator, and authorization-ready freshness gate while keeping G10/G11 live-evidence blocked",
  );
  const testnetDeepAuditSource = readFileSync("docs/testnet-deep-audit-2026-07-19.md", "utf8");
  assert.doesNotMatch(
    testnetDeepAuditSource,
    /optionally flush fees|every-120th external-transfer liveness coupling|Safety Pool discovery is still capped/,
    "testnet deep-audit docs must not preserve stale pre-V10 fee-flush or discovery blockers",
  );
  assert.match(
    testnetDeepAuditSource,
    /V10 accrues owner and burn fees during resolve[\s\S]*explicit permissionless `flushProtocolFees\(\)` path/,
    "testnet deep-audit docs must describe current V10 fee delivery accurately",
  );
  assert.match(
    testnetDeepAuditSource,
    /Safety Pool now exposes an explicit bounded load-older flow/,
    "testnet deep-audit docs must record the bounded Safety Pool older-history flow",
  );
  assert.equal(
    packageScripts["proof:restore:summary"],
    "node scripts/verify-db-restore.mjs --summary-only",
    "restore proof must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["db:backup:summary"],
    "node scripts/backup-sqlite.mjs --summary-only",
    "SQLite backup must expose a compact summary command for routine operator checks",
  );
  assert.equal(
    packageScripts["db:backup:strict:summary"],
    "node scripts/backup-sqlite.mjs --strict --summary-only",
    "SQLite backup must expose a compact strict summary command for launch checks",
  );
  assert.match(
    sqliteScopeAuditSource,
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*auditSqliteScopes\(sourceInput, activeScope\)[\s\S]*!regularFileStat\(sourcePath\)[\s\S]*Scope audit source must be an existing regular file/,
    "SQLite scope audit must reject missing or directory DB paths through a shared regular-file stat boundary",
  );
  const sqliteBehaviorRoot = mkdtempSync(join(tmpdir(), "lore-sqlite-operator-behavior-"));
  try {
    const sqliteBehaviorRun = spawnSync(process.execPath, ["scripts/test-sqlite-operations.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DB_DRILL_DIR: sqliteBehaviorRoot,
        LINEA_NETWORK: "sepolia",
        LORE_BACKUP_REQUIRE_EXTERNAL: "0",
        LORE_BACKUP_RETENTION_DAYS: "",
        NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
        NODE_ENV: "test",
        PROOF_STRICT: "0",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(
      sqliteBehaviorRun.status,
      0,
      `SQLite operator behavior probe must pass: ${sqliteBehaviorRun.error?.message ?? sqliteBehaviorRun.stderr}`,
    );
    const sqliteBehaviorLines = String(sqliteBehaviorRun.stdout).trim().split(/\r?\n/).filter(Boolean);
    const sqliteBehaviorSummary = JSON.parse(sqliteBehaviorLines.at(-1) ?? "{}");
    assert.equal(sqliteBehaviorSummary.status, "pass");
    assert.deepEqual(
      sqliteBehaviorSummary.retention,
      { expiredRemoved: 1, recentPreserved: true, unrelatedPreserved: true },
    );
    for (const fault of [
      "activeDbWalShmProtected",
      "atomicLatePublicationCollisionRejected",
      "backupSummaryReadOnly",
      "corruptBackupRestoreRejected",
      "corruptBackupRestoreSummaryRejected",
      "corruptSourceBackupCleanup",
      "futureSourceBackupSummaryRejected",
      "malformedRestoreSummaryRejected",
      "malformedRetentionBackupSummaryRejected",
      "malformedSqliteBackupSummaryRejected",
      "missingSourceBackupSummaryRejected",
      "readOnlyWriteRejected",
      "repoLocalProductionBackupRejected",
      "restoreSummaryReadOnly",
      "restoreUsesSuppliedBackupArtifact",
      "unsafeRetentionBackupSummaryRejected",
    ]) {
      assert.equal(sqliteBehaviorSummary.faults?.[fault], true, `SQLite operator behavior probe must cover ${fault}`);
    }
    assert.doesNotMatch(
      `${sqliteBehaviorRun.stdout}\n${sqliteBehaviorRun.stderr}`,
      new RegExp(sqliteBehaviorRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      "SQLite operator behavior output must not expose its temporary source, backup, or restore paths",
    );
  } finally {
    rmSync(sqliteBehaviorRoot, { recursive: true, force: true });
  }
  const previousWindow = globalThis.window;
  try {
    const storage = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    };
    const snapshotKey = liveStateSnapshot.getLiveStateSnapshotKey();
    storage.set(snapshotKey, JSON.stringify({ currentEpoch: "7", fetchedAt: Date.now() - 13 * 60 * 60 * 1000 }));
    assert.equal(liveStateSnapshot.loadLiveStateSnapshot(), null);
    assert.equal(storage.has(snapshotKey), false, "stale live-state snapshots must be removed from localStorage");
    storage.set(snapshotKey, "{bad json");
    assert.equal(liveStateSnapshot.loadLiveStateSnapshot(), null);
    assert.equal(storage.has(snapshotKey), false, "corrupt live-state snapshots must be removed from localStorage");
    storage.set(snapshotKey, JSON.stringify({ currentEpoch: "8", fetchedAt: Date.now() }));
    assert.deepEqual(liveStateSnapshot.loadLiveStateSnapshot()?.currentEpoch, "8");
  } finally {
    globalThis.window = previousWindow;
  }
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(2n, 2n), false);
  assert.equal(safetyPoolClaimThreshold.isSafetyPoolClaimBelowMinimum(0n, 2n), false);
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(null, 10_000), null);
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(9_500, 10_000), "Updated now");
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(40_000, 100_000), "Updated 1m ago");
  assert.equal(analyticsDepositsStatus.formatDepositFreshnessLabel(100_000, 360_000), "Updated 4m ago");
}
