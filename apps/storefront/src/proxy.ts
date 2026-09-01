import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { logAuthFailure } from "@/lib/logger";

const protectedRoutes = ["/account", "/checkout"];
const authRoutes = ["/login", "/register", "/forgot-password"];

/**
 * The header Next.js puts on every Server Action POST.
 *
 * Matched case-insensitively by `Headers.get`, which lower-cases the name, so
 * the wire spelling (`Next-Action`) does not matter here.
 */
const NEXT_ACTION_HEADER = "next-action";

export async function proxy(request: NextRequest) {
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
   * The proxy never was the authority; it was a convenience for NAVIGATIONS,
   * and it remains exactly that: a browser navigating to `/checkout` without a
   * session is still redirected below.
   *
   * Placed before every other branch deliberately, so no future route rule can
   * reintroduce a redirect on this path.
   */
  if (request.headers.get(NEXT_ACTION_HEADER) !== null) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }

  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  );
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  if (!isProtectedRoute && !isAuthRoute) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session && isProtectedRoute) {
    logAuthFailure({
      pathname,
      reason: "unauthenticated user accessing protected route",
    });
    return NextResponse.redirect(
      new URL(`/login?redirect=${encodeURIComponent(pathname)}`, request.url),
    );
  }

  if (session && isAuthRoute) {
    logAuthFailure({
      pathname,
      reason: "authenticated user accessing auth route",
    });
    return NextResponse.redirect(new URL("/account/orders", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
