import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { assertTrustedHealthCredentialOrigin } from "./health-credential-origin.mjs";

const ROOT = process.cwd();
const SECRET = "h".repeat(32);
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;
const FETCH_GUARD = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch=async()=>{throw new Error("NETWORK_CALL_FORBIDDEN")}',
)}`;

function runScript(script, args, env) {
  return spawnSync(process.execPath, [`--import=${FETCH_GUARD}`, script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 10_000,
  });
}

function runLiveCanary(env) {
  const inheritedEnvWithoutSigningMaterial = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !SIGNING_ENV_NAME_RE.test(name)),
  );
  return spawnSync(
    process.execPath,
    [`--import=${FETCH_GUARD}`, "node_modules/tsx/dist/cli.mjs", "scripts/live-round-canary.ts"],
    {
      cwd: ROOT,
      env: { ...inheritedEnvWithoutSigningMaterial, ...env },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

test("credential-bearing health origins require exact canonical origin", () => {
  assert.equal(
    assertTrustedHealthCredentialOrigin({
      target: "https://PLAYLORE.xyz:443/",
      canonicalOrigin: "https://playlore.xyz",
      targetName: "TEST_HEALTH_BASE_URL",
    }).origin,
    "https://playlore.xyz",
  );
  assert.equal(
    assertTrustedHealthCredentialOrigin({
      target: "http://127.0.0.1:3011",
      canonicalOrigin: undefined,
      targetName: "TEST_HEALTH_BASE_URL",
    }).origin,
    "http://127.0.0.1:3011",
  );
  assert.equal(
    assertTrustedHealthCredentialOrigin({
      target: "https://playlore.xyz",
      canonicalOrigin: undefined,
      targetName: "TEST_HEALTH_BASE_URL",
    }).origin,
    "https://playlore.xyz",
  );
  assert.throws(
    () => assertTrustedHealthCredentialOrigin({
      target: "https://attacker.example.net",
      canonicalOrigin: "https://playlore.xyz",
      targetName: "TEST_HEALTH_BASE_URL",
    }),
    /must exactly match NEXT_PUBLIC_SITE_URL/,
  );
  assert.throws(
    () => assertTrustedHealthCredentialOrigin({
      target: "https://playlore.xyz.attacker.example.net",
      canonicalOrigin: "https://playlore.xyz",
      targetName: "TEST_HEALTH_BASE_URL",
    }),
    /must exactly match NEXT_PUBLIC_SITE_URL/,
  );
});

test("production health checker rejects malicious origin before fetch", () => {
  const result = runScript("scripts/check-production-health.mjs", ["--summary-only"], {
    PROD_HEALTH_BASE_URL: "https://attacker.example.net",
    NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
    HEALTH_DIAGNOSTICS_SECRET: SECRET,
    PROD_HEALTH_ALLOW_LOCAL: "",
    NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
    LINEA_CHAIN_ID: "59141",
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /must exactly match NEXT_PUBLIC_SITE_URL/);
  assert.doesNotMatch(output, /NETWORK_CALL_FORBIDDEN/);
});

test("runtime monitor rejects malicious origin and preserves exact canonical config", () => {
  const common = {
    NEXT_PUBLIC_SITE_URL: "https://playlore.xyz",
    HEALTH_DIAGNOSTICS_SECRET: SECRET,
    RUNTIME_MONITOR_ALLOW_NO_ALERTS: "1",
    RUNTIME_MONITOR_ALLOW_LOCAL: "",
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    LORE_PREMAINNET_RUNTIME_STRICT: "",
    NODE_ENV: "test",
  };
  const malicious = runScript("scripts/monitor-runtime-health.mjs", ["--summary-only"], {
    ...common,
    RUNTIME_MONITOR_BASE_URL: "https://attacker.example.net",
  });
  const maliciousOutput = `${malicious.stdout}\n${malicious.stderr}`;
  assert.equal(malicious.status, 1, maliciousOutput);
  assert.match(maliciousOutput, /must exactly match NEXT_PUBLIC_SITE_URL/);
  assert.doesNotMatch(maliciousOutput, /NETWORK_CALL_FORBIDDEN/);

  const legitimate = runScript("scripts/monitor-runtime-health.mjs", ["--summary-only"], {
    ...common,
    RUNTIME_MONITOR_BASE_URL: "https://playlore.xyz",
  });
  const legitimateOutput = `${legitimate.stdout}\n${legitimate.stderr}`;
  assert.equal(legitimate.status, 0, legitimateOutput);
  assert.match(legitimate.stdout, /"status":"pass"/);
  assert.doesNotMatch(legitimateOutput, /NETWORK_CALL_FORBIDDEN/);
});

test("live canary rejects malicious health origin before RPC or health fetch", () => {
  const result = runLiveCanary({
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    LIVE_TEST_EXECUTE: "0",
    LIVE_TEST_HEALTH_BASE_URL: "https://attacker.example.net",
    NEXT_PUBLIC_SITE_URL: "https://testnet.playlore.xyz",
    HEALTH_DIAGNOSTICS_SECRET: SECRET,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /must exactly match NEXT_PUBLIC_SITE_URL/);
  assert.doesNotMatch(output, /NETWORK_CALL_FORBIDDEN/);
});
