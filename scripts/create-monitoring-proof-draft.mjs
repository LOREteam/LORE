import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isFinalHttpsOrigin } from "./collect-proof-common.mjs";

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
const MAX_MONITORING_DRAFT_ARTIFACT_BYTES = 512 * 1024;

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : process.env[name.toUpperCase().replaceAll("-", "_")] || fallback;
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

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function requireExistingArtifact(name) {
  const value = argValue(name);
  if (!value) {
    throw new Error(`--${name} is required when drafting monitoring launch evidence`);
  }
  const resolved = path.resolve(process.cwd(), value);
  const stats = regularFileStat(resolved);
  if (!stats) {
    throw new Error(`--${name} must point to an existing redacted file artifact`);
  }
  if (stats.size > MAX_MONITORING_DRAFT_ARTIFACT_BYTES) {
    throw new Error(`--${name} artifact is too large to reference safely`);
  }
  return value;
}

function sameArtifact(left, right) {
  return path.resolve(process.cwd(), left).toLowerCase() === path.resolve(process.cwd(), right).toLowerCase();
}

function requireDistinctArtifactInputs(entries) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftName, leftPath] = entries[leftIndex];
      const [rightName, rightPath] = entries[rightIndex];
      if (sameArtifact(leftPath, rightPath)) {
        if (leftName === "monitor-artifact" && rightName === "recovery-artifact") {
          throw new Error("--monitor-artifact and --recovery-artifact must point to distinct fired-alert and recovery evidence files");
        }
        throw new Error(`--${leftName} and --${rightName} must point to distinct monitoring evidence files`);
      }
    }
  }
}

function emailDomainForOrigin(value) {
  try {
    return new URL(String(value ?? "").trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "TODO: production domain";
  }
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/monitoring-proof.draft.json"));
refuseFinalProofOutput(outPath);
const provider = argValue("provider", "TODO: monitoring provider");
const origin = argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || "TODO: production origin");
const emailDomain = emailDomainForOrigin(origin);
const environment = argValue("environment", process.env.NODE_ENV || "production");
const errorProvider = argValue("error-provider", "TODO: Sentry/Datadog/etc");
const releaseOrDeploy = argValue("release", process.env.VERCEL_GIT_COMMIT_SHA || process.env.RELEASE_ID || "TODO: release or deploy id");
const monitorArtifact = requireExistingArtifact("monitor-artifact");
const recoveryArtifact = requireExistingArtifact("recovery-artifact");
const alertTargetArtifact = requireExistingArtifact("alert-target-artifact");
const errorEventArtifact = requireExistingArtifact("error-event-artifact");
requireDistinctArtifactInputs([
  ["monitor-artifact", monitorArtifact],
  ["recovery-artifact", recoveryArtifact],
  ["alert-target-artifact", alertTargetArtifact],
  ["error-event-artifact", errorEventArtifact],
]);

if (!isFinalHttpsOrigin(origin)) {
  throw new Error("--origin must be a public HTTPS origin without path, query, or hash");
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
      name: "TODO: verified Resend email alert target",
      kind: "email",
      recipient: "TODO: verified recipient email address",
      sender: `TODO: verified Resend sender such as alerts@${emailDomain}`,
      senderDomain: emailDomain,
      verified: false,
      lastTestAt: "TODO: ISO timestamp from alert target test",
      link: alertTargetArtifact ? `artifact: ${alertTargetArtifact}` : "TODO: alert target test event or provider link",
      evidence: alertTargetArtifact ? `redacted alert target artifact: ${alertTargetArtifact}` : "TODO: redacted fired alert proof",
      artifact: alertTargetArtifact || undefined,
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
    testEventArtifact: errorEventArtifact || undefined,
  },
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Monitoring proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields, enable each monitor only after a real alert test, then save as docs/monitoring-proof.json.");
