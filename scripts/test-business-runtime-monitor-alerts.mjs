import assert from "node:assert/strict";
import * as runtimeMonitorModule from "./runtime-monitor-lib.mjs";

export async function runRuntimeMonitorAlertTests() {
  const runtimeMonitor = runtimeMonitorModule.default ?? runtimeMonitorModule;
  const invalidResendSender = runtimeMonitor.createResendAlertSender({
    env: {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "not-an-email",
    },
  });
  assert.equal(
    invalidResendSender.configured,
    false,
    "runtime monitor must not treat invalid Resend email addresses as configured",
  );

  let resendRequestBody = null;
  const validResendSender = runtimeMonitor.createResendAlertSender({
    env: {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com, ops@playlore.xyz",
      ALERT_PREFIX: "LORE Keeper",
    },
    fetchImpl: async (_url, init) => {
      resendRequestBody = JSON.parse(String(init.body));
      return { ok: true };
    },
    now: () => 1_000,
  });
  assert.equal(
    validResendSender.configured,
    true,
    "runtime monitor must accept verified-sender display names and comma-separated email recipients",
  );
  assert.equal(await validResendSender.send("ALERT: synthetic", "synthetic-alert", 0), true);
  assert.deepEqual(resendRequestBody?.to, ["playlore88@gmail.com", "ops@playlore.xyz"]);
  assert.equal(resendRequestBody?.from, "LORE <alerts@playlore.xyz>");
}
