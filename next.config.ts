import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "bcrypt"],
  allowedDevOrigins: ['100.68.173.6','cuby-pc'],
};

export default nextConfig;
