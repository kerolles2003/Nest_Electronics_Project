/**
 * The order lifecycle. ONE axis.
 *
 * Authority: docs/architecture/ORDER-LIFECYCLE.md §2.
 *
 * Legacy carried three independent status columns — 7 x 6 x 5 = 210
 * combinations with no cross-field validation anywhere — and live data already
 * contained incoherent states (orders `shipped` while payment was `pending`,
 * one `delivered` while fulfilment was `unfulfilled`). This is that collapsed to
 * a single fulfilment axis plus a separate payment axis below.
 *
 * The COMPLETE frozen set is declared here although checkout can only produce
 * `PLACED`. Two reasons, both about contracts rather than convenience:
 *
 *  1. A generated Dart enum is exhaustive. Adding a value later is a breaking
 *     change for a mobile client already installed on a real device, which is
 *     exactly what API-CONTRACT.md §8's "additive-only within v1" forbids.
 *  2. The persisted enum validator must already accept the value that the state
 *     machine will write, or introducing transitions becomes a data migration.
 *
 * Declaring the vocabulary is not implementing the machine: there is no
 * transition matrix in this phase, and no endpoint that can change a status.
 */
export enum OrderStatus {
  /** Submitted by the customer. Stock is already committed. */
  PLACED = 'PLACED',
  /** An admin verified it, typically by phone — the real COD business step. */
  CONFIRMED = 'CONFIRMED',
  SHIPPED = 'SHIPPED',
  /** Terminal. Under COD, delivery IS the payment event. */
  DELIVERED = 'DELIVERED',
  /** The courier attempted and failed. Retryable, or returned. */
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  /** Terminal. Cancelled before dispatch; stock restored. */
  CANCELLED = 'CANCELLED',
  /** Terminal. Goods came back; stock restored. */
  RETURNED = 'RETURNED',
}

/**
 * Payment, on its own axis.
 *
 * Authority: ORDER-LIFECYCLE.md §3. Every COD order is `PENDING` until the
 * courier collects cash, which under ADR-ORDER-002 happens atomically with the
 * transition to `DELIVERED`. That is what makes "delivered but unpaid"
 * structurally impossible rather than merely discouraged.
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  REFUNDED = 'REFUNDED',
}

/**
 * Cash on Delivery is the only method in the MVP, and the enum has one member
 * so a client renders the payment section from data rather than from an
 * assumption baked into its UI.
 */
export enum PaymentMethod {
  COD = 'COD',
}

/**
 * The status every checkout-created order starts in. Server-controlled: no DTO
 * in the system carries a status field, so there is nothing for a client to
 * submit.
 */
export const INITIAL_ORDER_STATUS = OrderStatus.PLACED;

/** Every COD order is unpaid at placement, by definition. */
export const INITIAL_PAYMENT_STATUS = PaymentStatus.PENDING;
