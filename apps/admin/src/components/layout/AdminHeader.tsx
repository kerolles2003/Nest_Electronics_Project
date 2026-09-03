'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, Search, ChevronRight, Home, Command, ShoppingBag, PackageOpen, UserPlus, Check, Settings, Shield, LogOut } from 'lucide-react';
import Link from 'next/link';
import { logoutAction } from '@/actions/admin-auth.actions';
import type { AdminIdentity } from '@/lib/api/identity';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
} from '@nest/ui';

interface Notification {
  id: number;
  title: string;
  time: string;
  icon: React.ReactNode;
  read: boolean;
}

const mockNotifications: Notification[] = [
  { id: 1, title: 'New order #1024 — 2,450 EGP', time: '5 min ago', icon: <ShoppingBag className="h-3.5 w-3.5" />, read: false },
  { id: 2, title: 'Low stock alert: iPhone 15 Charger', time: '1 hour ago', icon: <PackageOpen className="h-3.5 w-3.5" />, read: false },
  { id: 3, title: 'New customer registered', time: '3 hours ago', icon: <UserPlus className="h-3.5 w-3.5" />, read: true },
];

/**
 * ## The identity is the server's, or it is nothing
 *
 * This header rendered the literal strings "Admin User", "admin@nest.com" and
 * the initials "AD" on every page of the console. Not as a loading state — as
 * the answer. An operator confirming orders and marking cash collected saw a
 * name that was never fetched from anywhere and belonged to nobody.
 *
 * That is worse than an empty header. It tells somebody they are signed in as
 * an account that does not exist, so if they are on a colleague's machine, or
 * on a session that expired an hour ago, nothing on screen contradicts them —
 * while every action they take is attributed to whoever the token actually
 * belongs to.
 *
 * `identity` comes from `readAdminIdentity()`, which is `GET /auth/me` and
 * nothing else. When it is `null` — the API is unreachable, the session is
 * gone, the account is not staff — this says so and **names nobody**.
 * `e2e/admin-identity.spec.ts` proves it by failing the request and asserting
 * no fabricated name appears.
 */
export function AdminHeader({ identity }: { identity: AdminIdentity | null }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications] = useState<Notification[]>(mockNotifications);
  const notificationRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showNotifications]);

  return (
    <header className="sticky top-0 z-30 h-[68px] bg-background/60 backdrop-blur-xl border-b border-border/40 shadow-sm transition-all duration-300 px-4 sm:px-6 flex items-center justify-between">
      {/* Gradient accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />

      {/* Left: Breadcrumb */}
      <nav className="flex items-center text-sm font-medium text-slate-500 min-w-0">
        <Link href="/" className="hover:text-slate-700 hover:bg-slate-50 transition-colors duration-200 flex items-center gap-2">
          <Home className="h-3.5 w-3.5" />
          <span className="sr-only">Dashboard</span>
        </Link>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join('/')}`;
          const isLast = index === segments.length - 1;

          if (segment === 'admin' && index === 0) return null;

          return (
            <React.Fragment key={href}>
              <ChevronRight className="h-3.5 w-3.5 mx-1 opacity-50 shrink-0" />
              <Link
                href={href}
                className={`capitalize hover:text-slate-700 hover:bg-slate-50 transition-colors duration-200 truncate ${
                  isLast ? 'text-slate-800 font-medium' : ''
                }`}
              >
                {segment.replace(/-/g, ' ')}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Search */}
        <div className="hidden md:flex items-center relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none group-focus-within:text-primary transition-colors" />
          <input
            type="text"
            placeholder="Search..."
            className="h-9 w-48 lg:w-64 rounded-full border border-border/50 bg-surface/50 backdrop-blur-md pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none hover:border-border hover:bg-surface/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/30 focus:bg-surface-high transition-all duration-300"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-70 group-focus-within:opacity-0 transition-opacity pointer-events-none">
            <Command className="h-3 w-3" />
            <span>K</span>
          </kbd>
        </div>

        {/* Notifications */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className={`relative p-2 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95 ${
              showNotifications
                ? 'bg-primary/10 text-primary ring-1 ring-primary/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-high/50'
            }`}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0 -right-0 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary-500 text-white text-[9px] font-bold ring-2 ring-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <div
            className={`absolute right-0 top-full mt-3 w-80 bg-card/80 rounded-2xl border border-border/50 shadow-elevated backdrop-blur-xl z-40 transition-all duration-300 origin-top-right ${
              showNotifications
                ? 'opacity-100 scale-100 translate-y-0 visible'
                : 'opacity-0 scale-95 -translate-y-4 invisible'
            }`}
          >
            <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Check className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-xs text-muted-foreground">All caught up</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-high/30 transition-colors duration-200 border-b border-border/30 last:border-b-0 group"
                  >
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        n.read ? 'bg-surface text-muted-foreground' : 'bg-primary/10 text-primary group-hover:bg-primary/20 group-hover:shadow-[0_0_10px_rgba(59,130,246,0.2)]'
                      }`}
                    >
                      {n.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[11px] leading-tight mb-1 truncate ${n.read ? 'text-muted-foreground' : 'text-foreground font-semibold'}`}>
                        {n.title}
                      </p>
                      <p className="text-[9px] font-medium text-muted-foreground">{n.time}</p>
                    </div>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />}
                  </button>
                ))
              )}
            </div>
            <div className="px-4 py-2 border-t border-border/50 bg-surface/30 rounded-b-2xl">
              <button className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary hover:text-primary-foreground hover:bg-primary transition-all duration-200 rounded-lg">
                View all notifications
              </button>
            </div>
          </div>
        </div>

        <Separator orientation="vertical" className="h-5" />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 h-10 px-2 rounded-xl transition-all duration-300 hover:bg-surface-high/50 active:scale-95 group">
              <Avatar
                size="sm"
                fallback={identity?.initials ?? '?'}
                className="border border-border/50 shadow-sm"
              />
              <span className="hidden sm:block text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                {identity?.fullName ?? 'Not identified'}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-card/80 rounded-2xl border border-border/50 shadow-elevated backdrop-blur-xl z-40 transition-all duration-300 origin-top-right p-1.5">
            <DropdownMenuLabel className="font-normal px-2.5 py-2">
              {identity === null ? (
                /*
                 * NOT a name. The console could not establish who is operating
                 * it, and inventing somebody here is the failure this replaced.
                 */
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-semibold text-warning">Identity unavailable</p>
                  <p className="text-[11px] text-muted-foreground font-medium">
                    The API did not confirm who is signed in. Reload, or sign in again.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-semibold text-foreground">{identity.fullName}</p>
                  <p className="text-[11px] text-muted-foreground font-medium">{identity.email}</p>
                  <p className="text-[10px] text-muted-foreground/80 font-medium uppercase tracking-wider">
                    {identity.role.replace('_', ' ')}
                  </p>
                </div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="border-border/50 my-1" />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-foreground-subtle hover:text-foreground hover:bg-surface-high transition-colors duration-200 rounded-xl cursor-pointer">
                <Settings className="w-4 h-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/audit-log" className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-foreground-subtle hover:text-foreground hover:bg-surface-high transition-colors duration-200 rounded-xl cursor-pointer">
                <Shield className="w-4 h-4" />
                Audit Log
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="border-border/50 my-1" />
            <DropdownMenuItem asChild>
              {/*
                A FORM, not an onClick.

                The old handler called `supabase.auth.signOut()` in the browser
                and set `window.location`. Against this API that revoked
                nothing — it cleared a Supabase session this console no longer
                has, and left the API refresh token valid for another thirty
                days. Clearing a cookie ends the tab, not the session.

                `logoutAction` revokes the refresh token server-side FIRST and
                then clears the cookies, so the credential is dead even if a
                copy of the cookie survives somewhere.
              */}
              <form action={logoutAction} className="w-full">
                <button
                  type="submit"
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors duration-200 rounded-xl cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
