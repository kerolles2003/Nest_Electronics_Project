'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Bell, Search, ChevronRight, Home, Command } from 'lucide-react';
import Link from 'next/link';
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

export function AdminHeader() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  return (
    <header className="h-14 border-b border-border bg-card sticky top-0 z-30 flex items-center justify-between px-6">
      {/* Left: Breadcrumb */}
      <nav className="flex items-center text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors flex items-center gap-1">
          <Home className="h-3.5 w-3.5" />
          <span className="sr-only">Dashboard</span>
        </Link>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join('/')}`;
          const isLast = index === segments.length - 1;

          if (segment === 'admin' && index === 0) return null;

          return (
            <React.Fragment key={href}>
              <ChevronRight className="h-3.5 w-3.5 mx-1 opacity-50" />
              <Link
                href={href}
                className={`capitalize hover:text-foreground transition-colors ${
                  isLast ? 'text-foreground font-medium' : ''
                }`}
              >
                {segment.replace(/-/g, ' ')}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* Search placeholder */}
        <div className="hidden md:flex items-center relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
          <div className="h-8 w-56 rounded-md border border-border bg-surface pl-8 pr-3 text-xs flex items-center text-foreground-subtle cursor-text hover:border-border-strong transition-colors">
            Search...
            <span className="ml-auto flex items-center gap-0.5 text-[10px] text-foreground-subtle opacity-60">
              <Command className="h-3 w-3" />
              <span>K</span>
            </span>
          </div>
        </div>

        {/* Notifications */}
        <button className="relative p-1.5 rounded-md hover:bg-surface-high transition-colors text-foreground-muted hover:text-foreground">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary rounded-full border-2 border-card" />
        </button>

        <Separator orientation="vertical" className="h-5" />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md hover:bg-surface-high transition-colors p-1">
              <Avatar size="sm" fallback="AD" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium text-foreground">Admin User</p>
                <p className="text-xs text-muted-foreground">admin@nest.com</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/audit-log">Audit Log</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                const { getSupabaseBrowserClient } = await import('@nest/providers');
                const supabase = getSupabaseBrowserClient();
                await supabase.auth.signOut();
                window.location.href = '/login';
              }}
              className="text-destructive focus:text-destructive"
            >
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
