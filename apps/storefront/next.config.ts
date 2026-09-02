import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Hosts allowed to request `/_next/*` dev resources.
   *
   * Development only — Next 16 blocks cross-origin requests for dev assets, and
   * treats `127.0.0.1` and `localhost` as different origins. The e2e suite
   * drives `http://127.0.0.1:3100` while the dev server calls itself
   * `localhost:3100`, so **every client chunk was refused and React never
   * booted**: pages server-rendered correctly, forms still worked through
   * progressive enhancement, and no `useEffect` in the application ran at all.
   *
   * It went unnoticed because nothing in the suite had needed client-side
   * behaviour until the guest-cart merge, which runs in an effect. The only
   * visible symptom was a failing HMR WebSocket, which reads like dev noise.
   *
   * Next's own warning names this setting as the fix.
   */
  allowedDevOrigins: ['127.0.0.1'],

  transpilePackages: ['@nest/types', '@nest/config', '@nest/repositories', '@nest/providers', '@nest/services', '@nest/ui'],
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
