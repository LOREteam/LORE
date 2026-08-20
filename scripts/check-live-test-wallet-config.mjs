import { pathToFileURL } from "node:url";
import {
  describeLiveTestWalletConfigError,
  loadLiveTestExecutionWalletConfig,
} from "./live-test-wallet-config.mjs";

export function validateLiveTestWalletConfig({ cwd = process.cwd(), environment = process.env } = {}) {
  const config = loadLiveTestExecutionWalletConfig({ cwd, environment });
  return {
    status: "pass",
    roles: config.roles,
    addressMatches: true,
    unique: true,
    walletSetSha256: config.walletSetSha256,
    signingMaterialLoaded: true,
    signatureRequested: false,
    networkRequests: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(validateLiveTestWalletConfig()));
  } catch (error) {
    console.error(describeLiveTestWalletConfigError(error));
    process.exitCode = 1;
  }
}
