import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ShippingRate,
  type ShippingRateLean,
} from '../schemas/shipping-rate.schema';

/**
 * Reads the rate table. It is the only thing that does.
 *
 * ## Why no cache
 *
 * 27 rows on a unique index is one round trip against a collection that fits in
 * a page. Caching would buy that back and pay for it in the currency that
 * matters least here and hurts most: an admin edits a fee in Phase 7 and every
 * running instance keeps charging the old one until someone restarts it. Money
 * a customer is shown must not be a function of how long a process has been up.
 *
 * ## Why the read carries no session
 *
 * Placement reads this inside a transaction, but without joining it. The rate
 * table is not written by checkout, so there is nothing to serialise against,
 * and the frozen public API is `quote(governorate, subtotal)`
 * (NESTJS-MODULE-MAP.md §9) — threading a session through it would change that
 * signature and couple a leaf module to Orders' transaction plumbing.
 */
@Injectable()
export class ShippingRateRepository {
  constructor(
    @InjectModel(ShippingRate.name) private readonly rates: Model<ShippingRate>,
  ) {}

  /** The row for one governorate, or `null` when the table has none. */
  async findByGovernorate(governorate: string): Promise<ShippingRateLean | null> {
    return this.rates.findOne({ governorate }).lean<ShippingRateLean>().exec();
  }

  /** Every row, ordered by governorate. Used by the seed and by tests. */
  async findAll(): Promise<ShippingRateLean[]> {
    return this.rates.find().sort({ governorate: 1 }).lean<ShippingRateLean[]>().exec();
  }
}
