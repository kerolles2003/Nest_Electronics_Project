import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Embedded value objects shared by the three catalogue collections.
 *
 * These are not collections and therefore not separate schema files: the
 * "one schema file per collection" rule in CODEBASE-STRUCTURE.md §6.1 governs
 * collections, and duplicating a localized-text definition three times would
 * guarantee drift.
 */

/**
 * Authority: docs/architecture/CATALOG-MODEL.md §3.
 * `en` required, `ar` optional and null in MVP.
 */
@Schema({ _id: false, strict: 'throw' })
export class LocalizedText {
  @Prop({ type: String, required: true, trim: true })
  en!: string;

  @Prop({ type: String, default: null })
  ar!: string | null;
}
export const LocalizedTextSchema = SchemaFactory.createForClass(LocalizedText);

/**
 * A managed media asset.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §3 — store `publicId` + `version`,
 * NEVER a rendered URL. Legacy persisted absolute URLs and then deleted assets
 * by string-splitting them, which was brittle and made a CDN change a data
 * migration. URLs are derived at read time.
 *
 * `width`/`height`/`bytes` are captured at upload — new here; legacy stored
 * none, which guaranteed layout shift on every product grid.
 */
@Schema({ _id: false, strict: 'throw' })
export class MediaAsset {
  @Prop({ type: String, required: true })
  publicId!: string;

  @Prop({ type: Number, required: true })
  version!: number;

  @Prop({ type: String, required: true })
  format!: string;

  @Prop({ type: Number, required: true })
  width!: number;

  @Prop({ type: Number, required: true })
  height!: number;

  @Prop({ type: Number, required: true })
  bytes!: number;

  @Prop({ type: String, default: null })
  alt!: string | null;
}
export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);

/**
 * A product image. Ordering and the primary flag live on the element itself so
 * a reorder is one atomic `$set` of the whole array rather than the legacy N+1
 * update loop, and the "exactly one primary" invariant is enforceable in a
 * single update rather than a non-atomic two-statement flip.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §8.
 */
@Schema({ _id: false, strict: 'throw' })
export class ProductImage extends MediaAsset {
  @Prop({ type: Number, default: 0 })
  sortOrder!: number;

  @Prop({ type: Boolean, default: false })
  isPrimary!: boolean;
}
export const ProductImageSchema = SchemaFactory.createForClass(ProductImage);
