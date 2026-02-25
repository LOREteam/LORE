const DEFAULT_FIREBASE_DB_URL =
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || DEFAULT_FIREBASE_DB_URL;
