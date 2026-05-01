import Link from 'next/link';
import { ROUTES } from '@nest/config/constants';

export function Footer() {
  return (
    <footer className="bg-foreground text-white">
      {/* Upper */}
      <div className="container-nest py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand Column */}
          <div>
            <div className="flex flex-col leading-none mb-4">
              <span className="font-heading font-bold text-xl text-white tracking-tight">NEST</span>
              <span className="text-[10px] tracking-[0.2em] text-primary uppercase font-semibold">ELECTRONICS</span>
            </div>
            <p className="text-sm text-white/60 leading-relaxed mb-4">
              Egypt&apos;s electronics store for engineers and makers. Quality components with fast delivery.
            </p>
            <p className="text-sm text-white/60">Cairo, Egypt</p>
          </div>

          {/* Shop */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Shop</h3>
            <Link href={ROUTES.products} className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Products</Link>
            <Link href="/categories" className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Categories</Link>
            <Link href="/brands" className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Brands</Link>
            <Link href={ROUTES.products} className="block text-sm text-white/60 hover:text-white transition-colors mb-2">New Arrivals</Link>
            <Link href={ROUTES.products} className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Featured</Link>
          </div>

          {/* Account */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Account</h3>
            <Link href={ROUTES.account.orders} className="block text-sm text-white/60 hover:text-white transition-colors mb-2">My Orders</Link>
            <Link href={ROUTES.wishlist} className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Wishlist</Link>
            <Link href={ROUTES.account.profile} className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Profile</Link>
            <Link href={ROUTES.account.orders} className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Track Order</Link>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Support</h3>
            <Link href="/contact" className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Contact Us</Link>
            <Link href="/faq" className="block text-sm text-white/60 hover:text-white transition-colors mb-2">FAQ</Link>
            <Link href="/shipping" className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Shipping Policy</Link>
            <Link href="/returns" className="block text-sm text-white/60 hover:text-white transition-colors mb-2">Return Policy</Link>
          </div>
        </div>
      </div>

      {/* Lower */}
      <div className="bg-foreground/95 border-t border-white/10">
        <div className="container-nest py-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <span className="text-xs text-white/50">&copy; 2025 Nest Electronics. All rights reserved.</span>
          <span className="text-xs text-white/50">Cash on Delivery &middot; Shipping across Egypt</span>
        </div>
      </div>
    </footer>
  );
}
