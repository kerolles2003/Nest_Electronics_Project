import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_REFRESH_COOKIE } from '@/lib/api/session';
import { logAdminAuthFailure } from '@/lib/logger';

/**
 * The navigation guard.
 *
 * ## What it is, and the much larger thing it is not
 *
 * This is a convenience for BROWSER NAVIGATIONS: it saves somebody with no
 * session from loading a console page that would only redirect them. **It is
 * not the authorization boundary.** Every dashboard route calls `requireAdmin`,
 * which asks the API who the caller is and checks the role against the server's
 * answer; and the API's `RolesGuard` refuses a non-staff token on every
 * `admin/*` route regardless of what any client believes.
 *
 * It therefore does the least it can: it looks for a cookie, and it never
 * inspects, decodes or trusts one.
 *
 * ## Why it does NOT decode the token to read the role
 *
 * A JWT is base64, not a secret. Anything this file could read out of one, a
 * browser could rewrite — so a `role` claim read here and believed would be a
 * request from the client, not an authorisation. Rendering decisions have to be
 * made from what the SERVER says, which is why the role check lives in
 * `requireAdmin` where an actual `/auth/me` answer is available.
 *
 * ## Why it does not call the API either
 *
 * The tempting version fetches `/auth/me` here and checks the role. It is wrong
 * for a mechanical reason: the access token lives fifteen minutes and the
 * refresh token ROTATES on every use, so this would have to refresh — and a
 * proxy runs on every request, including the several a single page load makes
 * in parallel. Concurrent refreshes on one rotating token burn each other and
 * destroy a valid session, and the symptom is a random sign-out nobody can
 * reproduce.
 *
 * The dashboard layout renders once per navigation, already needs the identity
 * for the header, and can write cookies. That is where the server-side role
 * check belongs, and that is where it is.
 *
 * ## What it replaces
 *
 * A Supabase `createServerClient` that ran `auth.getUser()` on EVERY matched
 * request — a network call in front of every navigation — and then a SECOND
 * call to `profiles` made with the **service-role key**, a full-privilege
 * database credential, to read one column. Two network round trips and an
 * unrestricted database credential, to decide whether to render a page the
 * page itself was about to guard properly.
 */

/** Reachable with no session. Everything else is behind the guard. */
const PUBLIC_PATHS = ['/login', '/unauthorized'];

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
   * A Server Action POST is NEVER answered with a redirect.
   *
   * ## The failure this removes
   *
   * A Server Action is a `fetch` issued by the React runtime, not a navigation.
   * It expects an action result — a specific streaming payload the client knows
   * how to reconcile. Answering one with a 307 to `/login` makes the browser
   * follow it transparently (a 307 preserves the method and body), the login
   * page replies with HTML, and the runtime is handed a document where a result
   * belonged. It cannot recover, so it throws the untargetable
   *
   *     "An unexpected response was received from the server."
   *
   * The storefront shipped exactly this bug to production. It is worse on a
   * console: the operator sees it on submitting a lifecycle action whose
   * session merely expired, and cannot tell whether the order moved.
   *
   * Passing through is the correct answer, not a workaround. The action itself
   * knows how to fail — it calls the API, and an expired session comes back as
   * a typed `ApiError` the form renders as a message. Letting the request reach
   * the action produces a real answer where the redirect produced a crash.
   *
   * Placed before every other branch deliberately, so no future route rule can
   * reintroduce a redirect on this path.
   */
  if (request.headers.get(NEXT_ACTION_HEADER) !== null) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((prefix) => isUnder(pathname, prefix))) {
    return NextResponse.next();
  }

  /*
   * Presence only. A forged or expired value gets past this file and is refused
   * by `requireAdmin` and then by the API, which are the correct places for
   * that answer and the only places that can give it.
   *
   * `nest_admin_rt` and not `nest_admin_at`: the access token is a SESSION
   * cookie that is gone after a browser restart while the operator is still
   * signed in, so guarding on it would bounce people whose session refreshes
   * fine on the next server-side call.
   */
  if (!request.cookies.has(ADMIN_REFRESH_COOKIE)) {
    logAdminAuthFailure({ pathname, reason: 'no admin session cookie' });

    /*
     * `nextUrl.clone()`, NOT `new URL('/login', request.url)`.
     *
     * This application has `basePath: '/admin'`. `request.nextUrl.pathname` is
     * given WITHOUT the base path, and Next re-adds it when a cloned `nextUrl`
     * is serialised — so cloning and setting the pathname produces
     * `/admin/login`. Building a plain `URL` against `request.url` does not:
     * it produces `/admin`-less `/login`, which is not a route in this app and
     * 404s.
     *
     * It cost a whole e2e run to find, because the redirect still happened and
     * the browser still left the guarded page — it just landed nowhere.
     */
    const target = request.nextUrl.clone();
    target.pathname = '/login';
    target.search = '';

    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

/**
 * Prefix matching on SEGMENT boundaries.
 *
 * `pathname.startsWith('/login')` also matches a hypothetical `/login-history`,
 * which would make that route public without anybody deciding it should be.
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
     * say about a JavaScript bundle. Note the basePath: these are matched
     * relative to it, so this covers `/admin/_next/*`.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
