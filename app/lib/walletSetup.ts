export type WalletSetupState = "idle" | "creating" | "error";

export const WALLET_SETUP_ERROR = "Wallet creation could not be completed. Please try again.";

export async function runWalletSetupAttempt(onCreateEmbeddedWallet: () => Promise<void>): Promise<"complete" | "failed"> {
  try {
    await onCreateEmbeddedWallet();
    return "complete";
  } catch {
    return "failed";
  }
}

export function createWalletSetupGuard({
  onCreateEmbeddedWallet,
  onStateChange,
}: {
  onCreateEmbeddedWallet: () => Promise<void>;
  onStateChange: (state: WalletSetupState) => void;
}) {
  let locked = false;

  return {
    async run(): Promise<void> {
      if (locked) return;
      locked = true;
      onStateChange("creating");
      if (await runWalletSetupAttempt(onCreateEmbeddedWallet) === "failed") {
        locked = false;
        onStateChange("error");
      }
    },
    reset() {
      locked = false;
      onStateChange("idle");
    },
  };
}
