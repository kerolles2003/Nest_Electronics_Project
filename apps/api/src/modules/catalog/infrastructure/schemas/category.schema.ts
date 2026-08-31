import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LocalizedText, LocalizedTextSchema, MediaAsset, MediaAssetSchema } from './embedded.schema';

/**
 * The category tree.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §6; MONGODB-DESIGN.md §5.
 *
 * `path[]` is THE key decision: MongoDB has no recursive CTE, so a materialised
 * ancestor array turns "all products in this subtree" into one indexed match.
 * `$graphLookup` was rejected as too expensive for a tree rendered on every
 * page. This is the direct fix for the legacy defect where a parent-category
 * page omitted every child category's products.
 *
 * Live shape: 27 categories, 17 roots, max depth 2. Max depth 3 is the limit.
 */
@Schema({ collection: 'categories', timestamps: true, strict: 'throw' })
export class Category {
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: LocalizedTextSchema, required: true })
  name!: LocalizedText;

  @Prop({ type: LocalizedTextSchema, default: null })
  description!: LocalizedText | null;

  @Prop({ type: Types.ObjectId, default: null })
  parentId!: Types.ObjectId | null;

  /** Ancestor ids, ROOT FIRST, excluding self. Empty for a root category. */
  @Prop({ type: [Types.ObjectId], default: [] })
  path!: Types.ObjectId[];

  /** `path.length`. Stored so a depth limit is checkable without a lookup. */
  @Prop({ type: Number, default: 0 })
  depth!: number;

  @Prop({ type: MediaAssetSchema, default: null })
  image!: MediaAsset | null;

  @Prop({ type: Number, default: 0 })
  sortOrder!: number;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  /** Maintained by the catalogue; a display count, never an authority. */
  @Prop({ type: Number, default: 0 })
  productCount!: number;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

export type CategoryDocument = HydratedDocument<Category>;
export type CategoryLean = Category & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CategorySchema = SchemaFactory.createForClass(Category);

CategorySchema.index({ slug: 1 }, { unique: true, name: 'category_slug_unique' });
CategorySchema.index({ parentId: 1, sortOrder: 1 }, { name: 'category_parent_order' });
CategorySchema.index({ path: 1 }, { name: 'category_path' });
CategorySchema.index({ isActive: 1, deletedAt: 1 }, { name: 'category_visibility' });
