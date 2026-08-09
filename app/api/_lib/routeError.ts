import { sanitizeSentryPayload } from "../../lib/sentrySanitize";

type RouteErrorDetails = {
  name: string;
  message: string;
};

const MAX_ERROR_NAME_LENGTH = 80;
const MAX_ERROR_MESSAGE_LENGTH = 600;
const MAX_ROUTE_LABEL_LENGTH = 120;
const MAX_EXTRA_DEPTH = 4;
const MAX_EXTRA_STRING_LENGTH = 240;
const MAX_EXTRA_ARRAY_ITEMS = 8;
const MAX_EXTRA_OBJECT_KEYS = 16;

function clampOneLine(value: string, maxLength: number) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function sanitizeRouteExtraKey(key: string) {
  const safe = sanitizeSentryPayload(key);
  const text = typeof safe === "string" && safe.trim() ? safe : "key";
  return clampOneLine(text, MAX_ERROR_NAME_LENGTH);
}

function clampRouteExtra(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return clampOneLine(value, MAX_EXTRA_STRING_LENGTH);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_EXTRA_DEPTH) return "<truncated>";
  if (Array.isArray(value)) return value.slice(0, MAX_EXTRA_ARRAY_ITEMS).map((entry) => clampRouteExtra(entry, depth + 1));

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_EXTRA_OBJECT_KEYS)
      .map(([key, entry]) => [sanitizeRouteExtraKey(key), clampRouteExtra(entry, depth + 1)]),
  );
}

export function describeRouteError(error: unknown): RouteErrorDetails {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
    };
  }

  if (typeof error === "string" && error.trim()) {
    return {
      name: "Error",
      message: error,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

export function describeSafeRouteError(error: unknown): RouteErrorDetails {
  const safe = sanitizeSentryPayload(describeRouteError(error));
  return {
    name: clampOneLine(safe.name || "Error", MAX_ERROR_NAME_LENGTH),
    message: clampOneLine(safe.message || "Unknown error", MAX_ERROR_MESSAGE_LENGTH),
  };
}

function describeSafeRouteLabel(route: string) {
  const safe = sanitizeSentryPayload(route);
  const label = typeof safe === "string" && safe.trim() ? safe : "api";
  return clampOneLine(label.replace(/[\[\]]/g, ""), MAX_ROUTE_LABEL_LENGTH) || "api";
}

export function logRouteError(route: string, error: unknown, extra?: Record<string, unknown>) {
  const safeRoute = describeSafeRouteLabel(route);
  const details = describeSafeRouteError(error);
  const safeExtra = extra ? clampRouteExtra(sanitizeSentryPayload(extra)) : undefined;
  if (safeExtra && Object.keys(safeExtra).length > 0) {
    console.error(`[${safeRoute}] ${details.name}: ${details.message}`, safeExtra);
    return;
  }
  console.error(`[${safeRoute}] ${details.name}: ${details.message}`);
}
