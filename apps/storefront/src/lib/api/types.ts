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

/**
 * A page of results WITH the facets computed over the same filtered set.
 *
 * Separate from `PagedEnvelope` because only `GET /products` returns facets,
 * and a shared type carrying an optional `facets` would let a caller reach for
 * one on an endpoint that never sends it.
 */
export interface FacetedPagedEnvelope<T> {
  data: T[];
  meta: PaginationMeta;
  facets: ProductFacets;
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
  /**
   * BASIS POINTS, not percent. `1500` is 15%.
   *
   * This was transcribed as `discountPercent` and the API has always sent
   * `discountPercentBps`, so anything reading it got `undefined`. Nothing did
   * — the `/shop` slice never showed a discount badge — which is exactly why
   * it survived: a wrong type costs nothing until the first reader.
   *
   * Basis points because a percentage of a price is money arithmetic, and
   * MONEY-MODEL.md keeps money in integers all the way down. Divide by 100 to
   * display.
   */
  discountPercentBps: number;
}

/**
 * A managed image — a provider-relative identifier, never a URL
 * (ADR-MEDIA-002). Build the delivery URL with `lib/images.ts`.
 *
 * `version` busts the CDN cache when an image is replaced; `width` and
 * `height` let a page reserve space before the bytes arrive, which is what
 * stops a product grid shifting as it loads. All four were missing from this
 * type and present on the wire.
 */
export interface ProductImage {
  publicId: string;
  version: number;
  format: string;
  width: number;
  height: number;
  alt: string | null;
}

export interface ProductSpec {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  filterable: boolean;
}

/** One value of one facet, with how many matches it would leave. */
export interface TermFacet {
  slug: string;
  name: string;
  count: number;
}

export interface SpecFacet {
  key: string;
  label: string;
  values: { value: string; count: number }[];
}

/**
 * Server-computed facets, over the FILTERED set.
 *
 * The counts describe what applying each value would leave, given the filters
 * already applied — so a facet showing `(0)` is a dead end the UI can grey out
 * instead of a promise it cannot keep. `priceRange` is the range across all
 * matches, not across the current page.
 */
export interface ProductFacets {
  categories: TermFacet[];
  brands: TermFacet[];
  priceRange: { min: Money; max: Money } | null;
  specs: SpecFacet[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  /** 0 for a root. The tree is not a fixed depth — do not assume two levels. */
  depth: number;
  image: ProductImage | null;
  /** SUBTREE count: a parent includes every descendant's products. */
  productCount: number;
  sortOrder: number;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export interface CategoryDetail extends Category {
  /** Ancestors, root first, EXCLUDING this category. */
  breadcrumb: Category[];
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo: ProductImage | null;
  website: string | null;
  productCount: number;
}

export interface ProductSuggestion {
  slug: string;
  name: string;
  sku: string;
  primaryImage: ProductImage | null;
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
  specs: ProductSpec[];
  /**
   * The API calls this `stockOnHand`. It was transcribed as `stockQuantity`,
   * which is a field the server has never sent.
   *
   * Prefer `availability` for anything a customer sees: the exact count is
   * operational detail, and showing "3 left" turns a stock figure into a
   * promise the next order may break.
   */
  stockOnHand: number;
  salesCount: number;
  weight: number | null;
  createdAt: string;
  updatedAt: string;
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
 * post-discount subtotal. **Never branch on its amount** — read
 * `shippingPriced`, which is the field that says whether the amount is a price
 * at all.
 */
export interface PricingBreakdown {
  itemsSubtotal: Money;
  discountTotal: Money;
  shippingFee: Money;
  /**
   * Whether `shippingFee` is a real price.
   *
   * `true` — the customer owes exactly that, INCLUDING when it is zero because
   * a free-shipping threshold was met. Show it as the fee, or as free.
   * `false` — no delivery rate has been supplied yet; the zero beside it is a
   * placeholder, and the honest thing to show is "not yet calculated".
   *
   * The distinction exists because `shippingFee === 0` cannot carry it: the
   * same zero means "free" and "unpriced", and reading it as "unpriced" — which
   * this app used to do — misreports every free-shipping order the moment real
   * rates land.
   */
  shippingPriced: boolean;
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
