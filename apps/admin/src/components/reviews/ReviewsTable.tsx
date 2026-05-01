'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Pagination, StatusBadge } from '@nest/ui';
import { useToast } from '@nest/ui';
import { updateReviewStatusAction, deleteReviewAction } from '@/actions/review.actions';
import type { Review } from '@nest/types';
import {
  Search, X, Star, MessageSquare, CheckCircle2, AlertTriangle, Eye, Trash2, Loader2,
  Filter, ChevronDown, User, Package, ThumbsUp, Clock
} from 'lucide-react';

interface ReviewsTableProps {
  initialReviews: (Review & { product?: { name_en: string; slug: string } | null })[];
  currentPage: number;
  totalPages: number;
  total: number;
  stats: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    verified: number;
  };
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < rating ? 'text-warning fill-warning' : 'text-muted-foreground/30'}`}
        />
      ))}
    </div>
  );
}

export function ReviewsTable({ initialReviews, currentPage, totalPages, total, stats }: ReviewsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [reviews, setReviews] = useState(initialReviews);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    setReviews(initialReviews);
  }, [initialReviews]);

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
        router.push(`/reviews?${params.toString()}`);
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
      router.push(`/reviews?${params.toString()}`);
    });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    startTransition(() => {
      router.push(`/reviews?${params.toString()}`);
    });
  };

  const clearAllFilters = () => {
    startTransition(() => {
      router.push('/reviews');
    });
  };

  const handleStatusChange = async (reviewId: string, status: string) => {
    setLoadingId(reviewId);
    try {
      const fd = new FormData();
      fd.set('reviewId', reviewId);
      fd.set('status', status);
      const result = await updateReviewStatusAction(fd);
      if (result.success) {
        addToast(`Review ${status}`, 'success');
        setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, moderation_status: status as any } : r));
      } else {
        addToast(result.error ?? 'Failed to update review', 'error');
      }
    } catch {
      addToast('Failed to update review', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (reviewId: string) => {
    if (!confirm('Are you sure you want to permanently delete this review?')) return;
    setLoadingId(reviewId);
    try {
      const result = await deleteReviewAction(reviewId);
      if (result.success) {
        addToast('Review deleted', 'success');
        setReviews(prev => prev.filter(r => r.id !== reviewId));
      } else {
        addToast(result.error ?? 'Failed to delete review', 'error');
      }
    } catch {
      addToast('Failed to delete review', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const filterChips: { key: string; label: string }[] = [];
  if (search) filterChips.push({ key: 'search', label: `Search: "${search}"` });
  if (statusFilter) {
    const label = statusFilter === 'pending' ? 'Pending' : statusFilter === 'approved' ? 'Approved' : 'Rejected';
    filterChips.push({ key: 'status', label: `Status: ${label}` });
  }

  /* ------------------------------------------------------------------ */
  /*  Stats Strip                                                        */
  /* ------------------------------------------------------------------ */

  const statItems = [
    { label: 'Total Reviews', value: stats.total, icon: MessageSquare, color: 'primary' as const, filter: '' },
    { label: 'Pending', value: stats.pending, icon: Clock, color: 'warning' as const, filter: 'pending' },
    { label: 'Approved', value: stats.approved, icon: CheckCircle2, color: 'success' as const, filter: 'approved' },
    { label: 'Rejected', value: stats.rejected, icon: AlertTriangle, color: 'destructive' as const, filter: 'rejected' },
    { label: 'Verified', value: stats.verified, icon: ThumbsUp, color: 'primary' as const, filter: 'verified' },
  ];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statItems.map((item) => {
          const Icon = item.icon;
          const isActive = statusFilter === item.filter || (!statusFilter && !item.filter);
          return (
            <button
              key={item.label}
              onClick={() => updateQueryParam('status', item.filter)}
              className={`relative overflow-hidden rounded-xl border ${isActive ? 'border-primary ring-1 ring-primary/30' : 'border-border'} bg-card p-3 text-left transition-all hover:shadow-md`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`rounded-lg p-1.5 bg-${item.color}/10`}>
                  <Icon className={`h-3.5 w-3.5 text-${item.color}`} />
                </div>
                {isActive && (
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
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by product or customer..."
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
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
                <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground font-medium shrink-0 hidden sm:inline">Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => updateQueryParam('status', e.target.value)}
                  className="bg-transparent border-none focus:ring-0 cursor-pointer text-foreground font-semibold text-xs outline-none appearance-none pr-4 min-w-[80px]"
                >
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <ChevronDown className="h-3 w-3 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
            {hasFilters && (
              <button onClick={clearAllFilters} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
        {filterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active:</span>
            {filterChips.map(chip => (
              <button
                key={chip.key}
                onClick={() => updateQueryParam(chip.key, '')}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {chip.label}
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
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
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Product</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Customer</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Rating</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Review</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Date</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {hasFilters ? 'No reviews match your filters' : 'No reviews yet'}
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        {hasFilters ? 'Try adjusting your filters.' : 'Product reviews will appear here.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                reviews.map((review) => {
                  const isLoading = loadingId === review.id;
                  return (
                    <tr key={review.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-5 py-3 min-w-[160px]">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                            <Package className="h-3.5 w-3.5 text-muted-foreground/50" />
                          </div>
                          <span className="text-xs font-semibold text-foreground truncate max-w-[140px]" title={review.product?.name_en ?? 'Unknown'}>
                            {review.product?.name_en ?? 'Unknown Product'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 border border-border">
                            {review.profile?.avatar_url ? (
                              <Image src={review.profile.avatar_url} alt="" width={28} height={28} className="rounded-full object-cover" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-muted-foreground/50" />
                            )}
                          </div>
                          <span className="text-xs font-semibold text-foreground truncate max-w-[100px]">
                            {review.profile?.full_name ?? 'Anonymous'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <StarRating rating={review.rating} />
                      </td>
                      <td className="px-5 py-3 max-w-[260px]">
                        <div className="flex flex-col gap-0.5">
                          {review.title && (
                            <span className="text-xs font-semibold text-foreground truncate">{review.title}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground truncate">{review.comment ?? 'No comment'}</span>
                          {review.is_verified_purchase && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-success font-semibold">
                              <CheckCircle2 className="h-3 w-3" /> Verified Purchase
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <StatusBadge status={review.moderation_status ?? 'pending'} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-[11px] text-muted-foreground">{formatRelativeTime(review.created_at)}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          {review.moderation_status !== 'approved' && (
                            <button
                              onClick={() => handleStatusChange(review.id, 'approved')}
                              disabled={isLoading}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-success/10 hover:text-success transition-all"
                              title="Approve"
                            >
                              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {review.moderation_status !== 'rejected' && (
                            <button
                              onClick={() => handleStatusChange(review.id, 'rejected')}
                              disabled={isLoading}
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-warning/10 hover:text-warning transition-all"
                              title="Reject"
                            >
                              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(review.id)}
                            disabled={isLoading}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
                            title="Delete"
                          >
                            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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
            Showing <span className="font-semibold text-foreground">{reviews.length}</span> of <span className="font-semibold text-foreground">{total}</span> reviews
          </span>
          {totalPages > 1 && (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
          )}
        </div>
      </div>
    </div>
  );
}
