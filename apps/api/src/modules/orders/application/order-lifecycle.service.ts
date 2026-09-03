import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { AppException } from '../../../common/errors/app.exception';
import { TransactionService } from '../../../database/transaction.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { InventoryEventType } from '../../inventory/infrastructure/schemas/inventory-event.schema';
import { UsersService } from '../../users/application/users.service';
import { Role } from '../../users/infrastructure/schemas/user.schema';
import { OrderStatus, PaymentStatus } from '../domain/order-status';
import { checkTransition, RESTORES_STOCK } from '../domain/order-transitions';
import { OrderRepository } from '../infrastructure/repositories/order.repository';
import type {
  OrderLean,
  OrderShipment,
  OrderStatusHistoryEntry,
} from '../infrastructure/schemas/order.schema';

/** Who is driving the transition. Always resolved from the token, never from a body. */
export interface TransitionActor {
  readonly id: Types.ObjectId;
  readonly role: Role;
  /** Snapshotted into history, so a later rename does not rewrite the trail. */
  readonly name: string;
}

export interface TransitionCommand {
  readonly orderId: Types.ObjectId;
  readonly to: OrderStatus;
  readonly actor: TransitionActor;
  /**
   * Restricts the order lookup AND the guarded update to this owner.
   *
   * Present for a customer operation, absent for an admin one. It is not an
   * authorization check performed after loading - it is part of both queries,
   * so a foreign order is never selected in the first place.
   */
  readonly ownerId?: Types.ObjectId;
  /** Required by transitions that record one (cancellation, return). */
  readonly reason?: string;
  /** Free-text note for the history entry. */
  readonly note?: string | null;
  /**
   * Dispatch details. REQUIRED to enter `SHIPPED` for the first time
   * (ORDER-LIFECYCLE.md §8 makes carrier and tracking a precondition of the
   * state); optional on a re-dispatch after a failed delivery (T7), where
   * omitting them keeps the existing shipment and only refreshes `shippedAt`.
   */
  readonly shipment?: {
    readonly carrier?: string | undefined;
    readonly trackingNumber?: string | undefined;
  };
}

/**
 * What a target status implies beyond the status itself.
 *
 * Computed in ONE place, from the frozen side-effect table (§5), so no endpoint
 * can dispatch an order without tracking or mark one delivered without
 * collecting the cash. A controller supplies inputs; it never decides what a
 * transition means.
 */
interface TransitionEffects {
  readonly shipment?: OrderShipment;
  readonly set?: Record<string, unknown>;
  readonly inc?: Record<string, number>;
}

/** One staff lifecycle action, as the admin controller supplies it. */
export interface StaffTransitionCommand {
  /** The signed-in staff principal. Resolved to a profile, never trusted as a name. */
  readonly actorId: Types.ObjectId;
  readonly orderId: Types.ObjectId;
  readonly to: OrderStatus;
  /**
   * Forensic context for the audit record, from the request.
   *
   * Required rather than optional, deliberately. An admin status transition is
   * listed under AUDIT-MODEL.md §3 as audited, and an optional context is one
   * an inattentive call site omits — at which point the action is silently
   * unaudited, which is the exact failure §2 documents.
   */
  readonly context: AuditContext;
  readonly reason?: string;
  readonly note?: string | null;
  readonly shipment?: {
    readonly carrier?: string | undefined;
    readonly trackingNumber?: string | undefined;
  };
}

/**
 * The matrix refused the edge.
 *
 * A typed domain error rather than an `AppException`, because the right HTTP
 * answer depends on what the CALLER was trying to do: a customer refused the
 * `-> CANCELLED` edge gets `ORDER_NOT_CANCELLABLE`, while a future admin
 * operation refused `SHIPPED -> PLACED` needs a different code. The engine
 * states the fact; the public operation phrases it.
 */
export class IllegalOrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`illegal order transition ${from} -> ${to}`);
    this.name = 'IllegalOrderTransitionError';
  }
}

/**
 * THE order state machine. Every status change in the system passes through
 * `transition`, and nothing else writes `orders.status`.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §5 (matrix), §6 (enforcement),
 *            §9 (status history), §11 (inventory effects);
 *            CONSISTENCY-MODEL.md §7 (transaction concerns).
 *
 * ## Why one engine and one public operation per actor
 *
 * `transition` is generic over the target status, the actor and the ownership
 * scope. `cancelForCustomer` and `transitionByStaff` are the only two public
 * operations, and NEITHER contains a rule: one supplies an ownership scope and
 * phrases a refusal as `ORDER_NOT_CANCELLABLE`, the other omits the scope and
 * phrases it as `INVALID_STATE_TRANSITION`. The matrix, the guarded update, the
 * history append, the side-effect table and the stock restoration exist once.
 * Six admin endpoints and one customer endpoint share them.
 *
 * There is deliberately no generic `PATCH /orders/:id` and no `updateStatus`
 * that takes a status from a request body. Legacy's transition matrix lived in
 * the admin app while the RPC beneath it was callable by `anon`, which made the
 * whole state machine advisory (F-CRIT-1 / F-HIGH-1).
 */
@Injectable()
export class OrderLifecycleService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly orders: OrderRepository,
    private readonly inventory: InventoryService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cancels one of the CALLER'S OWN orders. The only customer-driven transition.
   *
   * Authority: ORDER-LIFECYCLE.md §5 T2/T4 - permitted only while `PLACED` or
   * `CONFIRMED`, i.e. before the goods leave the warehouse; §13 - a customer may
   * cancel only their own order, and a foreign one answers `404`.
   *
   * ## Repeating this request is SAFE but not silent
   *
   * A second cancellation of the same order returns `409 ORDER_NOT_CANCELLABLE`,
   * not `200`. That is the frozen contract (T12: a no-op transition is
   * rejected; T13: `CANCELLED` is terminal), and it is the honest answer - a
   * client that receives 200 twice cannot tell whether it cancelled once or
   * twice. What the guarantee actually protects is the SIDE EFFECTS: stock is
   * restored exactly once and exactly one `CANCELLATION` ledger entry exists per
   * line, no matter how many times the request arrives or how many arrive at
   * once. Placement needs an `Idempotency-Key` because a retry could otherwise
   * create a SECOND order; cancellation needs none, because the order's own
   * status is the natural idempotency token and the guarded update consumes it.
   */
  async cancelForCustomer(
    userId: Types.ObjectId,
    orderId: Types.ObjectId,
    reason: string,
  ): Promise<OrderLean> {
    // Resolved OUTSIDE the transaction, exactly as placement does: `users` is
    // not part of this order's consistency boundary, and this is also the check
    // that a valid token for a soft-deleted account performs no writes.
    const profile = await this.users.findById(userId);

    if (profile === null) {
      throw AppException.accountDisabled();
    }

    try {
      return await this.transition({
        orderId,
        to: OrderStatus.CANCELLED,
        actor: { id: profile._id, role: profile.role, name: profile.fullName },
        ownerId: userId,
        reason,
      });
    } catch (error) {
      if (error instanceof IllegalOrderTransitionError) {
        // `from` is the order's CURRENT status, which the customer owns and
        // could read anyway - so echoing it discloses nothing and saves the
        // client a round trip to re-render.
        throw AppException.orderNotCancellable(error.from);
      }

      throw error;
    }
  }

  /**
   * Drives ONE staff lifecycle operation. The entry point for every admin
   * action: confirm, ship, deliver, delivery-failed, retry, return.
   *
   * Authority: ORDER-LIFECYCLE.md §5 (T1, T3, T5-T9), §13 (access rules).
   *
   * It is a THIN wrapper on `transition` and deliberately contains no rules of
   * its own — no status graph, no side-effect table, no ownership logic. Its
   * whole job is to resolve the actor from the token and to phrase a refusal in
   * staff terms. Six endpoints call it with six different `to` values; there is
   * still exactly one state machine.
   *
   * ## No ownership scope, on purpose
   *
   * `ownerId` is omitted, so the guarded update matches on `{_id, status}` and
   * not on `userId`. Staff act on ANY customer's order — that is the operation.
   * Reusing the customer's ownership filter here would make every admin action
   * silently fail against orders the admin does not own, which is every order.
   *
   * The ROLE comes from the database profile rather than the JWT claim: a role
   * downgraded since the token was issued must not still be able to ship goods,
   * and the matrix is evaluated against the role that is true now.
   */
  async transitionByStaff(command: StaffTransitionCommand): Promise<OrderLean> {
    const profile = await this.users.findById(command.actorId);

    if (profile === null) {
      throw AppException.accountDisabled();
    }

    try {
      const updated = await this.transition({
        orderId: command.orderId,
        to: command.to,
        actor: { id: profile._id, role: profile.role, name: profile.fullName },
        ...(command.reason !== undefined ? { reason: command.reason } : {}),
        ...(command.note !== undefined ? { note: command.note } : {}),
        ...(command.shipment !== undefined ? { shipment: command.shipment } : {}),
      });

      /*
       * POST-COMMIT, and outside the transaction on purpose.
       *
       * AUDIT-MODEL.md §5 rule 2: an audit write must never roll back a
       * successful business operation. A delivered order is more important than
       * its audit line, so `record` cannot throw and this cannot fail the
       * transition.
       *
       * This is the SECOND record of the same event, and that is the point.
       * `statusHistory` is business history — customer-visible, embedded,
       * answering *what happened to this order* (§6.1). This answers *who did
       * it and were they allowed to* (§1), which is a different question with a
       * different audience and a different retention. Phase 6 recorded only the
       * first and concluded the second was covered; it was not, and every
       * intervention between then and now is unaudited.
       */
      const latest = updated.statusHistory[updated.statusHistory.length - 1];

      await this.audit.record({
        actor: {
          id: profile._id,
          role: profile.role,
          name: profile.fullName,
          email: profile.email,
        },
        action: AuditAction.ORDER_STATUS_CHANGED,
        entity: {
          type: AuditEntityType.ORDER,
          id: updated._id,
          // The order NUMBER, not the id: §4 wants a label the log reads
          // without joins, and nobody recognises an ObjectId.
          label: updated.orderNumber,
        },
        changes: {
          before: { status: latest?.from ?? null },
          after: { status: updated.status },
        },
        metadata: {
          ...(command.note !== undefined && command.note !== null ? { note: command.note } : {}),
          ...(command.reason !== undefined ? { reason: command.reason } : {}),
        },
        context: command.context,
      });

      return updated;
    } catch (error) {
      if (error instanceof IllegalOrderTransitionError) {
        throw AppException.invalidStateTransition(error.from, error.to);
      }

      throw error;
    }
  }

  /**
   * Moves one order to `to`, with every consequence, atomically.
   *
   * ## What is inside the transaction, and why in this order
   *
   *  1. **Load the order in the session.** The status validated below and the
   *     status the guarded update matches on come from the same snapshot.
   *  2. **Validate the edge and the actor** against the frozen matrix.
   *  3. **Guarded update: status + history + cancellation, in ONE write.** This
   *     is the mutual-exclusion point. It runs BEFORE any stock moves, so a
   *     concurrent loser has nothing to undo, and an order whose status changed
   *     without a history entry is not representable.
   *  4. **Restore stock and write the ledger**, only for the transitions that
   *     return goods (§11).
   *
   * Every step shares one `ClientSession`. If step 4 throws - a unique-index
   * violation on the ledger, a write conflict, anything - step 3 is rolled back
   * with it, so an order can never be left `CANCELLED` with its stock still
   * committed, nor stock restored against an order that is not cancelled.
   *
   * The callback is RE-ENTRANT: `withTransaction` re-runs it after a transient
   * write conflict, so every read is repeated and no state survives an attempt.
   *
   * No email, no HTTP, no external I/O may ever appear in here
   * (CONSISTENCY-MODEL.md §7). Notifications belong after the commit.
   */
  async transition(command: TransitionCommand): Promise<OrderLean> {
    if (command.to === OrderStatus.CANCELLED && (command.reason?.trim() ?? '') === '') {
      // A CALLER error, not a client one — the customer-facing DTO already
      // requires `reason`, so reaching this means a future admin operation
      // omitted it. Refusing before the session opens is what keeps
      // "status CANCELLED with no cancellation record" unrepresentable, which
      // the schema's own contract promises.
      throw AppException.internal();
    }

    return this.transactions.run(async (session) => this.apply(command, session));
  }

  // --- the transaction ------------------------------------------------------

  private async apply(command: TransitionCommand, session: ClientSession): Promise<OrderLean> {
    const order = await this.orders.findForTransition(command.orderId, session, command.ownerId);

    if (order === null) {
      // Missing, or owned by somebody else - the same answer for both, because
      // it is the same code path. A 403 would confirm the id exists.
      throw AppException.orderNotFound();
    }

    const from = order.status;
    const refusal = checkTransition(from, command.to, command.actor.role);

    if (refusal === 'ILLEGAL') {
      throw new IllegalOrderTransitionError(from, command.to);
    }

    if (refusal === 'FORBIDDEN_ACTOR') {
      throw AppException.forbidden();
    }

    const at = new Date();
    const historyEntry: OrderStatusHistoryEntry = {
      from,
      to: command.to,
      // From the token, never from the request. Legacy accepted `changed_by`
      // from the caller and never verified it, so the trail was forgeable
      // (F-MED-5).
      actor: { id: command.actor.id, role: command.actor.role, name: command.actor.name },
      note: command.note ?? null,
      at,
    };

    const effects = OrderLifecycleService.effectsFor(command, order, at);

    const updated = await this.orders.applyTransition(
      {
        orderId: command.orderId,
        expectedStatus: from,
        to: command.to,
        historyEntry,
        ...(command.to === OrderStatus.CANCELLED && command.reason !== undefined
          ? {
              cancellation: {
                reason: command.reason,
                // The ROLE, not the identity: a customer may see that an admin
                // cancelled their order without learning which admin.
                by: command.actor.role,
                at,
              },
            }
          : {}),
        ...effects,
        ...(command.ownerId !== undefined ? { ownerId: command.ownerId } : {}),
      },
      session,
    );

    if (updated === null) {
      // The status moved between our read and our write. The document exists -
      // we just read it - so this is a race, not a 404, and retrying is the
      // correct client response.
      throw AppException.concurrentModification();
    }

    if (RESTORES_STOCK.has(command.to)) {
      await this.inventory.restoreStock(
        {
          // The ORDER's own quantities, not a request field and not a re-read
          // of the cart. What was taken out is exactly what goes back.
          lines: order.items.map((item) => ({
            productId: item.productId,
            sku: item.sku,
            quantity: item.quantity,
          })),
          orderId: order._id,
          reason: `${command.to === OrderStatus.CANCELLED ? 'Cancelled' : 'Returned'} order ${order.orderNumber}`,
          actor: { id: command.actor.id, role: command.actor.role, name: command.actor.name },
          type:
            command.to === OrderStatus.CANCELLED
              ? InventoryEventType.CANCELLATION
              : InventoryEventType.RETURN,
        },
        session,
      );
    }

    return updated;
  }

  // --- side effects ---------------------------------------------------------

  /**
   * The frozen side-effect table (§5), in one pure function.
   *
   * Every entry here is a rule the business already agreed; none of it is
   * reachable from a request body. A controller passes a carrier and a tracking
   * number, and this decides what entering `SHIPPED` actually MEANS.
   */
  private static effectsFor(
    command: TransitionCommand,
    order: OrderLean,
    at: Date,
  ): TransitionEffects {
    switch (command.to) {
      case OrderStatus.SHIPPED:
        return OrderLifecycleService.shippingEffects(command, order, at);

      case OrderStatus.DELIVERED:
        // ADR-ORDER-002: DELIVERED IMPLIES PAID. Under COD the courier does not
        // hand over goods without collecting, so delivery IS the payment event.
        // Setting both in this one update is what makes "delivered but unpaid"
        // — a combination that existed in live legacy data — unrepresentable.
        return {
          set: {
            'payment.status': PaymentStatus.PAID,
            'payment.collectedAt': at,
            ...(order.shipment !== null ? { 'shipment.deliveredAt': at } : {}),
          },
        };

      case OrderStatus.DELIVERY_FAILED:
        // T6. The reason for THIS attempt is on the matching history entry;
        // the counter is what the courier workflow acts on.
        return order.shipment !== null ? { inc: { 'shipment.deliveryAttempts': 1 } } : {};

      default:
        // CONFIRMED, CANCELLED and RETURNED touch no shipment or payment field.
        // Cancellation writes its own record above; RETURNED records its reason
        // on the history entry and its stock movement in the ledger.
        return {};
    }
  }

  /**
   * Entering `SHIPPED`, which happens two ways.
   *
   * FIRST DISPATCH (`CONFIRMED -> SHIPPED`) builds the whole sub-document, and
   * carrier plus tracking are mandatory — §8 makes them a precondition of the
   * state rather than an optional decoration, which is the fix for the legacy
   * defect where shipping WITH a tracking number was impossible (F-CRIT-4).
   *
   * RE-DISPATCH (`DELIVERY_FAILED -> SHIPPED`, T7) keeps the existing shipment
   * and refreshes `shippedAt`, applying a new carrier or tracking number only
   * if one was supplied. `deliveryAttempts` is deliberately NOT reset: it counts
   * what the courier actually attempted, and zeroing it would erase the reason
   * this order is being sent out again.
   */
  private static shippingEffects(
    command: TransitionCommand,
    order: OrderLean,
    at: Date,
  ): TransitionEffects {
    if (order.shipment === null) {
      const carrier = command.shipment?.carrier?.trim() ?? '';
      const trackingNumber = command.shipment?.trackingNumber?.trim() ?? '';

      if (carrier === '' || trackingNumber === '') {
        // A CALLER error: the ship DTO makes both required, so reaching this
        // means a future caller skipped them. Refusing keeps a shipped order
        // without tracking unrepresentable.
        throw AppException.internal();
      }

      return {
        shipment: { carrier, trackingNumber, shippedAt: at, deliveredAt: null, deliveryAttempts: 0 },
      };
    }

    const carrier = command.shipment?.carrier?.trim();
    const trackingNumber = command.shipment?.trackingNumber?.trim();

    return {
      set: {
        'shipment.shippedAt': at,
        // A re-dispatch after a failed delivery is a fresh attempt at delivery,
        // so any previous outcome must not linger.
        'shipment.deliveredAt': null,
        ...(carrier !== undefined && carrier !== '' ? { 'shipment.carrier': carrier } : {}),
        ...(trackingNumber !== undefined && trackingNumber !== ''
          ? { 'shipment.trackingNumber': trackingNumber }
          : {}),
      },
    };
  }
}
