import 'server-only';

import { apiFetch } from './client';
import type {
  AdminOrder,
  AuthUser,
  Envelope,
  OrderStatus,
  OrderSummary,
  PagedEnvelope,
  SessionTokens,
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
export function listOrders(
  params: { page?: number; limit?: number; status?: readonly OrderStatus[] } = {},
): Promise<PagedEnvelope<OrderSummary>> {
  const query = new URLSearchParams();

  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  // Repeated key, not a comma-joined string: the DTO reads `?status=A&status=B`
  // and a joined value would be one unrecognised enum member and a 400.
  for (const status of params.status ?? []) query.append('status', status);

  const suffix = query.toString();

  return apiFetch(`/admin/orders${suffix === '' ? '' : `?${suffix}`}`);
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
