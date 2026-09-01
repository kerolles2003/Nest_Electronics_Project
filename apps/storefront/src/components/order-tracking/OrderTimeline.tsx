'use client';

import { OrderStatusHistory } from '@nest/types';
import { StatusBadge } from '@nest/ui';
import { cn } from '@nest/ui/utils';

interface Props {
  history: OrderStatusHistory[];
}

const statusStepColors: Record<string, string> = {
  pending_payment: 'bg-amber-400',
  paid: 'bg-blue-400',
  processing: 'bg-blue-400',
  shipped: 'bg-sky-400',
  delivered: 'bg-green-500',
  cancelled: 'bg-red-400',
  failed: 'bg-red-400',
};

export default function OrderTimeline({ history }: Props) {
  const sorted = [...history].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="flex flex-col">
      <h3 className="font-bold text-foreground mb-4 uppercase tracking-wider text-xs">Status Timeline</h3>
      <div className="space-y-6">
        {sorted.map((entry, idx) => (
          <div key={entry.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={`w-3 h-3 rounded-full mt-1 ${
                  statusStepColors[entry.to_value] ?? 'bg-[var(--color-border-strong)]'
                } ${idx === 0 ? 'ring-4 ring-primary/20 shadow-sm animate-pulse scale-110' : ''}`}
              />
              {idx < sorted.length - 1 && (
                <div className="w-[1px] flex-1 bg-[var(--color-border)] mt-2" />
              )}
            </div>
            <div>
              <p className={cn(
                "text-[14px] font-bold capitalize leading-none",
                idx === 0 ? "text-primary" : "text-foreground"
              )}>
                {entry.to_value.replace(/_/g, ' ')}
              </p>
              <p className="text-[12px] text-foreground-muted mt-1.5 font-medium">
                {new Date(entry.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })} at {new Date(entry.created_at).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
              {entry.notes && (
                <div className="mt-2 p-2 bg-surface rounded text-[12px] text-foreground-muted border border-[var(--color-border)] italic">
                  {entry.notes}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
