/** Sleep for a given number of milliseconds */
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Normalize decimal separators (comma -> dot) for numeric input */
export const normalizeDecimalInput = (value: string): string => value.replace(/,/g, ".");

/** Format seconds as MM:SS */
export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

/** Truncate an Ethereum address for display */
export const shortenAddress = (address: string): string =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

/** Parse a numeric string safely, returning 0 on failure */
export const safeParseFloat = (value: string): number => {
  const n = parseFloat(normalizeDecimalInput(value));
  return isNaN(n) ? 0 : n;
};

/** Check if an error was a user rejection (MetaMask, etc.) */
export const isUserRejection = (err: unknown): boolean => {
  if (err instanceof Error) {
    return err.message.toLowerCase().includes("user rejected");
  }
  return false;
};
