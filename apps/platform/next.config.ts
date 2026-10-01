import type { NextConfig } from "next";
import path from "node:path";

const repositoryRoot = path.join(__dirname, "../..");
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  turbopack: { root: repositoryRoot },
  transpilePackages: ["@chibbo/audit", "@chibbo/auth", "@chibbo/config", "@chibbo/contracts", "@chibbo/domain", "@chibbo/rate-limit", "@chibbo/storage"]
};
export default nextConfig;
