import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Hosts allowed to request `/_next/*` dev resources.
   *
   * Development only — Next 16 blocks cross-origin requests for dev assets, and
   * treats `127.0.0.1` and `localhost` as different origins. The e2e suite
   * drove `http://127.0.0.1:3100` while the dev server called itself
   * `localhost:3100`, so **every client chunk was refused and React never
   * booted**: pages server-rendered correctly, forms still worked through
   * progressive enhancement, and no `useEffect` in the application ran at all.
   *
   * It went unnoticed because nothing in the suite had needed client-side
   * behaviour until the guest-cart merge, which runs in an effect. The only
   * visible symptom was a failing HMR WebSocket, which reads like dev noise.
   *
   * The value is NOT written here any more. `playwright.config.ts` owns one
   * HOST constant and passes it in, so the origin the tests drive and the
   * origin the dev server trusts cannot become two different strings — which is
   * precisely how this happened. The literal below is only for a developer
   * running `pnpm dev` by hand and browsing 127.0.0.1; nothing the suite does
   * depends on it.
   */
  allowedDevOrigins: [process.env['DEV_ORIGIN_HOST'] ?? '127.0.0.1'],

  /**
   * `/shop/*` is gone. These are the tombstones.
   *
   * The slice existed so the API-backed implementation could be built and
   * proven while the customer-facing pages were still on Supabase. T2 moved
   * those implementations onto the real URLs and T3 deleted the slice, but the
   * URLs were live: they were linked from verification emails, order emails and
   * anything anybody bookmarked while it existed.
   *
   * ## 301 rather than 308
   *
   * The frozen plan says 301 and these are all GET pages, so the distinction
   * that separates the two — 308 preserves the method — buys nothing here.
   * Every crawler treats them identically for ranking; 301 is the one every
   * tool and every operator expects to see, and matching the plan exactly costs
   * nothing.
   *
   * ## `/shop/cart` has a real destination
   *
   * `/cart` was built for it. Sending that URL to `/products` would have thrown
   * away what the customer was actually asking for, and sending it to
   * `/checkout` would have demanded a session and an address to look at a
   * basket.
   *
   * ## They are ordered, and the order matters
   *
   * `/shop/:slug` matches `login`, `cart` and every other single segment, so
   * the specific paths come first. Next takes the first match.
   */
  async redirects() {
    const gone = (source: string, destination: string) => ({
      source,
      destination,
      statusCode: 301 as const,
    });

    return [
      gone('/shop/login', '/login'),
      gone('/shop/register', '/register'),
      gone('/shop/verify-email', '/verify-email'),
      gone('/shop/cart', '/cart'),
      gone('/shop/checkout', '/checkout'),
      gone('/shop/addresses', '/account/addresses'),
      gone('/shop/orders', '/account/orders'),
      gone('/shop/orders/:id', '/account/orders/:id'),
      // The catch-all LAST: a product page under the old slice.
      gone('/shop/:slug', '/products/:slug'),
      gone('/shop', '/products'),
    ];
  },

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
