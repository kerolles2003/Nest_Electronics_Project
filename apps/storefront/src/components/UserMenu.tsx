'use client';

import React from 'react';
import Link from 'next/link';
import { User, LogOut, Package, Settings, ChevronDown } from 'lucide-react';
import { logoutAction } from '@/actions/api-auth.actions';
import { useViewer } from '@/components/providers/SiteProviders';
import { ROUTES } from '@nest/config/constants';

/**
 * The account menu.
 *
 * ## There is no loading state any more, and that is the improvement
 *
 * This used to open a Supabase client in the browser, read a session out of
 * `localStorage` and then fetch a profile row — so every page drew a skeleton,
 * then flickered from "Login" to a name. The session is an httpOnly cookie now:
 * the server resolves who is signed in before the HTML is sent, and this
 * component renders the answer on the first paint.
 */
export function UserMenu() {
  const user = useViewer();

  if (user === null) {
    return (
      <Link
        href={ROUTES.login}
        // 44px minimum: this was 32x28, and on a phone it is an icon alone.
        className="min-h-11 min-w-11 justify-center px-1.5 py-1 hover:bg-white/10 rounded-sm transition-colors flex items-center gap-2 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <User className="w-5 h-5 group-hover:text-primary transition-colors" strokeWidth={1.7} />
        <div className="hidden sm:block text-left">
          <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider leading-none mb-1">Account</p>
          <p className="text-[13px] font-bold leading-none">Login</p>
        </div>
      </Link>
    );
  }

  return (
    <div className="relative group">
      <button className="min-h-11 min-w-11 justify-center px-1.5 py-1 hover:bg-white/10 rounded-sm transition-colors flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <div className="w-7 h-7 rounded-sm bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-black group-hover:bg-primary-hover transition-colors">
          {user.initials}
        </div>
        <div className="hidden sm:block text-left mr-1">
          <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider leading-none mb-1">Account</p>
          <p className="text-[13px] font-bold leading-none max-w-[80px] truncate">{user.fullName.split(' ')[0]}</p>
        </div>
        <ChevronDown className="w-3.5 h-3.5 opacity-50 group-hover:rotate-180 transition-transform duration-300" />
      </button>

      {/* Dropdown */}
      <div className="absolute top-full right-0 w-56 bg-card shadow-[0_0_3px_rgba(0,0,0,0.15)] rounded-none border border-[var(--color-border)] py-2 mt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible translate-y-2 group-hover:translate-y-0 transition-all duration-300 z-50 overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[#F9F9F9] mb-1">
          <p className="text-[13px] font-bold text-foreground truncate">{user.fullName}</p>
          <p className="text-[11px] text-foreground-muted truncate">{user.email}</p>
        </div>
        
        <Link 
          href={ROUTES.account.profile}
          className="flex items-center gap-3 px-4 py-3 text-[13px] font-normal text-foreground-muted hover:bg-[#F9F9F9] hover:text-primary transition-colors"
        >
          <User className="w-4 h-4" />
          <span>My Profile</span>
        </Link>
        
        <Link 
          href={ROUTES.account.orders}
          className="flex items-center gap-3 px-4 py-3 text-[13px] font-normal text-foreground-muted hover:bg-[#F9F9F9] hover:text-primary transition-colors"
        >
          <Package className="w-4 h-4" />
          <span>My Orders</span>
        </Link>

        {user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? (
          <Link 
            href="/admin"
            className="flex items-center gap-3 px-4 py-3 text-[13px] font-normal text-foreground-muted hover:bg-[#F9F9F9] hover:text-primary transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span>Admin Dashboard</span>
          </Link>
        ) : null}

        <div className="h-px bg-[var(--color-border)] my-1" />
        
        {/*
          * A form, not an onClick.
          *
          * Signing out REVOKES the refresh token server-side before it clears
          * the cookies, so a copy of the cookie that survives somewhere is
          * already dead. That is a server action, and a form posts to one
          * without needing this component to hold a handler that could fail
          * silently.
          */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-4 py-3 text-[13px] font-normal text-danger hover:bg-[#F9F9F9] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </form>
      </div>
    </div>
  );
}
