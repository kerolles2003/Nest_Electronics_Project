'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Grid3X3, Search, ShoppingCart, User } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useCartStore } from '@/stores/cart-store';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@nest/config/constants';

export function MobileBottomNav() {
  const pathname = usePathname();
  const { openCart } = useUIStore();
  const totalItems = useCartStore((s) => s.totalItems);
  const { user } = useAuth();

  const isActive = (path: string) => pathname === path;

  const accountPaths = ['/login', '/register', '/account'];
  const isAccountActive = accountPaths.some((p) => pathname.startsWith(p));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white border-t border-gray-200 safe-area-bottom" aria-label="Mobile navigation">
      <div className="flex items-center h-14">
        <Link
          href={ROUTES.home}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            isActive(ROUTES.home) ? 'text-blue-600' : 'text-gray-500'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>

        <Link
          href={ROUTES.products}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            isActive(ROUTES.products) || pathname.startsWith('/categories/') || pathname.startsWith('/brands/')
              ? 'text-blue-600'
              : 'text-gray-500'
          }`}
        >
          <Grid3X3 className="w-5 h-5" />
          <span className="text-[10px] font-medium">Categories</span>
        </Link>

        <Link
          href={ROUTES.search}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            pathname.startsWith('/search') ? 'text-blue-600' : 'text-gray-500'
          }`}
        >
          <Search className="w-5 h-5" />
          <span className="text-[10px] font-medium">Search</span>
        </Link>

        <button
          onClick={openCart}
          className="relative flex-1 flex flex-col items-center justify-center gap-0.5 text-gray-500 transition-colors"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="text-[10px] font-medium">Cart</span>
          {totalItems > 0 && (
            <span className="absolute top-1 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 text-white text-[9px] font-bold px-1">
              {totalItems > 99 ? '99+' : totalItems}
            </span>
          )}
        </button>

        <Link
          href={user ? ROUTES.account.profile : ROUTES.login}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
            isAccountActive ? 'text-blue-600' : 'text-gray-500'
          }`}
        >
          <div className="relative">
            {user ? (
              <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[8px] font-bold">
                {user.initials}
              </div>
            ) : (
              <User className="w-5 h-5" />
            )}
          </div>
          <span className="text-[10px] font-medium">{user ? 'Profile' : 'Account'}</span>
        </Link>
      </div>
    </nav>
  );
}
