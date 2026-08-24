import { runProductionRuntimeEnvTests } from "./test-business-production-runtime-env.mjs";
import { runProductionRuntimeConfigTests } from "./test-business-production-runtime-config.mjs";
import { runProductionRuntimeStrictTests } from "./test-business-production-runtime-strict.mjs";
import { runProductionRuntimeNetworkMatrixTests } from "./test-business-production-runtime-network-matrix.mjs";

export function runProductionRuntimeSuite() {
  runProductionRuntimeEnvTests();
  runProductionRuntimeConfigTests();
  runProductionRuntimeStrictTests();
  runProductionRuntimeNetworkMatrixTests();
}
