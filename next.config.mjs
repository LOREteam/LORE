import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";
import { resolveNextDistDir } from "./scripts/next-dist-dir.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname);
const { relativePath: nextDistDir } = resolveNextDistDir(process.env.NEXT_DIST_DIR, projectRoot);
const devWatchIgnored =
  /[\\/](?:\.playwright-mcp|\.npm-cache|\.tmp-npm-cache)[\\/]|[\\/]artifacts[\\/]smoke-browser[\\/]|^[^\\/]+\.(?:png|jpe?g|webp|txt|md)$/i;

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: nextDistDir,
  images: {
    qualities: [75, 85],
  },
  typescript: {
    tsconfigPath: process.env.NEXT_TSCONFIG_PATH?.trim() || "tsconfig.json",
  },
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
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@react-native-async-storage/async-storage": false,
      "@farcaster/mini-app-solana": false,
      // `accounts` is an optional peer used only by Wagmi's Tempo connectors.
      // Keep absent peers absent rather than making the client bundle resolve an
      // unused dynamic connector module at build time.
      accounts: false,
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

const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    disable: !canUploadSentrySourcemaps,
    deleteSourcemapsAfterUpload: true,
  },
};

export default function configureNext(phase) {
  const isBuildCommand = process.argv.slice(1).includes("build");
  if (
    phase === "phase-production-build"
    && isBuildCommand
    && process.env.LORE_HERMETIC_BUILD !== "1"
  ) {
    throw new Error(
      "Production builds must run through `npm run build` so LORE_DB_PATH is isolated.",
    );
  }
  return withSentryConfig(nextConfig, sentryConfig);
}
