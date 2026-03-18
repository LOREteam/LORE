import { getConfiguredFirebaseDbUrl } from "../../config/publicConfig";

export const FIREBASE_DB_URL = getConfiguredFirebaseDbUrl(
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
);
