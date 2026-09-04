import type { AdminProductImage } from './api/types';

/**
 * A delivery URL from a provider-relative identifier.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §3 (ADR-MEDIA-002), §8.
 *
 * ## Why the console builds the URL instead of the API returning one
 *
 * Because the API never stores one, and that is the point. Legacy persisted
 * absolute Supabase URLs into product rows *and* into `next.config.ts`, with
 * two consequences it actually paid for: deleting an image meant string-
 * splitting the stored URL on `/products/` to recover the key, and changing
 * CDN, account or bucket became a data migration rather than a config change.
 *
 * Deriving the URL at read time means the cloud name lives in this file and in
 * `next.config.ts`, and nowhere in the database.
 *
 * This is a deliberate second copy of the storefront's `lib/images.ts` rather
 * than a shared package. The two apps take DIFFERENT image types — the admin
 * sees `AdminProductImage`, the storefront sees the public one — and the
 * presets differ because the jobs differ: a console needs a small square for a
 * table row and a large one for an editor, not a product-grid card. A shared
 * module would have to be generic over both, which buys nothing for one shared
 * string.
 *
 * ## With no Cloudinary account configured
 *
 * `null`, and every caller renders its placeholder. That is the state today:
 * D-4 confirms Cloudinary but the account is an owner deliverable, so
 * `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` is unset and no image resolves. The
 * screens are still correct — the layout is driven by real image counts and
 * real dimensions from the API — only the bytes are missing. Returning `null`
 * rather than throwing is the difference between a console that works without a
 * CDN and one that cannot be used until an owner deliverable arrives.
 */

/**
 * PUBLIC by design. The cloud name appears in every delivery URL a browser
 * fetches, so it is not a secret. The API key and secret are server-only and
 * are never exposed to this app (MEDIA-MODEL.md §12).
 */
const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';

/**
 * Named presets rather than transformation strings scattered through
 * components.
 *
 * `f_auto` serves WebP or AVIF per browser from whatever is stored, which is
 * why the upload pipeline does not convert formats on the way in — that
 * negotiation belongs at delivery, where the browser is known.
 *
 * `c_fill` for the fixed square cells, because a table of images has to line
 * up. `c_limit` for the editor, which never crops: there the photograph is what
 * is being judged, and cropping it hides the part an operator is checking.
 */
const PRESETS = {
  /** A table row's thumbnail. */
  row: 'f_auto,q_auto,c_fill,g_auto,w_80,h_80',
  /** A tile in the product form's image manager. */
  tile: 'f_auto,q_auto,c_fill,g_auto,w_320,h_320',
  /** Uncropped, for judging the actual photograph. */
  full: 'f_auto,q_auto,c_limit,w_1200,h_1200',
} as const;

export type ImagePreset = keyof typeof PRESETS;

/**
 * The URL for one image, or `null` when no CDN is configured.
 *
 * `version` is in the path because it is what makes a re-upload to the same
 * `publicId` bust the CDN cache deterministically. Omitting it would leave an
 * operator looking at the photograph they just replaced.
 */
export function imageUrl(
  image: Pick<AdminProductImage, 'publicId' | 'version'> | null | undefined,
  preset: ImagePreset = 'row',
): string | null {
  if (image === null || image === undefined || CLOUD_NAME === '') return null;

  return (
    `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/` +
    `${PRESETS[preset]}/v${String(image.version)}/${image.publicId}`
  );
}

/** Whether a CDN is configured at all — so a screen can explain an absence. */
export const CDN_CONFIGURED = CLOUD_NAME !== '';

/**
 * The primary image, or the first, or nothing.
 *
 * §8 requires exactly one primary when the array is non-empty, so the fallback
 * to `[0]` should never fire — it is here because a table rendering nothing at
 * all for a product that HAS photographs is a worse failure than rendering the
 * wrong one, and the invariant is the API's to keep, not this file's to assume.
 */
export function primaryImage(images: AdminProductImage[]): AdminProductImage | null {
  return images.find((image) => image.isPrimary) ?? images[0] ?? null;
}
