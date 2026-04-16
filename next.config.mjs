import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  webpack(config) {
    config.context = projectRoot;
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
      "porto/internal": path.resolve(projectRoot, "node_modules", "porto", "dist", "internal", "index.js"),
      "zod/mini": path.resolve(projectRoot, "node_modules", "porto", "node_modules", "zod", "mini", "index.js"),
    };
    return config;
  },
  turbopack: {},
};

export default nextConfig;
