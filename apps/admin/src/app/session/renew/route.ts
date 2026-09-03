import { NextResponse, type NextRequest } from 'next/server';
import { renewSession } from '@/lib/api/client';
import { BASE_PATH, safeNextPath } from '@/lib/api/renewal';
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
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
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

  if (session === null) return redirectTo('/login');

  const renewed = await renewSession(session.refreshToken);

  if (renewed === null) {
    /*
     * The refresh token is gone, revoked, or already burned. Nothing here can
     * recover it, and leaving the cookies in place would make every subsequent
     * navigation repeat this round trip.
     */
    await clearSession();

    return redirectTo('/login');
  }

  await writeSession({
    accessToken: renewed.accessToken,
    refreshToken: renewed.refreshToken,
  });

  return redirectTo(next);
}

/**
 * A RELATIVE redirect, carrying the base path explicitly.
 *
 * Both halves were learned the hard way, by measurement.
 *
 * The base path is written out because a Route Handler cannot recover it:
 * `request.url` arrives with the prefix already stripped and
 * `nextUrl.basePath` is empty. `BASE_PATH` is the same constant
 * `next.config.ts` mounts the application with, so the two cannot disagree.
 *
 * The location is RELATIVE — legal per RFC 7231, and resolved by the browser
 * against the URL it actually requested. `NextResponse.redirect` needs an
 * absolute URL, and building one meant reading the origin off `request.url`,
 * which Next reports as `http://localhost:3200` even for a request made to
 * `127.0.0.1`. Those are different origins to `next dev`, to a cookie jar, and
 * to this suite's origin pinning; silently moving the operator between them is
 * exactly the class of bug that cost the storefront five phases of client-side
 * coverage.
 *
 * 303, not 307: the browser must GET the destination. A 307 preserves the
 * method, which is correct today and wrong the moment somebody adds POST.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: `${BASE_PATH}${path}` } });
}
