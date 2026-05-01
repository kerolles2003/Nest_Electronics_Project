import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@nest/types', '@nest/config', '@nest/repositories', '@nest/providers', '@nest/services', '@nest/ui'],
  basePath: '/admin',
};

export default nextConfig;
