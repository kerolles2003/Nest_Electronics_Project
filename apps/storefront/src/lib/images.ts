import type { ProductImage } from './api/types';

/**
 * A delivery URL from a provider-relative identifier.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §3 (ADR-MEDIA-002), §8.
 *
 * ## Why the client builds the URL instead of the API returning one
 *
 * Because the API never stores one. Legacy persisted absolute Supabase URLs
 * into 22 product rows *and* into `next.config.ts`, with two consequences it
 * actually paid for: deleting an image meant string-splitting the stored URL on
 * `/products/` to recover the key, and changing CDN, account or bucket became a
 * data migration rather than a config change.
 *
 * Deriving the URL at read time means the cloud name lives in exactly two
 * places — this file and `next.config.ts` — and nowhere in the database.
 *
 * ## What happens with no Cloudinary account
 *
 * `null`, and every caller renders its existing placeholder.
 *
 * That is the state today: D-4 confirms Cloudinary but the account is an owner
 * deliverable that has not arrived, so `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` is
 * unset and no product image resolves. The pages are still correct — they
 * handle "no image" because most of the catalogue genuinely has none — and the
 * LAYOUT is still driven by real image counts and real dimensions from the API,
 * so the gallery, the thumbnail strip and the space reserved for each image are
 * all exercised. Only the bytes are missing.
 *
 * Returning `null` rather than throwing is deliberate: a missing CDN account is
 * a configuration state, not a programming error, and a storefront that refused
 * to render without one would be unusable for the whole of the build.
 */

/**
 * PUBLIC by design. `NEXT_PUBLIC_*` is correct here and only here: the cloud
 * name appears in every delivery URL a browser fetches, so it is not a secret
 * and cannot be treated as one. The API key and secret are server-only and are
 * never exposed to this app (MEDIA-MODEL.md §12).
 *
 * Read at module scope because Next inlines `process.env.NEXT_PUBLIC_*` at
 * build time; reading it per call would look dynamic while being exactly as
 * static, which is a worse kind of code.
 */
const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';

/**
 * Named delivery presets (MEDIA-MODEL.md §8) rather than transformation
 * strings scattered through components.
 *
 * `f_auto` lets Cloudinary serve WebP or AVIF per browser from whatever it
 * holds, which is why the upload pipeline does NOT convert formats on the way
 * in — the negotiation belongs at delivery, where the browser is known.
 * `q_auto` picks a quality per image rather than per site.
 *
 * `c_fill` on the fixed sizes: a product grid needs every cell the same shape,
 * and letterboxing a portrait photograph into a square cell looks like a bug.
 * The detail view uses `c_limit`, which never crops — there the photograph is
 * the content, and cropping it would hide part of what the customer is buying.
 */
const PRESETS = {
  /** Product grids and cards. */
  thumbnail: 'f_auto,q_auto,c_fill,g_auto,w_400,h_400',
  /** The main image on a product page. */
  detail: 'f_auto,q_auto,c_limit,w_1200,h_1200',
  /** The gallery strip under it. */
  gallery: 'f_auto,q_auto,c_fill,g_auto,w_160,h_160',
} as const;

export type ImagePreset = keyof typeof PRESETS;

/**
 * The URL for one image, or `null` when no CDN is configured.
 *
 * `version` is included because it is what makes a re-upload to the same
 * `publicId` bust the CDN cache deterministically. Omitting it would leave
 * customers looking at a replaced photograph for as long as the edge held it.
 */
export function imageUrl(
  image: Pick<ProductImage, 'publicId' | 'version'> | null | undefined,
  preset: ImagePreset = 'thumbnail',
): string | null {
  if (image === null || image === undefined || CLOUD_NAME === '') return null;

  return (
    `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/` +
    `${PRESETS[preset]}/v${String(image.version)}/${image.publicId}`
  );
}

/**
 * The URL for a CART line's image, which arrives WITHOUT a version.
 *
 * `GET /cart` returns `imagePublicId` and no version — the cart is a draft
 * intent, and it keeps the smallest identifier that still resolves. So this
 * builds a version-less URL, which Cloudinary serves happily.
 *
 * The cost is real and worth stating: without a version in the path, replacing
 * the photograph behind a `publicId` does not bust the CDN cache, so a
 * customer may see the old picture on a cart line for as long as the edge
 * holds it. That is acceptable HERE and nowhere else — a cart line is a
 * thumbnail beside a name and a price the customer already recognises, and the
 * catalogue pages that sell the product all use the versioned `imageUrl`.
 */
export function cartLineImageUrl(publicId: string | null): string | null {
  if (publicId === null || publicId === '' || CLOUD_NAME === '') return null;

  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${PRESETS.thumbnail}/${publicId}`;
}

/**
 * The dimensions to reserve for an image before it loads.
 *
 * Legacy stored neither width nor height, so `next/image` could never reserve
 * space and every product grid shifted as it loaded (Phase 0 P16). The API
 * captures both at upload, so a caller can size the box correctly even while
 * the bytes are still in flight — and, today, even when they never arrive.
 *
 * The fallback is square rather than absent: a placeholder still has to occupy
 * the right shape, and guessing 1:1 is closer than collapsing to zero.
 */
export function imageDimensions(image: ProductImage | null | undefined): {
  width: number;
  height: number;
} {
  return { width: image?.width ?? 800, height: image?.height ?? 800 };
}
