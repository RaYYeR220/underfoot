import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@underfoot/sdk", "@underfoot/mcp"],
  poweredByHeader: false,
};

export default config;
