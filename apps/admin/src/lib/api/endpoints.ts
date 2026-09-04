import 'server-only';

import { apiFetch } from './client';
import type {
  AdminCustomerSummary,
  AdminDashboardStats,
  AdminOrder,
  AdminShippingRate,
  AdjustmentResult,
  AdjustmentType,
  AdminCategory,
  AuthUser,
  DashboardWindowKey,
  Envelope,
  InventoryEvent,
  OrderQueueStats,
  OrderStatus,
  OrderSummary,
  PagedEnvelope,
  ReconciliationReport,
  SessionTokens,
  StockLevel,
} from './types';

/**
 * The API surface this console uses, one function per endpoint.
 *
 * Every signature matches the SERVED contract. Nothing here invents a
 * parameter, and nothing sends a field the API does not accept — with
 * `forbidNonWhitelisted` on globally, an extra key is a `400 UNKNOWN_FIELD`.
 *
 * Note what is ABSENT from every lifecycle call below: any actor field. There
 * is no `adminId`, no `changedBy`, no `actor`. The API derives the operator
 * from the TOKEN and writes it into the order's history itself, which is what
 * makes the trail unforgeable — legacy accepted `changed_by` from the caller
 * and never verified it.
 *
 * There is also no `status` field anywhere. Each edge of the state machine is
 * its own endpoint carrying exactly that edge's required input, so "ship"
 * cannot be called without a carrier and a tracking number.
 */

// --- auth -------------------------------------------------------------------

/** The tokens sit at the TOP of `data`, alongside `user` — they are not nested. */
export function login(input: {
  email: string;
  password: string;
}): Promise<Envelope<SessionTokens & { user: AuthUser }>> {
  return apiFetch('/auth/login', { method: 'POST', body: input, auth: false });
}

/**
 * Revokes ONE refresh token, server-side.
 *
 * This is what makes signing out real. Clearing the cookies ends the session in
 * this browser and leaves a working 30-day credential in the wild.
 */
export function logout(refreshToken: string): Promise<Envelope<{ message: string }>> {
  return apiFetch('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false });
}

/**
 * WHO is signed in, according to the server.
 *
 * The only source of the operator's identity and role. Nothing in this console
 * decodes a token, and nothing trusts a role read anywhere else — a claim read
 * client-side is a request, not an authorisation.
 */
export function currentUser(): Promise<Envelope<AuthUser>> {
  return apiFetch('/auth/me');
}

// --- the order work queue ---------------------------------------------------

/**
 * Every order in the system, newest first.
 *
 * `status` is repeatable and matches ANY of the given values, so one request
 * backs a filter tab. Ordering is `placedAt` descending with the order id as a
 * tie-breaker, so paging is stable and a row cannot appear on two pages or on
 * none.
 */
export type OrderQueueSort = 'newest' | 'oldest' | 'total_high' | 'total_low';

export interface OrderQueueParams {
  page?: number;
  limit?: number;
  status?: readonly OrderStatus[];
  /** Order number, customer name, email or phone. */
  q?: string;
  /** `YYYY-MM-DD` or a full ISO timestamp. A bare date bounds the whole day. */
  placedFrom?: string;
  placedTo?: string;
  sort?: OrderQueueSort;
}

export function listOrders(params: OrderQueueParams = {}): Promise<PagedEnvelope<OrderSummary>> {
  const query = new URLSearchParams();

  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  // Repeated key, not a comma-joined string: the DTO reads `?status=A&status=B`
  // and a joined value would be one unrecognised enum member and a 400.
  for (const status of params.status ?? []) query.append('status', status);

  /*
   * Empty strings are DROPPED rather than sent.
   *
   * A cleared search box submits `q=`, and the API treats a blank term as "no
   * filter" — so sending it is harmless but it puts `?q=` in the URL, which
   * makes a cleared filter look like an active one in the address bar and in
   * the back button's history. The same for the date inputs, which submit ''
   * when empty.
   */
  if (params.q !== undefined && params.q.trim() !== '') query.set('q', params.q.trim());
  if (params.placedFrom) query.set('placedFrom', params.placedFrom);
  if (params.placedTo) query.set('placedTo', params.placedTo);
  if (params.sort !== undefined && params.sort !== 'newest') query.set('sort', params.sort);

  const suffix = query.toString();

  return apiFetch(`/admin/orders${suffix === '' ? '' : `?${suffix}`}`);
}

/**
 * Every status and its count, in ONE request.
 *
 * Replaces seven `limit=1` requests whose totals were read off `meta.total`.
 * Those were seven real numbers, but taken at seven different instants — so an
 * order confirmed midway through could be counted twice or not at all, and the
 * tiles would not add up to the total beside them.
 */
export function orderQueueStats(): Promise<Envelope<OrderQueueStats>> {
  return apiFetch('/admin/orders/stats');
}

/** One order in full, with `allowedTransitions` and `statusHistory`. */
export function getOrder(id: string): Promise<Envelope<AdminOrder>> {
  return apiFetch(`/admin/orders/${id}`);
}

// --- the six lifecycle actions ---------------------------------------------

/**
 * Each of these returns the UPDATED order, in the same shape `getOrder` does —
 * `allowedTransitions` and `statusHistory` included. That is what lets a screen
 * apply the response directly instead of reloading.
 *
 * A refusal is NOT an error to swallow. `409 INVALID_STATE_TRANSITION` means
 * the order is not in a status this operation can move it from, including
 * repeating one that already succeeded. Retrying never succeeds.
 */

export function confirmOrder(id: string, note?: string): Promise<Envelope<AdminOrder>> {
  return apiFetch(`/admin/orders/${id}/confirm`, { method: 'POST', body: noted(note) });
}

export function shipOrder(
  id: string,
  input: { carrier: string; trackingNumber: string; note?: string },
): Promise<Envelope<AdminOrder>> {
  return apiFetch(`/admin/orders/${id}/ship`, {
    method: 'POST',
    body: { carrier: input.carrier, trackingNumber: input.trackingNumber, ...noted(input.note) },
  });
}

export function deliverOrder(id: string, note?: string): Promise<Envelope<AdminOrder>> {
  return apiFetch(`/admin/orders/${id}/deliver`, { method: 'POST', body: noted(note) });
}

/** `reason` is required and is recorded on the status history entry. */
export function failDelivery(id: string, reason: string): Promise<Envelope<AdminOrder>> {
  return apiFetch(`/admin/orders/${id}/delivery-failed`, { method: 'POST', body: { reason } });
}

/**
 * Re-dispatch. `carrier` and `trackingNumber` are OPTIONAL here and only here —
 * the order already has a shipment, so omitting them re-sends with the current
 * carrier.
 */
export function retryShipment(
  id: string,
  input: { carrier?: string; trackingNumber?: string; note?: string } = {},
): Promise<Envelope<AdminOrder>> {
  return apiFetch(`/admin/orders/${id}/retry-shipment`, {
    method: 'POST',
    body: {
      ...(input.carrier !== undefined && input.carrier !== '' ? { carrier: input.carrier } : {}),
      ...(input.trackingNumber !== undefined && input.trackingNumber !== ''
        ? { trackingNumber: input.trackingNumber }
        : {}),
      ...noted(input.note),
    },
  });
}

/** Restores stock, in one transaction with the status change. `reason` required. */
export function returnOrder(id: string, reason: string): Promise<Envelope<AdminOrder>> {
  return apiFetch(`/admin/orders/${id}/return`, { method: 'POST', body: { reason } });
}

/**
 * An optional note, or nothing at all.
 *
 * `{ note: undefined }` would serialise to `{}` anyway, but `{ note: '' }`
 * would not — it would reach the API as an empty string and be recorded as a
 * blank note on the history entry. Omitting is the honest encoding of "the
 * operator typed nothing".
 */
function noted(note: string | undefined): { note?: string } {
  const trimmed = note?.trim() ?? '';

  return trimmed === '' ? {} : { note: trimmed };
}

/** Is a catalogue slug free? Fails closed — see the route that calls it. */
export function checkSlugAvailability(params: {
  type: string;
  slug: string;
  excludeId?: string;
}): Promise<Envelope<{ slug: string; available: boolean; suggestion: string | null }>> {
  const query = new URLSearchParams({ type: params.type, slug: params.slug });

  if (params.excludeId !== undefined) query.set('excludeId', params.excludeId);

  return apiFetch(`/admin/catalog/slug-availability?${query.toString()}`);
}

// --- dashboard aggregates ---------------------------------------------------

/**
 * Single aggregated statistics endpoint for the admin dashboard.
 *
 * Revenue is recognized at DELIVERY (where payment.status = PAID),
 * and pipeline value is tracked alongside.
 *
 * The order figures are bounded by a trailing window — 30 days unless one is
 * asked for. Omitting the parameter takes the server's default rather than
 * restating it here: a default written in two places is a default that drifts.
 * The window that was actually applied comes back in `data.window`, and its
 * `label` is what the screen prints.
 */
export function dashboardStats(
  params: { window?: DashboardWindowKey } = {},
): Promise<Envelope<AdminDashboardStats>> {
  const suffix = params.window === undefined ? '' : `?window=${params.window}`;

  return apiFetch(`/admin/dashboard/stats${suffix}`);
}

// --- customers --------------------------------------------------------------

export interface CustomerListParams {
  page?: number;
  limit?: number;
  q?: string;
}

export function listCustomers(
  params: CustomerListParams = {},
): Promise<PagedEnvelope<AdminCustomerSummary>> {
  const query = new URLSearchParams();

  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.q !== undefined && params.q.trim() !== '') query.set('q', params.q.trim());

  const suffix = query.toString();
  return apiFetch(`/admin/customers${suffix === '' ? '' : `?${suffix}`}`);
}

export function getCustomer(id: string): Promise<Envelope<AdminCustomerSummary>> {
  return apiFetch(`/admin/customers/${id}`);
}

// --- catalogue taxonomy -----------------------------------------------------

/**
 * Every category, flat and shallowest-first, INCLUDING inactive ones.
 *
 * Flat is what the API returns and what a filter dropdown wants; each row
 * carries its own `parentId`, `path` and `depth`, so any shape can be assembled
 * without a second request. Soft-deleted ones are excluded unless asked for —
 * a filter listing deleted categories offers a choice that matches nothing.
 */
export function listAdminCategories(
  params: { includeDeleted?: boolean } = {},
): Promise<Envelope<AdminCategory[]>> {
  const suffix = params.includeDeleted === true ? '?includeDeleted=true' : '';

  return apiFetch(`/admin/catalog/categories${suffix}`);
}

// --- inventory --------------------------------------------------------------

export interface StockLevelParams {
  page?: number;
  limit?: number;
  q?: string;
  lowStock?: boolean;
  outOfStock?: boolean;
  /** A category SUBTREE, by id. Not a slug — the API filters on `category.path`. */
  categoryId?: string;
  includeInactive?: boolean;
}

/**
 * Stock levels, scarcest first.
 *
 * The ordering is the server's and is deliberate: the list exists to be acted
 * on, so what runs out next is at the top. There is no sort parameter, which is
 * why this console does not offer one.
 *
 * Note what is NOT here: no brand filter, and no reserved/available columns.
 * The API's stock is a single `onHand` — reservation is not part of the model —
 * so a console showing "Reserved: 0" beside every row would be inventing a
 * concept the system does not have.
 */
export function listStockLevels(params: StockLevelParams = {}): Promise<PagedEnvelope<StockLevel>> {
  const query = new URLSearchParams();

  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.q !== undefined && params.q.trim() !== '') query.set('q', params.q.trim());
  if (params.lowStock === true) query.set('lowStock', 'true');
  if (params.outOfStock === true) query.set('outOfStock', 'true');
  if (params.categoryId !== undefined && params.categoryId !== '') {
    query.set('categoryId', params.categoryId);
  }
  if (params.includeInactive === true) query.set('includeInactive', 'true');

  const suffix = query.toString();
  return apiFetch(`/admin/inventory${suffix === '' ? '' : `?${suffix}`}`);
}

/** One product's movement history, newest first. */
export function stockHistory(
  productId: string,
  params: { page?: number; limit?: number } = {},
): Promise<PagedEnvelope<InventoryEvent>> {
  const query = new URLSearchParams();

  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));

  const suffix = query.toString();
  return apiFetch(`/admin/inventory/${productId}/events${suffix === '' ? '' : `?${suffix}`}`);
}

/**
 * Moves stock by a SIGNED delta and writes the ledger entry, in one transaction.
 *
 * A delta, not a target. An absolute value would silently overwrite a
 * concurrent sale; a delta composes with one. That semantic is preserved from
 * `adjust_stock_v2`, which was well designed and never once ran successfully.
 */
export function adjustStock(
  productId: string,
  body: { delta: number; reason: string; type: AdjustmentType },
): Promise<Envelope<AdjustmentResult>> {
  return apiFetch(`/admin/inventory/${productId}/adjust`, { method: 'POST', body });
}

/** Does `Σ quantityDelta` still equal `stock.onHand` for every product? */
export function inventoryReconciliation(): Promise<Envelope<ReconciliationReport>> {
  return apiFetch('/admin/inventory/reconciliation');
}

// --- shipping rates ---------------------------------------------------------

export function listShippingRates(): Promise<Envelope<AdminShippingRate[]>> {
  return apiFetch('/admin/shipping-rates');
}

export function getShippingRate(governorate: string): Promise<Envelope<AdminShippingRate>> {
  return apiFetch(`/admin/shipping-rates/${governorate}`);
}

export function updateShippingRate(
  governorate: string,
  fee: number,
): Promise<Envelope<AdminShippingRate>> {
  return apiFetch(`/admin/shipping-rates/${governorate}`, {
    method: 'PATCH',
    body: { fee },
  });
}

