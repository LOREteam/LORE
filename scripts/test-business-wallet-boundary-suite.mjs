import { runWalletActionBoundaryTests } from "./test-business-wallet-action-boundaries.mjs";
import { runWalletExternalBoundaryTests } from "./test-business-wallet-external-boundaries.mjs";
import { runErrorShellBoundaryTests } from "./test-business-error-shell-boundaries.mjs";
import { runDialogAccessibilityTests } from "./test-business-dialog-accessibility.mjs";
import { runWalletFundingPresentationTests } from "./test-business-wallet-funding-presentation.mjs";

export function runWalletBoundarySuite() {
  runWalletActionBoundaryTests();
  runWalletExternalBoundaryTests();
  runErrorShellBoundaryTests();
  runDialogAccessibilityTests();
  runWalletFundingPresentationTests();
}
