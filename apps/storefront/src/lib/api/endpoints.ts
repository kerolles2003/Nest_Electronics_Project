import 'server-only';

import { apiFetch } from './client';
import type {
  Address,
  AddressInput,
  AuthUser,
  Cart,
  CheckoutQuote,
  Envelope,
  Order,
  OrderSummary,
  PagedEnvelope,
  ProductDetail,
  ProductListItem,
  SessionTokens,
} from './types';

/**
 * The API surface this storefront actually uses, one function per endpoint.
 *
 * Every signature matches the SERVED contract. Nothing here invents a
 * parameter, and nothing sends a field the API does not accept — with
 * `forbidNonWhitelisted` on globally, an extra key is a `400 UNKNOWN_FIELD`,
 * and that code is logged server-side as a security signal.
 *
 * Note what is ABSENT from every write below: `userId`, `shippingFee`,
 * `discount`, `grandTotal`, `currency`, `items`, prices. The server owns all of
 * them. The client cannot influence what it pays because the fields to do so do
 * not exist on the wire.
 */

// --- auth -------------------------------------------------------------------

/**
 * Creates the account. Deliberately returns NO session.
 *
 * The API requires the address to be verified before the account can sign in,
 * so there are no tokens to store and the client must show "check your email"
 * rather than navigating to a guarded route. Assuming a session here is exactly
 * the mistake this signature exists to prevent.
 */
export function register(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}): Promise<Envelope<{ message: string; emailVerificationRequired: boolean }>> {
  return apiFetch('/auth/register', { method: 'POST', body: input, auth: false });
}

/** The tokens sit at the TOP of `data`, alongside `user` — they are not nested. */
export function login(input: {
  email: string;
  password: string;
}): Promise<Envelope<SessionTokens & { user: AuthUser }>> {
  return apiFetch('/auth/login', { method: 'POST', body: input, auth: false });
}

export function logout(refreshToken: string): Promise<Envelope<{ message: string }>> {
  return apiFetch('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false });
}

export function currentUser(): Promise<Envelope<AuthUser>> {
  return apiFetch('/auth/me');
}

/**
 * Consumes the single-use token from the verification email.
 *
 * Public: the caller has no session yet — being unable to sign in is precisely
 * what this endpoint fixes. An expired token and an unknown one are reported
 * identically, so the UI must not try to tell them apart.
 */
export function verifyEmail(token: string): Promise<Envelope<{ message: string }>> {
  return apiFetch('/auth/verify-email', { method: 'POST', body: { token }, auth: false });
}

/**
 * Requests a fresh verification email.
 *
 * ALWAYS resolves 200, whether or not the address exists or is already
 * verified — anything else would make this a password-free account-existence
 * oracle. The UI must therefore show the same message either way.
 */
export function resendVerification(email: string): Promise<Envelope<{ message: string }>> {
  return apiFetch('/auth/resend-verification', { method: 'POST', body: { email }, auth: false });
}

// --- catalogue (public) -----------------------------------------------------

export function listProducts(params: {
  page?: number;
  limit?: number;
  q?: string;
  category?: string;
  sort?: string;
} = {}): Promise<PagedEnvelope<ProductListItem>> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }

  const qs = query.toString();

  // Catalogue reads are public and unauthenticated: sending a bearer token
  // would tie a cacheable public response to one customer for no benefit.
  return apiFetch(`/products${qs ? `?${qs}` : ''}`, { auth: false, revalidate: 60 });
}

export function getProduct(slug: string): Promise<Envelope<ProductDetail>> {
  return apiFetch(`/products/${encodeURIComponent(slug)}`, { auth: false, revalidate: 60 });
}

// --- cart -------------------------------------------------------------------

/**
 * The cart is SERVER state. There is no second authoritative cart in
 * localStorage or in a client store: quantities are clamped, prices are
 * re-read and line statuses are decided by the API on every call, so a local
 * copy would only ever be a stale opinion about somebody else's data.
 */
export function getCart(): Promise<Envelope<Cart>> {
  return apiFetch('/cart');
}

export function addCartItem(productId: string, quantity: number): Promise<Envelope<Cart>> {
  return apiFetch('/cart/items', { method: 'POST', body: { productId, quantity } });
}

export function updateCartItem(productId: string, quantity: number): Promise<Envelope<Cart>> {
  return apiFetch(`/cart/items/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: { quantity },
  });
}

export function removeCartItem(productId: string): Promise<Envelope<Cart>> {
  return apiFetch(`/cart/items/${encodeURIComponent(productId)}`, { method: 'DELETE' });
}

// --- addresses --------------------------------------------------------------

export function listAddresses(): Promise<Envelope<Address[]>> {
  return apiFetch('/users/me/addresses');
}

export function createAddress(input: AddressInput): Promise<Envelope<Address>> {
  return apiFetch('/users/me/addresses', { method: 'POST', body: input });
}

export function updateAddress(
  addressId: string,
  patch: Partial<Omit<AddressInput, 'isDefault'>>,
): Promise<Envelope<Address>> {
  // `isDefault` is deliberately not patchable: making an address default is a
  // write against every SIBLING, and it has its own atomic endpoint. Sending it
  // here returns 400 UNKNOWN_FIELD.
  return apiFetch(`/users/me/addresses/${encodeURIComponent(addressId)}`, {
    method: 'PATCH',
    body: patch,
  });
}

/**
 * Deleting and setting-default both return the WHOLE book, because either can
 * move the default to an address the caller did not name. Replace the local
 * list with the result — never merge just the address you touched.
 */
export function deleteAddress(addressId: string): Promise<Envelope<Address[]>> {
  return apiFetch(`/users/me/addresses/${encodeURIComponent(addressId)}`, { method: 'DELETE' });
}

export function setDefaultAddress(addressId: string): Promise<Envelope<Address[]>> {
  return apiFetch(`/users/me/addresses/${encodeURIComponent(addressId)}/default`, {
    method: 'POST',
  });
}

// --- checkout ---------------------------------------------------------------

/**
 * The authoritative breakdown for the current cart. No side effects, no
 * reservation, and no promise that placement will succeed — placement
 * revalidates everything inside its own transaction.
 *
 * `addressId` is optional: quote before the customer has chosen. Supplying it
 * makes `shippingFee` the fee the order will actually carry.
 */
export function quote(addressId?: string): Promise<Envelope<CheckoutQuote>> {
  return apiFetch('/checkout/quote', {
    method: 'POST',
    body: addressId === undefined ? {} : { addressId },
  });
}

/**
 * Places the order.
 *
 * `Idempotency-Key` is MANDATORY and is the server's own duplicate-submit
 * defence — there is no second client-side guard, because a competing one would
 * only disagree with it. Generate the key when the confirmation screen opens
 * and send the SAME value on every retry of that attempt: the first call
 * returns 201, a retry returns 200 with the identical order body, and two
 * concurrent calls with one key produce exactly one order.
 */
export function placeOrder(input: {
  addressId: string;
  customerNote?: string;
  idempotencyKey: string;
}): Promise<Envelope<Order>> {
  return apiFetch('/orders', {
    method: 'POST',
    body:
      input.customerNote === undefined || input.customerNote === ''
        ? { addressId: input.addressId }
        : { addressId: input.addressId, customerNote: input.customerNote },
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
}

// --- orders -----------------------------------------------------------------

export function listOrders(params: { page?: number; limit?: number } = {}): Promise<
  PagedEnvelope<OrderSummary>
> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }

  const qs = query.toString();

  return apiFetch(`/orders${qs ? `?${qs}` : ''}`);
}

export function getOrder(id: string): Promise<Envelope<Order>> {
  return apiFetch(`/orders/${encodeURIComponent(id)}`);
}
