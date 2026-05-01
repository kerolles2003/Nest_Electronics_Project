'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

interface AuthUser {
  id: string;
  email: string | null;
  fullName: string | null;
  initials: string;
}

let supabase: ReturnType<typeof createBrowserClient> | null = null;

function getSupabase() {
  if (!supabase) {
    supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return supabase;
}

let cachedUser: AuthUser | null = null;

function fetchProfile(supabaseUser: User): AuthUser {
  const fullName = supabaseUser.user_metadata?.full_name ?? supabaseUser.email?.split('@')[0] ?? null;
  const initials = fullName
    ? fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : (supabaseUser.email?.charAt(0).toUpperCase() ?? 'U');

  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? null,
    fullName,
    initials,
  };
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const supabaseClient = getSupabase();

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const authUser = fetchProfile(session.user);
        cachedUser = authUser;
        setUser(authUser);
      } else {
        cachedUser = null;
        setUser(null);
      }
      setLoading(false);
    });

    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const authUser = fetchProfile(session.user);
        cachedUser = authUser;
        setUser(authUser);
      }
      setLoading(false);
    });
  }, []);

  const signOut = useCallback(async () => {
    const supabaseClient = getSupabase();
    await supabaseClient.auth.signOut();
    cachedUser = null;
    setUser(null);
  }, []);

  return { user, loading, signOut };
}
