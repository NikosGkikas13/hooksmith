import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this project so Turbopack doesn't pick up
    // an outer lockfile at ~/package-lock.json.
    root: process.cwd(),
  },
};

export default nextConfig;
