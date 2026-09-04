'use client';

import { useState, useTransition } from 'react';
import { X, Loader2, Minus, Plus, Box, AlertTriangle, CheckCircle2, PackagePlus, Wrench, Trash2 } from 'lucide-react';
import { adjustStockAction } from '@/actions/inventory.actions';
import type { AdjustmentType, StockLevel } from '@/lib/api/types';

/**
 * Move stock by a signed delta, with a reason and a kind.
 *
 * ## A delta, never a target
 *
 * The field asks how much stock MOVED, not what the number should become. That
 * is preserved from `adjust_stock_v2` — whose semantics were right even though
 * it never once ran successfully — and it is not a stylistic choice: an
 * absolute value silently overwrites a sale that landed while the dialog was
 * open, and a delta composes with it.
 *
 * ## The kind is required, and it is not cosmetic
 *
 * `RESTOCK`, `ADJUSTMENT` and `DAMAGE` are different business events. Reporting
 * has to tell "we received 100" from "the count was wrong" from "three were
 * broken", and a single generic movement type makes that permanently
 * unanswerable. The three an operator may post are the only three the API
 * accepts here: `SALE`, `RETURN` and `CANCELLATION` belong to an order's own
 * transaction, and an operator able to hand-write a `SALE` could move stock
 * with no order behind it.
 *
 * ## Validation lives on the server
 *
 * The reason minimum, the non-zero delta and the floor at zero are the API's
 * rules and its messages are shown verbatim. This dialog previews the resulting
 * balance and refuses to submit an obviously empty form; it does not
 * re-implement the rules, because two copies is two things to keep in step.
 */

interface InventoryAdjustDialogProps {
  level: StockLevel;
  onClose: () => void;
  onAdjusted: () => void;
}

const TYPES: { value: AdjustmentType; label: string; hint: string; icon: typeof PackagePlus }[] = [
  { value: 'RESTOCK', label: 'Restock', hint: 'Goods arrived', icon: PackagePlus },
  { value: 'ADJUSTMENT', label: 'Correction', hint: 'The count was wrong', icon: Wrench },
  { value: 'DAMAGE', label: 'Damage', hint: 'Units were destroyed', icon: Trash2 },
];

export function InventoryAdjustDialog({ level, onClose, onAdjusted }: InventoryAdjustDialogProps) {
  const [direction, setDirection] = useState<1 | -1>(1);
  const [magnitude, setMagnitude] = useState('');
  const [reason, setReason] = useState('');
  const [type, setType] = useState<AdjustmentType>('RESTOCK');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const units = Number.parseInt(magnitude, 10);
  const hasUnits = Number.isInteger(units) && units > 0;
  const delta = hasUnits ? units * direction : 0;
  const projected = level.onHand + delta;

  /*
   * The API floors stock at zero and refuses the movement rather than clamping
   * it. Saying so before the request is sent is the difference between a form
   * that teaches and a form that scolds — but the refusal itself is still the
   * server's, so this only previews it.
   */
  const wouldGoNegative = hasUnits && projected < 0;
  const canSubmit = hasUnits && reason.trim().length >= 3 && !wouldGoNegative && !isPending;

  const submit = () => {
    setError(null);

    startTransition(async () => {
      const result = await adjustStockAction({
        productId: level.productId,
        delta,
        reason: reason.trim(),
        type,
      });

      if (!result.ok) {
        setError(result.error ?? 'The adjustment was not applied.');
        return;
      }

      onAdjusted();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-elevated">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Adjust stock</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={level.name}>
              {level.name}
            </p>
            <span className="text-[11px] font-mono text-muted-foreground">{level.sku}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Current */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Box className="h-3.5 w-3.5" />
              On hand now
            </span>
            <span className="text-sm font-bold tabular-nums text-foreground">{level.onHand}</span>
          </div>

          {/* Kind */}
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              What kind of movement
            </span>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {TYPES.map((option) => {
                const Icon = option.icon;
                const selected = option.value === type;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setType(option.value)}
                    className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background hover:bg-muted'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="mt-1 block text-xs font-bold text-foreground">{option.label}</span>
                    <span className="block text-[10px] leading-tight text-muted-foreground">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Delta */}
          <div>
            <label htmlFor="adjust-units" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              How many units moved
            </label>
            <div className="mt-1.5 flex items-stretch gap-2">
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setDirection(1)}
                  aria-pressed={direction === 1}
                  className={`inline-flex items-center gap-1 rounded-md px-3 text-xs font-bold transition-colors ${
                    direction === 1 ? 'bg-success/15 text-success' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Plus className="h-3.5 w-3.5" /> In
                </button>
                <button
                  type="button"
                  onClick={() => setDirection(-1)}
                  aria-pressed={direction === -1}
                  className={`inline-flex items-center gap-1 rounded-md px-3 text-xs font-bold transition-colors ${
                    direction === -1 ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Minus className="h-3.5 w-3.5" /> Out
                </button>
              </div>
              <input
                id="adjust-units"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={magnitude}
                onChange={(event) => setMagnitude(event.target.value)}
                placeholder="0"
                className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm tabular-nums outline-none transition-all focus:ring-2 focus:ring-primary/10"
              />
            </div>

            {hasUnits && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {level.onHand} {delta >= 0 ? '+' : '−'} {Math.abs(delta)} ={' '}
                <span className={`font-bold tabular-nums ${wouldGoNegative ? 'text-destructive' : 'text-foreground'}`}>
                  {projected}
                </span>
              </p>
            )}

            {wouldGoNegative && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Stock cannot go below zero — there are only {level.onHand} on hand.
              </p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label htmlFor="adjust-reason" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Why
            </label>
            <textarea
              id="adjust-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Damaged in storage — water ingress on the top shelf"
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/10"
            />
            {/*
              Not a nag. This is the field that makes the ledger readable a year
              later, and it is the one the legacy schema never enforced.
            */}
            <p className="mt-1 text-[10px] text-muted-foreground">
              Required, at least 3 characters. It is what makes this movement explicable later.
            </p>
          </div>

          {error !== null && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Apply adjustment
          </button>
        </div>
      </div>
    </div>
  );
}
