import { ApiProperty } from '@nestjs/swagger';
import type { Locale } from '../../../../common/localization/locale';
import { Role } from '../../../users/infrastructure/schemas/user.schema';
import type { PlacedOrder } from '../../application/checkout.service';
import { OrderStatus } from '../../domain/order-status';
import { allowedTransitions } from '../../domain/order-transitions';
import { adminActionFor } from '../admin-order-actions';
import { OrderDto } from './order-response.dto';

/**
 * WHO performed a transition.
 *
 * Authority: ORDER-LIFECYCLE.md §9 (status history); AUDIT-MODEL.md.
 *
 * ## Why this is admin-only and not on `OrderDto`
 *
 * The order document has always carried this — `statusHistory[].actor` is
 * written from the TOKEN inside the same atomic update as the status change, so
 * the trail is unforgeable (the legacy defect F-MED-5 was that `changed_by`
 * arrived in the request body and was never verified). It was simply never
 * serialised by anything, so no client could read it.
 *
 * It is exposed HERE rather than on the canonical `OrderDto`, because a
 * customer must be able to see that the shop cancelled their order without
 * learning which member of staff did it. `OrderCancellationDto.by` gives them
 * the ROLE and nothing more; this gives an operator the person.
 */
export class OrderHistoryActorDto {
  @ApiProperty({
    example: '652f1a9b3c4d5e6f7a8b9c0d',
    nullable: true,
    type: String,
    description:
      'The acting account. `null` only for a history entry written before an actor was ' +
      'recorded — no live code path can produce one.',
  })
  id!: string | null;

  @ApiProperty({
    enum: Role,
    example: Role.ADMIN,
    description: 'The role held at the moment of the action, snapshotted.',
  })
  role!: Role;

  @ApiProperty({
    example: 'Mina Kerolles',
    description:
      'The name AS IT WAS. Snapshotted rather than joined, so renaming an account never ' +
      'rewrites what the trail says happened.',
  })
  name!: string;
}

/**
 * One append-only entry in the order's business history.
 *
 * `from` is `null` on the placement entry, which is the only entry with no
 * predecessor. Everything else names both ends of the edge, so the whole
 * lifecycle can be replayed from this array alone.
 */
export class OrderStatusHistoryEntryDto {
  @ApiProperty({
    enum: OrderStatus,
    nullable: true,
    example: OrderStatus.PLACED,
    description: 'The status left behind. `null` on the placement entry only.',
  })
  from!: OrderStatus | null;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.CONFIRMED })
  to!: OrderStatus;

  @ApiProperty({ type: OrderHistoryActorDto })
  actor!: OrderHistoryActorDto;

  @ApiProperty({
    example: 'Customer confirmed by phone.',
    nullable: true,
    type: String,
    description: 'The note or reason supplied with the transition. Internal.',
  })
  note!: string | null;

  @ApiProperty({ example: '2026-08-31T09:14:02.000Z', format: 'date-time' })
  at!: string;
}

/**
 * ONE move an operator may make on this order right now.
 *
 * It carries the endpoint, not only the destination, because the destination
 * alone is not actionable: `-> SHIPPED` is `ship` from `CONFIRMED` and
 * `retry-shipment` from `DELIVERY_FAILED`, with different mandatory fields. See
 * `admin-order-actions.ts` for the table and why it is keyed by edge.
 */
export class AdminOrderTransitionDto {
  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.CONFIRMED,
    description: 'The status this move would put the order in.',
  })
  to!: OrderStatus;

  @ApiProperty({
    example: 'confirm',
    nullable: true,
    type: String,
    description:
      'The path segment to `POST /admin/orders/{id}/{action}`. **`null` means the transition is ' +
      'legal but this API exposes no staff route for it** — cancellation is the customer’s own ' +
      'operation. Render such a move as unavailable rather than as a button.',
  })
  action!: string | null;

  @ApiProperty({
    isArray: true,
    type: String,
    example: ['carrier', 'trackingNumber'],
    description:
      'Body fields this edge REQUIRES. Empty when the endpoint needs nothing beyond an optional ' +
      'note. Collect these before enabling the action; sending the request without them is a 400.',
  })
  requires!: string[];
}

/**
 * An order as STAFF see it: the canonical order, plus the two things only an
 * operator needs.
 *
 * ## `allowedTransitions` exists so the console has no state machine of its own
 *
 * The admin app used to hold its own `VALID_ORDER_TRANSITIONS` map and render
 * its buttons from it. Two state machines that must agree eventually disagree,
 * and the one in the browser is the one that cannot be enforced — which is
 * exactly how legacy ended up with rules the database did not know about
 * (F-CRIT-1). This field is computed by `allowedTransitions`, which calls the
 * same `checkTransition` the engine calls before it writes, so the buttons a
 * console draws and the requests the server will accept cannot drift.
 *
 * It is a statement about THIS order at THIS moment for a STAFF actor. It is
 * not a permission grant: the API still evaluates the matrix on every request,
 * and an operator who fabricates a transition that is not in this list gets the
 * same `409 INVALID_STATE_TRANSITION` as anybody else.
 *
 * ## `statusHistory` exists so a money-path action is attributable
 *
 * Confirming, shipping and delivering an order move goods and collect cash. An
 * operator looking at an order must be able to see who moved it and when,
 * without asking somebody to read the database.
 */
export class AdminOrderDto extends OrderDto {
  @ApiProperty({
    type: [AdminOrderTransitionDto],
    description:
      'Every move a staff actor may make on this order right now, from the server’s own ' +
      'transition matrix, each with the endpoint that performs it. Render the available actions ' +
      'from THIS — never from a copy of the matrix held in the client. Empty for a terminal ' +
      'order, which is the complete answer and not a missing one.',
  })
  allowedTransitions!: AdminOrderTransitionDto[];

  @ApiProperty({
    type: [OrderStatusHistoryEntryDto],
    description:
      'Every status change this order has been through, oldest first, each with the member of ' +
      'staff who made it. Append-only and written inside the same transaction as the status ' +
      'change, so an entry cannot be missing from a transition that took effect.',
  })
  statusHistory!: OrderStatusHistoryEntryDto[];

  static override from(order: PlacedOrder, locale: Locale): AdminOrderDto {
    return {
      ...OrderDto.from(order, locale),
      /*
       * ADMIN, not the caller's own role. Every edge in the matrix is
       * admin-drivable, and SUPER_ADMIN drives exactly the same set (§5), so
       * the two staff roles get one answer — and passing the caller's role
       * would invite a future CUSTOMER-shaped reading of a staff-only response.
       */
      allowedTransitions: allowedTransitions(order.status, Role.ADMIN).map((to) => {
        const move = adminActionFor(order.status, to);

        return {
          to,
          // `undefined` cannot occur for a legal edge — the coverage test in
          // `admin-order-transitions.spec.ts` forbids it — and reporting an
          // absent entry as "no route" is the safe reading if one ever slips
          // through: an operator sees a move they cannot make, rather than a
          // button that posts to a URL which does not exist.
          action: move?.action ?? null,
          requires: [...(move?.requires ?? [])],
        };
      }),
      statusHistory: order.statusHistory.map((entry) => ({
        from: entry.from,
        to: entry.to,
        actor: {
          id: entry.actor.id?.toHexString() ?? null,
          role: entry.actor.role,
          name: entry.actor.name,
        },
        note: entry.note,
        at: entry.at.toISOString(),
      })),
    };
  }
}

/** The single-resource envelope for every staff order operation. */
export class AdminOrderResponseDto {
  @ApiProperty({ type: AdminOrderDto })
  data!: AdminOrderDto;
}
