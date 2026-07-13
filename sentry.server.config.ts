import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryPayload } from "./app/lib/sentrySanitize";

function readSampleRate(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: readSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
  sendDefaultPii: false,
  beforeSend: sanitizeSentryPayload,
  beforeBreadcrumb: sanitizeSentryPayload,
});
