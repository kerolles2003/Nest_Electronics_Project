import { NextResponse, type NextRequest } from 'next/server';
import { logAuthFailure } from '@/lib/logger';

/**
 * The navigation guard.
 *
 * ## What it is, and the much larger thing it is not
 *
 * This is a convenience for BROWSER NAVIGATIONS: it saves an anonymous visitor
 * from loading a page that would only tell them to sign in. **It is not the
 * authorization boundary.** Every guarded page calls the API, and the API
 * decides on the identity inside the token — so deleting this file would cost
 * some polish and no security. Treating it as the guard is how a proxy ends up
 * making decisions it cannot make correctly.
 *
 * It therefore does the least it can: it looks for a cookie, and it never
 * inspects, decodes or trusts one.
 *
 * ## Why `nest_rt` and not `nest_at`
 *
 * The access token lives fifteen minutes and is a SESSION cookie, so it is gone
 * after a browser restart while the customer is still signed in. Guarding on it
 * would bounce people to a sign-in page they do not need — their session
 * refreshes server-side on the next API call. `nest_rt` is the thirty-day
 * credential, and its presence is the honest answer to "does this browser
 * believe it has a session?".
 *
 * Presence only. A forged or expired value gets past this file and is refused
 * by the API a moment later, which is the correct place for that answer and the
 * only place that can give it.
 *
 * ## What it replaces
 *
 * A Supabase `createServerClient` that ran `auth.getSession()` on EVERY
 * matched request — a network call in front of every navigation, plus a cookie
 * writer, to answer a question the page was about to ask properly anyway.
 */

/** Routes an anonymous visitor is sent away from. */
const PROTECTED_PREFIXES = ['/account', '/checkout'];

/** Routes a signed-in customer has no reason to be on. */
const AUTH_PREFIXES = ['/login', '/register', '/forgot-password'];

/**
 * Auth-cluster paths that a SIGNED-IN customer must still be allowed to reach.
 *
 * A reset link is a credential with an expiry, sent to an inbox. Somebody signed
 * in on this device may be recovering the account on another, or may simply
 * have asked for a reset and then remembered their password on a different tab.
 * Bouncing them off the link consumes nothing and leaves them holding a token
 * they cannot use.
 */
const AUTH_EXCEPTIONS = ['/forgot-password/reset'];

/** The session cookie the guard looks for. See the note above on why this one. */
const REFRESH_COOKIE = 'nest_rt';

/**
 * The header Next.js puts on every Server Action POST.
 *
 * Matched case-insensitively by `Headers.get`, which lower-cases the name, so
 * the wire spelling (`Next-Action`) does not matter here.
 */
const NEXT_ACTION_HEADER = 'next-action';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  /**
   * F-05 — a Server Action POST is NEVER answered with a redirect.
   *
   * ## The failure this removes
   *
   * A Server Action is a `fetch` issued by the React runtime, not a
   * navigation. It expects an action result — a specific streaming payload the
   * client knows how to reconcile. When this proxy answered one with a 307 to
   * `/login`, the browser transparently followed it (a 307 preserves the method
   * and body), the login page replied with HTML, and the runtime was handed a
   * document where a result belonged. It cannot recover from that, so it throws
   * the untargetable, unactionable
   *
   *     "An unexpected response was received from the server."
   *
   * which is the reported production bug class. The user sees it on submitting
   * a form whose session merely expired.
   *
   * ## Why passing through is the correct answer, not a workaround
   *
   * Redirecting was answering an AUTHORIZATION question in the wrong protocol.
   * The action itself knows how to fail: every one of them calls the API, and an
   * expired session comes back as a typed `ApiError` with
   * `kind: 'unauthenticated'`, which the form renders as an error message and
   * the customer can act on. Letting the request reach the action produces a
   * real answer where the redirect produced a crash.
   *
   * This is not a hole in the guard. The action's own authorization still runs —
   * server-side, against the API, which is the only place that can decide it.
   *
   * Placed before every other branch deliberately, so no future route rule can
   * reintroduce a redirect on this path.
   */
  if (request.headers.get(NEXT_ACTION_HEADER) !== null) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(REFRESH_COOKIE);

  if (!hasSession && PROTECTED_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
    logAuthFailure({ pathname, reason: 'unauthenticated user accessing protected route' });

    /*
     * The destination is carried so the customer lands where they were going.
     * `loginAction` re-validates it and refuses anything that is not a path on
     * this site: it arrives here from a URL anybody can send, and an unchecked
     * value would be an open redirect reached through a genuine sign-in.
     */
    const target = new URL('/login', request.url);
    target.searchParams.set('redirect', pathname);

    return NextResponse.redirect(target);
  }

  if (
    hasSession &&
    AUTH_PREFIXES.some((prefix) => isUnder(pathname, prefix)) &&
    !AUTH_EXCEPTIONS.some((prefix) => isUnder(pathname, prefix))
  ) {
    // Not a failure, and deliberately not logged as one: a signed-in customer
    // opening /login is a bookmark, not an attack.
    return NextResponse.redirect(new URL('/account/orders', request.url));
  }

  return NextResponse.next();
}

/**
 * Prefix matching on SEGMENT boundaries.
 *
 * `pathname.startsWith('/account')` also matches `/accountancy`, which would
 * guard a route that has nothing to do with the account area — and, in the
 * other direction, would bounce a signed-in customer off a hypothetical
 * `/registered-dealers` because it starts with `/register`.
 */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and static files.
     *
     * `_next/static` and `_next/image` are excluded because running this on
     * every chunk and every image is pure overhead — the guard has nothing to
     * say about a JavaScript bundle.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
