import { runReleaseDocumentationTests } from "./test-business-release-documentation.mjs";
import { runMainnetProofPolicyTests } from "./test-business-mainnet-proof-policy.mjs";
import { runMainnetProofOutputTests } from "./test-business-mainnet-proof-output.mjs";
import { runChainProofPolicyTests } from "./test-business-chain-proof-policy.mjs";

export function runReleaseProofSuite() {
  runReleaseDocumentationTests();
  runMainnetProofPolicyTests();
  runMainnetProofOutputTests();
  runChainProofPolicyTests();
}
