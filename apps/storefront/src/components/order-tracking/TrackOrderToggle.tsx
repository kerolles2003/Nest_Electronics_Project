'use client';

import { useState } from 'react';
import { Button } from '@nest/ui';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import OrderTimeline from './OrderTimeline';
import ShipmentInfo from './ShipmentInfo';

interface TrackOrderToggleProps {
  order: any;
}

export default function TrackOrderToggle({ order }: TrackOrderToggleProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <Button
          onClick={() => setIsOpen(!isOpen)}
          className={`h-14 px-10 text-[14px] font-black uppercase tracking-[0.2em] rounded-sm transition-all flex items-center gap-3 ${
            isOpen 
              ? 'bg-surface border border-border text-foreground hover:bg-surface/80' 
              : 'bg-primary text-white hover:bg-primary-hover shadow-xl shadow-primary/20 hover:-translate-y-0.5'
          }`}
        >
          {isOpen ? (
            <>
              <ChevronUp className="w-4 h-4" />
              HIDE TRACKING INFO
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              TRACK MY ORDER
            </>
          )}
        </Button>
      </div>

      {isOpen && (
        <div className="bg-white border border-[var(--color-border)] rounded-sm p-6 sm:p-10 shadow-sm relative overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
            <Search className="w-40 h-40" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-7">
              {order.status_history && order.status_history.length > 0 ? (
                <OrderTimeline history={order.status_history} />
              ) : (
                <div className="p-8 bg-[var(--color-surface)] rounded-sm border border-dashed border-[var(--color-border-strong)] text-center">
                  <p className="text-sm text-foreground-muted">No status history available yet.</p>
                </div>
              )}
            </div>
            <div className="lg:col-span-5">
              <ShipmentInfo address={order.shipping_address} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
