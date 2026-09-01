import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * APPLICATION-level media configuration — provider-agnostic by construction.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §5 (validation), §6 (naming),
 *            §12 (configuration); CONFIGURATION-ARCHITECTURE.md §5.
 *
 * ## Why the limits are configuration and not constants in the validator
 *
 * They are the legacy **bucket-level** limits, ported deliberately (§5, "Two-layer
 * validation is deliberate"). Cloudinary's own upload-preset restrictions are
 * the second layer; these are the first. Keeping the numbers in one typed
 * namespace means the two layers can be compared without reading a validator,
 * and means a limit change is a config review rather than a code review.
 *
 * ## Why they are NOT environment variables
 *
 * A size limit that varies per environment is a size limit nobody knows. These
 * are product decisions frozen in `MEDIA-MODEL.md`, so they live here as
 * constants inside a config namespace: injectable and typed like everything
 * else, but with exactly one value across every deployment. `provider` is the
 * only field that varies, and it is the only one read from the environment.
 */

/**
 * The declared MIME types an upload may claim.
 *
 * SVG is ABSENT, and that is a hard rule rather than an oversight
 * (MEDIA-MODEL.md §5 item 6): SVG is executable markup, and one served from a
 * whitelisted image host is a stored-XSS vector. `dangerouslyAllowSVG` is
 * correspondingly absent from both Next configs.
 *
 * GIF is absent too — no requirement, and an animated GIF is a video with worse
 * compression.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const mediaConfig = registerAs('media', () => {
  const e = env();

  return {
    /**
     * Read in exactly one place — `ProvidersModule`, to choose an adapter. No
     * business code may branch on it; `if (config.media.provider ===
     * 'cloudinary')` inside a service is the provider leakage this boundary
     * exists to prevent.
     */
    provider: e.MEDIA_PROVIDER,

    /** 5 MB. Ported from the legacy product/blog/review bucket limit. */
    maxBytes: 5 * 1024 * 1024,

    allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,

    /**
     * Below this on either edge the upload is REFUSED — a 40x40 thumbnail
     * submitted as a product photo is a mistake, not a small image, and
     * accepting it produces a catalogue that looks broken.
     */
    minEdge: 200,

    /**
     * Above this the image is DOWNSCALED, not refused (§5 item 5). A 6000 px
     * photograph from a phone is a normal thing for an operator to have; the
     * only thing wrong with it is its size, and the server can fix that.
     */
    maxEdge: 4000,

    /**
     * Enforced SERVER-side. Legacy enforced it only in the React component,
     * which meant it was not enforced.
     */
    maxImagesPerProduct: 8,

    /** Every managed asset lives under this prefix (§6). */
    folderRoot: 'nest',
  } as const;
});

export type MediaConfig = ConfigType<typeof mediaConfig>;
