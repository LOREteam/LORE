// Non-secret project defaults.
// Keep values here so deployment does not require duplicating them in server .env.

export const DEFAULT_FIREBASE_DB_URL =
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export const DEFAULT_CONTRACT_ADDRESS =
  "0x2a98cfb661710d11c47e958856859f7b474e0107" as const;

export const DEFAULT_INDEXER_START_BLOCK = 25_663_555;

export const DEFAULT_INDEXER_RECONCILE_INTERVAL_MS = 120_000;
export const DEFAULT_INDEXER_RECONCILE_MAX_EPOCHS_PER_PASS = 8;
export const DEFAULT_API_EPOCHS_RECONCILE_MAX = 25;
export const DEFAULT_DATA_SYNC_LAG_WARN_BLOCKS = 800;

export const DEFAULT_LINEA_SEPOLIA_RPCS = [
  "https://linea-sepolia.drpc.org",
  "https://linea-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.linea.build",
] as const;
