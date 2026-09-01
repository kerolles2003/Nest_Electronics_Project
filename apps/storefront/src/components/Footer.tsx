import Link from 'next/link';
import { ROUTES } from '@nest/config/constants';

export function Footer() {
  return (
    <footer className="bg-topbar">
      {/* Upper */}
      <div className="container-nest py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          {/* Brand Column */}
          <div>
            <div className="flex flex-col leading-none mb-4">
              <span className="font-heading font-bold text-xl text-foreground tracking-tight">NEST</span>
              <span className="text-[10px] tracking-[0.2em] text-primary uppercase font-semibold">ELECTRONICS</span>
            </div>
            <p className="text-sm text-foreground-muted leading-relaxed mb-4">
              Egypt&apos;s electronics store for engineers and makers. Quality components with fast delivery.
            </p>
            <p className="text-sm text-foreground-muted">Cairo, Egypt</p>
          </div>

          {/* Shop */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-4">Shop</h3>
            <Link href={ROUTES.products} className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Products</Link>
            <Link href="/categories" className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Categories</Link>
            <Link href="/brands" className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Brands</Link>
            <Link href={ROUTES.products} className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">New Arrivals</Link>
            <Link href={ROUTES.products} className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Featured</Link>
          </div>

          {/* Account */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-4">Account</h3>
            <Link href={ROUTES.account.orders} className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">My Orders</Link>
            <Link href={ROUTES.wishlist} className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Wishlist</Link>
            <Link href={ROUTES.account.profile} className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Profile</Link>
            <Link href={ROUTES.account.orders} className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Track Order</Link>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-4">Support</h3>
            <Link href="/contact" className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Contact Us</Link>
            <Link href="/faq" className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">FAQ</Link>
            <Link href="/shipping" className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Shipping Policy</Link>
            <Link href="/returns" className="block text-sm text-foreground-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Return Policy</Link>
          </div>
        </div>
      </div>

      {/* Lower */}
      <div className="bg-topbar border-t border-[var(--color-border)]">
        <div className="container-nest py-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <span className="text-xs text-foreground-subtle">&copy; 2025 Nest Electronics. All rights reserved.</span>
          <span className="text-xs text-foreground-subtle">Cash on Delivery &middot; Shipping across Egypt</span>
        </div>
      </div>
    </footer>
  );
}
