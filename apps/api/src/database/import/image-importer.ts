import { Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { readFileSync } from 'node:fs';
import { isAbsolute, extname, resolve as resolvePath, dirname } from 'node:path';
import type { Types } from 'mongoose';
import { attach } from '../../modules/media/application/image-collection';
import type { MediaService } from '../../modules/media/application/media.service';
import type { MediaConfig } from '../../config/media.config';

/**
 * Uploads a row's local image files and attaches them to the product.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §2 (ADR-MEDIA-001), §5–§7.
 *
 * ## Every file goes through the SAME pipeline as an admin upload
 *
 * `MediaService.upload()` is called, not the storage port. That is the whole
 * design: magic-byte sniffing, the format allow-list, the size cap, the minimum
 * edge, EXIF stripping, dimension capture and the reference ledger all apply to
 * an imported photograph exactly as they do to one an operator drags into the
 * admin. A supplier's file is no more trustworthy than a stranger's upload —
 * arguably less, since nobody looked at it.
 *
 * ## Why a product with images already is left alone
 *
 * This is what makes `--images` idempotent, and it is the rule the runner
 * already applies to `images` on an update: *the spreadsheet has no opinion
 * about them, and "no opinion" is not the same as "none"*.
 *
 * Re-uploading on a second run would be worse than useless. `publicId` carries
 * 96 random bits, so the same file uploaded twice becomes two different assets:
 * the product would end up with duplicates, the first upload would become an
 * orphan nobody is paying attention to, and the account would grow by the size
 * of the catalogue on every run.
 *
 * The cost is stated rather than hidden: **a re-import does not update
 * images.** Changing a product's photographs is an admin action. Clearing them
 * in admin and re-importing works, because then the product has none again.
 */

/** What one row's image import did. */
export interface ImageImportResult {
  readonly uploaded: number;
  readonly skipped: number;
  /** Non-empty when at least one file could not be imported. */
  readonly failures: readonly string[];
}

export const NO_IMAGES: ImageImportResult = { uploaded: 0, skipped: 0, failures: [] };

/**
 * Which MIME type to declare for a local file.
 *
 * The extension is a HINT, and deliberately treated as one: `MediaService`
 * sniffs the real bytes and refuses a file whose contents disagree with what
 * was declared. So a mislabelled `.jpg` that is really a PNG is rejected with
 * the same message an admin upload would get, rather than being quietly
 * corrected — which is the behaviour that catches a supplier shipping renamed
 * files.
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export class ImageImporter {
  private readonly logger = new Logger(ImageImporter.name);

  constructor(
    private readonly media: MediaService,
    private readonly config: MediaConfig,
    /**
     * Relative paths in the spreadsheet resolve against the CATALOGUE FILE, not
     * the working directory. A supplier sends a folder containing the CSV and
     * its images; whoever runs the command should not have to be standing in
     * that folder for the paths to mean anything.
     */
    private readonly catalogueFile: string,
  ) {}

  /**
   * Uploads `paths` and returns the new `images` array, or `null` when there is
   * nothing to write.
   *
   * `existing` is the product's current array. A non-empty one means this
   * product has been imported before, or an operator has curated it — either
   * way it is left exactly as it is.
   */
  async importFor(input: {
    readonly productId: Types.ObjectId;
    readonly paths: readonly string[];
    readonly existing: readonly { publicId: string }[];
  }): Promise<{ images: unknown[] | null; result: ImageImportResult }> {
    if (input.paths.length === 0) {
      return { images: null, result: NO_IMAGES };
    }

    if (input.existing.length > 0) {
      return {
        images: null,
        result: { uploaded: 0, skipped: input.paths.length, failures: [] },
      };
    }

    let images: {
      publicId: string;
      version: number;
      format: string;
      width: number;
      height: number;
      bytes: number;
      alt: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }[] = [];

    const failures: string[] = [];

    for (const path of input.paths) {
      const absolute = isAbsolute(path)
        ? path
        : resolvePath(dirname(this.catalogueFile), path);

      try {
        const bytes = readFileSync(absolute);
        const extension = extname(absolute).toLowerCase();
        const declaredMimeType = MIME_BY_EXTENSION[extension];

        if (declaredMimeType === undefined) {
          throw new Error(
            `${extension || 'no extension'} is not an importable image type ` +
              `(${Object.keys(MIME_BY_EXTENSION).join(', ')})`,
          );
        }

        const stored = await this.media.upload({
          buffer: bytes,
          declaredMimeType,
          owner: { entity: 'products', entityId: input.productId.toHexString() },
          /*
           * `null`, not a fabricated user id. An import is not performed by a
           * person with an account, and inventing one would put a lie in the
           * ledger's provenance — which is the field somebody reads when asking
           * who uploaded a photograph the shop had no right to.
           */
          uploadedBy: null,
        });

        images = attach(
          images,
          { ...stored, alt: null, sortOrder: images.length, isPrimary: false },
          this.config.maxImagesPerProduct,
        );
      } catch (error) {
        /*
         * One file's failure does not lose the others.
         *
         * The ones that DID upload are still attached, because the alternative
         * is a product with no photographs at all because the fourth file was
         * corrupt — and the report names the failures, so the operator can fix
         * those files and clear the product's images to re-run.
         */
        failures.push(`${path}: ${describe(error)}`);
      }
    }

    if (images.length === 0) {
      return { images: null, result: { uploaded: 0, skipped: 0, failures } };
    }

    return {
      images,
      result: { uploaded: images.length, skipped: 0, failures },
    };
  }

  /**
   * Records the product's reference to each asset.
   *
   * Called only after the product document has been written. Reference counting
   * is what makes `DELETE /admin/media` refuse to destroy an image a live page
   * is showing, and what keeps the reconciliation report from offering one for
   * cleanup — so an attached asset left at zero references is not a cosmetic
   * gap, it is a photograph waiting to be deleted by a tool doing its job.
   */
  async retainAll(publicIds: readonly string[]): Promise<void> {
    for (const publicId of publicIds) {
      await this.media.retain(publicId);
    }
  }

  /**
   * Destroys assets uploaded for a product whose row then failed to save.
   *
   * Without this a row that uploads three photographs and then trips the
   * schema leaves three paid-for orphans in the account for every run. The
   * ledger row goes with them, so the reconciliation report stays honest.
   */
  async rollback(publicIds: readonly string[]): Promise<void> {
    for (const publicId of publicIds) {
      try {
        await this.media.destroy(publicId);
      } catch (error) {
        // Reported, never rethrown: the caller is already handling a failure,
        // and losing that failure behind a cleanup error would hide the cause.
        this.logger.warn(
          `could not roll back ${publicId}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  }
}

/**
 * The reason a file was refused, in the words the operator needs.
 *
 * `AppException.invalidUpload` carries a generic `safeMessage` — "The uploaded
 * file was rejected." — because that one is written for an HTTP client, and the
 * specific reason lives in `details[0].message`. Reporting the safe message in
 * a CLI report tells the person holding the file nothing they can act on;
 * "declared image/jpeg but the bytes are a PNG" tells them exactly what to fix.
 */
function describe(error: unknown): string {
  if (error instanceof AppException) {
    return error.details?.[0]?.message ?? error.safeMessage;
  }

  return error instanceof Error ? error.message : String(error);
}
