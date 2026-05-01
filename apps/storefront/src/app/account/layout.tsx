'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Package, User, MapPin, LogOut } from 'lucide-react';
import { getSupabaseBrowserClient } from '@nest/providers';
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
    <div className="container-marketplace py-8">
      <div className="flex flex-col lg:flex-row gap-6">
        <nav className="lg:hidden flex gap-1 border-b border-gray-200 overflow-x-auto pb-1">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <aside className="hidden lg:block w-56 shrink-0">
          <div className="bg-white border border-gray-200 rounded-md overflow-hidden sticky top-24">
            <div className="px-4 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-bold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {displayName}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {displayEmail}
                  </p>
                </div>
              </div>
            </div>

            <nav className="p-2">
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded text-sm transition-colors ${
                      active
                        ? 'bg-blue-50 text-blue-600 font-medium border-r-2 border-blue-600'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="p-2 border-t border-gray-200">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 w-full px-4 py-2.5 rounded text-sm text-gray-500 hover:bg-gray-50 hover:text-red-500 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
