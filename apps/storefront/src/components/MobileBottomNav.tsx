'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Grid3X3, Search, ShoppingCart, User } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useCart } from '@/components/cart/CartProvider';
import { useViewer } from '@/components/providers/SiteProviders';
import { ROUTES } from '@nest/config/constants';

export function MobileBottomNav() {
  const pathname = usePathname();
  const { openCart } = useUIStore();
  // The server's count, for the same cart the drawer and the header show.
  const { totalQuantity: totalItems } = useCart();
  const viewer = useViewer();

  const isActive = (path: string) => pathname === path;

  const accountPaths = ['/login', '/register', '/account'];
  const isAccountActive = accountPaths.some((p) => pathname.startsWith(p));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-background/95 border-t border-[var(--color-border)] safe-area-bottom backdrop-blur-xl" aria-label="Mobile navigation">
      <div className="flex items-center h-14">
        <Link
          href={ROUTES.home}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 active:scale-95 ${
            isActive(ROUTES.home) ? 'text-primary' : 'text-foreground-muted'
          }`}
        >
          <span
            className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-300 ${
              isActive(ROUTES.home) ? 'w-8 opacity-100' : 'w-0 opacity-0'
            }`}
          />
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>

        <Link
          href={ROUTES.products}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 active:scale-95 ${
            isActive(ROUTES.products) || pathname.startsWith('/categories/') || pathname.startsWith('/brands/')
              ? 'text-primary'
              : 'text-foreground-muted'
          }`}
        >
          <span
            className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-300 ${
              isActive(ROUTES.products) || pathname.startsWith('/categories/') || pathname.startsWith('/brands/')
                ? 'w-8 opacity-100'
                : 'w-0 opacity-0'
            }`}
          />
          <Grid3X3 className="w-5 h-5" />
          <span className="text-[10px] font-medium">Categories</span>
        </Link>

        <Link
          href={ROUTES.search}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 active:scale-95 ${
            pathname.startsWith('/search') ? 'text-primary' : 'text-foreground-muted'
          }`}
        >
          <span
            className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-300 ${
              pathname.startsWith('/search') ? 'w-8 opacity-100' : 'w-0 opacity-0'
            }`}
          />
          <Search className="w-5 h-5" />
          <span className="text-[10px] font-medium">Search</span>
        </Link>

        <button
          onClick={openCart}
          className="relative flex-1 flex flex-col items-center justify-center gap-0.5 text-foreground-muted transition-all duration-150 active:scale-95 active:text-primary"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="text-[10px] font-medium">Cart</span>
          {totalItems > 0 && (
            <span className="absolute top-0.5 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1 shadow-sm">
              {totalItems > 99 ? '99+' : totalItems}
            </span>
          )}
        </button>

        <Link
          href={viewer !== null ? ROUTES.account.profile : ROUTES.login}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 active:scale-95 ${
            isAccountActive ? 'text-primary' : 'text-foreground-muted'
          }`}
        >
          <span
            className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-300 ${
              isAccountActive ? 'w-8 opacity-100' : 'w-0 opacity-0'
            }`}
          />
          <div className="relative">
            {viewer !== null ? (
              <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[8px] font-bold">
                {viewer.initials}
              </div>
            ) : (
              <User className="w-5 h-5" />
            )}
          </div>
          <span className="text-[10px] font-medium">{viewer !== null ? 'Profile' : 'Account'}</span>
        </Link>
      </div>
    </nav>
  );
}
