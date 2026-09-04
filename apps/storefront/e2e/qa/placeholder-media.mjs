/**
 * Serves the generated placeholder images to a browser, without a CDN.
 *
 * `imageUrl()` builds `https://res.cloudinary.com/<cloud>/image/upload/<transform>/v<n>/<publicId>`
 * from data the API returns. With `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` set to
 * anything, those URLs are well-formed and point at a cloud that does not
 * exist. This intercepts them in the browser and answers from
 * `apps/api/dev-media/`, which `pnpm --filter api media:placeholders` fills.
 *
 * ## Why interception rather than pointing the app somewhere else
 *
 * Because the URL the browser requests must be the URL production will request.
 * A dev-only base-URL switch inside `images.ts` would mean the thing being
 * looked at is not quite the thing that ships — the transformation segment, the
 * `v<version>` segment and the `publicId` would all be exercised only in the
 * shape the switch happened to produce. Here they are exercised exactly as
 * written, and the interception is the last hop.
 *
 * Nothing in `src/` knows this file exists.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Resolved from the working directory, NOT from `import.meta.url`.
 *
 * Playwright transpiles this file to CommonJS when the config imports it, and
 * `import.meta` is a syntax error there — the whole suite failed to load. Both
 * callers run from `apps/storefront` (the QA scripts by convention, Playwright
 * because that is where its config lives), so the working directory is the one
 * thing they agree on.
 */
const DEV_MEDIA = join(process.cwd(), '..', 'api', 'dev-media');

/** The value the storefront must be started with for the URLs to be built. */
export const PLACEHOLDER_CLOUD_NAME = 'dev-placeholders';

/**
 * Everything after `/image/upload/` is a transformation string, an optional
 * `v<digits>` version, and then the publicId. The transformation is Cloudinary's
 * business and there is nothing local to apply it to, so it is skipped: the
 * point of the placeholder is to occupy the right box at the right aspect
 * ratio, and the file already has the catalogue's exact dimensions.
 */
const DELIVERY = /\/image\/upload\/(?:[^/]*\/)*?(?:v\d+\/)?(nest\/.+)$/;

const MIME = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * A 1x1 transparent GIF, for when no generated placeholder exists.
 *
 * The e2e suite installs this route so that product images RESOLVE — that is
 * what makes "the image loaded and is invisible" an assertable condition. It
 * must not depend on anyone having run `media:placeholders` first, and it must
 * never fall through to the real network, so a missing file answers with a
 * valid image instead of a 404. Layout is not the point in that case; the
 * `<img>` existing and completing is.
 */
const ONE_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Installs the route on a page or context.
 *
 * A missing file is answered with 404 rather than falling through to the real
 * network: a placeholder that silently reached out would make a slow, flaky
 * screenshot look like a slow, flaky page.
 */
export async function servePlaceholderMedia(target) {
  /**
   * Two routes, because the storefront requests images two ways.
   *
   * The product grid renders a plain `<img src="https://res.cloudinary.com/…">`,
   * which the browser fetches itself. The product detail page renders
   * `next/image`, which emits `/_next/image?url=…` and makes the NEXT SERVER
   * fetch the CDN — a request no browser-side route can see. Intercepting only
   * the first left every detail-page image broken, which looked like a product
   * bug and was a harness bug.
   */
  const serve = async (route, rawUrl) => {
    const match = DELIVERY.exec(new URL(rawUrl).pathname);

    if (match === null) {
      await route.fulfill({ status: 404, body: 'not a product delivery URL' });
      return;
    }

    const publicId = match[1];
    // The publicId carries no extension; every generated file is webp because
    // that is what the catalogue records as the format.
    const file = join(DEV_MEDIA, `${publicId}.webp`);

    try {
      const body = await readFile(file);
      await route.fulfill({
        status: 200,
        contentType: MIME.webp,
        headers: { 'cache-control': 'public, max-age=60' },
        body,
      });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'image/gif',
        headers: { 'x-placeholder': `missing:${publicId}` },
        body: ONE_PIXEL,
      });
    }
  };

  await target.route('https://res.cloudinary.com/**', (route) => serve(route, route.request().url()));

  await target.route('**/_next/image*', async (route) => {
    const source = new URL(route.request().url()).searchParams.get('url');

    if (source === null || !source.startsWith('https://res.cloudinary.com/')) {
      await route.continue();
      return;
    }

    await serve(route, source);
  });
}
