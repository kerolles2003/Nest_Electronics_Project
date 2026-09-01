import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@nest/types', '@nest/config', '@nest/repositories', '@nest/providers', '@nest/services', '@nest/ui'],
  basePath: '/admin',
  images: {
    /*
     * `dangerouslyAllowSVG` is deliberately ABSENT.
     *
     * MEDIA-MODEL.md §5 item 6 and §12: SVG is executable markup, and one
     * served from a whitelisted image host is a stored-XSS vector (Phase 0 M3).
     * It was `true` here; nothing in `src/` renders an SVG through `next/image`
     * (only the unused Next scaffolding files in `public/` are SVGs), so
     * removing it costs nothing and closes the hole.
     */
    remotePatterns: [
      // Managed media (D-4, ADR-MEDIA-001). The API stores a provider-relative
      // `publicId` and never a URL, so this pattern and the cloud name in
      // NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME are the only two places the CDN is
      // named — which is what makes changing it configuration rather than a
      // data migration.
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'placehold.co',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
