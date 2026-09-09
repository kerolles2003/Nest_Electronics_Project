'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, History, AlertTriangle, Box, User, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { getStockHistoryAction } from '@/actions/inventory.actions';
import type { InventoryEvent, StockLevel } from '@/lib/api/types';

/**
 * One product's movement ledger, newest first.
 *
 * ## Why every event type appears, not only the ones an operator posts
 *
 * A balance is only explicable if the sales are in the list beside the
 * restocks. `SALE`, `RETURN` and `CANCELLATION` are written inside an order's
 * own transaction and can never be posted from this console — but they are
 * exactly what accounts for the difference between yesterday's number and
 * today's, so they are read here.
 *
 * ## `balanceBefore` and `balanceAfter` are the server's
 *
 * Each row states the balance either side of its own movement, recorded at the
 * time inside the transaction that moved the stock. The drawer does not add
 * deltas up to reconstruct them: a running total computed in the browser is a
 * second opinion about a number the database already knows, and the two
 * disagreeing is how legacy's decorative ledger looked right until somebody
 * checked it.
 *
 * ## An empty ledger and a failed request are different things
 *
 * "No movements recorded" is a claim about a product. It is only made when the
 * request succeeded and came back empty.
 */

interface InventoryHistoryDrawerProps {
  level: StockLevel;
  onClose: () => void;
}

/** Colour by direction of the movement, and by whether it was chosen. */
const TYPE_STYLE: Record<string, string> = {
  RESTOCK: 'bg-success/10 text-success border-success/20',
  ADJUSTMENT: 'bg-warning/10 text-warning border-warning/20',
  DAMAGE: 'bg-destructive/10 text-destructive border-destructive/20',
  SALE: 'bg-primary/10 text-primary border-primary/20',
  RETURN: 'bg-purple/10 text-purple border-purple/20',
  CANCELLATION: 'bg-muted text-muted-foreground border-border',
  OPENING_BALANCE: 'bg-muted text-muted-foreground border-border',
};

const TYPE_LABEL: Record<string, string> = {
  RESTOCK: 'Restock',
  ADJUSTMENT: 'Correction',
  DAMAGE: 'Damage',
  SALE: 'Sold',
  RETURN: 'Returned',
  CANCELLATION: 'Order cancelled',
  OPENING_BALANCE: 'Opening balance',
};

function formatWhen(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InventoryHistoryDrawer({ level, onClose }: InventoryHistoryDrawerProps) {
  const [events, setEvents] = useState<InventoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await getStockHistoryAction(level.productId, 1, 25);

      if (cancelled) return;

      if (!result.ok) {
        setError(result.error ?? 'The movement history could not be read.');
        return;
      }

      setEvents(result.events ?? []);
      setTotal(result.total ?? 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [level.productId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <aside className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-elevated">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="inline-flex items-center gap-2 text-base font-bold text-foreground">
              <History className="h-4 w-4 text-primary" />
              Movement history
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={level.name}>
              {level.name}
            </p>
            <span className="text-[11px] font-mono text-muted-foreground">{level.sku}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error !== null && (
            <div className="m-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {error === null && events === null && (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading the ledger...
            </div>
          )}

          {events !== null && events.length === 0 && (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Box className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p data-testid="history-empty" className="text-sm font-medium text-muted-foreground">
                No movements recorded
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                Nothing has moved this product&apos;s stock since it was created.
              </p>
            </div>
          )}

          {events !== null && events.length > 0 && (
            <div className="divide-y divide-border">
              {events.map((event, index) => {
                const chip = TYPE_STYLE[event.type] ?? 'bg-muted text-muted-foreground border-border';
                const label = TYPE_LABEL[event.type] ?? event.type;
                const positive = event.quantityDelta >= 0;

                return (
                  <div
                    key={`${event.createdAt}-${String(index)}`}
                    data-testid="history-event"
                    data-event-type={event.type}
                    className="px-5 py-3 transition-colors hover:bg-muted/20"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span
                        data-testid="history-type"
                        className={`rounded-full border px-1.5 py-[2px] text-[10px] font-bold ${chip}`}
                      >
                        {label}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">
                        {formatWhen(event.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        data-testid="history-delta"
                        className={`text-sm font-bold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}
                      >
                        {positive ? '+' : ''}
                        {event.quantityDelta}
                      </span>
                      {/* Recorded, not recomputed. See the docstring. */}
                      <span data-testid="history-balance" className="text-[11px] tabular-nums text-muted-foreground">
                        {event.balanceBefore} →{' '}
                        <span data-testid="history-balance-after" className="font-semibold text-foreground">
                          {event.balanceAfter}
                        </span>
                      </span>
                    </div>

                    <p data-testid="history-reason" className="mt-1 text-xs text-foreground">
                      {event.reason}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      {event.actorName !== null && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <User className="h-3 w-3" />
                          {event.actorName}
                        </span>
                      )}
                      {event.referenceId !== null && (
                        <Link
                          href={`/orders/${event.referenceId}`}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          The order behind it
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {events !== null && events.length > 0 && (
          <div className="border-t border-border bg-muted/20 px-5 py-3">
            <span className="text-xs text-muted-foreground">
              {/*
                Says "most recent 25" rather than pretending the drawer holds
                everything. The full ledger is paginated; a drawer showing a
                window of it must not read as a complete record.
              */}
              Showing the most recent <span className="font-semibold text-foreground">{events.length}</span>{' '}
              of <span className="font-semibold text-foreground">{total}</span> movements
            </span>
          </div>
        )}
      </aside>
    </div>
  );
}
