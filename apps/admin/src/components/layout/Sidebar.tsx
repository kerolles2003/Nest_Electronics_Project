'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@nest/providers';
import { LogOut, Menu, X } from 'lucide-react';
import { navSections } from '@/config/navigation';
import { Avatar } from '@nest/ui';

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const supabase = getSupabaseBrowserClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      <button
        type="button"
        className="fixed top-3 left-3 z-50 lg:hidden p-1.5 rounded-md border border-border bg-card text-foreground"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-60 shrink-0 bg-card border-r border-border
          flex flex-col transition-transform duration-150 ease-in-out
          lg:relative lg:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <span className="font-heading font-bold text-lg text-white tracking-tight">NEST</span>
          <span className="text-[10px] font-bold text-primary uppercase tracking-widest">ADMIN</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 overflow-auto">
          {navSections.map((section) => (
            <div key={section.label} className="mb-4">
              <div className="px-4 py-1.5 text-[10px] font-semibold text-foreground-subtle uppercase tracking-wider">
                {section.label}
              </div>
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
                        flex items-center gap-3 px-4 py-2 rounded-md text-sm transition-colors
                        ${active
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground-muted hover:text-foreground hover:bg-surface-high'
                        }
                      `}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom: User + Sign Out */}
        <div className="mt-auto border-t border-border p-4 space-y-2">
          <div className="flex items-center gap-3 px-2">
            <Avatar size="sm" fallback="AD" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">Admin User</p>
              <p className="text-[10px] text-foreground-subtle uppercase tracking-wider">admin</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-1.5 rounded-md text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-surface-high transition-colors"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
