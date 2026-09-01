import { Logger } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import {
  MediaStoragePort,
  type MediaUploadRequest,
  type StoredMediaAsset,
} from '../../../modules/media/application/ports/media-storage.port';

/**
 * The Cloudinary adapter.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §2 (ADR-MEDIA-001), §6, §7, §9.
 *
 * ## Integration status — stated plainly
 *
 * **This adapter has never run against a real Cloudinary account.** D-4 confirms
 * Cloudinary as the provider, but the credentials are an owner deliverable that
 * has not arrived: there is no `CLOUDINARY_*` value anywhere in this repository
 * or its environment files. Everything below is written against the published
 * SDK contract and is unit-tested with the SDK's calls observed, which proves
 * the request this code MAKES and not the response a real account GIVES.
 *
 * Two consequences, both real:
 *   · the request shape (folder, `overwrite`, `resource_type`) is asserted;
 *   · the response mapping is asserted against a fixture, so a field Cloudinary
 *     renames would not be caught until an integration run.
 *
 * The pipeline in front of this file — validation, sniffing, EXIF stripping,
 * dimension capture, the ledger — is provider-independent and IS proven, by
 * running the whole of it against the in-memory adapter. That is the split
 * ADR-MEDIA-001 was chosen for: because the server sees every byte, almost
 * nothing that matters depends on which store the bytes end up in.
 */
export class CloudinaryMediaStorage extends MediaStoragePort {
  private readonly logger = new Logger(CloudinaryMediaStorage.name);

  constructor(config: { cloudName: string; apiKey: string; apiSecret: string }) {
    super();

    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      // Delivery URLs are built by consumers, not here, but an adapter that
      // could be made to talk plaintext to a media host is one nobody should
      // have to reason about.
      secure: true,
    });
  }

  /**
   * Uploads through a stream rather than a temporary file.
   *
   * The bytes are already in memory — multer uses `memoryStorage` precisely so
   * nothing untrusted is ever written to the API's filesystem — so writing them
   * out to hand Cloudinary a path would create a file to clean up, a disk to
   * fill, and a window in which an unvalidated-looking file sits on a server.
   */
  upload(request: MediaUploadRequest): Promise<StoredMediaAsset> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: request.publicId,
          resource_type: 'image',

          // NEVER overwrite (MEDIA-MODEL.md §6). `publicId` carries 96 random
          // bits, so a collision is not a real scenario — which is exactly why
          // one occurring must fail loudly instead of silently destroying
          // somebody else's photograph.
          overwrite: false,

          // The application already stripped metadata with sharp. Saying so
          // again here is not redundancy for its own sake: it is the second of
          // the two layers §5 describes, and it is the layer that still holds
          // if this adapter is ever called by something that skipped the first.
          image_metadata: false,

          // `publicId` already contains the folder path. Passing `folder` as
          // well would make Cloudinary prepend it a second time.
          use_filename: false,
          unique_filename: false,
        },
        (error, result) => {
          if (error) {
            reject(new Error(`cloudinary upload failed: ${error.message}`));
            return;
          }

          if (result === undefined) {
            reject(new Error('cloudinary upload returned neither a result nor an error'));
            return;
          }

          resolve(mapUploadResponse(result));
        },
      );

      stream.end(request.bytes);
    });
  }

  /**
   * Destroys the asset, treating "already gone" as success.
   *
   * Cloudinary answers `{ result: 'not found' }` rather than raising for an id
   * it does not hold. Mapping that to success is the contract this port
   * declares, and it is what makes a retry after a partial failure safe: the
   * caller asked for the asset not to exist, and it does not.
   */
  async destroy(publicId: string): Promise<void> {
    const response = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    });

    const result: unknown = response.result;

    if (result !== 'ok' && result !== 'not found') {
      throw new Error(`cloudinary destroy failed for ${publicId}: ${String(result)}`);
    }

    if (result === 'not found') {
      this.logger.warn(`destroy: ${publicId} was already absent from cloudinary`);
    }
  }

  /**
   * Every `publicId` under a prefix, paged to the end.
   *
   * The pagination is not optional. `api.resources` returns at most 500 per
   * call, and a reconciliation report built from the first page would confidently
   * declare every asset after the 500th an orphan — a report that is wrong in
   * the direction of "delete these" is worse than no report at all.
   */
  async list(prefix: string): Promise<readonly string[]> {
    const publicIds: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await cloudinary.api.resources({
        type: 'upload',
        resource_type: 'image',
        prefix,
        max_results: 500,
        next_cursor: cursor,
      });

      for (const resource of page.resources as { public_id: string }[]) {
        publicIds.push(resource.public_id);
      }

      cursor = page.next_cursor as string | undefined;
    } while (cursor !== undefined);

    return publicIds;
  }
}

/**
 * The Cloudinary response is the authority for what was stored.
 *
 * MEDIA-MODEL.md §4 allows either sharp or the upload response as the source of
 * metadata; the response is preferred here because it describes the object that
 * actually exists in the CDN. If Cloudinary ever transformed the image on
 * ingest, sharp's numbers would describe a file that was never stored.
 */
export function mapUploadResponse(response: UploadApiResponse): StoredMediaAsset {
  return {
    publicId: response.public_id,
    version: response.version,
    format: response.format,
    width: response.width,
    height: response.height,
    bytes: response.bytes,
  };
}
