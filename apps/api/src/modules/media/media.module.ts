import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { mediaConfig } from '../../config/media.config';
import { MediaService } from './application/media.service';
import { MediaAssetRepository } from './infrastructure/repositories/media-asset.repository';
import { MediaAsset, MediaAssetSchema } from './infrastructure/schemas/media-asset.schema';
import { MediaController } from './presentation/media.controller';

/**
 * Managed media: upload, destroy, reconcile.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md; NESTJS-MODULE-MAP.md.
 *
 * ## What it does NOT import
 *
 * No adapter, and no vendor SDK. `MediaStoragePort` is provided globally by
 * `ProvidersModule`, which is the only file in the codebase that names both a
 * port and a vendor. `grep -rn "cloudinary" src/ --exclude-dir=providers`
 * returns nothing, and that property — replaceability as a fact about the
 * import graph — is the whole reason the port exists.
 *
 * No catalog module either. Attaching an image to a product is Phase 7's write
 * path; this module knows how to store bytes and how to count references to
 * them, and nothing about what a product is.
 *
 * ## Why the ordering rules are not exported here
 *
 * `image-collection.ts` holds the primary/ordering invariant as pure functions
 * with no Nest wiring at all. Phase 7 imports the functions directly. Exporting
 * them through a service would add a provider, an injection and a mock for
 * logic that has no dependencies and no state — the kind of ceremony
 * ANTI-OVERENGINEERING.md exists to refuse.
 */
@Module({
  imports: [
    ConfigModule.forFeature(mediaConfig),
    MongooseModule.forFeature([{ name: MediaAsset.name, schema: MediaAssetSchema }]),
  ],
  controllers: [MediaController],
  providers: [MediaService, MediaAssetRepository],
  exports: [MediaService, MediaAssetRepository],
})
export class MediaModule {}
