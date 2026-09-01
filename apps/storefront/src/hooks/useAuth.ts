'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@nest/providers';
import { Profile } from '@nest/types';

export interface AuthUser {
  id: string;
  email?: string;
  fullName?: string;
  initials?: string;
  role?: string;
  profile?: Profile;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    let mounted = true;

    const handleSession = async (session: any) => {
      if (!session?.user) {
        if (mounted) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (mounted) {
          const fullName = profile?.full_name || session.user.user_metadata?.full_name || 'User';
          const initials = fullName
            .split(' ')
            .map((n: string) => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);

          setUser({
            id: session.user.id,
            email: session.user.email,
            fullName,
            initials,
            role: profile?.role || 'customer',
            profile: profile as Profile,
          });
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    // Listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    user,
    loading,
    signOut,
    supabase,
  };
}
