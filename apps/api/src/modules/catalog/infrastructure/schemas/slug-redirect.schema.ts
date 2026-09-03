import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Where an old slug now points.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §2 rules 3–6;
 *            MONGODB-DESIGN.md §11 — `{entityType, oldSlug, newSlug}`, key
 *            `{entityType:1, oldSlug:1}` unique;
 *            ADR-CATALOG-005; BEHAVIOR-DECISIONS.md K4; BUSINESS-RULES.md
 *            RULE-CAT-002.
 *
 * ## The defect this collection is the second half of
 *
 * Legacy HAD this table and wrote to it on every rename. **Nothing ever read
 * it.** Zero rows were ever consumed, so every rename produced a permanent 404
 * at the old URL while a row sat in the database recording where the page had
 * gone. That is defect K4, and it is why the frozen documents say "**must be
 * read**" in bold rather than "exists".
 *
 * So this schema is the easy half. The half that matters is the lookup in
 * `ProductsController`, and the test that proves a renamed product's old URL
 * answers 301 rather than 404.
 *
 * ## Why `entityType` is part of the key rather than three collections
 *
 * A product and a brand may legitimately hold the same slug — they are
 * different URL spaces. One collection with the type in the unique key keeps
 * that true while leaving the lookup a single indexed equality match. Three
 * collections would triple the schema, the sync step and the reconciliation for
 * no behavioural difference.
 *
 * Only `product` is written today. Categories and brands gain their renames in
 * later units of this part, and the enum is declared whole so adding the write
 * changes no contract.
 */
export enum SlugRedirectEntityType {
  PRODUCT = 'product',
  CATEGORY = 'category',
  BRAND = 'brand',
}

@Schema({
  collection: 'slugRedirects',
  timestamps: { createdAt: true, updatedAt: true },
  strict: 'throw',
  versionKey: false,
})
export class SlugRedirect {
  @Prop({ type: String, required: true, enum: Object.values(SlugRedirectEntityType) })
  entityType!: SlugRedirectEntityType;

  /** The slug that no longer resolves. Unique per type — one destination, or none. */
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  oldSlug!: string;

  /**
   * The slug it resolves to now.
   *
   * Kept CURRENT by chain collapse (§2 rule 5): when B is renamed to C, every
   * row whose `newSlug` is B is rewritten to C in the same operation. Without
   * that, A→B→C would need two hops at read time, and a resolver that follows
   * chains needs a cycle guard — a rename back and forth would otherwise loop
   * forever on a public endpoint. Collapsing at write time means resolution is
   * always exactly one lookup with no loop to guard.
   */
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  newSlug!: string;

  /**
   * The entity that moved.
   *
   * Not needed for resolution — the redirect answers with a slug, and the
   * client re-requests. It is here so an operator looking at an unexpected
   * redirect can find out which product wrote it, which a pair of strings
   * cannot tell them once both slugs have moved on again.
   */
  @Prop({ type: Types.ObjectId, required: true })
  entityId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SlugRedirectDocument = HydratedDocument<SlugRedirect>;
export type SlugRedirectLean = SlugRedirect & { _id: Types.ObjectId };

export const SlugRedirectSchema = SchemaFactory.createForClass(SlugRedirect);

/**
 * The frozen key, and the only index this collection needs.
 *
 * UNIQUE because one old slug must have exactly one destination. Two rows for
 * one slug would make resolution order-dependent, which means a customer's
 * bookmark would land on a different product depending on which row the planner
 * happened to return first.
 */
SlugRedirectSchema.index(
  { entityType: 1, oldSlug: 1 },
  { unique: true, name: 'slug_redirect_source_unique' },
);

/**
 * Chain collapse rewrites every row pointing AT a slug, which is a query by
 * `newSlug`. Without this it is a collection scan on every rename — cheap today
 * at zero rows, and quietly linear in the number of renames the shop ever makes.
 */
SlugRedirectSchema.index({ entityType: 1, newSlug: 1 }, { name: 'slug_redirect_target' });
