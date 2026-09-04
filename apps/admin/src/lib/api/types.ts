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

/**
 * The queue tiles, from `GET /admin/orders/stats`.
 *
 * Every lifecycle status is present, including the ones nothing is in — the API
 * fills those with `0` rather than omitting them, so the console can tell "no
 * cancelled orders" from "the count could not be read". Those are different
 * sentences and only one of them is a fact.
 */
export interface OrderQueueStats {
  readonly byStatus: readonly { readonly status: OrderStatus; readonly count: number }[];
  readonly total: number;
}

// --- dashboard aggregates ---------------------------------------------------

export interface DashboardRevenue {
  delivered: Money;
  deliveredCount: number;
  pipeline: Money;
  pipelineCount: number;
}

export interface DashboardOrders {
  total: number;
  byStatus: readonly { readonly status: OrderStatus; readonly count: number }[];
}

export interface DashboardLowStockItem {
  id: string;
  name: string;
  slug: string;
  sku: string;
  onHand: number;
  lowStockThreshold: number;
}

export interface DashboardProducts {
  total: number;
  lowStockCount: number;
  outOfStockCount: number;
  lowStock: DashboardLowStockItem[];
}

export interface DashboardCustomers {
  total: number;
  newThisWeek: number;
  /** Customers who ordered INSIDE the window — not "have ever ordered". */
  withOrdersCount: number;
}

/** The windows the dashboard endpoint offers. A closed set, not a date range. */
export const DASHBOARD_WINDOWS = ['30d', '90d', 'all'] as const;

export type DashboardWindowKey = (typeof DASHBOARD_WINDOWS)[number];

/**
 * The period the order figures cover, as the SERVER reports it.
 *
 * `label` is printed verbatim and never re-derived here. A console that formats
 * its own "last 30 days" beside a figure the server computed over 90 is a lie
 * no test catches, and the caption is the only thing that makes a windowed
 * number honest.
 */
export interface DashboardWindow {
  key: DashboardWindowKey;
  days: number | null;
  label: string;
  since: string | null;
}

export interface AdminDashboardStats {
  window: DashboardWindow;
  revenue: DashboardRevenue;
  orders: DashboardOrders;
  products: DashboardProducts;
  customers: DashboardCustomers;
}

// --- customers --------------------------------------------------------------

export interface AdminCustomerSummary {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  emailVerifiedAt: string | null;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
  formattedTotalSpent: string;
  lastOrderAt: string | null;
}

// --- audit trail ------------------------------------------------------------

/**
 * One recorded administrative action.
 *
 * The actor is a SNAPSHOT, not a reference: the record has to stay readable
 * after the account is deleted or renamed, which is exactly when an
 * investigation wants it. So there is no id to follow for a name — the name and
 * email are what they were at the time.
 */
export interface AuditLogEntry {
  id: string;
  action: string;
  actor: { id: string; role: string; name: string; email: string };
  entity: { type: string; id: string; label: string };
  /** Only the fields that moved, never whole documents. */
  changes: { before: Record<string, unknown>; after: Record<string, unknown> } | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  /** Correlates with the API's request log line. */
  requestId: string;
  createdAt: string;
}

export interface AuditLogParams {
  page?: number;
  limit?: number;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

// --- catalogue taxonomy -----------------------------------------------------

export interface AdminLocalizedText {
  en: string;
  ar: string | null;
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: AdminLocalizedText;
  description: AdminLocalizedText | null;
  parentId: string | null;
  /** Ancestor ids, root first, EXCLUDING self. */
  path: string[];
  depth: number;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBrand {
  id: string;
  slug: string;
  name: AdminLocalizedText;
  description: AdminLocalizedText | null;
  website: string | null;
  isActive: boolean;
  productCount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a category write accepts.
 *
 * `path` and `depth` are absent because they are COMPUTED from `parentId`. A
 * caller-supplied ancestor chain is one that can disagree with the parent, and
 * every subtree query would then answer from the disagreement.
 */
export interface CreateCategoryBody {
  slug: string;
  name: { en: string; ar?: string | null };
  description?: { en: string; ar?: string | null } | null;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export type UpdateCategoryBody = Partial<CreateCategoryBody>;

export interface CreateBrandBody {
  slug: string;
  name: { en: string; ar?: string | null };
  description?: { en: string; ar?: string | null } | null;
  website?: string | null;
  isActive?: boolean;
}

export type UpdateBrandBody = Partial<CreateBrandBody>;

// --- catalogue products -----------------------------------------------------

/**
 * The three states CATALOG-MODEL.md §9 defines.
 *
 * Absent from a query, the API includes drafts and EXCLUDES soft-deleted rows:
 * a draft is work in progress and is what the screen is for, while a deleted
 * product mixed into the working list is how somebody edits a row no customer
 * can reach and does not notice for a week.
 */
export const PRODUCT_STATES = ['published', 'draft', 'deleted'] as const;

export type AdminProductState = (typeof PRODUCT_STATES)[number];

export const PRODUCT_SORTS = [
  'newest',
  'oldest',
  'name_asc',
  'price_asc',
  'price_desc',
  'stock_asc',
  'updated',
] as const;

export type AdminProductSort = (typeof PRODUCT_SORTS)[number];

export interface AdminSnapshotRef {
  id: string;
  slug: string;
  name: AdminLocalizedText;
}

export interface AdminProductSpec {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  filterable: boolean;
  sortOrder: number;
}

export interface AdminProductImage {
  publicId: string;
  version: number;
  format: string;
  width: number;
  height: number;
  bytes: number;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

/**
 * Money as INTEGER minor units, not a formatted string.
 *
 * The public DTO formats money for display; an editor round-trips it. Passing a
 * value through a display format and back is where a currency symbol, a
 * thousands separator or a rounding rule gets its chance to change the number.
 */
export interface AdminProductPricing {
  basePrice: number;
  salePrice: number | null;
  /** MAINTAINED as `salePrice ?? basePrice`. The write endpoints reject it. */
  effectivePrice: number;
  /** ADMIN ONLY — absent from every public DTO by construction. */
  costPrice: number | null;
}

export interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  name: AdminLocalizedText;
  shortDescription: AdminLocalizedText | null;
  description: AdminLocalizedText | null;
  category: AdminSnapshotRef;
  brand: AdminSnapshotRef | null;
  pricing: AdminProductPricing;
  currency: string;
  /** READ-ONLY here. Stock moves only through the inventory endpoints. */
  stock: { onHand: number; lowStockThreshold: number };
  images: AdminProductImage[];
  specs: AdminProductSpec[];
  ratingAverage: number;
  ratingCount: number;
  salesCount: number;
  isActive: boolean;
  isFeatured: boolean;
  deletedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Grams. */
  weight: number | null;
  /** Millimetres. */
  dimensions: { length: number; width: number; height: number } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a create accepts.
 *
 * Note the absences, each of which is the feature: no `stock` (InventoryModule
 * is the sole writer, and a product write that could set it is legacy defect M7
 * exactly), no `images` (attaching is reference-counted and has its own
 * endpoint), no `effectivePrice` (maintained), no `currency` (there is one).
 * Sending any of them is a 400 UNKNOWN_FIELD rather than a silently ignored
 * key.
 */
export interface CreateProductBody {
  sku: string;
  slug: string;
  name: { en: string; ar?: string | null };
  shortDescription?: { en: string; ar?: string | null } | null;
  description?: { en: string; ar?: string | null } | null;
  categoryId: string;
  brandId?: string | null;
  basePrice: number;
  salePrice?: number | null;
  costPrice?: number | null;
  specs?: AdminProductSpecInput[];
  seo?: { title?: string | null; description?: string | null } | null;
  weight?: number | null;
  dimensions?: { length: number; width: number; height: number } | null;
  isActive?: boolean;
  isFeatured?: boolean;
}

export interface AdminProductSpecInput {
  key: string;
  label: string;
  value: string;
  unit?: string | null;
  filterable?: boolean;
  sortOrder?: number;
}

/**
 * What an edit accepts. `sku` is absent because it is IMMUTABLE after creation:
 * it is the warehouse identifier, printed on labels and quoted to suppliers.
 * `isActive` is absent because publishing is its own separately audited action.
 */
export type UpdateProductBody = Omit<CreateProductBody, 'sku' | 'isActive'>;

export interface HardDeleteResult {
  sku: string;
  slug: string;
  imagesDestroyed: string[];
  imagesKept: string[];
}

export interface SlugAvailability {
  slug: string;
  available: boolean;
  suggestion: string | null;
}

// --- media ------------------------------------------------------------------

export interface MediaAsset {
  /**
   * Provider-relative. There is NO `url` here and there never will be: storing
   * a rendered URL turns a CDN change into a data migration. Build the delivery
   * URL from this and `version` — `lib/images.ts` does it in one place.
   */
  publicId: string;
  version: number;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

// --- inventory --------------------------------------------------------------

/**
 * Derived by the SERVER, never re-computed here.
 *
 * The legacy console worked out availability in five places and got five
 * answers. `onHand <= lowStockThreshold` is a per-product rule — a reel of
 * resistors and an oscilloscope do not reorder at the same number — so a
 * console constant could not express it even if one were wanted.
 */
export type StockState = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface StockLevel {
  productId: string;
  sku: string;
  slug: string;
  name: string;
  onHand: number;
  lowStockThreshold: number;
  state: StockState;
  isActive: boolean;
  categoryName: string;
  /** ADMIN ONLY, minor units. `null` when unset. */
  costPrice: number | null;
}

/**
 * What an operator may post directly.
 *
 * `SALE`, `RETURN` and `CANCELLATION` are absent because they are consequences
 * of an order, written inside that order's transaction. They appear in HISTORY
 * — an operator reads them — but nothing here can write one.
 */
export const ADJUSTMENT_TYPES = ['RESTOCK', 'ADJUSTMENT', 'DAMAGE'] as const;

export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export interface InventoryEvent {
  /** The full frozen vocabulary, not only the three an operator can write. */
  type: string;
  /** SIGNED. Negative when stock left. */
  quantityDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  referenceId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface AdjustmentResult {
  productId: string;
  sku: string;
  balanceBefore: number;
  balanceAfter: number;
  state: StockState;
}

export interface ReconciliationDiscrepancy {
  productId: string;
  sku: string;
  onHand: number;
  ledgerSum: number;
  /** `onHand - ledgerSum`. Non-zero proves an out-of-band mutation. */
  difference: number;
}

export interface ReconciliationReport {
  checked: number;
  discrepancies: ReconciliationDiscrepancy[];
}

// --- shipping rates ---------------------------------------------------------

export interface AdminShippingRate {
  governorate: string;
  fee: number;
  formattedFee: string;
  updatedAt: string;
}

