'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Package, User, MapPin, LogOut, ChevronRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@nest/config/constants';

const navItems = [
  { href: ROUTES.account.orders, label: 'Orders', icon: Package },
  { href: ROUTES.account.profile, label: 'Profile', icon: User },
  { href: ROUTES.account.addresses, label: 'Addresses', icon: MapPin },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push(ROUTES.home);
    router.refresh();
  };

  const isActive = (href: string) => {
    if (href === ROUTES.account.orders) {
      return pathname === href || pathname.startsWith(ROUTES.account.orders + '/');
    }
    return pathname.startsWith(href);
  };

  const initials = user?.initials ?? 'U';
  const displayName = user?.fullName ?? 'User';
  const displayEmail = user?.email ?? 'Customer';

  return (
    <div className="container-marketplace py-10">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Mobile Navigation */}
        <nav className="lg:hidden flex gap-2 border-b border-[var(--color-border)] overflow-x-auto pb-2 scrollbar-none">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-5 py-3 text-[13px] font-black uppercase tracking-widest whitespace-nowrap border-b-2 transition-all ${
                  active
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-foreground-muted hover:text-foreground'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-72 shrink-0">
          <div className="bg-white border border-[var(--color-border)] rounded-sm overflow-hidden sticky top-32 shadow-sm">
            {/* User Profile Summary */}
            <div className="px-6 py-8 border-b border-[var(--color-border)] bg-surface/30 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none rotate-12">
                <User className="w-24 h-24 text-foreground" strokeWidth={1} />
              </div>
              
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-14 h-14 rounded-sm bg-primary text-white flex items-center justify-center text-xl font-black shrink-0 shadow-lg shadow-primary/20 ring-4 ring-primary/10">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-[15px] font-black text-foreground truncate uppercase tracking-tight">
                      {displayName}
                    </p>
                    <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <p className="text-[12px] text-foreground-muted truncate font-medium">
                    {displayEmail}
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation Links */}
            <nav className="p-3">
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between px-5 py-3.5 rounded-sm text-[12px] font-black uppercase tracking-[0.15em] transition-all group ${
                      active
                        ? 'bg-primary text-white shadow-md shadow-primary/10 translate-x-1'
                        : 'text-foreground-muted hover:bg-surface hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <item.icon className={`w-4 h-4 transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`} strokeWidth={active ? 2.5 : 2} />
                      {item.label}
                    </div>
                    {active && <ChevronRight className="w-4 h-4 opacity-50" />}
                  </Link>
                );
              })}
            </nav>

            {/* Logout Section */}
            <div className="p-3 border-t border-[var(--color-border)] bg-surface/10">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-4 w-full px-5 py-3.5 rounded-sm text-[12px] font-black uppercase tracking-[0.15em] text-foreground-muted hover:bg-red-50 hover:text-red-500 transition-all group"
              >
                <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1" strokeWidth={2} />
                Sign Out
              </button>
            </div>
          </div>

          <div className="mt-6 p-6 bg-primary/5 border border-primary/10 rounded-sm">
            <h4 className="text-[11px] font-black text-primary uppercase tracking-widest mb-2">Member Support</h4>
            <p className="text-[12px] text-foreground-muted font-medium leading-relaxed">
              As a Nest member, you have access to priority support for all your orders.
            </p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-10 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
          {children}
        </main>
      </div>
    </div>
  );
}

