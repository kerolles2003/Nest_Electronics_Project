import { Injectable } from '@nestjs/common';
import { Types, type ClientSession } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import {
  AddressWriteMiss,
  UserRepository,
  type AddressInput,
  type AddressPatch,
} from '../infrastructure/repositories/user.repository';
import { MAX_ADDRESSES_PER_USER, type AddressLean } from '../infrastructure/schemas/user.schema';

/**
 * The customer's address book.
 *
 * Authority: docs/architecture/DOMAIN-MODEL.md §D2 — Users owns "profile ·
 * address book CRUD · default-address invariant"; NESTJS-MODULE-MAP.md §2;
 * AUTHORIZATION-MODEL.md §4.
 *
 * ## What this class is, and is not
 *
 * It is a THIN application service, and deliberately so. The default-address
 * invariant does not live here — it lives in the single atomic pipeline that
 * `UserRepository` issues, because an invariant enforced in application code is
 * an invariant two concurrent requests can both step around. What lives here is
 * the translation from "the write matched nothing" into the one honest,
 * oracle-free error, and the rule about which address a new one may displace.
 *
 * There is no address-verification vendor, no geocoder, no carrier lookup and no
 * deliverability check. The server validates the SHAPE of what the customer
 * typed and stores it; claiming to know that a street exists would be claiming
 * something no code here can know.
 */
@Injectable()
export class AddressesService {
  constructor(private readonly users: UserRepository) {}

  /** Every saved address, default first. An empty book is not an error. */
  async list(userId: Types.ObjectId): Promise<AddressLean[]> {
    return this.users.findAddresses(userId);
  }

  /**
   * One saved address.
   *
   * A foreign address and a nonexistent one both arrive here as `null` — the
   * repository never fetched either — and both leave as the same 404.
   */
  async findOne(userId: Types.ObjectId, addressId: Types.ObjectId): Promise<AddressLean> {
    const address = await this.users.findAddress(userId, addressId);

    if (address === null) {
      throw AppException.addressNotFound();
    }

    return address;
  }

  /**
   * Resolves the address a checkout is being placed against, INSIDE the caller's
   * transaction.
   *
   * The session is threaded through so the address is read from the same
   * snapshot the stock decrement and the order insert are evaluated against —
   * the checkout cannot snapshot an address that a concurrent edit has already
   * replaced within the same commit.
   *
   * Ownership is the same query filter as everywhere else, so a foreign
   * `addressId` fails identically to a nonexistent one and neither reaches an
   * order.
   */
  async findOwnedForCheckout(
    userId: Types.ObjectId,
    addressId: Types.ObjectId,
    session: ClientSession,
  ): Promise<AddressLean> {
    const address = await this.users.findAddress(userId, addressId, session);

    if (address === null) {
      throw AppException.addressNotFound();
    }

    return address;
  }

  /**
   * Saves a new address.
   *
   * `makeDefault` is the customer's explicit request — a "make this my default"
   * checkbox on the form. Without it, a new address becomes the default ONLY
   * when the book was empty, so adding a second address can never silently
   * redirect the customer's next order.
   */
  async create(
    userId: Types.ObjectId,
    input: AddressInput,
    makeDefault: boolean,
  ): Promise<AddressLean> {
    return this.unwrap(await this.users.insertAddress(userId, input, makeDefault, new Date()));
  }

  /**
   * Edits a saved address.
   *
   * This has NO effect on any order already placed. An order carries its own
   * address snapshot, so editing the source here changes where the NEXT order
   * goes and nothing about where a past one went.
   */
  async update(
    userId: Types.ObjectId,
    addressId: Types.ObjectId,
    patch: AddressPatch,
  ): Promise<AddressLean> {
    return this.unwrap(await this.users.updateAddress(userId, addressId, patch, new Date()));
  }

  /**
   * Makes one address the default and, in the same atomic update, every sibling
   * not the default.
   *
   * Returns the whole book so a client replaces its state rather than merging a
   * partial response — the same rule the cart follows, and for the same reason:
   * this operation changes more rows than the one that was addressed.
   */
  async setDefault(userId: Types.ObjectId, addressId: Types.ObjectId): Promise<AddressLean[]> {
    const result = await this.users.setDefaultAddress(userId, addressId, new Date());

    if (result === AddressWriteMiss.ADDRESS) {
      throw AppException.addressNotFound();
    }

    if (result === AddressWriteMiss.USER || result === AddressWriteMiss.LIMIT) {
      throw AppException.accountDisabled();
    }

    return result;
  }

  /**
   * Deletes a saved address.
   *
   * Deleting the DEFAULT promotes a replacement deterministically — oldest
   * surviving address, `_id` as the tie-break — rather than leaving the customer
   * with none. Deleting the last one leaves no default, which is a legitimate
   * state.
   *
   * There is deliberately NO check for "this address is referenced by an order".
   * Orders snapshot their address, so no order depends on this document and
   * blocking the delete would protect nothing while making the address book
   * impossible to tidy.
   */
  async remove(userId: Types.ObjectId, addressId: Types.ObjectId): Promise<void> {
    const result = await this.users.deleteAddress(userId, addressId, new Date());

    if (result === AddressWriteMiss.ADDRESS) {
      throw AppException.addressNotFound();
    }

    if (result === AddressWriteMiss.USER || result === AddressWriteMiss.LIMIT) {
      throw AppException.accountDisabled();
    }
  }

  /**
   * Turns a repository miss into the ONE error it should be.
   *
   * `ADDRESS` and a nonexistent id are indistinguishable by construction, which
   * is the property that keeps an address id from becoming an oracle.
   */
  private unwrap(result: AddressLean | AddressWriteMiss): AddressLean {
    switch (result) {
      case AddressWriteMiss.ADDRESS:
        throw AppException.addressNotFound();
      case AddressWriteMiss.LIMIT:
        throw AppException.addressLimitReached(MAX_ADDRESSES_PER_USER);
      case AddressWriteMiss.USER:
        // A valid token for a soft-deleted account — the same answer checkout
        // gives in the same situation.
        throw AppException.accountDisabled();
      default:
        return result;
    }
  }
}
