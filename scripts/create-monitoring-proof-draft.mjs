import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MONITOR_KINDS = [
  "health-prod",
  "data-sync",
  "stale-indexer-heartbeat",
  "indexer-lag",
  "bot-restart",
  "indexer-restart",
  "reverted-tx",
];

const DEFAULT_CONDITIONS = {
  "health-prod": "TODO: alert when npm.cmd run health:prod is non-ok",
  "data-sync": "TODO: alert when /api/health/data-sync is non-ok",
  "stale-indexer-heartbeat": "TODO: heartbeat stale threshold",
  "indexer-lag": "TODO: indexer lag threshold",
  "bot-restart": "TODO: bot restart threshold",
  "indexer-restart": "TODO: indexer restart threshold",
  "reverted-tx": "TODO: repeated reverted tx threshold",
};

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : process.env[name.toUpperCase().replaceAll("-", "_")] || fallback;
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) &&
      !host.endsWith(".local");
  } catch {
    return false;
  }
}

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/monitoring-proof.json") {
    throw new Error("monitoring draft generator writes incomplete drafts only; use --out=docs/monitoring-proof.draft.json, then promote to docs/monitoring-proof.json only after real alert evidence and strict validation");
  }
}
function hasRealText(value) {
  return String(value ?? "").trim().length > 0 && !/TODO|TBD/i.test(String(value));
}

function optionalExistingArtifact(name) {
  const value = argValue(name);
  if (!value) return "";
  const resolved = path.resolve(process.cwd(), value);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return value;
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/monitoring-proof.draft.json"));
refuseFinalProofOutput(outPath);
const provider = argValue("provider", "TODO: monitoring provider");
const origin = argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || "TODO: production origin");
const environment = argValue("environment", process.env.NODE_ENV || "production");
const errorProvider = argValue("error-provider", "TODO: Sentry/Datadog/etc");
const releaseOrDeploy = argValue("release", process.env.VERCEL_GIT_COMMIT_SHA || process.env.RELEASE_ID || "TODO: release or deploy id");
const monitorArtifact = optionalExistingArtifact("monitor-artifact");
const recoveryArtifact = optionalExistingArtifact("recovery-artifact");
const alertTargetArtifact = optionalExistingArtifact("alert-target-artifact");
const errorEventArtifact = optionalExistingArtifact("error-event-artifact");

if (!isFinalHttpsOrigin(origin)) {
  throw new Error("--origin must be a non-local HTTPS origin without path, query, or hash");
}
if (!hasRealText(provider)) {
  throw new Error("--provider must identify the monitoring provider");
}
if (!hasRealText(errorProvider)) {
  throw new Error("--error-provider must identify the error tracking provider");
}

const monitors = MONITOR_KINDS.map((kind) => ({
  kind,
  enabled: false,
  provider,
  cadenceSeconds: kind === "health-prod" ? 60 : undefined,
  command: kind === "health-prod" ? "npm.cmd run health:prod" : undefined,
  url:
    kind === "health-prod"
      ? `${origin.replace(/\/+$/, "")}/api/health/runtime`
      : ["data-sync", "stale-indexer-heartbeat", "indexer-lag"].includes(kind)
        ? `${origin.replace(/\/+$/, "")}/api/health/data-sync`
        : undefined,
  alertCondition: DEFAULT_CONDITIONS[kind],
  link: monitorArtifact ? `artifact: ${monitorArtifact}` : "TODO: monitor page link",
  evidencePath: monitorArtifact || undefined,
  lastAlertTestAt: "TODO: ISO timestamp from fired test alert",
  recoveryLink: recoveryArtifact ? `artifact: ${recoveryArtifact}` : "TODO: resolved/recovery alert link or evidence",
  recoveryEvidencePath: recoveryArtifact || undefined,
  lastRecoveryAt: "TODO: ISO timestamp from resolved/recovered alert",
}));

const manifest = {
  origin,
  monitors,
  alertTargets: [
    {
      name: "TODO: alert target label",
      kind: "TODO: pagerduty/slack/email/etc",
      verified: false,
      lastTestAt: "TODO: ISO timestamp from alert target test",
      link: alertTargetArtifact ? `artifact: ${alertTargetArtifact}` : "TODO: alert target test event or provider link",
      evidence: alertTargetArtifact ? `redacted alert target artifact: ${alertTargetArtifact}` : "TODO: redacted fired alert proof",
    },
  ],
  errorTracking: {
    enabled: false,
    provider: errorProvider,
    project: "TODO: project label",
    link: "TODO: project or dashboard link",
    environment,
    releaseOrDeploy,
    testEventStatus: "TODO",
    testEventAt: "TODO: ISO timestamp from error tracking test event",
    testEventId: "TODO: provider event id or issue id",
    testEventLink: errorEventArtifact ? `artifact: ${errorEventArtifact}` : "TODO: provider test event link",
    testEventEvidencePath: errorEventArtifact || undefined,
  },
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Monitoring proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields, enable each monitor only after a real alert test, then save as docs/monitoring-proof.json.");
