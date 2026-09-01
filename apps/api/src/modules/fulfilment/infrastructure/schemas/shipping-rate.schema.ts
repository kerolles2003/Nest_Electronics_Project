import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EGYPTIAN_GOVERNORATES } from '../../../../common/constants/governorates';

/**
 * What delivery costs, one row per governorate.
 *
 * Authority: docs/architecture/MONGODB-DESIGN.md §11 — "`shippingRates` |
 * Governorate → fee, free-shipping threshold | `{governorate:1}` unique";
 *            MONEY-MODEL.md §6 — `shippingRates[].fee` is int64 minor units.
 * Both are adopted **unchanged**; nothing frozen was amended to land this.
 *
 * ## 27 rows, no default row, no fallback, no sentinel (D-8)
 *
 * Every governorate is priced explicitly and every row is independently
 * editable. There is deliberately no "rest of Egypt" row and no wildcard,
 * because either one would answer a lookup that should have failed.
 *
 * A lookup MISS raises. It never invents a fee. That is only safe because the
 * governorate is closed to a validated list on both sides — see
 * `common/constants/governorates.ts`, which exists for exactly this reason — so
 * a miss cannot be a customer typing "Kairo". A miss means the table is
 * incomplete, which is bad data, and charging a made-up amount for delivery is
 * worse than refusing to quote one.
 *
 * ## Why the fee is not on the address, the order, or in configuration
 *
 * It was in configuration (`SHIPPING_FLAT_FEE`), as OPEN-001's specified
 * fallback, while the rates were unsupplied business input. They have now been
 * supplied, so the fallback is superseded — one flat number cannot express
 * "Cairo and Giza are half the price of everywhere else", and 27 environment
 * variables would be a table with worse tooling.
 */
@Schema({ collection: 'shippingRates', timestamps: true, strict: 'throw' })
export class ShippingRate {
  /**
   * The natural key, and the reason the unique index is a guarantee rather than
   * an optimisation: two rows for one governorate would make the fee depend on
   * which one the query happened to return.
   */
  @Prop({ type: String, required: true, enum: EGYPTIAN_GOVERNORATES })
  governorate!: string;

  /**
   * Integer minor units (piastres). `0` is a legitimate value meaning delivery
   * is free in this governorate — distinct from "no rate", which is the absence
   * of the row and raises.
   */
  @Prop({ type: Number, required: true, min: 0 })
  fee!: number;

  /**
   * Order value at or above which delivery is free in THIS governorate, in
   * integer minor units, or `null` for "this governorate has no threshold of
   * its own".
   *
   * Present because MONGODB-DESIGN.md §11 gives this collection the
   * free-shipping threshold as well as the fee, and narrowing a frozen shape
   * would be as much of an amendment as widening it. Every seeded row is
   * `null`, so the configured `FREE_SHIPPING_THRESHOLD` remains the only live
   * mechanism and behaviour is unchanged: **the threshold stays implemented and
   * off.**
   *
   * When a row does set one it wins for that governorate, because a rule
   * written against a specific place is more specific than a global default.
   * Nothing sets one today, and that precedence is worth ratifying before
   * anything does.
   */
  @Prop({ type: Number, default: null, min: 0 })
  freeShippingThreshold!: number | null;
}

export type ShippingRateDocument = HydratedDocument<ShippingRate>;
export type ShippingRateLean = ShippingRate & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ShippingRateSchema = SchemaFactory.createForClass(ShippingRate);

ShippingRateSchema.index({ governorate: 1 }, { unique: true, name: 'shipping_rate_governorate_unique' });
