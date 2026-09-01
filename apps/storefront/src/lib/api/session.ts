import 'server-only';

import { cookies } from 'next/headers';

/**
 * Where the API session lives in the browser.
 *
 * ## Why httpOnly cookies and not localStorage
 *
 * The refresh token is a 30-day credential that can mint access tokens. In
 * `localStorage` any script on the page can read it, so a single XSS becomes a
 * month-long account takeover. In an httpOnly cookie no JavaScript can read it
 * at all — only this server module can, and it never sends either token to the
 * browser as script-readable data.
 *
 * That choice is what makes every API call in this slice happen on the SERVER:
 * a client component cannot attach a token it is not allowed to see. Pages read
 * through server components and mutate through server actions.
 *
 * ## Why two cookies and not one
 *
 * They have different lifetimes and different blast radii. The access token is
 * short (15 minutes) and replaced constantly; the refresh token is long and
 * rotates on every use. Storing them together would force the pair to share the
 * shorter expiry and be rewritten on every request.
 */

const ACCESS_COOKIE = 'nest_at';
const REFRESH_COOKIE = 'nest_rt';

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

/** Clears both cookies. Safe to call when there is no session. */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, '', { ...BASE_COOKIE, maxAge: 0 });
  jar.set(REFRESH_COOKIE, '', { ...BASE_COOKIE, maxAge: 0 });
}

/**
 * Replaces only the access token, keeping the refresh cookie untouched.
 *
 * Used after a silent refresh in a context that may write cookies. The API
 * ROTATES the refresh token on every refresh, so callers that can write cookies
 * should use `writeSession` with both values instead; this exists for the case
 * where only the access half changed.
 */
export async function writeAccessToken(accessToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, accessToken, BASE_COOKIE);
}
