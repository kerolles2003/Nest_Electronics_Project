import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * The daily order-number sequence.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §7 (Order number).
 *
 * The `NE-YYYYMMDD-NNNN` FORMAT is preserved from legacy; the COUNTER BEHAVIOUR
 * is fixed. Legacy used one global sequence behind a date-prefixed format, so
 * `NE-20260503-0006` really meant "the sixth order ever placed" — a date prefix
 * implying a daily reset that never happened, which leaked total lifetime order
 * volume to anyone holding a single order number.
 *
 * `_id` IS the day key (`YYYYMMDD`), so there is no second identifier, no
 * additional index, and the atomic `$inc` upsert targets a document addressed by
 * primary key. One document per day, a few bytes each.
 *
 * `strict: 'throw'` and a numeric floor of 0 make a malformed counter a write
 * error rather than a silently corrupt order number.
 */
@Schema({ collection: 'orderCounters', versionKey: false, strict: 'throw', timestamps: false })
export class OrderCounter {
  /**
   * `YYYYMMDD` in UTC.
   *
   * UTC rather than Africa/Cairo because no timezone is configured anywhere in
   * the system and inventing one here would put a business rule in a schema
   * file. The visible consequence is that orders placed between midnight and
   * 02:00 Cairo time carry the previous day's prefix. Recorded as an open item
   * rather than silently decided.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  seq!: number;
}

export type OrderCounterDocument = HydratedDocument<OrderCounter>;

export const OrderCounterSchema = SchemaFactory.createForClass(OrderCounter);

/**
 * NO index is declared, and that is the correct answer rather than an omission.
 *
 * Every read and every write addresses a counter by `_id`, which MongoDB always
 * indexes. There is no query that filters, sorts or ranges on anything else,
 * and the collection holds one document per day.
 */
