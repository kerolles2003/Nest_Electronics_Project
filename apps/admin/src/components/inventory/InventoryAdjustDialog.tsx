'use client';

import { useState, useCallback, useMemo } from 'react';
import { X, Loader2, Minus, Plus, Box, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@nest/ui';
import { useToast } from '@nest/ui';
import type { Product } from '@nest/types';
import { adjustStockAction } from '@/actions/inventory.actions';

type AdjustmentType = 'stock_in' | 'stock_out' | 'set_exact';

interface Props {
  product: Pick<Product, 'id' | 'name_en' | 'sku' | 'stock_quantity' | 'reserved_quantity' | 'available_stock' | 'low_stock_threshold'>;
  onClose: () => void;
}

export function InventoryAdjustDialog({ product, onClose }: Props) {
  const { addToast } = useToast();
  const [type, setType] = useState<AdjustmentType>('stock_in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const qtyNum = parseInt(quantity, 10);
  const isValidQty = !isNaN(qtyNum) && qtyNum > 0;

  const previewStock = useMemo(() => {
    if (!isValidQty) return null;
    if (type === 'stock_in') return product.stock_quantity + qtyNum;
    if (type === 'stock_out') return Math.max(0, product.stock_quantity - qtyNum);
    return qtyNum;
  }, [type, qtyNum, isValidQty, product.stock_quantity]);

  const previewAvailable = useMemo(() => {
    if (previewStock === null) return null;
    return Math.max(0, previewStock - product.reserved_quantity);
  }, [previewStock, product.reserved_quantity]);

  const handleSubmit = useCallback(async () => {
    setError('');

    if (!quantity || isNaN(qtyNum) || qtyNum < 1) {
      setError('Quantity must be a positive number');
      return;
    }

    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }

    if (type === 'stock_out' && qtyNum > product.available_stock) {
      setError(`Cannot remove more than available stock (${product.available_stock})`);
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.set('productId', product.id);

      let finalQty: number;
      if (type === 'stock_in') {
        finalQty = qtyNum;
      } else if (type === 'stock_out') {
        finalQty = -qtyNum;
      } else {
        finalQty = qtyNum - product.stock_quantity;
      }

      formData.set('quantity', finalQty.toString());
      formData.set('reason', reason);

      const result = await adjustStockAction(formData);

      if (result.success) {
        addToast('Stock adjusted successfully', 'success');
        onClose();
        setTimeout(() => window.location.reload(), 500);
      } else {
        setError(result.error ?? 'Failed to adjust stock');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [type, quantity, reason, product, addToast, onClose, qtyNum]);

  const typeOptions: { value: AdjustmentType; label: string; icon: typeof Plus; desc: string; color: string }[] = [
    { value: 'stock_in', label: 'Stock In', icon: Plus, desc: 'Add inventory', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    { value: 'stock_out', label: 'Stock Out', icon: Minus, desc: 'Remove inventory', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    { value: 'set_exact', label: 'Set Exact', icon: Box, desc: 'Set total stock', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  ];

  const isLowStock = product.stock_quantity <= (product.low_stock_threshold ?? 5);
  const isOutOfStock = product.stock_quantity === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Adjust Stock</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Update inventory levels</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors" aria-label="Close">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Product Info Card */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-foreground">{product.name_en}</p>
                <p className="text-[11px] font-mono text-muted-foreground">SKU: {product.sku}</p>
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
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span>Stock: <strong className="text-foreground">{product.stock_quantity}</strong></span>
              <span>Reserved: <strong className="text-foreground">{product.reserved_quantity}</strong></span>
              <span>Available: <strong className={product.available_stock <= 0 ? 'text-rose-400' : 'text-foreground'}>{product.available_stock}</strong></span>
            </div>
          </div>

          {/* Adjustment Type */}
          <div>
            <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Adjustment Type</label>
            <div className="grid grid-cols-3 gap-2">
              {typeOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = type === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => { setType(opt.value); setQuantity(''); setError(''); }}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center transition-all ${isActive ? opt.color + ' ring-1' : 'border-border bg-background hover:bg-muted/40'}`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? '' : 'text-muted-foreground'}`} />
                    <span className={`text-[11px] font-bold ${isActive ? '' : 'text-foreground'}`}>{opt.label}</span>
                    <span className="text-[9px] text-muted-foreground">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Quantity</label>
            <input
              type="number"
              min={1}
              max={type === 'stock_out' ? product.available_stock : undefined}
              value={quantity}
              onChange={(e) => { setQuantity(e.target.value); setError(''); }}
              placeholder={type === 'set_exact' ? `Current: ${product.stock_quantity}` : 'Enter quantity'}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-bold tabular-nums focus:ring-2 focus:ring-primary/10 transition-all outline-none"
              autoFocus
            />
            {type === 'stock_out' && (
              <p className="text-[10px] text-muted-foreground mt-1">Max removable: {product.available_stock}</p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(''); }}
              placeholder="e.g., Physical count, supplier restock, damaged goods..."
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
            />
          </div>

          {/* Stock Preview */}
          {previewStock !== null && previewAvailable !== null && (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Result Preview</p>
              <div className="flex items-center justify-between text-sm">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">New Stock</span>
                  <span className="font-bold text-foreground tabular-nums">{previewStock}</span>
                </div>
                <div className="text-muted-foreground">→</div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-muted-foreground">New Available</span>
                  <span className={`font-bold tabular-nums ${previewAvailable <= 0 ? 'text-rose-400' : previewAvailable <= (product.low_stock_threshold ?? 5) ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {previewAvailable}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-400 font-medium">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={loading} className="rounded-lg text-xs">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading || !isValidQty || !reason.trim()} className="rounded-lg text-xs">
              {loading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {loading ? 'Adjusting...' : 'Confirm Adjustment'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
