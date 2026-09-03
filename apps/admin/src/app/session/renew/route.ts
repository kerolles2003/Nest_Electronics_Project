import { NextResponse, type NextRequest } from 'next/server';
import { renewSession } from '@/lib/api/client';
import { RENEWAL_PATH, safeNextPath } from '@/lib/api/renewal';
import {
  clearSession,
  markRenewalAttempted,
  readSession,
  writeSession,
} from '@/lib/api/session';

/**
 * The ONE place this console renews a session.
 *
 * ## Why it is a route handler and not part of a page
 *
 * Renewing writes two cookies, and Next's own documentation for this version is
 * unambiguous: "Setting cookies is not supported during Server Component
 * rendering. To modify cookies, invoke a Server Function from the client or use
 * a Route Handler."
 *
 * The console used to renew inside `apiFetch`, which most pages call while
 * rendering. It threw, `tryApi` only catches `ApiError`, and the page 500'd —
 * after the API had already rotated the refresh token and burned the old one,
 * so the browser went on presenting a dead credential until the API revoked the
 * family for reuse. A stack trace followed by a silent sign-out, from nothing
 * but leaving a tab open for fifteen minutes.
 *
 * ## Why not middleware, which can also write cookies
 *
 * Middleware runs on every request a page load makes, including the RSC
 * prefetch a hovered link fires. The refresh token ROTATES on every use, so two
 * concurrent renewals burn each other and the API — correctly — reads the loser
 * as theft. A redirect is single-flight by construction: one request arrives
 * here, one renewal happens, the browser goes back. `proxy.ts` explains the
 * same trap from its side.
 *
 * ## What protects `next`
 *
 * It decides where a browser lands, so an unchecked value is an open redirect.
 * `safeNextPath` accepts only a single-slash local path and discards everything
 * else rather than trying to repair it.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const base = basePathOf(url.pathname);
  const next = safeNextPath(url.searchParams.get('next'));

  const session = await readSession();

  /*
   * The marker goes down BEFORE the outcome is known, and deliberately.
   *
   * It answers "has renewal just been attempted", not "did it work". If this
   * request dies half way — the API times out, the process is killed — the
   * next expiry must still find the breadcrumb and go to the sign-in page
   * rather than starting the loop over.
   */
  await markRenewalAttempted();

  if (session === null) return redirectTo(url, base, '/login');

  const renewed = await renewSession(session.refreshToken);

  if (renewed === null) {
    /*
     * The refresh token is gone, revoked, or already burned. Nothing here can
     * recover it, and leaving the cookies in place would make every subsequent
     * navigation repeat this round trip.
     */
    await clearSession();

    return redirectTo(url, base, '/login');
  }

  await writeSession({
    accessToken: renewed.accessToken,
    refreshToken: renewed.refreshToken,
  });

  return redirectTo(url, base, next);
}

/**
 * The base path, derived from the request rather than written down.
 *
 * This application is served under `basePath: '/admin'`, and `redirect()`'s
 * handling of that in a route handler is not something this version's docs
 * state. Rather than assume — the last assumption about base paths cost a whole
 * browser run, because the redirect happened and landed nowhere — the prefix is
 * read off the path that actually arrived: everything before this route's own
 * known suffix IS the base path, whatever it is configured to be.
 */
function basePathOf(pathname: string): string {
  return pathname.endsWith(RENEWAL_PATH)
    ? pathname.slice(0, pathname.length - RENEWAL_PATH.length)
    : '';
}

function redirectTo(url: URL, base: string, path: string): NextResponse {
  /*
   * 303, not 307. The browser must GET the destination; a 307 would preserve
   * the method, and while this handler only answers GET today, a redirect that
   * silently replays a method is the kind of thing that is correct until
   * somebody adds POST.
   */
  return NextResponse.redirect(new URL(`${base}${path}`, url.origin), 303);
}
