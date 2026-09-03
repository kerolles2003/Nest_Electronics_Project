/**
 * The API's wire types, as this console consumes them.
 *
 * Hand-written against `docs/api/openapi.v1.json` rather than generated,
 * matching what the storefront does. Only what the admin actually reads is
 * declared — a type nobody uses is a type nobody notices going stale.
 *
 * Everything here is the SERVED contract. Nothing invents a field.
 */

/** The single-resource envelope every endpoint answers with. */
export interface Envelope<T> {
  data: T;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PagedEnvelope<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Money {
  /** Minor units. The integer the server computed; never re-derive from it. */
  amount: number;
  currency: string;
  /** Pre-formatted for display, e.g. "325.00 EGP". */
  formatted: string;
}

export type Role = 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';

/** `GET /auth/me`. The only source of the operator's identity. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

/**
 * The order lifecycle. SEVEN values, and a client must handle all of them.
 *
 * This is the API's vocabulary, which is not the legacy Supabase one. There is
 * no `pending_payment`, no `paid`, no `processing`, and no separate fulfilment
 * axis — legacy carried three independent status columns with 210 combinations
 * and no cross-field validation, and live data already contained incoherent
 * states. One fulfilment axis, plus payment on its own.
 */
export type OrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'CANCELLED'
  | 'RETURNED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED';

export interface OrderPayment {
  method: 'COD';
  status: PaymentStatus;
  collectedAt: string | null;
}

export interface PricingBreakdown {
  itemsSubtotal: Money;
  discountTotal: Money;
  shippingFee: Money;
  /** False when no rate was supplied — which is NOT the same as free delivery. */
  shippingPriced: boolean;
  grandTotal: Money;
  vatInclusive: boolean;
  vatRateBps: number;
}

/** One row of the work queue. Deliberately smaller than the full order. */
export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  payment: OrderPayment;
  pricing: PricingBreakdown;
  itemCount: number;
  totalQuantity: number;
  previewImagePublicId: string | null;
  placedAt: string;
}

export interface OrderItem {
  productId: string;
  sku: string;
  slug: string;
  name: string;
  brandName: string | null;
  imagePublicId: string | null;
  unitPrice: Money;
  quantity: number;
  lineTotal: Money;
}

export interface OrderCustomer {
  fullName: string;
  email: string;
  phone: string | null;
}

export interface OrderShippingAddress {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  postalCode: string | null;
}

export interface OrderShipment {
  carrier: string;
  trackingNumber: string;
  shippedAt: string;
  deliveredAt: string | null;
  deliveryAttempts: number;
}

export interface OrderCancellation {
  reason: string;
  /** The ROLE that cancelled, not the person. */
  by: Role;
  at: string;
}

/** Who performed a transition. From the token, never from a request body. */
export interface OrderHistoryActor {
  id: string | null;
  role: Role;
  /** The name AS IT WAS. A later rename does not rewrite the trail. */
  name: string;
}

export interface OrderStatusHistoryEntry {
  from: OrderStatus | null;
  to: OrderStatus;
  actor: OrderHistoryActor;
  note: string | null;
  at: string;
}

/**
 * ONE move an operator may make on this order right now.
 *
 * **This is the console's only state machine.** There is no transition map in
 * this application: the API computes these with the same function its engine
 * calls before it writes, so what the UI offers and what the server accepts
 * cannot drift. `action` is `null` for a move that is legal but has no staff
 * route — cancellation is the customer's own operation — and such a move is
 * shown as unavailable rather than as a button.
 */
export interface AdminOrderTransition {
  to: OrderStatus;
  action: string | null;
  /** Body fields this edge REQUIRES. Collect them before enabling the action. */
  requires: string[];
}

/** The full order, as staff see it. */
export interface AdminOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customer: OrderCustomer;
  items: OrderItem[];
  currency: string;
  pricing: PricingBreakdown;
  payment: OrderPayment;
  shippingAddress: OrderShippingAddress;
  customerNote: string | null;
  cancellation: OrderCancellation | null;
  shipment: OrderShipment | null;
  placedAt: string;
  allowedTransitions: AdminOrderTransition[];
  statusHistory: OrderStatusHistoryEntry[];
}
