import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@nest/types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}
/*
 * `createAdminClient` USED TO BE HERE, and its removal is the point.
 *
 * It built a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` — a credential
 * that bypasses row-level security completely, which is to say an unrestricted
 * database login — and its only caller was `requireAdmin`, which used it to
 * read one column (`profiles.role`) on every guarded navigation.
 *
 * Authentication is the API's now. Nothing in this application reads that key,
 * so it has been removed from `.env.example` and from the classification table
 * there. A secret an application does not need is a second place it can leak
 * from, and this one had the largest possible blast radius.
 *
 * The client below is the ANON one, constrained by row-level security, and is
 * what the remaining Supabase-backed screens use until Phase 7 moves them.
 */
