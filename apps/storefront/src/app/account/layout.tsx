'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Package, User, MapPin, LogOut, ChevronRight, ShieldCheck } from 'lucide-react';
import { logoutAction } from '@/actions/api-auth.actions';
import { useViewer } from '@/components/providers/SiteProviders';
import { ROUTES } from '@nest/config/constants';

const navItems = [
  { href: ROUTES.account.orders, label: 'Orders', icon: Package },
  { href: ROUTES.account.profile, label: 'Profile', icon: User },
  { href: ROUTES.account.addresses, label: 'Addresses', icon: MapPin },
];

/**
 * The account area's chrome.
 *
 * ## It does not guard anything, and that is deliberate
 *
 * `proxy.ts` refuses `/account/*` without a session, and each page below asks
 * the API, which answers on the identity in the token. This layout draws a
 * sidebar. A third authorization check here would be a third place for the rule
 * to be written slightly differently.
 *
 * The customer's name and initials come from the viewer context — resolved once
 * on the server per request — rather than from a browser-side Supabase session
 * plus a profile query, which is what used to make this whole area flicker.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useViewer();

  const isActive = (href: string) => {
    if (href === ROUTES.account.orders) {
      return pathname === href || pathname.startsWith(ROUTES.account.orders + '/');
    }
    return pathname.startsWith(href);
  };

  /*
   * The fallbacks are for the instant between a session ending and the proxy
   * noticing — not a state anyone should sit in. There is no "loading" here:
   * the server resolved the viewer before this HTML was sent.
   */
  const initials = user?.initials ?? 'U';
  const displayName = user?.fullName ?? 'Your account';
  const displayEmail = user?.email ?? '';

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
              {/*
                * A form posting to a server action, not a click handler.
                *
                * Signing out REVOKES the refresh token at the API before it
                * clears the cookies, so a stray copy of the cookie is already
                * dead. Clearing the browser's cookies alone would leave a
                * working 30-day credential in the wild.
                */}
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex items-center gap-4 w-full px-5 py-3.5 rounded-sm text-[12px] font-black uppercase tracking-[0.15em] text-foreground-muted hover:bg-red-50 hover:text-red-500 transition-all group"
                >
                  <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1" strokeWidth={2} />
                  Sign Out
                </button>
              </form>
            </div>
          </div>

          <div className="mt-6 p-6 bg-primary/5 border border-primary/10 rounded-sm">
            <h4 className="text-[11px] font-black text-primary uppercase tracking-widest mb-2">Member Support</h4>
            <p className="text-[12px] text-foreground-muted font-medium leading-relaxed">
              As a Nest member, you have access to priority support for all your orders.
            </p>
          </div>
        </aside>

        {/*
          * A `section`, NOT a second `main` — F-12.
          *
          * The root layout already renders the page's one `<main>`, and this
          * layout renders inside it. Two nested `main` landmarks is invalid
          * HTML and it degrades the thing the landmark exists for: a screen
          * reader offering "skip to main content" cannot say which one is
          * meant, and "next landmark" walks into a nested copy of where the
          * user already is.
          *
          * The `/shop` slice had the same defect and it went with the slice.
          * This was the other half of it, on every `/account/*` page, and it
          * would have outlived the deletion unnoticed — `not-found.spec.ts`
          * counts landmarks now so it cannot come back.
          */}
        <section
          aria-label="Account"
          className="flex-1 min-w-0 bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-10 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500"
        >
          {children}
        </section>
      </div>
    </div>
  );
}

