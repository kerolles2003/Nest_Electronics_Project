'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pagination, StatusBadge } from '@nest/ui';
import { useToast } from '@nest/ui';
import {
  createCouponAction,
  updateCouponAction,
  toggleCouponActiveAction,
  deleteCouponAction,
} from '@/actions/coupon.actions';
import {
  Search, X, Ticket, Plus, Percent, Tag, CheckCircle2, XCircle, Trash2, Loader2,
  Filter, ChevronDown, Calendar, ShoppingCart, Hash, Pencil
} from 'lucide-react';

interface Coupon {
  id: string;
  code: string;
  type: string;
  value: number;
  min_order: number | null;
  max_discount: number | null;
  usage_limit: number | null;
  used_count: number | null;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean | null;
}

interface CouponsTableProps {
  initialCoupons: Coupon[];
  currentPage: number;
  totalPages: number;
  total: number;
  stats: {
    total: number;
    active: number;
    expired: number;
    used: number;
  };
}

function isExpired(coupon: Coupon) {
  if (!coupon.expires_at) return false;
  return new Date(coupon.expires_at) < new Date();
}

function isUpcoming(coupon: Coupon) {
  if (!coupon.starts_at) return false;
  return new Date(coupon.starts_at) > new Date();
}

function getCouponStatus(coupon: Coupon) {
  if (!coupon.is_active) return { label: 'Inactive', status: 'inactive' };
  if (isExpired(coupon)) return { label: 'Expired', status: 'expired' };
  if (isUpcoming(coupon)) return { label: 'Scheduled', status: 'pending' };
  return { label: 'Active', status: 'active' };
}

function formatDate(dateString: string | null) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface CouponFormData {
  id?: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: string;
  min_order: string;
  max_discount: string;
  usage_limit: string;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
}

const emptyForm: CouponFormData = {
  code: '',
  type: 'percentage',
  value: '',
  min_order: '',
  max_discount: '',
  usage_limit: '',
  starts_at: '',
  expires_at: '',
  is_active: true,
};

export function CouponsTable({ initialCoupons, currentPage, totalPages, total, stats }: CouponsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [coupons, setCoupons] = useState(initialCoupons);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CouponFormData>({ ...emptyForm });
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    setCoupons(initialCoupons);
  }, [initialCoupons]);

  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';
  const hasFilters = search || statusFilter;

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
        router.push(`/coupons?${params.toString()}`);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search, router, searchParams]);

  const updateQueryParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') params.set('page', '1');
    startTransition(() => {
      router.push(`/coupons?${params.toString()}`);
    });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    startTransition(() => {
      router.push(`/coupons?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    startTransition(() => {
      router.push('/coupons');
    });
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set('code', form.code);
      fd.set('type', form.type);
      fd.set('value', form.value);
      fd.set('min_order', form.min_order);
      fd.set('max_discount', form.max_discount);
      fd.set('usage_limit', form.usage_limit);
      fd.set('starts_at', form.starts_at);
      fd.set('expires_at', form.expires_at);
      fd.set('is_active', form.is_active.toString());

      const result = await createCouponAction(fd);
      if (result.success) {
        addToast('Coupon created', 'success');
        setShowForm(false);
        setForm({ ...emptyForm });
        window.location.reload();
      } else {
        addToast(result.error ?? 'Failed to create coupon', 'error');
      }
    } catch {
      addToast('Failed to create coupon', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (id: string) => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set('id', id);
      fd.set('code', form.code);
      fd.set('type', form.type);
      fd.set('value', form.value);
      fd.set('min_order', form.min_order);
      fd.set('max_discount', form.max_discount);
      fd.set('usage_limit', form.usage_limit);
      fd.set('starts_at', form.starts_at);
      fd.set('expires_at', form.expires_at);
      fd.set('is_active', form.is_active.toString());

      const result = await updateCouponAction(fd);
      if (result.success) {
        addToast('Coupon updated', 'success');
        setEditingId(null);
        window.location.reload();
      } else {
        addToast(result.error ?? 'Failed to update coupon', 'error');
      }
    } catch {
      addToast('Failed to update coupon', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (coupon: Coupon) => {
    setActionId(coupon.id);
    try {
      const result = await toggleCouponActiveAction(coupon.id, !coupon.is_active);
      if (result.success) {
        addToast(`Coupon ${coupon.is_active ? 'deactivated' : 'activated'}`, 'success');
        setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, is_active: !c.is_active } : c));
      } else {
        addToast(result.error ?? 'Failed to update coupon', 'error');
      }
    } catch {
      addToast('Failed to update coupon', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this coupon?')) return;
    setActionId(id);
    try {
      const result = await deleteCouponAction(id);
      if (result.success) {
        addToast('Coupon deleted', 'success');
        setCoupons(prev => prev.filter(c => c.id !== id));
      } else {
        addToast(result.error ?? 'Failed to delete coupon', 'error');
      }
    } catch {
      addToast('Failed to delete coupon', 'error');
    } finally {
      setActionId(null);
    }
  };

  const startEdit = (coupon: Coupon) => {
    setForm({
      id: coupon.id,
      code: coupon.code,
      type: coupon.type as 'percentage' | 'fixed',
      value: coupon.value.toString(),
      min_order: coupon.min_order?.toString() ?? '',
      max_discount: coupon.max_discount?.toString() ?? '',
      usage_limit: coupon.usage_limit?.toString() ?? '',
      starts_at: coupon.starts_at ? coupon.starts_at.slice(0, 10) : '',
      expires_at: coupon.expires_at ? coupon.expires_at.slice(0, 10) : '',
      is_active: coupon.is_active ?? true,
    });
    setEditingId(coupon.id);
    setShowForm(false);
  };

  const filterChips: { key: string; label: string }[] = [];
  if (search) filterChips.push({ key: 'search', label: `Search: "${search}"` });
  if (statusFilter) filterChips.push({ key: 'status', label: `Status: ${statusFilter === 'active' ? 'Active' : statusFilter === 'inactive' ? 'Inactive' : 'Expired'}` });

  const statItems = [
    { label: 'Total', value: stats.total, icon: Ticket, color: 'primary' as const, filter: '' },
    { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'success' as const, filter: 'active' },
    { label: 'Expired', value: stats.expired, icon: Calendar, color: 'warning' as const, filter: 'expired' },
    { label: 'Used', value: stats.used, icon: ShoppingCart, color: 'primary' as const, filter: '' },
  ];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statItems.map((item) => {
          const Icon = item.icon;
          const isActive = statusFilter === item.filter || (!statusFilter && !item.filter && item.label !== 'Used');
          return (
            <button
              key={item.label}
              onClick={() => item.filter && updateQueryParam('status', item.filter)}
              className={`relative overflow-hidden rounded-xl border ${isActive ? 'border-primary ring-1 ring-primary/30' : 'border-border'} bg-card p-3 text-left transition-all hover:shadow-md`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`rounded-lg p-1.5 bg-${item.color}/10`}>
                  <Icon className={`h-3.5 w-3.5 text-${item.color}`} />
                </div>
                {isActive && item.label !== 'Used' && (
                  <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-${item.color}/10 text-${item.color}`}>Active</span>
                )}
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{item.label}</p>
              <p className="text-lg font-bold tracking-tight text-foreground mt-0.5">{item.value.toLocaleString('en-EG')}</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search coupons..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
          />
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm({ ...emptyForm }); }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add Coupon
        </button>
      </div>

      {/* Form */}
      {(showForm || editingId) && (
        <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
              {editingId ? 'Edit Coupon' : 'New Coupon'}
            </h3>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Code *</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-mono focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="SUMMER25"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Type *</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as 'percentage' | 'fixed' })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
              >
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount (EGP)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Value *</label>
              <input
                type="number"
                min={0}
                step={form.type === 'percentage' ? 1 : 0.01}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder={form.type === 'percentage' ? '25' : '100'}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Usage Limit</label>
              <input
                type="number"
                min={0}
                value={form.usage_limit}
                onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="Unlimited"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Min Order</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.min_order}
                onChange={(e) => setForm({ ...form, min_order: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Max Discount</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.max_discount}
                onChange={(e) => setForm({ ...form, max_discount: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="None"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Starts At</label>
              <input
                type="date"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Expires At</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              Active
            </label>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => editingId ? handleUpdate(editingId) : handleCreate()}
                disabled={loading || !form.code || !form.value}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {loading && <Loader2 className="w-3 h-3 animate-spin" />}
                {editingId ? 'Save Changes' : 'Create Coupon'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Code</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Value</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Usage</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Validity</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {coupons.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Ticket className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {hasFilters ? 'No coupons match your search' : 'No coupons yet'}
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        {hasFilters ? 'Try a different search term.' : 'Create your first promotional coupon.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                coupons.map((coupon) => {
                  const status = getCouponStatus(coupon);
                  const isLoading = actionId === coupon.id;
                  const usage = coupon.used_count ?? 0;
                  const limit = coupon.usage_limit;
                  const usagePercent = limit && limit > 0 ? Math.min((usage / limit) * 100, 100) : 0;

                  return (
                    <tr key={coupon.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                            <Hash className="h-3.5 w-3.5 text-muted-foreground/50" />
                          </div>
                          <span className="text-sm font-bold text-foreground font-mono">{coupon.code}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {coupon.type === 'percentage' ? <Percent className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                          {coupon.type === 'percentage' ? 'Percentage' : 'Fixed'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-sm font-bold text-foreground tabular-nums">
                          {coupon.type === 'percentage' ? `${coupon.value}%` : `EGP ${coupon.value.toLocaleString('en-EG')}`}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xs font-bold text-foreground tabular-nums">
                            {usage}{limit ? ` / ${limit}` : ''}
                          </span>
                          {limit && limit > 0 && (
                            <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(usagePercent, 4)}%` }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                          <span>{coupon.starts_at ? `From ${formatDate(coupon.starts_at)}` : 'No start date'}</span>
                          <span>{coupon.expires_at ? `Until ${formatDate(coupon.expires_at)}` : 'No expiry'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <StatusBadge status={status.status} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(coupon)}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(coupon)}
                            disabled={isLoading}
                            className={`inline-flex items-center justify-center rounded-md p-1.5 transition-all ${coupon.is_active ? 'text-muted-foreground hover:bg-warning/10 hover:text-warning' : 'text-muted-foreground hover:bg-success/10 hover:text-success'}`}
                            title={coupon.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : coupon.is_active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDelete(coupon.id)}
                            disabled={isLoading}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
                            title="Delete"
                          >
                            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
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
            Showing <span className="font-semibold text-foreground">{coupons.length}</span> of <span className="font-semibold text-foreground">{total}</span> coupons
          </span>
          {totalPages > 1 && (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
          )}
        </div>
      </div>
    </div>
  );
}
