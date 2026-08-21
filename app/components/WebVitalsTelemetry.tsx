"use client";

import * as Sentry from "@sentry/nextjs";
import { useReportWebVitals } from "next/web-vitals";
import { useRef } from "react";

const WEB_VITAL_METRIC_NAME = "lore.web_vital";
const WEB_VITAL_NAMES = new Set(["TTFB", "FCP", "LCP", "CLS", "INP"]);
const WEB_VITAL_RATINGS = new Set(["good", "needs-improvement", "poor"]);
const WEB_VITAL_ROUTES = new Set([
  "/",
  "/faq",
  "/whitepaper",
  "/leaderboards",
  "/privacy",
  "/terms",
  "/jackpot-win",
]);
const MAX_WEB_VITAL_MILLISECONDS = 120_000;
const MAX_WEB_VITAL_CLS = 10;
const DEFAULT_WEB_VITAL_SAMPLE_RATE = 0.1;
const RELEASE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{6,127}$/;
const SAMPLE_RATE_PATTERN = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;

type WebVitalName = "TTFB" | "FCP" | "LCP" | "CLS" | "INP";
type WebVitalRating = "good" | "needs-improvement" | "poor";

type WebVitalMetric = {
  name?: unknown;
  rating?: unknown;
  value?: unknown;
};

type WebVitalsTelemetryEnvironment = {
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
  NEXT_PUBLIC_SENTRY_RELEASE?: string;
  NEXT_PUBLIC_WEB_VITALS_ENABLED?: string;
  NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE?: string;
  NODE_ENV?: string;
};

type WebVitalsTelemetryConfig = {
  release: string;
  sampleRate: number;
};

export type WebVitalEmission = {
  attributes: {
    name: WebVitalName;
    rating: WebVitalRating;
    release: string;
    route: string;
  };
  unit: "millisecond" | "none";
  value: number;
};

type MetricDistribution = (
  name: string,
  value: number,
  options: { attributes: WebVitalEmission["attributes"]; unit: WebVitalEmission["unit"] },
) => void;

function parseSampleRate(value: string | undefined) {
  if (value === undefined || value === "") return DEFAULT_WEB_VITAL_SAMPLE_RATE;
  if (!SAMPLE_RATE_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function getWebVitalsTelemetryConfig(
  environment: WebVitalsTelemetryEnvironment = process.env,
): WebVitalsTelemetryConfig | null {
  if (
    environment.NODE_ENV !== "production"
    || environment.NEXT_PUBLIC_WEB_VITALS_ENABLED !== "1"
    || environment.NEXT_PUBLIC_SENTRY_ENVIRONMENT !== "production"
    || !environment.NEXT_PUBLIC_SENTRY_DSN?.trim()
  ) {
    return null;
  }

  const release = environment.NEXT_PUBLIC_SENTRY_RELEASE?.trim() ?? "";
  if (!RELEASE_PATTERN.test(release)) return null;
  const sampleRate = parseSampleRate(environment.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE);
  return sampleRate === null ? null : { release, sampleRate };
}

function normalizeWebVitalRoute(pathname: string) {
  return WEB_VITAL_ROUTES.has(pathname) ? pathname : "other";
}

function normalizeWebVitalValue(name: WebVitalName, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const maximum = name === "CLS" ? MAX_WEB_VITAL_CLS : MAX_WEB_VITAL_MILLISECONDS;
  if (value > maximum) return null;
  return Number(value.toFixed(3));
}

export function buildWebVitalEmission(
  metric: WebVitalMetric,
  pathname: string,
  environment: WebVitalsTelemetryEnvironment = process.env,
): WebVitalEmission | null {
  const config = getWebVitalsTelemetryConfig(environment);
  if (!config || typeof metric.name !== "string" || typeof metric.rating !== "string") return null;
  if (!WEB_VITAL_NAMES.has(metric.name) || !WEB_VITAL_RATINGS.has(metric.rating)) return null;

  const name = metric.name as WebVitalName;
  const value = normalizeWebVitalValue(name, metric.value);
  if (value === null) return null;

  return {
    value,
    unit: name === "CLS" ? "none" : "millisecond",
    attributes: {
      name,
      rating: metric.rating as WebVitalRating,
      route: normalizeWebVitalRoute(pathname),
      release: config.release,
    },
  };
}

export function recordWebVital(
  metric: WebVitalMetric,
  pathname: string,
  environment: WebVitalsTelemetryEnvironment = process.env,
  distribution: MetricDistribution = Sentry.metrics.distribution,
) {
  const emission = buildWebVitalEmission(metric, pathname, environment);
  if (!emission) return false;
  distribution(WEB_VITAL_METRIC_NAME, emission.value, {
    unit: emission.unit,
    attributes: emission.attributes,
  });
  return true;
}

export function WebVitalsTelemetry() {
  const reportedNames = useRef(new Set<WebVitalName>());
  const sampled = useRef(Math.random() < (getWebVitalsTelemetryConfig()?.sampleRate ?? 0));

  useReportWebVitals((metric) => {
    if (!sampled.current || typeof window === "undefined") return;
    if (typeof metric.name !== "string" || !WEB_VITAL_NAMES.has(metric.name)) return;
    const name = metric.name as WebVitalName;
    if (reportedNames.current.has(name)) return;

    if (recordWebVital(metric, window.location.pathname)) {
      reportedNames.current.add(name);
    }
  });

  return null;
}