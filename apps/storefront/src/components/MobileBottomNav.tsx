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
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white border-t border-border safe-area-bottom" aria-label="Mobile navigation">
      <div className="flex items-center h-14">
        <Link
          href={ROUTES.home}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 ${
            isActive(ROUTES.home) ? 'text-primary' : 'text-foreground-muted'
          }`}
        >
          {isActive(ROUTES.home) && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
          )}
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>

        <Link
          href={ROUTES.products}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 ${
            isActive(ROUTES.products) || pathname.startsWith('/categories/') || pathname.startsWith('/brands/')
              ? 'text-primary'
              : 'text-foreground-muted'
          }`}
        >
          {(isActive(ROUTES.products) || pathname.startsWith('/categories/') || pathname.startsWith('/brands/')) && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
          )}
          <Grid3X3 className="w-5 h-5" />
          <span className="text-[10px] font-medium">Categories</span>
        </Link>

        <Link
          href={ROUTES.search}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 ${
            pathname.startsWith('/search') ? 'text-primary' : 'text-foreground-muted'
          }`}
        >
          {pathname.startsWith('/search') && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
          )}
          <Search className="w-5 h-5" />
          <span className="text-[10px] font-medium">Search</span>
        </Link>

        <button
          onClick={openCart}
          className="relative flex-1 flex flex-col items-center justify-center gap-0.5 text-foreground-muted transition-colors duration-150 active:text-primary"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="text-[10px] font-medium">Cart</span>
          {totalItems > 0 && (
            <span className="absolute top-0.5 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-white text-[9px] font-bold px-1">
              {totalItems > 99 ? '99+' : totalItems}
            </span>
          )}
        </button>

        <Link
          href={user ? ROUTES.account.profile : ROUTES.login}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 ${
            isAccountActive ? 'text-primary' : 'text-foreground-muted'
          }`}
        >
          {isAccountActive && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
          )}
          <div className="relative">
            {user ? (
              <div className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[8px] font-bold">
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
