'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, History, Package, AlertTriangle, CheckCircle2, Minus, Plus, Box, User, Calendar } from 'lucide-react';
import { Button, Pagination } from '@nest/ui';
import { getInventoryTransactionsAction } from '@/actions/inventory.actions';
import type { Product } from '@nest/types';

interface Props {
  product: Pick<Product, 'id' | 'name_en' | 'sku' | 'stock_quantity' | 'reserved_quantity' | 'available_stock' | 'low_stock_threshold'>;
  onClose: () => void;
}

function formatTransactionType(type: string) {
  const map: Record<string, string> = {
    purchase: 'Restock',
    sale: 'Order Deduction',
    return: 'Return',
    adjustment: 'Adjustment',
    reservation: 'Reservation',
    reservation_release: 'Release',
    damaged: 'Damaged',
  };
  return map[type] || type.replace(/_/g, ' ');
}

function formatTransactionColor(type: string) {
  const map: Record<string, string> = {
    purchase: 'bg-success/10 text-success border-success/20',
    sale: 'bg-primary/10 text-primary border-primary/20',
    return: 'bg-primary/10 text-primary border-primary/20',
    adjustment: 'bg-warning/10 text-warning border-warning/20',
    reservation: 'bg-warning/10 text-warning border-warning/20',
    reservation_release: 'bg-muted text-muted-foreground border-border',
    damaged: 'bg-destructive/10 text-destructive border-destructive/20',
  };
  return map[type] || 'bg-muted text-muted-foreground border-border';
}

function formatTransactionIcon(type: string) {
  switch (type) {
    case 'purchase': return Plus;
    case 'sale': return Minus;
    case 'return': return Box;
    case 'adjustment': return History;
    case 'reservation': return Package;
    case 'reservation_release': return CheckCircle2;
    case 'damaged': return AlertTriangle;
    default: return History;
  }
}

function formatDate(dateString: string) {
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  return formatDate(dateString);
}

export function InventoryTransactionDrawer({ product, onClose }: Props) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const limit = 15;

  const fetchTransactions = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError('');
    try {
      const result = await getInventoryTransactionsAction(product.id, targetPage, limit);
      if (result.success) {
        setTransactions(result.data ?? []);
        setTotal(result.total ?? 0);
        setTotalPages(result.totalPages ?? 1);
        setPage(targetPage);
      } else {
        setError(result.error ?? 'Failed to load transactions');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    fetchTransactions(1);
  }, [fetchTransactions]);

  const isLowStock = product.stock_quantity <= (product.low_stock_threshold ?? 5);
  const isOutOfStock = product.stock_quantity === 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-lg bg-card border-l border-border shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider truncate">Transaction History</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{product.name_en}</p>
            <p className="text-[11px] font-mono text-muted-foreground">SKU: {product.sku}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors shrink-0" aria-label="Close">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Current Stock Summary */}
        <div className="px-5 py-3 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex-1 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Current Stock</p>
                  <p className="text-lg font-bold text-foreground tabular-nums mt-0.5">{product.stock_quantity}</p>
                </div>
                {isOutOfStock ? (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-bold bg-rose-500/10 text-rose-400 shrink-0">
                    <AlertTriangle className="h-3 w-3" /> Out
                  </span>
                ) : isLowStock ? (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-bold bg-amber-500/10 text-amber-400 shrink-0">
                    <AlertTriangle className="h-3 w-3" /> Low
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-bold bg-emerald-500/10 text-emerald-400 shrink-0">
                    <CheckCircle2 className="h-3 w-3" /> OK
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
                <span>Reserved: <strong className="text-foreground">{product.reserved_quantity}</strong></span>
                <span>Available: <strong className={product.available_stock <= 0 ? 'text-rose-400' : 'text-foreground'}>{product.available_stock}</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* Transaction List */}
        <div className="flex-1 overflow-y-auto">
          {loading && transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading transactions...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 px-5">
              <AlertTriangle className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground text-center">{error}</p>
              <Button variant="outline" size="sm" onClick={() => fetchTransactions(page)} className="rounded-lg text-xs">
                Retry
              </Button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 px-5 text-center">
              <History className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No transactions yet</p>
              <p className="text-xs text-muted-foreground/60">Stock adjustments, orders, and restocks will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {transactions.map((tx) => {
                const Icon = formatTransactionIcon(tx.type);
                const qty = tx.quantity ?? 0;
                return (
                  <div key={tx.id} className="px-5 py-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`rounded-lg p-2 shrink-0 border ${formatTransactionColor(tx.type)}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-xs font-bold text-foreground truncate">{formatTransactionType(tx.type)}</span>
                          <span className={`text-xs font-bold tabular-nums shrink-0 ${qty >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {qty >= 0 ? '+' : ''}{qty}
                          </span>
                        </div>
                        {tx.notes && (
                          <p className="text-[11px] text-muted-foreground truncate">{tx.notes}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                            <Calendar className="h-3 w-3" />
                            {formatRelativeTime(tx.created_at)}
                          </span>
                          {tx.profiles?.full_name && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 truncate max-w-[120px]">
                              <User className="h-3 w-3" />
                              {tx.profiles.full_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer / Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-border bg-muted/20 shrink-0 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              Page <strong className="text-foreground">{page}</strong> of <strong className="text-foreground">{totalPages}</strong>
            </span>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={(p) => fetchTransactions(p)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
