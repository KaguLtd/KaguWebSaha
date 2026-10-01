import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolate verification builds from a local development server's .next files.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  reactStrictMode: true,
};

export default nextConfig;
