'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Pagination } from '@nest/ui';
import {
  Search, X, Users, User, UserPlus, ShoppingBag, CreditCard, Calendar,
  Loader2, ChevronDown, Filter, Phone, Mail
} from 'lucide-react';

interface Customer {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface CustomerOrderStats {
  count: number;
  total: number;
}

interface CustomersTableProps {
  initialCustomers: Customer[];
  orderMap: Record<string, CustomerOrderStats>;
  currentPage: number;
  totalPages: number;
  total: number;
  stats: {
    total: number;
    newThisWeek: number;
    withOrders: number;
    totalRevenue: number;
  };
}

function formatDate(dateString: string) {
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CustomersTable({ initialCustomers, orderMap, currentPage, totalPages, total, stats }: CustomersTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');

  const search = searchParams.get('search') || '';
  const hasFilters = !!search;

  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput) {
        params.set('search', searchInput);
      } else {
        params.delete('search');
      }
      params.set('page', '1');
      startTransition(() => {
        router.push(`/customers?${params.toString()}`);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search, router, searchParams]);

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    startTransition(() => {
      router.push(`/customers?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    startTransition(() => {
      router.push('/customers');
    });
  };

  const statItems = [
    { label: 'Total Customers', value: stats.total, icon: Users, color: 'primary' as const },
    { label: 'New This Week', value: stats.newThisWeek, icon: UserPlus, color: 'success' as const },
    { label: 'With Orders', value: stats.withOrders, icon: ShoppingBag, color: 'warning' as const },
    { label: 'Total Revenue', value: `EGP ${stats.totalRevenue.toLocaleString('en-EG')}`, icon: CreditCard, color: 'primary' as const },
  ];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className={`rounded-lg p-1.5 bg-${item.color}/10`}>
                  <Icon className={`h-3.5 w-3.5 text-${item.color}`} />
                </div>
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{item.label}</p>
              <p className="text-lg font-bold tracking-tight text-foreground mt-0.5">{item.value}</p>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={searchInput}
              className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {hasFilters && (
            <button onClick={clearAllFilters} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating results...
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Customer</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Contact</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Orders</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Spent</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {initialCustomers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Users className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {hasFilters ? 'No customers match your search' : 'No customers yet'}
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        {hasFilters ? 'Try a different search term.' : 'Customer accounts will appear here.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                initialCustomers.map((customer) => {
                  const stats = orderMap[customer.id] ?? { count: 0, total: 0 };
                  return (
                    <tr key={customer.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full border border-border bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                            {customer.avatar_url ? (
                              <Image src={customer.avatar_url} alt="" width={36} height={36} className="object-cover" />
                            ) : (
                              <User className="h-4 w-4 text-muted-foreground/50" />
                            )}
                          </div>
                          <span className="text-sm font-semibold text-foreground">{customer.full_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-0.5">
                          {customer.phone && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3" /> {customer.phone}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-sm font-bold text-foreground tabular-nums">{stats.count}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-sm font-bold text-foreground tabular-nums">
                          EGP {stats.total.toLocaleString('en-EG')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDate(customer.created_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{initialCustomers.length}</span> of <span className="font-semibold text-foreground">{total}</span> customers
          </span>
          {totalPages > 1 && (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
          )}
        </div>
      </div>
    </div>
  );
}
