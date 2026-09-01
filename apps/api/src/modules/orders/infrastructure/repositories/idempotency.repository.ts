import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  IDEMPOTENCY_TTL_MS,
  IdempotencyKeyRecord,
  type IdempotencyKeyLean,
} from '../schemas/idempotency-key.schema';

/**
 * MongoDB's duplicate-key error code.
 *
 * **Every `catch` on this code below is a CONCURRENCY CONTROL, not error
 * handling.** The unique index is what makes the operation correct under
 * concurrency; the catch is only how the refusal is translated. Drop the
 * index and the error never arrives, the catch never runs, and the race
 * silently succeeds — no exception, no log line, nothing to notice.
 *
 * `GET /health/ready` refuses traffic when a declared index is missing, and
 * `test/infrastructure/index-health.spec.ts` lists every invariant that
 * depends on one. Do not remove an index named there.
 */
const DUPLICATE_KEY = 11000;

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY
  );
}

export interface ReserveKeyCommand {
  readonly key: string;
  readonly userId: Types.ObjectId;
  readonly requestHash: string;
  readonly orderId: Types.ObjectId;
}

/**
 * The idempotency-key store.
 *
 * Authority: docs/architecture/CONSISTENCY-MODEL.md §4.
 *
 * Two operations and nothing else: claim a key, or look one up. There is no
 * update and no delete — a record is written once, inside the transaction that
 * creates its order, and removed only by the TTL. Mutability would reintroduce
 * exactly the window the design exists to close.
 */
@Injectable()
export class IdempotencyRepository {
  constructor(
    @InjectModel(IdempotencyKeyRecord.name) private readonly model: Model<IdempotencyKeyRecord>,
  ) {}

  /**
   * Claims a key for one order, inside the caller's transaction.
   *
   * Returns `false` when the key is already claimed — the caller then resolves
   * the canonical result rather than creating a second order. The DATABASE
   * decides who claimed it, through the unique index; nothing here reads first
   * and then writes, because two concurrent requests would both pass that read.
   *
   * The record carries the `orderId` up front, from an id generated before the
   * transaction opened. That is what makes "key consumed, no order" impossible:
   * the claim and the result are the same write, and if the transaction aborts
   * the claim disappears with it.
   *
   * A `WriteConflict` — the other request has claimed the key but has not
   * committed yet — is NOT caught here. It is labelled `TransientTransactionError`,
   * so the driver retries the whole callback; on that retry the winner has
   * either committed (duplicate key, handled) or aborted (the key is free).
   */
  async reserve(command: ReserveKeyCommand, session: ClientSession): Promise<boolean> {
    try {
      await this.model.create(
        [
          {
            key: command.key,
            userId: command.userId,
            requestHash: command.requestHash,
            orderId: command.orderId,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        ],
        { session },
      );

      return true;
    } catch (error) {
      /*
       * `idempotencyKeys.idempotency_key_unique` IS the idempotency guarantee.
       *
       * `false` means "another request already reserved this key", and the only
       * thing that can tell us so is the insert being refused. Without the
       * index every reservation succeeds, this always returns `true`, and a
       * retried checkout places a SECOND ORDER against the customer's card.
       *
       * That is the most expensive consequence of a missing index in this
       * system, and it produces no error anywhere.
       */
      if (isDuplicateKeyError(error)) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Looks a key up by itself, WITHOUT a `userId` filter.
   *
   * That is deliberate. The key is globally unique, so filtering by owner here
   * would silently turn "this key belongs to someone else" into "this key does
   * not exist", and the second request would go on to create a second order for
   * a key that already has one. The caller compares `record.userId` and refuses;
   * the comparison has to happen where it can be seen.
   */
  async findByKey(key: string): Promise<IdempotencyKeyLean | null> {
    return this.model.findOne({ key }).lean<IdempotencyKeyLean>().exec();
  }
}
