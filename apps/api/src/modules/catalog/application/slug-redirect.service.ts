import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SlugRedirect,
  SlugRedirectEntityType,
  type SlugRedirectLean,
} from '../infrastructure/schemas/slug-redirect.schema';

/**
 * Writing and reading `slugRedirects`.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §2 rules 3–6; ADR-CATALOG-005.
 *
 * ## Both halves, or neither
 *
 * Legacy had `record`. It did not have `resolve`, and that is the whole of
 * defect K4: redirects were written on every rename and nothing ever read one,
 * so each rename left a permanent 404 at the old URL with a row in the database
 * saying exactly where the page had gone.
 *
 * The two methods are in one class for that reason. A `record` that ships
 * without its `resolve` is worse than no redirect at all, because the row it
 * writes looks like the feature working.
 */
@Injectable()
export class SlugRedirectService {
  private readonly logger = new Logger(SlugRedirectService.name);

  constructor(@InjectModel(SlugRedirect.name) private readonly model: Model<SlugRedirect>) {}

  /**
   * Records a rename, collapsing any chain it extends.
   *
   * Three writes, in this order, and the order is the correctness:
   *
   * 1. **Collapse.** Every row already pointing at `oldSlug` is rewritten to
   *    point at `newSlug` (§2 rule 5). A→B followed by B→C becomes A→C, so
   *    resolution is always one hop. The alternative — following chains at read
   *    time — needs a cycle guard on a public endpoint, because renaming a
   *    product back and forth builds a loop.
   * 2. **Clear.** Any redirect whose SOURCE is the new slug is removed. The
   *    live slug must never also be a redirect source: resolution finds the
   *    live product first so the row is unreachable, but an unreachable row
   *    that contradicts reality is the kind of thing somebody debugs for an
   *    hour, and it also holds the unique key against a later legitimate rename.
   * 3. **Upsert** the new row.
   *
   * ## Why this is not in a transaction
   *
   * It is called from inside the caller's rename, after the product document
   * has been updated, and the operations are individually idempotent: replaying
   * any of them lands on the same state. A partial failure leaves the product
   * renamed with a redirect missing — the old URL 404s, which is exactly the
   * pre-existing behaviour and is recoverable by renaming again. Wrapping it
   * would trade that for a rename that can fail because its redirect could not
   * be written, which is the more damaging failure of the two: the product
   * would keep a name the operator has already changed in front of them.
   */
  async record(input: {
    readonly entityType: SlugRedirectEntityType;
    readonly entityId: Types.ObjectId;
    readonly oldSlug: string;
    readonly newSlug: string;
  }): Promise<void> {
    const { entityType, entityId, oldSlug, newSlug } = input;

    if (oldSlug === newSlug) return;

    await this.model
      .updateMany({ entityType, newSlug: oldSlug }, { $set: { newSlug } })
      .exec();

    await this.model.deleteOne({ entityType, oldSlug: newSlug }).exec();

    await this.model
      .updateOne(
        { entityType, oldSlug },
        { $set: { newSlug, entityId }, $setOnInsert: { entityType, oldSlug } },
        { upsert: true },
      )
      .exec();

    this.logger.log(`slug redirect  ${entityType}  ${oldSlug} -> ${newSlug}`);
  }

  /**
   * Where an old slug points now, or null.
   *
   * ONE indexed equality lookup, no chain following, no loop guard — because
   * `record` collapsed the chain at write time. That is the trade this design
   * makes: a little more work on a rename, which happens rarely and is done by
   * a person who is waiting, in exchange for a single fast lookup on a public
   * detail page, which happens constantly.
   */
  async resolve(entityType: SlugRedirectEntityType, oldSlug: string): Promise<string | null> {
    const row = await this.model
      .findOne({ entityType, oldSlug })
      .select({ newSlug: 1 })
      .lean<Pick<SlugRedirectLean, 'newSlug'>>()
      .exec();

    return row?.newSlug ?? null;
  }

  /**
   * Forgets every redirect belonging to one entity.
   *
   * Used by a HARD delete, which is the one operation after which the
   * destination genuinely no longer exists. A soft delete deliberately does NOT
   * call this: the product is recoverable, its slug is still held (§9), and
   * removing the redirects would make a restore silently lose every old URL
   * that still worked the day before.
   */
  async forgetEntity(entityType: SlugRedirectEntityType, entityId: Types.ObjectId): Promise<number> {
    const result = await this.model.deleteMany({ entityType, entityId }).exec();

    return result.deletedCount;
  }
}
