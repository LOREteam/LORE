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
  let generation = 0;
  let locked = false;

  return {
    async run(): Promise<void> {
      if (locked) return;
      locked = true;
      const attemptGeneration = ++generation;
      onStateChange("creating");
      const result = await runWalletSetupAttempt(onCreateEmbeddedWallet);
      if (attemptGeneration !== generation) return;
      if (result === "failed") {
        locked = false;
        onStateChange("error");
      }
    },
    reset() {
      generation += 1;
      locked = false;
      onStateChange("idle");
    },
  };
}
