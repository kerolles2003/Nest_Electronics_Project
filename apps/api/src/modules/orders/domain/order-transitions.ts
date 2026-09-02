import { Role } from '../../users/infrastructure/schemas/user.schema';
import { OrderStatus } from './order-status';

/**
 * THE transition matrix. The single authority on what may follow what.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §5 (transition matrix, T0-T14)
 *            and §6 (enforcement).
 *
 * This module is PURE: no Nest, no Mongoose, no HTTP status, no exception. It
 * answers "is this edge legal, for this actor" and nothing else, which is what
 * makes it callable from the customer cancellation path today and from an admin
 * status operation later without either one owning the rules.
 *
 * The legacy failure this replaces is precise: the transition matrix lived only
 * in the admin app's TypeScript, while the underlying RPC was callable by the
 * `anon` role. The rules were therefore advisory — anybody who skipped the UI
 * skipped the state machine (F-CRIT-1 / F-HIGH-1). Here the matrix is on the
 * server, and `OrderLifecycleService` is the only writer of `orders.status`.
 *
 * An empty array is a TERMINAL status, and terminality is expressed as "no
 * outgoing edges" rather than as a separate flag, so the two can never disagree.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    // T1, T2
    [OrderStatus.PLACED]: Object.freeze([OrderStatus.CONFIRMED, OrderStatus.CANCELLED]),
    // T3, T4
    [OrderStatus.CONFIRMED]: Object.freeze([OrderStatus.SHIPPED, OrderStatus.CANCELLED]),
    // T5, T6. Deliberately NOT CANCELLED (T10): the goods are with the courier,
    // and the honest path for a failed dispatch is DELIVERY_FAILED -> RETURNED.
    [OrderStatus.SHIPPED]: Object.freeze([OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED]),
    // T7 (re-dispatch), T8 (give up)
    [OrderStatus.DELIVERY_FAILED]: Object.freeze([OrderStatus.SHIPPED, OrderStatus.RETURNED]),
    // T9. Not CANCELLED (T11) — a delivered order that comes back is RETURNED.
    [OrderStatus.DELIVERED]: Object.freeze([OrderStatus.RETURNED]),
    // T13. Terminal. No resurrection, for anybody, ever.
    [OrderStatus.CANCELLED]: Object.freeze([]),
    [OrderStatus.RETURNED]: Object.freeze([]),
  });

/**
 * The edges a CUSTOMER may drive. Everything else in the matrix is admin-only.
 *
 * Authority: ORDER-LIFECYCLE.md §5 "Customer-initiated cancellation" and §13
 * (access rules) — a customer may cancel only while `PLACED` or `CONFIRMED`,
 * i.e. before the goods leave the warehouse.
 *
 * Encoded as edges rather than as a list of cancellable statuses so that this
 * set and `ORDER_TRANSITIONS` cannot drift: an edge a customer is permitted to
 * drive must ALSO be legal in the matrix, which `assertMatrixIsCoherent` below
 * checks at module load.
 */
const CUSTOMER_EDGES: ReadonlySet<string> = new Set([
  edgeKey(OrderStatus.PLACED, OrderStatus.CANCELLED),
  edgeKey(OrderStatus.CONFIRMED, OrderStatus.CANCELLED),
]);

/**
 * Statuses whose ENTRY returns goods to stock.
 *
 * Authority: ORDER-LIFECYCLE.md §11 (inventory effects) — `-> CANCELLED` and
 * `-> RETURNED` restore, every other transition leaves stock untouched.
 *
 * Derived from the TARGET status rather than from the edge, because what makes
 * stock come back is arriving in one of these states, not which state it came
 * from. That is also why `CONFIRMED -> CANCELLED` and `PLACED -> CANCELLED`
 * need no separate rule.
 */
export const RESTORES_STOCK: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.RETURNED,
]);

/** Why a transition was refused. Mapped to an HTTP error by the CALLER. */
export type TransitionRefusal =
  /** The matrix does not contain this edge — including a no-op and a terminal state. */
  | 'ILLEGAL'
  /** The edge is legal, but not for this actor's role. */
  | 'FORBIDDEN_ACTOR';

function edgeKey(from: OrderStatus, to: OrderStatus): string {
  return `${from}->${to}`;
}

/** Legal in the matrix, ignoring who is asking. */
export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** No outgoing edges. `CANCELLED` and `RETURNED` today. */
export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/**
 * THE gate. Returns `null` when the transition is allowed, or the reason it is
 * not.
 *
 * A refusal value rather than a thrown error, deliberately: this module must
 * not know that HTTP exists, and the two refusals map to DIFFERENT statuses
 * (409 for an illegal edge, 403 for the wrong actor) which only the caller can
 * decide how to phrase.
 *
 * The order of the two checks matters. Legality is evaluated FIRST, so a
 * customer asking for an admin-only edge from a state where that edge does not
 * exist is told the edge is illegal — a role-shaped answer would confirm which
 * transitions exist for other roles.
 */
export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  actorRole: Role,
): TransitionRefusal | null {
  if (!isLegalTransition(from, to)) {
    return 'ILLEGAL';
  }

  if (actorRole === Role.ADMIN || actorRole === Role.SUPER_ADMIN) {
    // Every edge in the matrix is admin-drivable (§5: actor `A` on T1-T9).
    return null;
  }

  return CUSTOMER_EDGES.has(edgeKey(from, to)) ? null : 'FORBIDDEN_ACTOR';
}

/** The statuses a customer may cancel FROM. Derived, never hand-maintained. */
export const CUSTOMER_CANCELLABLE_FROM: readonly OrderStatus[] = Object.values(OrderStatus).filter(
  (status) => checkTransition(status, OrderStatus.CANCELLED, Role.CUSTOMER) === null,
);

/**
 * A load-time coherence check on the matrix itself.
 *
 * Cheap, runs once, and catches the two ways a hand-written matrix rots: an
 * actor permitted to drive an edge the matrix does not contain, and a self-edge
 * (T12 — no-op transitions are rejected). Failing at boot is the right moment;
 * discovering it from a customer's cancelled order is not.
 */
function assertMatrixIsCoherent(): void {
  for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
    if (targets.includes(from as OrderStatus)) {
      throw new Error(`order transition matrix contains a no-op edge: ${from}`);
    }
  }

  for (const edge of CUSTOMER_EDGES) {
    const [from, to] = edge.split('->') as [OrderStatus, OrderStatus];

    if (!isLegalTransition(from, to)) {
      throw new Error(`customer edge ${edge} is not present in the transition matrix`);
    }
  }
}

assertMatrixIsCoherent();

/**
 * Every status this actor may move an order to FROM `from`, right now.
 *
 * Derived by asking `checkTransition` about each candidate rather than by
 * reading `ORDER_TRANSITIONS` directly, so the answer a client is given and the
 * answer the engine enforces come from the same function. A second list — one
 * for rendering buttons, one for refusing requests — is precisely the shape
 * that made legacy's state machine advisory: the admin app held the matrix, the
 * database held nothing, and the two could not be compared.
 *
 * The empty array is a complete answer, not a missing one: a terminal status
 * has no outgoing edges, and an actor with no permitted edges is told so.
 */
export function allowedTransitions(from: OrderStatus, actorRole: Role): readonly OrderStatus[] {
  return Object.values(OrderStatus).filter(
    (candidate) => checkTransition(from, candidate, actorRole) === null,
  );
}
