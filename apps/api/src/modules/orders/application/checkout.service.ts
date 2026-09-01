import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import type { Locale } from '../../../common/localization/locale';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { TransactionService } from '../../../database/transaction.service';
import { CartLineStatus, CartService, type CartLineView, type CartView } from '../../cart/application/cart.service';
import { FulfilmentService } from '../../fulfilment/fulfilment.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { AddressesService } from '../../users/application/addresses.service';
import { UsersService, type UserProfile } from '../../users/application/users.service';
import type { AddressLean } from '../../users/infrastructure/schemas/user.schema';
import { INITIAL_ORDER_STATUS, INITIAL_PAYMENT_STATUS, PaymentMethod } from '../domain/order-status';
import { IdempotencyRepository, isDuplicateKeyError } from '../infrastructure/repositories/idempotency.repository';
import { counterDayKey, OrderCounterRepository } from '../infrastructure/repositories/order-counter.repository';
import { OrderRepository } from '../infrastructure/repositories/order.repository';
import type { IdempotencyKeyLean } from '../infrastructure/schemas/idempotency-key.schema';
import type { Order, OrderItem } from '../infrastructure/schemas/order.schema';
import {
  computeOrderPricing,
  lineTotal,
  VAT_INCLUSIVE,
  VAT_RATE_BPS,
  type OrderPricing,
} from './order-pricing';

/**
 * The delivery address as it is FROZEN ONTO THE ORDER.
 *
 * No longer a request shape. Every field is copied from a saved address the
 * customer owns, resolved inside the placement transaction — the client supplies
 * an id and nothing else, so there is no address field on the wire for it to
 * influence.
 *
 * `label` is deliberately not carried across: it is the customer's private name
 * for an entry in their address book ("Mum's"), not a delivery datum, and an
 * order has no use for it.
 */
export interface ShippingAddressInput {
  readonly fullName: string;
  readonly phone: string;
  readonly street: string;
  readonly city: string;
  readonly governorate: string;
  readonly postalCode: string | null;
}

/** Copies a saved address into the order snapshot. The one place that mapping exists. */
function toSnapshot(address: AddressLean): ShippingAddressInput {
  return {
    fullName: address.fullName,
    phone: address.phone,
    street: address.street,
    city: address.city,
    governorate: address.governorate,
    postalCode: address.postalCode,
  };
}

/**
 * Everything placement needs, assembled by the controller.
 *
 * Authority: docs/architecture/DTO-STRATEGY.md §2 — a command object exists
 * where the input includes data that is NOT in the request body. Two fields
 * here qualify: `userId` comes from the JWT and `idempotencyKey` from a header.
 * Neither is a DTO field, so neither can be forged by a client.
 */
export interface PlaceOrderCommand {
  readonly userId: Types.ObjectId;
  readonly idempotencyKey: string;
  /**
   * A saved address belonging to `userId`. Resolved INSIDE the transaction,
   * through an ownership-filtered query, and copied onto the order — never
   * stored as a reference, so no order ever depends on a document the customer
   * can later edit or delete.
   */
  readonly addressId: Types.ObjectId;
  readonly customerNote: string | null;
  /**
   * The request's resolved locale, used ONLY to choose the language of the
   * confirmation email — one request, one language.
   *
   * Deliberately absent from `fingerprint()`: a retry sent with a different
   * `Accept-Language` is the SAME order, and treating it as a conflicting
   * request would turn a header change into a 409.
   */
  readonly locale: Locale;
}

/** An order as written, or as replayed. One shape, so one response mapper. */
export type PlacedOrder = Order & { _id: Types.ObjectId };

export interface PlacementOutcome {
  readonly order: PlacedOrder;
  /** True when this request returned an order a PREVIOUS request created. */
  readonly replayed: boolean;
}

/**
 * A server-calculated view of the current checkout state. Nothing more.
 *
 * Explicitly NOT a reservation, a stock lock, a payment authorisation, or any
 * guarantee that a later placement will succeed. It is not persisted — there is
 * no `quotes` collection, no quote id and no quote lifecycle, because nothing
 * would ever read one: placement recomputes every figure from scratch inside
 * its own transaction and would ignore a stored quote if it existed.
 */
export interface CheckoutQuote {
  readonly lines: readonly CartLineView[];
  readonly itemCount: number;
  readonly totalQuantity: number;
  readonly currency: string;
  readonly pricing: OrderPricing;
  readonly vatInclusive: boolean;
  readonly vatRateBps: number;
  readonly hasBlockingIssues: boolean;
  readonly canPlaceOrder: boolean;
  readonly generatedAt: Date;
}

/**
 * Signals that another request already owns this idempotency key.
 *
 * A sentinel rather than an `AppException`, because it is not the answer — it
 * means "abort this transaction and go and find the canonical result". It also
 * deliberately carries no server label, so the driver does not retry it: the
 * key is taken, and retrying the callback would only discover that again.
 */
class DuplicateCheckoutError extends Error {
  constructor() {
    super('idempotency key already claimed');
    this.name = 'DuplicateCheckoutError';
  }
}

/** Statuses that must stop a checkout rather than silently drop a line. */
const BLOCKING: ReadonlySet<CartLineStatus> = new Set([
  CartLineStatus.OUT_OF_STOCK,
  CartLineStatus.UNAVAILABLE,
]);

/**
 * Checkout: the quote, and the atomic placement of an order.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §7; CONSISTENCY-MODEL.md §3,
 *            §4; CART-MODEL.md §9; MONEY-MODEL.md §7.
 *
 * ## The one rule
 *
 * The client is authoritative for NOTHING that costs money, and as of this phase
 * for nothing about WHERE the goods go either. It supplies the id of an address
 * it already owns, an optional note, and an idempotency key. Prices, currency,
 * discounts, shipping, subtotals, the grand total, stock, the order status, the
 * delivery address and the customer identity are all read or computed here, on
 * the server, inside the transaction that commits them.
 *
 * The item list is not a request field either: it is derived from the server
 * cart. Legacy discarded client prices inside `create_order_v2` (correct) but
 * still accepted the item list, and with no `quantity > 0` check a negative
 * quantity could reduce the order total (F-CRIT-3). Deriving the list from the
 * cart closes that class of attack entirely — the fields to mount it do not
 * exist on the wire.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly carts: CartService,
    private readonly inventory: InventoryService,
    private readonly users: UsersService,
    private readonly addresses: AddressesService,
    private readonly fulfilment: FulfilmentService,
    private readonly orders: OrderRepository,
    private readonly counters: OrderCounterRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The authoritative breakdown for the customer's current cart.
   *
   * NO TRANSACTION, deliberately. A transaction exists to make several writes
   * atomic; this performs none. Opening one would add a session round trip, take
   * a snapshot nothing outlives, and imply a stock guarantee the quote does not
   * make.
   *
   * Every figure is recomputed from live catalogue data on this request, so two
   * quotes seconds apart may legitimately differ. That is the honest behaviour:
   * the alternative is showing a stale total that placement will then refuse.
   */
  async quote(userId: Types.ObjectId, addressId: Types.ObjectId | null): Promise<CheckoutQuote> {
    // Resolved through the SAME ownership-filtered query placement uses, so a
    // foreign address id answers 404 here too and the quote endpoint cannot be
    // used to probe somebody else's address book.
    const address =
      addressId === null ? null : await this.addresses.findOne(userId, addressId);

    const cart = await this.carts.getCart(userId);

    return this.toQuote(cart, address?.governorate ?? null);
  }

  /**
   * Places the order.
   *
   * ## Sequence
   *
   *   pre-flight    replay lookup by idempotency key       (no writes)
   *                 customer snapshot, counter document    (no reservation)
   *   TRANSACTION   claim the key -> read cart -> re-read products ->
   *                 resolve the owned address -> price -> reserve order number ->
   *                 decrement stock + ledger -> insert order -> clear cart
   *   post-commit   nothing. There is no notification module yet, and anything
   *                 added later belongs outside the transaction.
   *
   * ## Why nothing from the quote is trusted
   *
   * A quote is a display artefact. This method re-reads the cart, re-reads every
   * product, re-checks availability, re-computes every total and re-derives the
   * status — inside the transaction, against the snapshot the stock decrement is
   * evaluated against. A client that held a quote for an hour gets today's
   * prices, or a clean failure, never yesterday's total.
   */
  async placeOrder(command: PlaceOrderCommand): Promise<PlacementOutcome> {
    const requestHash = CheckoutService.fingerprint(command);

    // --- Pre-flight replay -------------------------------------------------
    // A retry after a successful commit is the COMMON case on a mobile network,
    // and answering it costs one indexed read instead of an entire transaction.
    // It is an optimisation, not the mechanism: the guarantee is the unique
    // index, which is what makes the concurrent case safe.
    const claimed = await this.idempotency.findByKey(command.idempotencyKey);

    if (claimed !== null) {
      return { order: await this.replay(claimed, command, requestHash), replayed: true };
    }

    // Read OUTSIDE the transaction: `users` is not part of this order's
    // consistency boundary — nothing here writes to it — and a profile edit
    // racing a checkout changes a snapshot, not a total.
    const profile = await this.users.findById(command.userId);

    if (profile === null) {
      // A valid token for a soft-deleted account. Refused before any write.
      throw AppException.accountDisabled();
    }

    const day = counterDayKey(new Date());
    await this.counters.ensureDay(day);

    const orderId = new Types.ObjectId();

    let placed: PlacedOrder;

    try {
      placed = await this.transactions.run(async (session) =>
        this.commit({ command, requestHash, profile, day, orderId, session }),
      );
    } catch (error) {
      if (error instanceof DuplicateCheckoutError || isDuplicateKeyError(error)) {
        // Another request won the key, or won `orders.idempotencyKey`. Our
        // transaction rolled back completely — no stock moved, no order exists,
        // the cart is untouched — so the only thing left is to return theirs.
        return { order: await this.resolveContested(command, requestHash), replayed: true };
      }

      throw error;
    }

    // --- post-commit ---------------------------------------------------------
    // OUTSIDE the try, deliberately. Inside it, any error escaping the
    // notification path would be handed to a `catch` that asks "was this a
    // duplicate key?" — and a false positive there would answer a successful
    // placement with somebody else's order. The catch block guards exactly one
    // thing: the transaction.
    //
    // Placement is the asset; the email is a courtesy about it. This call
    // therefore cannot fail the request — `NotificationsService` catches
    // everything and returns void (CONSISTENCY-MODEL.md §7,
    // ORDER-LIFECYCLE.md §12).
    //
    // It is also where duplicate emails are prevented, at no extra cost: both
    // replay paths return before reaching this line, so one send is bound to
    // one commit by the same idempotency key that already makes placement safe
    // to retry. A customer who taps "Place order" three times on a bad
    // connection gets one order and one email.
    await this.notifications.sendOrderConfirmation(placed, command.locale);

    return { order: placed, replayed: false };
  }

  // --- the transaction ------------------------------------------------------

  /**
   * Everything that must commit or roll back together.
   *
   * ORDER OF WRITES IS LOAD-BEARING:
   *
   *  1. **Claim the key first.** Two concurrent requests collide here, before
   *     either has moved stock, so the loser wastes nothing and — crucially —
   *     cannot half-succeed.
   *  2. **Read the cart and the products inside the session.** Both reads see
   *     the snapshot the decrement is evaluated against, so the price charged
   *     and the stock taken are consistent by construction rather than by
   *     timing.
   *  3. **Reserve the order number** before the ledger, because a ledger entry
   *     records `Order NE-…` as its human-readable provenance.
   *  4. **Decrement stock and write the ledger** together, in `InventoryService`.
   *  5. **Insert the order.** One write with the final totals — no placeholder,
   *     no second pass.
   *  6. **Clear the cart LAST**, strictly after the order exists.
   *
   * Nothing here performs I/O outside MongoDB. No email, no HTTP, no media
   * upload may ever appear inside this callback (CONSISTENCY-MODEL.md §7): an
   * external call inside a transaction holds locks for the duration of somebody
   * else's outage.
   *
   * This callback is RE-ENTRANT. `withTransaction` re-runs it after a
   * `TransientTransactionError` such as a write conflict on the daily counter or
   * on a contested product, so every piece of state it touches is local to one
   * invocation and every read is repeated on each attempt.
   */
  private async commit(context: {
    command: PlaceOrderCommand;
    requestHash: string;
    profile: UserProfile;
    day: string;
    orderId: Types.ObjectId;
    session: ClientSession;
  }): Promise<PlacedOrder> {
    const { command, profile, orderId, session } = context;

    const claimed = await this.idempotency.reserve(
      {
        key: command.idempotencyKey,
        userId: command.userId,
        requestHash: context.requestHash,
        orderId,
      },
      session,
    );

    if (!claimed) {
      throw new DuplicateCheckoutError();
    }

    // AUTHORITATIVE, and inside the transaction. This is the same resolution the
    // cart endpoint performs — same clamping, same status ladder, same live
    // prices — so checkout can never disagree with what the customer was shown
    // for any reason other than time passing.
    const cart = await this.carts.getCart(command.userId, session);

    if (cart.lines.length === 0) {
      throw AppException.cartEmpty();
    }

    CheckoutService.assertPurchasable(cart);

    /**
     * THE delivery address, resolved INSIDE the transaction and inside the
     * ownership filter.
     *
     * Two properties come from doing it here rather than in the controller:
     *
     *  - **Ownership cannot be bypassed.** The query names `userId` AND
     *    `addressId`, so a foreign address is never selected. It answers the
     *    same 404 as an id that exists nowhere, and it reaches no order.
     *  - **The snapshot is consistent with the commit.** The read joins the
     *    same session and therefore the same snapshot as the cart read, the
     *    stock decrement and the order insert, so an address edit racing this
     *    placement either lands entirely before it or entirely after it.
     */
    const address = await this.addresses.findOwnedForCheckout(
      command.userId,
      command.addressId,
      session,
    );

    const items = cart.lines.map((line) => CheckoutService.toOrderItem(line));
    const itemsSubtotal = items.reduce((total, item) => total + item.lineTotal, 0);

    // No coupon domain exists, so the discount is 0 — because nothing real can
    // compute one, not because the formula omits it. Shipping is no longer a
    // literal: `FulfilmentService` is the one authority for what delivery costs
    // (BUSINESS-RULES.md RULE-PRICE-009), and it reads the governorate off the
    // address the customer actually chose.
    const discountTotal = 0;
    const pricing = computeOrderPricing(
      itemsSubtotal,
      discountTotal,
      await this.fulfilment.quote(address.governorate, itemsSubtotal - discountTotal),
    );

    const orderNumber = await this.counters.next(context.day, session);

    // THE overselling guard. Each decrement carries its own availability
    // precondition, and the first refusal throws — which aborts everything above
    // it, including the decrements already applied to earlier lines.
    await this.inventory.commitSale(
      {
        lines: items.map((item) => ({
          productId: item.productId,
          sku: item.sku,
          quantity: item.quantity,
        })),
        orderId,
        reason: `Order ${orderNumber}`,
        actor: { id: profile._id, role: profile.role, name: profile.fullName },
      },
      session,
    );

    const order = CheckoutService.buildOrder({
      orderId,
      orderNumber,
      command,
      profile,
      shippingAddress: toSnapshot(address),
      items,
      pricing,
      currency: cart.currency,
    });

    await this.orders.insert(order, session);

    // LAST. The cart is emptied only once the order it produced is durably part
    // of this transaction, so "cart cleared, no order" cannot exist.
    await this.carts.clearInTransaction(command.userId, session);

    return order;
  }

  // --- idempotency resolution -----------------------------------------------

  /**
   * Returns the order a previous request created for this key.
   *
   * Two refusals, both answering with the SAME code so the header cannot be used
   * to probe for other people's keys:
   *
   *  - **Another account owns the key.** Checked against the record, before any
   *    order is loaded, so a stolen key never reaches an order document.
   *  - **The same account, a materially different request.** Replaying a key
   *    with a new delivery address is a client bug; answering it with the first
   *    order would ship goods to an address the customer did not ask for.
   */
  private async replay(
    record: IdempotencyKeyLean,
    command: PlaceOrderCommand,
    requestHash: string,
  ): Promise<PlacedOrder> {
    if (!record.userId.equals(command.userId) || record.requestHash !== requestHash) {
      throw AppException.idempotencyKeyReused();
    }

    const order = await this.orders.findByIdForUser(record.orderId, command.userId);

    if (order === null) {
      // The record committed, so its order committed with it. Reaching here
      // means something removed an order out of band, which no code path does.
      throw AppException.concurrentModification();
    }

    return order;
  }

  /**
   * Resolves a key our transaction lost the race for.
   *
   * The duplicate-key error proves a COMMITTED record exists: an aborted
   * transaction's writes are never visible, so a conflict with an uncommitted
   * writer surfaces as a `WriteConflict` the driver retries, not as a duplicate.
   *
   * The second lookup covers the one gap the first cannot: an
   * `idempotencyKeys` record that reached its 24-hour TTL while its order lives
   * on, because `orders.idempotencyKey` is unique forever. The request hash is
   * unavailable there, so ownership is all that can be checked — which is enough
   * to keep the order from crossing accounts.
   */
  private async resolveContested(
    command: PlaceOrderCommand,
    requestHash: string,
  ): Promise<PlacedOrder> {
    const record = await this.idempotency.findByKey(command.idempotencyKey);

    if (record !== null) {
      return this.replay(record, command, requestHash);
    }

    const order = await this.orders.findByIdempotencyKey(command.idempotencyKey);

    if (order !== null) {
      if (!order.userId.equals(command.userId)) {
        throw AppException.idempotencyKeyReused();
      }

      return order;
    }

    // Defensive. A duplicate key with nothing behind it should be unreachable;
    // telling the client to retry is the only safe answer, and it is safe
    // because a retry with the same key still cannot create a second order.
    throw AppException.concurrentModification();
  }

  // --- pure helpers ---------------------------------------------------------

  /**
   * Refuses a cart that contains a line the customer cannot actually buy.
   *
   * Blocking lines are NOT silently dropped. A customer who checks out with four
   * items must not receive three without being told; CART-MODEL.md §5 keeps such
   * lines visible and flagged precisely so the reason is never hidden.
   *
   * The first blocking line decides the error, and the ladder in `resolveLine`
   * already ordered the statuses by severity, so the customer is told the most
   * blocking thing first.
   */
  private static assertPurchasable(cart: CartView): void {
    const blocked = cart.lines.find((line) => BLOCKING.has(line.status));

    if (blocked === undefined) {
      return;
    }

    throw blocked.status === CartLineStatus.OUT_OF_STOCK
      ? AppException.outOfStock(blocked.sku, blocked.availableQuantity)
      : AppException.productUnavailable();
  }

  /**
   * Freezes one cart line into an order line.
   *
   * `effectiveQuantity` — the stored intent clamped to live stock — is what gets
   * ordered, which is the frozen behaviour for a `REDUCED_STOCK` line: checkout
   * proceeds at the clamped quantity rather than failing outright. It can only
   * ever reduce what is asked for, so it cannot cause an oversell; the guarded
   * decrement is what enforces that.
   *
   * `unitPrice` is the LIVE price, never the cart snapshot. A price change does
   * not block checkout (CART-MODEL.md §5); the order records what the server
   * charged, and the quote the client just fetched is how the customer sees it
   * first.
   */
  private static toOrderItem(line: CartLineView): OrderItem & { productId: Types.ObjectId } {
    return {
      productId: line.productId,
      sku: line.sku,
      slug: line.slug,
      name: { en: line.name.en, ar: line.name.ar ?? null },
      brandName: line.brandName,
      imagePublicId: line.imagePublicId,
      unitPrice: line.unitPrice,
      quantity: line.effectiveQuantity,
      lineTotal: lineTotal(line.unitPrice, line.effectiveQuantity),
    };
  }

  /**
   * Assembles the order document.
   *
   * Every value here is either server-computed or a server-read snapshot. The
   * only client-supplied content is the customer note; the delivery address is a
   * copy of a stored record the server resolved by id, and neither participates
   * in any total.
   *
   * `status` and `payment.status` are constants, not parameters: no request DTO
   * in the system carries a status field, so there is nothing for a client to
   * submit and nothing for this method to defend against.
   */
  private static buildOrder(context: {
    orderId: Types.ObjectId;
    orderNumber: string;
    command: PlaceOrderCommand;
    profile: UserProfile;
    shippingAddress: ShippingAddressInput;
    items: readonly OrderItem[];
    pricing: OrderPricing;
    currency: string;
  }): PlacedOrder {
    const placedAt = new Date();

    return {
      /**
       * The id was generated BEFORE the transaction opened and is already
       * recorded on the idempotency claim. Letting Mongoose mint a different one
       * here would leave that claim pointing at a document that does not exist,
       * so every replay would fail to find the order it just created.
       */
      _id: context.orderId,
      orderNumber: context.orderNumber,
      userId: context.command.userId,
      status: INITIAL_ORDER_STATUS,
      customer: {
        fullName: context.profile.fullName,
        email: context.profile.email,
        phone: context.profile.phone,
      },
      items: [...context.items],
      currency: context.currency,
      pricing: {
        itemsSubtotal: context.pricing.itemsSubtotal,
        discountTotal: context.pricing.discountTotal,
        shippingFee: context.pricing.shippingFee,
        shippingPriced: context.pricing.shippingPriced,
        grandTotal: context.pricing.grandTotal,
        vatInclusive: VAT_INCLUSIVE,
        vatRateBps: VAT_RATE_BPS,
      },
      payment: {
        method: PaymentMethod.COD,
        status: INITIAL_PAYMENT_STATUS,
        collectedAt: null,
        refundedAmount: null,
        refundNote: null,
      },
      /**
       * A COPY, not a reference. There is no `addressId` on the order, by
       * design: the customer may rename, edit or delete the saved address
       * tomorrow, and an invoice must still say where these goods were sent.
       * Storing the id as well would invite a client to dereference it and
       * would create a second, divergeable answer to "where did this go".
       */
      shippingAddress: { ...context.shippingAddress },
      coupon: null,
      shipment: null,
      cancellation: null,
      statusHistory: [
        {
          from: null,
          to: INITIAL_ORDER_STATUS,
          actor: {
            id: context.profile._id,
            role: context.profile.role,
            name: context.profile.fullName,
          },
          note: null,
          at: placedAt,
        },
      ],
      customerNote: context.command.customerNote,
      adminNote: null,
      idempotencyKey: context.command.idempotencyKey,
      placedAt,
    };
  }

  /**
   * A stable fingerprint of the CHECKOUT INPUTS, used to detect a key replayed
   * for a different request.
   *
   * Field order is fixed by construction rather than by object literal order, so
   * a client that reorders its JSON still hashes to the same value — the
   * question is "did they ask for the same thing", not "did they serialise it
   * the same way".
   *
   * The cart is deliberately NOT part of the fingerprint. It is server state,
   * not a request input, and including it would break the exact case this
   * exists to serve: a client retrying after a timeout, whose original request
   * already emptied the cart.
   *
   * Neither are the address CONTENTS, only its id. The fingerprint answers "did
   * they ask for the same thing", and the request is `{addressId, customerNote}`
   * — the two fields that exist on the wire. A customer who edits the address
   * between a placement and its retry gets the order the first attempt created,
   * which is what an idempotency key means; the alternative would turn a
   * successful order into a 409 because something on the server changed.
   */
  private static fingerprint(command: PlaceOrderCommand): string {
    return createHash('sha256')
      .update(JSON.stringify([command.addressId.toHexString(), command.customerNote]))
      .digest('hex');
  }

  /**
   * The quote is computed by the SAME expressions placement uses — the pricing
   * function and `FulfilmentService` — so the only thing that can make the two
   * disagree is time passing, never a second implementation drifting.
   */
  private async toQuote(cart: CartView, governorate: string | null): Promise<CheckoutQuote> {
    const discountTotal = 0;
    const pricing = computeOrderPricing(
      cart.itemsSubtotal,
      discountTotal,
      await this.fulfilment.quote(governorate, cart.itemsSubtotal - discountTotal),
    );

    return {
      lines: cart.lines,
      itemCount: cart.itemCount,
      totalQuantity: cart.totalQuantity,
      currency: cart.currency,
      pricing,
      vatInclusive: VAT_INCLUSIVE,
      vatRateBps: VAT_RATE_BPS,
      hasBlockingIssues: cart.hasBlockingIssues,
      // The one derived flag the client must not compute for itself: an empty
      // cart and a cart with a delisted line are different reasons for the same
      // disabled button, and the server owns both rules.
      canPlaceOrder: cart.lines.length > 0 && !cart.hasBlockingIssues,
      generatedAt: new Date(),
    };
  }
}
