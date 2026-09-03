'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, X, ChevronDown } from 'lucide-react';
import { logoutAction } from '@/actions/admin-auth.actions';
import type { AdminIdentity } from '@/lib/api/identity';
import { navSections } from '@/config/navigation';
import { Avatar } from '@nest/ui';

/**
 * ## The second fabricated identity
 *
 * This rendered "Admin User / admin@nest.com / AD" too — the same lie as the
 * header, in a second place, which is why grepping the header alone was not
 * enough and the e2e assertion is a whole-page one.
 *
 * It also had its OWN sign-out, calling `supabase.auth.signOut()` and pushing a
 * route: against this API that revoked nothing at all. Both sign-outs now go
 * through `logoutAction`, which revokes the refresh token server-side first.
 */
export function AdminSidebar({ identity }: { identity: AdminIdentity | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === '/admin' || pathname === '/admin/';
    return pathname.startsWith(href) || pathname.startsWith('/admin' + href);
  };

  const toggleSection = (label: string) => {
    setCollapsedSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <>
      {/* Mobile Toggle */}
      <button
        type="button"
        className="fixed top-3 left-3 z-50 lg:hidden p-2 rounded-lg bg-card border border-border text-foreground shadow-subtle hover:shadow-card transition-all duration-200 active:scale-95"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* Mobile Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity duration-300 ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 shrink-0 bg-card border-r border-border/60
          flex flex-col transition-transform duration-300 ease-out
          lg:relative lg:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo area */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-border/60 shrink-0 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shadow-sm">
            <span className="text-sm font-bold text-primary-foreground">N</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground leading-tight">Nest Electronics</span>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-tight">Admin Panel</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
          {navSections.map((section) => {
            const hasLabel = section.label && section.label !== 'Overview';
            const isCollapsed = collapsedSections[section.label];

            return (
              <div key={section.label} className={hasLabel ? 'mb-4' : 'mb-1'}>
                {hasLabel && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.label)}
                    className="flex items-center justify-between w-full px-3 py-1 mb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group"
                  >
                    <span>{section.label}</span>
                    <ChevronDown
                      className={`h-3 w-3 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'} group-hover:text-foreground`}
                    />
                  </button>
                )}

                <div
                  className={`overflow-hidden transition-all duration-300 ease-out ${
                    isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[600px] opacity-100'
                  }`}
                >
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className={`
                            group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200
                            ${active
                              ? 'bg-primary/[0.08] text-primary font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                            }
                          `}
                        >
                          {/* Active side indicator bar */}
                          {active && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-primary" />
                          )}
                          <div className={`
                            flex items-center justify-center h-7 w-7 rounded-md transition-colors duration-200
                            ${active ? 'bg-primary/10' : 'bg-muted/50 group-hover:bg-muted'}
                          `}>
                            <Icon className={`h-3.5 w-3.5 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                          </div>
                          <span>{item.label}</span>
                          {active && (
                            <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom: User + Sign Out */}
        <div className="shrink-0 border-t border-border/60 p-3">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/50 transition-colors group">
            <Avatar size="sm" fallback={identity?.initials ?? '?'} />
            <div className="flex-1 min-w-0">
              {identity === null ? (
                <p className="text-sm font-medium text-warning truncate">Identity unavailable</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground truncate">{identity.fullName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{identity.email}</p>
                </>
              )}
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
