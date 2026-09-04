'use client';

import { useState, useTransition } from 'react';
import { Search, Truck, Check, X, Pencil, Loader2 } from 'lucide-react';
import { useToast, Input, Button, Badge } from '@nest/ui';
import type { AdminShippingRate } from '@/lib/api/types';
import { updateShippingRateAction } from '@/actions/shipping-rates.actions';

interface ShippingRatesTableProps {
  initialRates: AdminShippingRate[];
}

export function ShippingRatesTable({ initialRates }: ShippingRatesTableProps) {
  const { addToast } = useToast();
  const [rates, setRates] = useState<AdminShippingRate[]>(initialRates);
  const [search, setSearch] = useState('');
  const [editingGov, setEditingGov] = useState<string | null>(null);
  const [editFeeEgp, setEditFeeEgp] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  const filteredRates = rates.filter((r) =>
    r.governorate.toLowerCase().includes(search.toLowerCase()),
  );

  const startEdit = (rate: AdminShippingRate) => {
    setEditingGov(rate.governorate);
    // fee is in minor units (piastres), convert to major EGP for human editing
    setEditFeeEgp((rate.fee / 100).toFixed(2));
  };

  const cancelEdit = () => {
    setEditingGov(null);
    setEditFeeEgp('');
  };

  const saveEdit = (governorate: string) => {
    const val = parseFloat(editFeeEgp);
    if (isNaN(val) || val < 0) {
      addToast('Please enter a valid non-negative fee', 'error');
      return;
    }

    startTransition(async () => {
      const res = await updateShippingRateAction(governorate, val);
      if (res.ok && res.rate) {
        const updatedRate = res.rate;
        setRates((prev) =>
          prev.map((r) => (r.governorate === governorate ? updatedRate : r)),
        );
        setEditingGov(null);
        setEditFeeEgp('');
        addToast(`Shipping rate for ${governorate} updated to ${updatedRate.formattedFee}`, 'success');
      } else {
        addToast(res.error ?? 'Failed to update shipping rate', 'error');
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Policy banner explaining D-8 invariants */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground space-y-2">
        <div className="flex items-center gap-2 font-medium text-primary">
          <Truck className="h-4 w-4" />
          <span>Governorate Shipping Rates Policy (D-8 Invariant)</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The rate table covers all 27 official Egyptian governorates. Missing rows cause checkout quoting failures,
          so rate deletion is permanently forbidden. Free shipping is configured by setting a rate to 0.00 EGP.
          Every fee modification is recorded in the immutable audit log and takes effect immediately at checkout.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search governorates..."
            className="pl-9"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Showing {filteredRates.length} of {rates.length} governorates
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-subtle">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/40 border-b border-border text-xs uppercase text-muted-foreground tracking-wider">
              <tr>
                <th className="px-6 py-3.5 font-medium">Governorate</th>
                <th className="px-6 py-3.5 font-medium">Shipping Fee</th>
                <th className="px-6 py-3.5 font-medium">Status</th>
                <th className="px-6 py-3.5 font-medium">Last Updated</th>
                <th className="px-6 py-3.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredRates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    No governorates match your search query.
                  </td>
                </tr>
              ) : (
                filteredRates.map((rate) => {
                  const isEditing = editingGov === rate.governorate;
                  const isFree = rate.fee === 0;

                  return (
                    <tr
                      key={rate.governorate}
                      className="hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-6 py-4 font-medium text-foreground">
                        {rate.governorate}
                      </td>
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <div className="flex items-center gap-2 max-w-[160px]">
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              value={editFeeEgp}
                              onChange={(e) => setEditFeeEgp(e.target.value)}
                              className="h-8 text-sm"
                              autoFocus
                              disabled={isPending}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(rate.governorate);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                            />
                            <span className="text-xs text-muted-foreground">EGP</span>
                          </div>
                        ) : (
                          <span className="font-mono text-foreground font-semibold">
                            {rate.formattedFee}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isFree ? (
                          <Badge variant="success" className="text-xs">
                            Free Shipping
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Standard
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">
                        {new Date(rate.updatedAt).toLocaleString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              disabled={isPending}
                              onClick={() => saveEdit(rate.governorate)}
                              className="h-8 px-2.5"
                            >
                              {isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5 mr-1" />
                              )}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isPending}
                              onClick={cancelEdit}
                              className="h-8 px-2"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(rate)}
                            className="h-8 px-3 text-xs"
                          >
                            <Pencil className="h-3 w-3 mr-1.5" />
                            Edit Fee
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
