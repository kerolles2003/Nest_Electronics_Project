import 'server-only';

import { cookies } from 'next/headers';

/**
 * Where the ADMIN's API session lives in the browser.
 *
 * ## Why httpOnly cookies and not localStorage
 *
 * The refresh token is a 30-day credential that can mint access tokens for an
 * account that confirms orders, dispatches goods and marks cash collected. In
 * `localStorage` any script on the page can read it, so a single XSS becomes a
 * month of that. In an httpOnly cookie no JavaScript can read it at all — only
 * this server module can, and it never sends either token to the browser as
 * script-readable data.
 *
 * That choice is what makes every API call in this app happen on the SERVER: a
 * client component cannot attach a token it is not allowed to see. Pages read
 * through server components and mutate through server actions.
 *
 * ## Why the names differ from the storefront's
 *
 * The storefront uses `nest_at` / `nest_rt`. These are `nest_admin_at` /
 * `nest_admin_rt`, and the distinction is not cosmetic.
 *
 * Both applications are served from the same origin in development and are
 * intended to be in production too — the admin lives under `basePath: '/admin'`
 * on the same host. Cookies are scoped by DOMAIN and PATH, not by port or by
 * application, so a shared name would mean one jar with one slot: signing in to
 * the storefront as a customer would overwrite the operator's session, and
 * signing in to the admin would silently replace a shopper's.
 *
 * Worse than the inconvenience is the ambiguity. With one name, neither app can
 * tell whose session it is holding — the storefront would happily send an
 * operator's token to `/orders`, and this app would send a customer's token to
 * `/admin/orders` and render an authorization error that looks like a bug.
 * Distinct names make "an admin session and a customer session can never be
 * confused" a property of the cookie jar rather than a thing to remember.
 *
 * The cookies are NOT path-scoped to `/admin`, deliberately. Path scoping looks
 * like extra safety and is not: it is trivially bypassed (path is not a
 * security boundary), and it would break the sign-out flow, which redirects to
 * `/admin/login` — a path change mid-flight with a path-scoped cookie is how
 * sessions go missing for reasons nobody can reproduce.
 *
 * ## Why two cookies and not one
 *
 * They have different lifetimes and different blast radii. The access token is
 * short (15 minutes) and replaced constantly; the refresh token is long and
 * rotates on every use. Storing them together would force the pair to share the
 * shorter expiry and be rewritten on every request.
 */

const ACCESS_COOKIE = 'nest_admin_at';
const REFRESH_COOKIE = 'nest_admin_rt';

/**
 * The name the navigation guard looks for.
 *
 * Exported so `proxy.ts` cannot spell it differently — a guard checking a
 * cookie nobody sets is a guard that redirects everybody, and one checking a
 * cookie name that used to be right is a guard that redirects nobody.
 */
export const ADMIN_REFRESH_COOKIE = REFRESH_COOKIE;

/** 30 days, matching the API's `JWT_REFRESH_TTL` default. */
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const BASE_COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  // Secure everywhere except local http development, where it would prevent the
  // cookie being set at all.
  secure: process.env.NODE_ENV === 'production',
} as const;

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

export async function readSession(): Promise<StoredSession | null> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value;
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  // The refresh token is the one that matters: without it the session cannot be
  // renewed, so a lone access token is not a session worth keeping.
  if (!refreshToken) return null;

  return { accessToken: accessToken ?? '', refreshToken };
}

/**
 * Persists a freshly issued pair.
 *
 * The access cookie deliberately has NO `maxAge`: it is a session cookie, so it
 * disappears when the browser closes, while the refresh cookie survives. The
 * access token carries its own 15-minute expiry server-side regardless.
 */
export async function writeSession(tokens: StoredSession): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.accessToken, BASE_COOKIE);
  jar.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...BASE_COOKIE,
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });
}

/**
 * Clears both cookies. Safe to call when there is no session.
 *
 * **This is not signing out.** It ends the session in THIS browser and leaves
 * the refresh token valid on the server for another thirty days. Sign-out must
 * revoke it first — see `logoutAction`.
 */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, '', { ...BASE_COOKIE, maxAge: 0 });
  jar.set(REFRESH_COOKIE, '', { ...BASE_COOKIE, maxAge: 0 });
}
