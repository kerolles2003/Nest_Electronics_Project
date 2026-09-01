import sharp from 'sharp';

/**
 * Turns an accepted upload into the bytes that will actually be stored.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §5 items 5 and 7.
 *
 * Three things happen here, and each one is a defect the legacy system had:
 *
 *   EXIF stripped      GPS coordinates and camera serials travel inside
 *                      photographs. Legacy stored the file as received, so
 *                      every product photo taken on a phone published the
 *                      location it was taken in. This matters more, not less,
 *                      when customer review images arrive.
 *   Dimensions read    Legacy stored only `size` and `mimetype`, so `next/image`
 *                      could never reserve space and every product grid shifted
 *                      as it loaded.
 *   Max edge capped    A 6000 px phone photograph is a normal thing for an
 *                      operator to have. The only thing wrong with it is its
 *                      size, and the server can fix that — so it is downscaled
 *                      rather than refused.
 */

export interface ProcessedImage {
  readonly bytes: Buffer;
  readonly format: string;
  readonly width: number;
  readonly height: number;
}

export interface ImageProcessingLimits {
  readonly minEdge: number;
  readonly maxEdge: number;
}

/** Raised when the image is structurally unusable; the caller maps it to a 400. */
export class ImageProcessingError extends Error {}

/**
 * Decode, correct orientation, strip metadata, cap the long edge, re-encode.
 *
 * ## Why `.rotate()` comes first, and why it is not optional
 *
 * A photograph's true orientation frequently lives in its EXIF `Orientation`
 * tag rather than in its pixel data — the sensor writes rows in one order and
 * records "display this rotated 90°". Stripping EXIF without acting on that tag
 * therefore does not preserve the image; it silently rotates it. Calling
 * `.rotate()` with no argument tells sharp to BAKE the recorded orientation
 * into the pixels, after which discarding the tag is lossless.
 *
 * Getting this backwards is the classic EXIF-stripping bug, and it is invisible
 * in testing unless a test fixture actually carries an orientation tag — which
 * is why one does.
 *
 * ## Why the format is preserved rather than normalised to WebP
 *
 * Converting everything to WebP would save bytes, but it would also mean the
 * stored object is not the thing the operator uploaded, and `format` would stop
 * describing the original. MEDIA-MODEL.md §8 puts format negotiation in the
 * DELIVERY transformation (`f_auto`), where it belongs: Cloudinary serves WebP
 * or AVIF per browser from whatever it holds. Re-encoding on the way in would
 * be a second, lossier answer to a question already answered.
 *
 * The re-encode itself is not optional, though — see `image-format.ts`. Decoding
 * and writing out again is what guarantees the stored bytes are an image and
 * nothing else.
 */
export async function processUploadedImage(
  input: Buffer,
  limits: ImageProcessingLimits,
): Promise<ProcessedImage> {
  const pipeline = sharp(input, { failOn: 'error' }).rotate();

  let metadata;
  try {
    metadata = await pipeline.metadata();
  } catch (error) {
    throw new ImageProcessingError(
      `the file could not be decoded as an image: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const width = metadata.width;
  const height = metadata.height;

  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    throw new ImageProcessingError('the image reports no usable dimensions');
  }

  // Measured BEFORE the resize, deliberately. The rule is about the source: an
  // image that arrives at 40x40 is a mistake whatever the server does to it,
  // and upscaling it to satisfy a minimum would be inventing detail.
  if (Math.min(width, height) < limits.minEdge) {
    throw new ImageProcessingError(
      `the image is ${String(width)}x${String(height)}; the shorter edge must be at least ` +
        `${String(limits.minEdge)}px`,
    );
  }

  const longestEdge = Math.max(width, height);

  const resized =
    longestEdge > limits.maxEdge
      ? // `fit: 'inside'` preserves the aspect ratio and never enlarges, so the
        // only image this touches is one that is genuinely too big.
        pipeline.resize({ width: limits.maxEdge, height: limits.maxEdge, fit: 'inside' })
      : pipeline;

  // sharp discards all metadata unless `.withMetadata()` is called. The
  // stripping is therefore the DEFAULT rather than a step that could be
  // forgotten — but it is asserted by a test rather than trusted to stay so.
  const { data, info } = await resized.toBuffer({ resolveWithObject: true });

  return { bytes: data, format: info.format, width: info.width, height: info.height };
}
