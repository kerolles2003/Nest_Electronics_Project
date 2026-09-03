/**
 * Where a page sends the browser when its access token has expired, and how it
 * gets back afterwards.
 *
 * ## Why a redirect and not a refresh in place
 *
 * Renewing means writing two cookies, and there are exactly two places in a
 * Next application allowed to do that: a Server Action and a Route Handler. A
 * page render is neither — it throws — which is the bug this replaces.
 *
 * Middleware can write cookies, and was the obvious candidate. It is the wrong
 * one for a mechanical reason `proxy.ts` already explains: middleware runs on
 * every request a page load makes, including the RSC prefetches a hovered link
 * fires, and the refresh token ROTATES on every use. Two concurrent renewals
 * burn each other's token and the API — correctly — treats the loser as theft
 * and revokes the family. The symptom is a sign-out nobody can reproduce.
 *
 * A redirect has none of that. One request goes to the renewal route, it
 * renews once, and it sends the browser back. Single-flight by construction
 * rather than by hoping two requests do not overlap.
 *
 * ## Deliberately dependency-free
 *
 * No `server-only`, no `next/headers`. `proxy.ts` imports `PATH_HEADER`, and
 * middleware runs in a context where neither of those exists — a `server-only`
 * import there is a build error, and it is the kind that reads as unrelated.
 * Everything here is a pure string function; the one piece that needs request
 * state lives in `identity.ts`, which is server-only already.
 */

/**
 * THE base path, and the only place it is written down.
 *
 * `next.config.ts` imports this rather than repeating the literal, so the
 * application's own mount point and the redirects that have to reproduce it
 * cannot drift apart.
 *
 * It has to be written down at all because a Route Handler CANNOT derive it.
 * Measured on Next 16.2.4: for a request to `/admin/session/renew`,
 * `request.url` is `http://localhost:3200/session/renew` — the prefix is
 * already stripped — `nextUrl.pathname` is `/session/renew`, and
 * `nextUrl.basePath` is the empty string. There is nothing left to read it
 * from, which is exactly the sort of thing worth measuring rather than
 * assuming: the first version of this file assumed the prefix survived, and
 * every redirect it produced landed on a 404.
 */
export const BASE_PATH = '/admin';

/** The route that renews. Under `BASE_PATH`, so this is `/admin/session/renew`. */
export const RENEWAL_PATH = '/session/renew';

/** The header `proxy.ts` writes so a Server Component knows where it is. */
export const PATH_HEADER = 'x-admin-path';

/** Where to send somebody whose `next` cannot be trusted or is missing. */
const FALLBACK = '/';

/**
 * A local path, or the dashboard.
 *
 * The `next` parameter decides where a browser lands after renewing, so it is
 * an open redirect unless it is checked. Anything that is not a single-slash
 * absolute path is discarded rather than corrected — `//evil.example` is a
 * protocol-relative URL that most parsers treat as another origin, and a value
 * containing a scheme is not a path at all.
 *
 * The path is NOT prefixed with the base path here. Callers hand it to
 * `redirect()` or to `nextUrl.clone()`, and both add it — doing it twice
 * produces `/admin/admin/orders`, which is a 404 that took a whole browser run
 * to diagnose the last time it happened.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw.length === 0) return FALLBACK;
  if (!raw.startsWith('/') || raw.startsWith('//')) return FALLBACK;
  if (raw.includes('\\') || /^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return FALLBACK;

  return raw;
}

/** The URL a page redirects to in order to renew and come back. */
export function renewalUrl(next: string): string {
  return `${RENEWAL_PATH}?next=${encodeURIComponent(safeNextPath(next))}`;
}
