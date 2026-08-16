import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isFinalHttpsOrigin } from "./collect-proof-common.mjs";

const MONITORS = [
  {
    kind: "health-prod",
    target: "/api/health/runtime",
    cadence: "60s",
    condition: "Runtime health is not ok or the endpoint is unreachable.",
    test: "Point the monitor at a temporary failing URL or force a non-ok runtime dependency in staging, then confirm an alert fires and resolves.",
    evidence: "Monitor link, fired alert link, resolved alert link, timestamp, and redacted notification screenshot/export.",
  },
  {
    kind: "data-sync",
    target: "/api/health/data-sync",
    cadence: "60s",
    condition: "Data-sync health is not ok.",
    test: "Use staging/canary data-sync failure mode or a temporary threshold override, then confirm alert and recovery.",
    evidence: "Monitor link, fired alert link, recovery event, and redacted provider export.",
  },
  {
    kind: "stale-indexer-heartbeat",
    target: "/api/health/data-sync",
    cadence: "60s",
    condition: "Indexer heartbeat is stale beyond the production threshold.",
    test: "Pause the canary indexer long enough to cross the stale threshold, then restart and confirm recovery.",
    evidence: "Alert event, indexer restart timestamp, heartbeat before/after, and recovery event.",
  },
  {
    kind: "indexer-lag",
    target: "/api/health/data-sync",
    cadence: "60s",
    condition: "Indexer lag exceeds the production threshold for consecutive checks.",
    test: "Throttle or pause the canary indexer until lag crosses the threshold, then let it catch up.",
    evidence: "Lag samples, alert event, recovery event, and direct chain/indexer comparison sample.",
  },
  {
    kind: "bot-restart",
    target: "process manager",
    cadence: "event-driven",
    condition: "lore-bot restarts unexpectedly or exceeds restart threshold.",
    test: "Restart the canary bot process through the process manager and confirm the restart alert fires.",
    evidence: "Process manager event, alert event, bot version/env label, and recovery timestamp.",
  },
  {
    kind: "indexer-restart",
    target: "process manager",
    cadence: "event-driven",
    condition: "lore-indexer restarts unexpectedly or exceeds restart threshold.",
    test: "Restart the canary indexer process through the process manager and confirm the restart alert fires.",
    evidence: "Process manager event, alert event, indexer version/env label, and recovery timestamp.",
  },
  {
    kind: "reverted-tx",
    target: "centralized error tracking",
    cadence: "event-driven",
    condition: "Repeated reverted transactions or repeated wallet send failures are reported.",
    test: "Trigger a controlled reverted transaction in canary with a test wallet and confirm it appears in error tracking with safe redaction.",
    evidence: "Error event link, redacted payload sample, wallet/tx hash redaction check, and alert notification.",
  },
];

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function hasRealText(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^todo\b/i.test(text);
}

function printHelp() {
  console.log(`Usage:
  npm.cmd run proof:monitoring:plan -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --out=docs/monitoring-alert-test-plan.draft.md

Options:
  --provider=<name>          External monitor provider, e.g. Better Stack, Datadog, Grafana Cloud.
  --error-provider=<name>    Error tracking provider, e.g. Sentry or Datadog.
  --origin=<https-origin>    Final public HTTPS origin without path/query/hash.
  --alert-target=<target>    Alert delivery target label. Default: TODO: alert target.
  --release=<id>             Release/deploy id for the test plan. Default: TODO: release or deploy id.
  --out=<path>               Output markdown path. Default: docs/monitoring-alert-test-plan.draft.md.
  --force                    Overwrite an existing output file.
`);
}

if (hasFlag("help") || hasFlag("h")) {
  printHelp();
  process.exit(0);
}

const provider = argValue("provider", "TODO: monitoring provider");
const errorProvider = argValue("error-provider", "TODO: error tracking provider");
const origin = argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || "TODO: production origin");
const alertTarget = argValue("alert-target", "TODO: alert target");
const releaseOrDeploy = argValue("release", process.env.VERCEL_GIT_COMMIT_SHA || process.env.RELEASE_ID || "TODO: release or deploy id");
const outPath = path.resolve(process.cwd(), argValue("out", "docs/monitoring-alert-test-plan.draft.md"));

if (!isFinalHttpsOrigin(origin)) {
  throw new Error("--origin must be a public HTTPS origin without path, query, or hash");
}
if (!hasRealText(provider)) {
  throw new Error("--provider must identify the monitoring provider");
}
if (!hasRealText(errorProvider)) {
  throw new Error("--error-provider must identify the error tracking provider");
}
if (existsSync(outPath) && !hasFlag("force")) {
  throw new Error(`${path.relative(process.cwd(), outPath)} already exists; pass --force to overwrite`);
}

const rows = MONITORS.map((monitor) => `| ${monitor.kind} | ${monitor.target} | ${monitor.cadence} | ${monitor.condition} | ${monitor.test} | ${monitor.evidence} |`).join("\n");

const markdown = `# Monitoring Alert Test Plan Draft

This is a draft checklist. It is not launch proof until every TODO is replaced with external provider evidence from the real canary/production setup.

## Target

- Provider: ${provider}
- Origin: ${origin}
- Required email alert target: ${alertTarget}
- Error tracking: ${errorProvider}
- Release/deploy: ${releaseOrDeploy}

## Required Alert Tests

| Monitor | Target | Cadence | Alert condition | Test method | Required evidence |
| --- | --- | --- | --- | --- | --- |
${rows}

## Execution Notes

- Run tests on staging/canary first; do not use synthetic failures against production users.
- Keep payloads redacted: no private keys, auth tokens, raw cookies, or full wallet inventory dumps.
- Every alert needs a fired event and a recovery/resolution event.
- Strict proof requires a verified email alert target with concrete fired-alert evidence.
- Reverted transaction monitoring must prove repeated failures are visible without leaking sensitive wallet/session data.
- Stale indexer and lag checks must use the same finality assumptions as production.

## Commands

\`\`\`powershell
npm.cmd run proof:monitoring:draft -- --provider=${provider} --error-provider=${errorProvider} --origin=${origin} --monitor-artifact=docs/monitoring-alert-export.log --recovery-artifact=docs/monitoring-recovery-export.log --alert-target-artifact=docs/monitoring-alert-target-test.log --error-event-artifact=docs/error-tracking-test-event.log --out=docs/monitoring-proof.draft.json
npm.cmd run proof:monitoring -- --strict
\`\`\`
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, markdown, "utf8");
console.log(`Monitoring alert test plan written: ${path.relative(process.cwd(), outPath)}`);
