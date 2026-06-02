import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname);
const devWatchIgnored =
  /[\\/](?:\.playwright-mcp|\.npm-cache|\.tmp-npm-cache)[\\/]|[\\/]artifacts[\\/]smoke-browser[\\/]|^[^\\/]+\.(?:png|jpe?g|webp|txt|md)$/i;

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  webpack(config, { dev }) {
    config.context = projectRoot;
    if (!dev && process.env.NEXT_WEBPACK_CACHE !== "1") {
      config.cache = false;
    }
    const existingWatchOptions = config.watchOptions ?? {};
    config.watchOptions = {
      ...existingWatchOptions,
      ignored: devWatchIgnored,
    };
    config.resolve = config.resolve ?? {};
    config.resolve.modules = [
      path.resolve(projectRoot, "node_modules"),
      "node_modules",
      ...(config.resolve.modules ?? []),
    ];
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@react-native-async-storage/async-storage": false,
      "@farcaster/mini-app-solana": false,
      tailwindcss: path.resolve(projectRoot, "node_modules", "tailwindcss"),
      "viem$": path.resolve(projectRoot, "node_modules", "viem", "_esm", "index.js"),
      "porto/internal": path.resolve(projectRoot, "node_modules", "porto", "dist", "internal", "index.js"),
      "zod/mini": path.resolve(projectRoot, "node_modules", "porto", "node_modules", "zod", "mini", "index.js"),
    };
    return config;
  },
  turbopack: {},
};

const canUploadSentrySourcemaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    disable: !canUploadSentrySourcemaps,
    deleteSourcemapsAfterUpload: true,
  },
});
