import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession, type PipelineStage } from 'mongoose';
import { MAX_ADDRESSES_PER_USER, User, type AddressLean } from '../schemas/user.schema';

/** The address fields a client may supply. Never `isDefault`, never `userId`. */
export interface AddressInput {
  readonly label: string;
  readonly fullName: string;
  readonly phone: string;
  readonly street: string;
  readonly city: string;
  readonly governorate: string;
  readonly postalCode: string | null;
}

/** A PATCH: only the keys actually sent. An absent key is left unchanged. */
export type AddressPatch = Partial<AddressInput>;

/** Why a write matched nothing, so the service can choose the honest error. */
export enum AddressWriteMiss {
  /** The user document is gone or soft-deleted. */
  USER = 'USER',
  /** The user exists; the address does not, or is not theirs — one answer. */
  ADDRESS = 'ADDRESS',
  /** The user exists and already holds the maximum number of addresses. */
  LIMIT = 'LIMIT',
}

/**
 * A client-supplied string, neutralised for use inside an aggregation pipeline.
 *
 * THIS IS A SECURITY CONTROL, not a formality. In an update pipeline a string
 * beginning with `$` is a FIELD PATH, so an address whose street is
 * `"$passwordHash"` would otherwise be stored as the VALUE of that field.
 * `$literal` returns its argument uninterpreted, which closes the whole class
 * of expression injection in one place.
 */
function literal(value: string | null): { $literal: string | null } {
  return { $literal: value };
}

/**
 * Persistence for the `users` document, and THE home of the default-address
 * invariant.
 *
 * Authority: docs/architecture/MONGODB-DESIGN.md §3, §12.3;
 *            docs/architecture/CODEBASE-STRUCTURE.md §7 (users is Tier 2, with
 *            a repository — `UsersService` recorded that one "arrives with
 *            address CRUD", which is this phase).
 *
 * ## Two properties hold for every method here
 *
 * **1. Ownership is a QUERY FILTER, never a post-fetch comparison.** No method
 * accepts an address id without the owning `userId` in the same filter, so a
 * foreign address is never selected rather than selected and then rejected.
 * There is no code path that could leak one by forgetting a check
 * (AUTHORIZATION-MODEL.md §4, rule 2).
 *
 * **2. Every write is ONE atomic single-document update.** Not a transaction —
 * an aggregation-pipeline `updateOne` against one user document. MongoDB
 * serialises concurrent updates to a single document, so "at most one default"
 * needs no transaction, no lock, no partial unique index and no read-then-write
 * window. That is precisely the property MONGODB-DESIGN.md §12.3 cited when it
 * chose to embed.
 *
 * The invariant is enforced by RECOMPUTING `isDefault` across the whole array on
 * every write (`defaultRepairStage`) rather than by setting it on one element. A
 * write that touches the array cannot leave the array inconsistent, because
 * consistency is not a separate step it could skip.
 */
@Injectable()
export class UserRepository {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  // --- reads ----------------------------------------------------------------

  /**
   * The whole address book, in a STABLE, deterministic order: the default
   * first, then oldest first, with the id as the final tie-break.
   *
   * Sorted in memory on purpose. The array is capped at ten and arrives inside
   * a document already fetched by `_id`; asking MongoDB to sort it would add a
   * stage to save nothing.
   */
  async findAddresses(userId: Types.ObjectId): Promise<AddressLean[]> {
    const user = await this.model
      .findOne({ _id: userId, deletedAt: null })
      .select({ addresses: 1 })
      .lean<{ addresses?: AddressLean[] }>()
      .exec();

    return user === null ? [] : [...(user.addresses ?? [])].sort(compareForDisplay);
  }

  /**
   * ONE address, selected by id AND owner in the same filter.
   *
   * Returns null for "no such address", for "it belongs to somebody else" and
   * for "the account is disabled" — one answer, so there is nothing here a
   * caller could turn into an existence oracle.
   *
   * `addresses.$` projects only the matched element, so a response cannot even
   * disclose how many addresses the owner has.
   */
  async findAddress(
    userId: Types.ObjectId,
    addressId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<AddressLean | null> {
    const query = this.model
      .findOne({ _id: userId, deletedAt: null, 'addresses._id': addressId })
      .select({ 'addresses.$': 1 })
      .lean<{ addresses?: AddressLean[] }>();

    if (session !== undefined) {
      query.session(session);
    }

    const found = await query.exec();

    return found?.addresses?.[0] ?? null;
  }

  // --- writes ---------------------------------------------------------------

  /**
   * Appends an address and settles the default in ONE update.
   *
   * The cap is part of the FILTER (`addresses.9` must not exist), not a
   * read-then-check: two concurrent creates against a user holding nine
   * addresses cannot both pass, because the second is evaluated against the
   * document the first already wrote.
   *
   * `makeDefault` is the client's explicit request. When it is false the repair
   * stage keeps whatever default already exists and promotes the new address
   * only when there was none — which is what makes the FIRST address default
   * automatically, and what stops a later one from silently stealing it.
   */
  async insertAddress(
    userId: Types.ObjectId,
    input: AddressInput,
    makeDefault: boolean,
    now: Date,
  ): Promise<AddressLean | AddressWriteMiss> {
    const addressId = new Types.ObjectId();

    const result = await this.model
      .updateOne(
        {
          _id: userId,
          deletedAt: null,
          [`addresses.${String(MAX_ADDRESSES_PER_USER - 1)}`]: { $exists: false },
        },
        [
          {
            $set: {
              addresses: {
                $concatArrays: [
                  { $ifNull: ['$addresses', []] },
                  [
                    {
                      _id: addressId,
                      label: literal(input.label),
                      fullName: literal(input.fullName),
                      phone: literal(input.phone),
                      street: literal(input.street),
                      city: literal(input.city),
                      governorate: literal(input.governorate),
                      postalCode: literal(input.postalCode),
                      isDefault: false,
                      createdAt: now,
                      updatedAt: now,
                    },
                  ],
                ],
              },
            },
          },
          UserRepository.defaultRepairStage(makeDefault ? addressId : null, now),
        ],
      )
      .exec();

    if (result.matchedCount === 0) {
      // Reached only on failure, and only to choose between two honest answers:
      // a disabled account and a full address book.
      return (await this.model.exists({ _id: userId, deletedAt: null })) === null
        ? AddressWriteMiss.USER
        : AddressWriteMiss.LIMIT;
    }

    // Read back rather than reconstruct: the repair stage decides `isDefault`,
    // and the response must report what the database holds, not what the caller
    // asked for.
    const created = await this.findAddress(userId, addressId);

    return created ?? AddressWriteMiss.ADDRESS;
  }

  /**
   * Applies a PATCH to one owned address.
   *
   * `isDefault` is NOT patchable here — changing it is a write against every
   * sibling rather than against this element, and it has its own endpoint. The
   * repair stage still runs, so an update can only ever leave the array
   * consistent.
   */
  async updateAddress(
    userId: Types.ObjectId,
    addressId: Types.ObjectId,
    patch: AddressPatch,
    now: Date,
  ): Promise<AddressLean | AddressWriteMiss> {
    const changes: Record<string, unknown> = { updatedAt: now };

    for (const [key, value] of Object.entries(patch)) {
      changes[key] = literal(value as string | null);
    }

    const result = await this.model
      .updateOne({ _id: userId, deletedAt: null, 'addresses._id': addressId }, [
        {
          $set: {
            addresses: {
              $map: {
                input: '$addresses',
                as: 'a',
                in: {
                  $cond: [
                    { $eq: ['$$a._id', addressId] },
                    { $mergeObjects: ['$$a', changes] },
                    '$$a',
                  ],
                },
              },
            },
          },
        },
        UserRepository.defaultRepairStage(null, now),
      ])
      .exec();

    if (result.matchedCount === 0) {
      return this.classifyMiss(userId);
    }

    const updated = await this.findAddress(userId, addressId);

    return updated ?? AddressWriteMiss.ADDRESS;
  }

  /**
   * Makes one owned address the default, and every sibling not the default, in
   * ONE update.
   *
   * There is no window in which two are default and none in which zero are,
   * because there is no intermediate state to observe: the array is rewritten
   * once, and MongoDB applies that rewrite atomically to the document.
   */
  async setDefaultAddress(
    userId: Types.ObjectId,
    addressId: Types.ObjectId,
    now: Date,
  ): Promise<AddressLean[] | AddressWriteMiss> {
    const result = await this.model
      .updateOne({ _id: userId, deletedAt: null, 'addresses._id': addressId }, [
        UserRepository.defaultRepairStage(addressId, now),
      ])
      .exec();

    if (result.matchedCount === 0) {
      return this.classifyMiss(userId);
    }

    return this.findAddresses(userId);
  }

  /**
   * Removes one owned address and settles the replacement default in ONE update.
   *
   * Deleting the default promotes a replacement by the DOCUMENTED DETERMINISTIC
   * RULE — oldest surviving `createdAt`, `_id` ascending as the tie-break —
   * never by Mongo natural order. Deleting a non-default moves no flag. Deleting
   * the last address simply leaves the customer with no default.
   *
   * This touches NOTHING outside the user document. Orders keep their address
   * snapshot, inventory and shipment records are untouched, and no order is ever
   * deleted — which is why there is deliberately no "this address is used by an
   * order" block anywhere above it.
   */
  async deleteAddress(
    userId: Types.ObjectId,
    addressId: Types.ObjectId,
    now: Date,
  ): Promise<true | AddressWriteMiss> {
    const result = await this.model
      .updateOne({ _id: userId, deletedAt: null, 'addresses._id': addressId }, [
        {
          $set: {
            addresses: {
              $filter: {
                input: '$addresses',
                as: 'a',
                cond: { $ne: ['$$a._id', addressId] },
              },
            },
          },
        },
        UserRepository.defaultRepairStage(null, now),
      ])
      .exec();

    if (result.matchedCount === 0) {
      return this.classifyMiss(userId);
    }

    return true;
  }

  // --- the invariant --------------------------------------------------------

  /**
   * THE default-address invariant, as one pipeline stage.
   *
   * Recomputes `isDefault` for EVERY element from a single chosen winner, so "at
   * most one default" is a property of the expression rather than of a caller
   * remembering to unset siblings — the exact legacy defect MONGODB-DESIGN.md §3
   * records: "legacy set the new default without unsetting siblings, permitting
   * multiple defaults".
   *
   * The winner is:
   *
   *  1. `preferred`, when the caller explicitly chose one; otherwise
   *  2. the address that is ALREADY default, if one is still present — so an
   *     unrelated write never moves the default; otherwise
   *  3. the OLDEST remaining address by `createdAt`, with `_id` ascending as the
   *     tie-break. Documented, deterministic, and independent of Mongo natural
   *     order — which is what makes the outcome of deleting the default a
   *     testable rule rather than an accident of storage.
   *
   * It is also SELF-HEALING: an array that somehow held two defaults leaves this
   * stage holding one, because the flag is DERIVED on every write, not carried.
   *
   * `updatedAt` moves only on an element whose flag actually changed, so a
   * repair that is a no-op is a no-op in the data too.
   */
  private static defaultRepairStage(
    preferred: Types.ObjectId | null,
    now: Date,
  ): PipelineStage.Set {
    const currentDefault = {
      $first: {
        $filter: { input: '$addresses', as: 'a', cond: { $eq: ['$$a.isDefault', true] } },
      },
    };

    const oldest = {
      $first: { $sortArray: { input: '$addresses', sortBy: { createdAt: 1, _id: 1 } } },
    };

    const winner =
      preferred === null
        ? {
            $let: {
              vars: { current: currentDefault, oldest },
              in: { $ifNull: ['$$current._id', '$$oldest._id'] },
            },
          }
        : preferred;

    return {
      $set: {
        addresses: {
          $let: {
            vars: { keep: winner },
            in: {
              $map: {
                input: '$addresses',
                as: 'a',
                in: {
                  $let: {
                    vars: { flag: { $eq: ['$$a._id', '$$keep'] } },
                    in: {
                      $mergeObjects: [
                        '$$a',
                        {
                          isDefault: '$$flag',
                          updatedAt: {
                            $cond: [{ $eq: ['$$flag', '$$a.isDefault'] }, '$$a.updatedAt', now],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Separates "your account is gone" from "that address is not yours".
   *
   * Both are failures, but only one of them is about the address — and the
   * address answer is deliberately identical for a foreign address and a
   * nonexistent one, so this classification cannot widen into an oracle.
   */
  private async classifyMiss(userId: Types.ObjectId): Promise<AddressWriteMiss> {
    return (await this.model.exists({ _id: userId, deletedAt: null })) === null
      ? AddressWriteMiss.USER
      : AddressWriteMiss.ADDRESS;
  }
}

/** Default first, then oldest first, then by id — a total order, so it is stable. */
function compareForDisplay(a: AddressLean, b: AddressLean): number {
  if (a.isDefault !== b.isDefault) {
    return a.isDefault ? -1 : 1;
  }

  const byAge = a.createdAt.getTime() - b.createdAt.getTime();

  return byAge !== 0 ? byAge : a._id.toHexString().localeCompare(b._id.toHexString());
}
