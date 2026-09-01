import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { AppException } from '../../../../common/errors/app.exception';
import { OrderCounter } from '../schemas/order-counter.schema';

/**
 * MongoDB's duplicate-key error code.
 *
 * The catch below is the ONE in this codebase that is NOT at risk from a
 * missing index: the day key is the document's `_id`, and `_id_` is the one
 * index MongoDB always creates and `syncIndexes()` can never drop. Recorded
 * here because the pattern looks identical to the four that ARE at risk, and
 * the difference is worth being able to see.
 */
const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY
  );
}

/** `YYYYMMDD`, UTC. */
export function counterDayKey(at: Date): string {
  return at.toISOString().slice(0, 10).replace(/-/g, '');
}

/** `NE-YYYYMMDD-NNNN`. Four digits, zero-padded; wider once a day exceeds 9,999. */
export function formatOrderNumber(day: string, sequence: number): string {
  return `NE-${day}-${String(sequence).padStart(4, '0')}`;
}

/**
 * The daily order-number sequence.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §7.
 */
@Injectable()
export class OrderCounterRepository {
  constructor(@InjectModel(OrderCounter.name) private readonly model: Model<OrderCounter>) {}

  /**
   * Creates today's counter document if it is not there yet. Called OUTSIDE the
   * placement transaction, deliberately.
   *
   * ## Why this is a separate step rather than an upsert inside the transaction
   *
   * `$inc` with `upsert: true` inside a transaction behaves differently
   * depending on whether the document already exists. Against an existing
   * document, two concurrent transactions produce a WriteConflict, which the
   * server labels `TransientTransactionError` and the driver retries
   * transparently. Against a MISSING document they both attempt an insert, and
   * the loser gets a duplicate-key error, which carries no such label — so the
   * first two orders of every day would race into a hard failure that the rest
   * of the day never sees. A bug that only reproduces at midnight is the worst
   * kind.
   *
   * Creating the document first makes the in-transaction step a pure `$inc` on
   * an existing document, so the ONLY concurrency outcome is the retryable one.
   *
   * It is safe outside the transaction because a counter at `seq: 0` allocates
   * nothing: no number is reserved, no gap is created, and a checkout that
   * subsequently fails leaves only an empty counter behind.
   */
  async ensureDay(day: string): Promise<void> {
    try {
      await this.model.updateOne({ _id: day }, { $setOnInsert: { seq: 0 } }, { upsert: true }).exec();
    } catch (error) {
      // Another request created it between this filter and this insert, which
      // is the outcome we wanted anyway.
      if (!isDuplicateKey(error)) {
        throw error;
      }
    }
  }

  /**
   * Reserves the next number for `day`, inside the caller's transaction.
   *
   * The reservation is transactional, so a rolled-back placement returns its
   * number rather than burning it. Two placements on the same day contend on
   * this one document and the loser's transaction is retried by the driver;
   * that serialisation is the price of a genuinely gapless daily sequence, and
   * the daily volume this system handles makes it unmeasurable.
   */
  async next(day: string, session: ClientSession): Promise<string> {
    const counter = await this.model
      .findOneAndUpdate({ _id: day }, { $inc: { seq: 1 } }, { session, returnDocument: 'after' })
      .lean<{ _id: string; seq: number }>()
      .exec();

    if (counter === null) {
      // Unreachable: `ensureDay` ran before the transaction opened. A loud
      // failure beats fabricating an order number nobody can explain.
      throw AppException.internal();
    }

    return formatOrderNumber(day, counter.seq);
  }
}
