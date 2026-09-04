import Link from 'next/link';
import { ROUTES } from '@nest/config/constants';

/**
 * The site footer.
 *
 * ## It was drawn in its own background colour
 *
 * The footer sits on `--color-topbar` (#1a1a2e) but styled its text with the
 * LIGHT palette: the brand name and all three column headings used
 * `text-foreground`, which IS #1a1a2e — contrast 1:1, invisible — and the links
 * used `text-foreground-muted` (#6b7280), 3.4:1, below AA. `TopBar` sits on the
 * same colour and already used the right tokens; this now does too.
 *
 * ## Four of its links went nowhere
 *
 * `/brands`, `/faq`, `/shipping` and `/returns` have never been routes. They
 * are removed rather than redirected, because a link that lands somewhere
 * plausible is a worse answer than no link.
 *
 * `/shipping` and `/returns` in particular are what a first-time
 * cash-on-delivery customer looks for before ordering, and the QA report says
 * so — the entries belong back here the day the pages are written. "Support"
 * holding a single link is the honest current state, not a design.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-topbar">
      {/* Upper */}
      <div className="container-nest py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          {/* Brand Column */}
          <div>
            <div className="flex flex-col leading-none mb-4">
              <span className="font-heading font-bold text-xl text-topbar-foreground tracking-tight">NEST</span>
              <span className="text-[10px] tracking-[0.2em] text-primary uppercase font-semibold">ELECTRONICS</span>
            </div>
            <p className="text-sm text-topbar-muted leading-relaxed mb-4">
              Egypt&apos;s electronics store for engineers and makers. Quality components with fast delivery.
            </p>
            <p className="text-sm text-topbar-muted">Cairo, Egypt</p>
          </div>

          {/* Shop */}
          <div>
            <h3 className="text-sm font-semibold text-topbar-foreground mb-4">Shop</h3>
            <Link href={ROUTES.products} className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Products</Link>
            <Link href="/categories" className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Categories</Link>
            <Link href="/products?sort=newest" className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">New Arrivals</Link>
            <Link href="/products?featured=true" className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Featured</Link>
          </div>

          {/* Account */}
          <div>
            <h3 className="text-sm font-semibold text-topbar-foreground mb-4">Account</h3>
            <Link href={ROUTES.account.orders} className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">My Orders</Link>
            <Link href={ROUTES.wishlist} className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Wishlist</Link>
            <Link href={ROUTES.account.profile} className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Profile</Link>
            <Link href={ROUTES.account.orders} className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Track Order</Link>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-sm font-semibold text-topbar-foreground mb-4">Support</h3>
            <Link href="/contact" className="block text-sm text-topbar-muted hover:text-primary hover:underline underline-offset-4 transition-colors duration-150 mb-2.5">Contact Us</Link>
          </div>
        </div>
      </div>

      {/* Lower */}
      <div className="bg-topbar border-t border-[var(--color-border)]">
        <div className="container-nest py-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          {/* Was hard-coded to 2025, and it is not 2025. */}
          <span className="text-xs text-topbar-muted">&copy; {year} Nest Electronics. All rights reserved.</span>
          <span className="text-xs text-topbar-muted">Cash on Delivery &middot; Shipping across Egypt</span>
        </div>
      </div>
    </footer>
  );
}
