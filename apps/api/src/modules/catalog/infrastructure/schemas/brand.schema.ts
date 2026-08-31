import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LocalizedText, LocalizedTextSchema, MediaAsset, MediaAssetSchema } from './embedded.schema';

/**
 * Brands — a flat list, no hierarchy.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §6; MONGODB-DESIGN.md §5.
 *
 * 53 of 85 live products have NO brand, so `product.brand` is nullable and every
 * listing must render without one. That is a load-bearing fact, not an edge case.
 */
@Schema({ collection: 'brands', timestamps: true, strict: 'throw' })
export class Brand {
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: LocalizedTextSchema, required: true })
  name!: LocalizedText;

  @Prop({ type: LocalizedTextSchema, default: null })
  description!: LocalizedText | null;

  /** Optional; 0 of 17 legacy brands had one. */
  @Prop({ type: MediaAssetSchema, default: null })
  logo!: MediaAsset | null;

  @Prop({ type: String, default: null })
  website!: string | null;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Number, default: 0 })
  productCount!: number;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

export type BrandDocument = HydratedDocument<Brand>;
export type BrandLean = Brand & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const BrandSchema = SchemaFactory.createForClass(Brand);

BrandSchema.index({ slug: 1 }, { unique: true, name: 'brand_slug_unique' });
BrandSchema.index({ isActive: 1, deletedAt: 1 }, { name: 'brand_visibility' });
