import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from './lib/supabase'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  /* ------------------------------------------------------------------ */
  /*  Skip auth check for public pages and static assets                */
  /* ------------------------------------------------------------------ */
  if (
    pathname === '/login' ||
    pathname === '/unauthorized' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next({ request: { headers: request.headers } })
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  /* ------------------------------------------------------------------ */
  /*  1. Validate session with Supabase Auth server                     */
  /* ------------------------------------------------------------------ */
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  /* ------------------------------------------------------------------ */
  /*  2. Verify admin role — lightweight indexed lookup                  */
  /* ------------------------------------------------------------------ */
  const adminClient = createAdminClient()
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (
    profileError ||
    !profile ||
    (profile.role !== 'admin' && profile.role !== 'super_admin')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/unauthorized'
    return NextResponse.redirect(url)
  }

  return response
}

/* ------------------------------------------------------------------ */
/*  Matcher: exclude static assets only. Public pages handled above.   */
/* ------------------------------------------------------------------ */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
