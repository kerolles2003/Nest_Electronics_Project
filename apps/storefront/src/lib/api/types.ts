/**
 * Response types for the NestJS API, transcribed from the SERVED OpenAPI
 * document (`/api/v1/docs-json`), not invented.
 *
 * Two contract rules from `API-CONTRACT.md` §1 shape everything here:
 *
 *  - **Optional fields are `null`, never omitted.** So every property below is
 *    REQUIRED and nullable where a value may be absent. A field is only marked
 *    `?` when the server genuinely omits the key.
 *  - **Money is never a number.** It is `{ amount, currency, formatted }` where
 *    `amount` is an integer in minor units. The client never does money
 *    arithmetic — every total shown comes from the server.
 */

/** Integer minor units plus a display string. Never parse `formatted`. */
export interface Money {
  amount: number;
  currency: string;
  formatted: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// --- auth -------------------------------------------------------------------

export type Role = 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** The access token lives 15 minutes; the refresh token rotates on every use. */
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

// --- catalogue --------------------------------------------------------------

export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
}

export interface ProductPricing {
  basePrice: Money;
  salePrice: Money | null;
  effectivePrice: Money;
  discountPercent: number | null;
}

export interface ProductImage {
  publicId: string;
  alt: string | null;
}

export interface ProductListItem {
  id: string;
  slug: string;
  sku: string;
  name: string;
  shortDescription: string | null;
  category: CategoryRef;
  brand: { id: string; slug: string; name: string } | null;
  pricing: ProductPricing;
  primaryImage: ProductImage | null;
  rating: { average: number; count: number };
  availability: Availability;
  isFeatured: boolean;
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  images: ProductImage[];
  specs: { key: string; label: string; value: string }[];
  stockQuantity: number;
}

// --- cart -------------------------------------------------------------------

export type CartLineStatus =
  | 'OK'
  | 'PRICE_CHANGED'
  | 'REDUCED_STOCK'
  | 'OUT_OF_STOCK'
  | 'UNAVAILABLE';

export interface CartLine {
  productId: string;
  sku: string;
  slug: string;
  name: string;
  imagePublicId: string | null;
  quantity: number;
  effectiveQuantity: number;
  availableQuantity: number;
  unitPrice: Money;
  previousUnitPrice: Money;
  lineTotal: Money;
  status: CartLineStatus;
}

export interface Cart {
  items: CartLine[];
  itemCount: number;
  totalQuantity: number;
  itemsSubtotal: Money;
  currency: string;
  hasBlockingIssues: boolean;
  updatedAt: string;
  expiresAt: string | null;
}

// --- addresses --------------------------------------------------------------

export interface Address {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  postalCode: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Exactly the fields `POST /users/me/addresses` accepts. Nothing else. */
export interface AddressInput {
  label: string;
  fullName: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  postalCode?: string | null;
  isDefault?: boolean;
}

// --- checkout ---------------------------------------------------------------

/**
 * The authoritative money breakdown. Every figure is server-computed.
 *
 * `shippingFee` is quoted from the chosen address's governorate and the
 * post-discount subtotal. It is `0` under the current configuration — render
 * that as "shipping not yet calculated", NOT as a free-shipping promotion.
 */
export interface PricingBreakdown {
  itemsSubtotal: Money;
  discountTotal: Money;
  shippingFee: Money;
  grandTotal: Money;
  vatInclusive: boolean;
  vatRateBps: number;
}

export interface CheckoutQuote {
  items: CartLine[];
  itemCount: number;
  totalQuantity: number;
  currency: string;
  pricing: PricingBreakdown;
  hasBlockingIssues: boolean;
  /** THE flag for the place-order button. Never compute this on the client. */
  canPlaceOrder: boolean;
  generatedAt: string;
}

// --- orders -----------------------------------------------------------------

export type OrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'CANCELLED'
  | 'RETURNED';

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

/**
 * The delivery address AS FROZEN ON THE ORDER.
 *
 * This is a snapshot, not a reference to the customer's address book. It does
 * not change when the saved address is edited or deleted, and it carries no
 * `id` — never try to match it back to a current address.
 */
export interface OrderShippingAddress {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  postalCode: string | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customer: { fullName: string; email: string; phone: string | null };
  items: OrderItem[];
  currency: string;
  pricing: PricingBreakdown;
  payment: {
    method: string;
    status: 'PENDING' | 'PAID' | 'REFUNDED';
    collectedAt: string | null;
  };
  shippingAddress: OrderShippingAddress;
  customerNote: string | null;
  cancellation: { reason: string | null; cancelledAt: string } | null;
  shipment: { carrier: string; trackingNumber: string; shippedAt: string } | null;
  placedAt: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  payment: { method: string; status: string; collectedAt: string | null };
  pricing: PricingBreakdown;
  itemCount: number;
  totalQuantity: number;
  previewImagePublicId: string | null;
  placedAt: string;
}

// --- envelopes --------------------------------------------------------------

export interface Envelope<T> {
  data: T;
}

export interface PagedEnvelope<T> {
  data: T[];
  meta: PaginationMeta;
}
