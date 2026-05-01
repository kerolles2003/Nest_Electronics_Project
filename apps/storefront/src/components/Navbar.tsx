'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Search, Heart, ShoppingCart, Menu, X, User, ChevronDown, LayoutGrid, LogOut, Package, MapPin } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useCartStore } from '@/stores/cart-store';
import { useWishlistStore } from '@/stores/wishlist-store';
import { useAuth } from '@/hooks/useAuth';
import { CartDrawer } from '@/components/CartDrawer';
import { CartSync } from '@/components/CartSync';
import { ROUTES } from '@nest/config/constants';
import { createBrowserClient } from '@supabase/ssr';

interface CategoryItem {
  id: string;
  name_en: string;
  slug: string;
  parent_id: string | null;
}

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu, openCart } = useUIStore();
  const totalItems = useCartStore((s) => s.totalItems);
  const wishlistCount = useWishlistStore((s) => s.items.length);
  const { user, signOut } = useAuth();
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [mobileSearchValue, setMobileSearchValue] = useState('');
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data } = await supabase
        .from('categories')
        .select('id, name_en, slug, parent_id')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order');
      if (data) setCategories(data);
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileDropdownOpen(false);
      }
    }
    if (isProfileDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileDropdownOpen]);

  const handleSignOut = async () => {
    await signOut();
    setIsProfileDropdownOpen(false);
    router.push(ROUTES.home);
    router.refresh();
  };

  const handleSearch = useCallback(() => {
    const q = searchValue.trim();
    if (q) {
      router.push(`${ROUTES.search}?q=${encodeURIComponent(q)}`);
    }
  }, [searchValue, router]);

  const handleMobileSearch = useCallback(() => {
    const q = mobileSearchValue.trim();
    if (q) {
      router.push(`${ROUTES.search}?q=${encodeURIComponent(q)}`);
      closeMobileMenu();
      setMobileSearchValue('');
    }
  }, [mobileSearchValue, router, closeMobileMenu]);

  const rootCategories = categories.filter((c) => !c.parent_id);
  const getSubcategories = (parentId: string) =>
    categories.filter((c) => c.parent_id === parentId);

  return (
    <>
      <CartSync />

      {/* Row 1: Top Bar */}
      <div className="hidden md:block bg-foreground text-white h-9">
        <div className="container-nest h-full flex items-center justify-between">
          <span className="text-xs">🇪🇬 Free delivery on orders over 500 EGP within Cairo</span>
          <div className="flex items-center gap-4 text-xs">
            {user ? (
              <button onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)} className="hover:text-primary-light transition-colors">
                {user.fullName ?? 'Account'}
              </button>
            ) : (
              <>
                <Link href={ROUTES.login} className="hover:text-primary-light transition-colors">Login</Link>
                <span className="text-white/30">|</span>
                <Link href={ROUTES.register} className="hover:text-primary-light transition-colors">Register</Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Main Header */}
      <header className="bg-white border-b border-border shadow-sm sticky top-0 z-50">
        <div className="container-nest h-[68px] flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href={ROUTES.home} className="flex-shrink-0 flex flex-col leading-none">
            <span className="font-heading font-bold text-xl text-foreground tracking-tight">NEST</span>
            <span className="text-[10px] tracking-[0.2em] text-primary uppercase font-semibold">ELECTRONICS</span>
          </Link>

          {/* Search Bar */}
          <div className="hidden lg:flex flex-1 max-w-xl mx-auto">
            <div className="relative w-full flex items-center">
              <input
                type="text"
                placeholder="Search for products..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="h-10 w-full border border-border rounded-l-md px-4 text-sm bg-white text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
              <button
                className="h-10 px-5 bg-primary hover:bg-primary-hover text-white rounded-r-md text-sm font-medium transition-colors flex items-center gap-1.5"
                onClick={handleSearch}
              >
                <Search className="w-4 h-4" />
                <span className="hidden sm:inline">Search</span>
              </button>
            </div>
          </div>

          {/* Action Icons */}
          <div className="flex items-center gap-3">
            <Link
              href={ROUTES.wishlist}
              className="relative p-2 text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors"
              aria-label="Wishlist"
            >
              <Heart className="w-5 h-5" />
              {wishlistCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white text-[10px] font-bold">
                  {wishlistCount}
                </span>
              )}
            </Link>

            <button
              onClick={openCart}
              className="relative p-2 text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors"
              aria-label="Cart"
            >
              <ShoppingCart className="w-5 h-5" />
              {totalItems > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white text-[10px] font-bold">
                  {totalItems}
                </span>
              )}
            </button>

            {user ? (
              <div className="relative hidden md:block" ref={dropdownRef}>
                <button
                  onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                  className="flex items-center gap-2 p-2 text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors"
                  aria-label="Account"
                >
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary">
                    {user.initials}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {isProfileDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-dropdown border border-border py-2 z-50">
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-sm font-semibold text-foreground truncate">{user.fullName ?? 'User'}</p>
                      <p className="text-xs text-foreground-muted truncate">{user.email ?? ''}</p>
                    </div>
                    <Link href={ROUTES.account.orders} onClick={() => setIsProfileDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-muted hover:text-foreground hover:bg-surface transition-colors">
                      <Package className="w-4 h-4" /> My Orders
                    </Link>
                    <Link href={ROUTES.account.profile} onClick={() => setIsProfileDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-muted hover:text-foreground hover:bg-surface transition-colors">
                      <User className="w-4 h-4" /> My Profile
                    </Link>
                    <Link href={ROUTES.account.addresses} onClick={() => setIsProfileDropdownOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-muted hover:text-foreground hover:bg-surface transition-colors">
                      <MapPin className="w-4 h-4" /> My Addresses
                    </Link>
                    <div className="border-t border-border mt-1 pt-1">
                      <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-danger hover:bg-danger-light transition-colors">
                        <LogOut className="w-4 h-4" /> Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href={ROUTES.login} className="hidden md:flex items-center gap-2 p-2 text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors" aria-label="Login">
                <User className="w-5 h-5" />
              </Link>
            )}

            <button className="lg:hidden p-2 text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors" onClick={toggleMobileMenu} aria-label="Menu">
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Row 3: Category Nav */}
      <nav className="hidden lg:block bg-surface border-b border-border" aria-label="Categories">
        <div className="container-nest h-[44px] flex items-center gap-1 overflow-x-auto scrollbar-none">
          <Link
            href={ROUTES.products}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors rounded-md ${
              pathname === '/products' ? 'text-primary bg-primary-light' : 'text-foreground-muted hover:text-primary hover:bg-surface-low'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            All Categories
          </Link>
          {rootCategories.map((cat) => {
            const subs = getSubcategories(cat.id);
            const isActive = pathname === `/categories/${cat.slug}`;
            return (
              <div
                key={cat.id}
                className="relative group"
                onMouseEnter={() => setActiveCategory(cat.id)}
                onMouseLeave={() => setActiveCategory(null)}
              >
                <Link
                  href={`/categories/${cat.slug}`}
                  className={`flex items-center gap-1 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive ? 'text-primary border-b-2 border-primary' : 'text-foreground-muted hover:text-primary hover:bg-surface-low'
                  }`}
                >
                  {cat.name_en}
                  {subs.length > 0 && <ChevronDown className="w-3 h-3 opacity-60" />}
                </Link>

                {/* Mega Menu */}
                {subs.length > 0 && activeCategory === cat.id && (
                  <div className="absolute top-full left-0 w-full min-w-[600px] bg-white border-b border-border shadow-dropdown z-40 p-4">
                    <div className="grid grid-cols-4 gap-3">
                      {subs.map((sub) => (
                        <Link
                          key={sub.id}
                          href={`/categories/${sub.slug}`}
                          className="text-sm text-foreground-muted hover:text-primary px-3 py-2 rounded-md hover:bg-surface transition-colors"
                        >
                          {sub.name_en}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div 
            className="fixed inset-0 bg-black/50 animate-in fade-in duration-200" 
            onClick={closeMobileMenu} 
          />
          <div className="relative flex-1 w-full max-w-xs bg-white h-full shadow-2xl overflow-y-auto flex flex-col animate-in slide-in-from-left-full duration-300 ease-out">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex flex-col leading-none">
                <span className="font-heading font-bold text-xl text-foreground">NEST</span>
                <span className="text-[10px] tracking-[0.2em] text-primary uppercase font-semibold">ELECTRONICS</span>
              </div>
              <button onClick={closeMobileMenu} className="p-2 text-foreground-muted hover:bg-surface rounded-md transition-colors duration-150">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-subtle pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={mobileSearchValue}
                  onChange={(e) => setMobileSearchValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleMobileSearch(); }}
                  className="w-full h-10 pl-9 pr-4 text-sm bg-surface border border-border rounded-md focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors duration-150"
                />
              </div>
            </div>

            <nav className="flex flex-col py-2 flex-1">
              <Link href={ROUTES.products} onClick={closeMobileMenu} className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-foreground hover:bg-surface transition-colors duration-150">
                <LayoutGrid className="w-4 h-4" /> All Categories
              </Link>
              {rootCategories.map((cat) => (
                <Link key={cat.id} href={`/categories/${cat.slug}`} onClick={closeMobileMenu} className="px-5 py-3 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface transition-colors duration-150">
                  {cat.name_en}
                </Link>
              ))}
            </nav>

            <div className="border-t border-border p-4 space-y-1">
              <Link href={ROUTES.wishlist} onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors duration-150">
                <Heart className="w-4 h-4" /> Wishlist
              </Link>
              {user ? (
                <>
                  <Link href={ROUTES.account.orders} onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors duration-150">
                    <Package className="w-4 h-4" /> My Orders
                  </Link>
                  <Link href={ROUTES.account.profile} onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors duration-150">
                    <User className="w-4 h-4" /> My Profile
                  </Link>
                  <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-3 py-2.5 text-sm font-medium text-danger hover:bg-danger-light rounded-md transition-colors duration-150">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </>
              ) : (
                <Link href={ROUTES.login} onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface rounded-md transition-colors duration-150">
                  <User className="w-4 h-4" /> Login / Register
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <CartDrawer />
    </>
  );
}
