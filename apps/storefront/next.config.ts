import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@nest/types', '@nest/config', '@nest/repositories', '@nest/providers', '@nest/services', '@nest/ui'],
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'ampere-electronics.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'placehold.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'quhllllvwwuizjfrxvdz.supabase.co',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
