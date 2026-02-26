import { DEFAULT_FIREBASE_DB_URL } from "../../config/publicConfig";

export const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || DEFAULT_FIREBASE_DB_URL;
