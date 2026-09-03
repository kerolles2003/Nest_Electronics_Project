import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Where the build output goes.
   *
   * Overridable ONLY so the e2e suite can run a second dev server from this
   * same directory. Next 16 refuses to start two `next dev` processes for one
   * project — it locks on the build directory — and the identity suite needs a
   * second instance whose `API_BASE_URL` points at nothing, because
   * `GET /auth/me` is called server-side and cannot be intercepted from the
   * browser (see `e2e/origin.ts`).
   *
   * Unset in every normal run, including `next build`, so production output is
   * exactly where it has always been.
   */
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',

  /**
   * Hosts allowed to request `/admin/_next/*` dev resources.
   *
   * Development only — Next 16 blocks cross-origin requests for dev assets, and
   * treats `127.0.0.1` and `localhost` as different origins. In the storefront
   * the e2e suite drove `http://127.0.0.1:3100` while the dev server called
   * itself `localhost:3100`, so **every client chunk was refused and React
   * never booted**: pages server-rendered correctly, forms still worked through
   * progressive enhancement, and 44 tests passed for five phases without ever
   * running a line of client code.
   *
   * The admin is a second Next application and would have made the same mistake
   * independently. The value is NOT written out here: `e2e/origin.ts` owns one
   * HOST constant and `playwright.config.ts` passes it in, so the origin the
   * tests drive and the origin the dev server trusts cannot become two
   * different strings. The literal below is only for a developer running
   * `pnpm dev` by hand and browsing 127.0.0.1; nothing the suite does depends
   * on it.
   */
  allowedDevOrigins: [process.env['DEV_ORIGIN_HOST'] ?? '127.0.0.1'],

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
