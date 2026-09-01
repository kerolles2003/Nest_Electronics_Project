'use client';

import { ShippingAddress } from '@nest/types';
import { Label } from '@nest/ui';

interface Props {
  address: ShippingAddress;
}

export default function ShipmentInfo({ address }: Props) {
  return (
    <div className="flex flex-col h-full">
      <h3 className="font-bold text-foreground mb-4 uppercase tracking-wider text-xs">Shipping Address</h3>
      <div className="bg-surface border border-[var(--color-border)] rounded-sm p-4 flex-1">
        <p className="text-[15px] font-bold text-foreground mb-2">{address.full_name}</p>
        <div className="space-y-1 text-[13px] text-foreground-muted font-medium">
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border-strong)]" />
            {address.phone}
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border-strong)]" />
            {address.street}
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border-strong)]" />
            {address.city}, {address.governorate}
          </p>
          {address.postal_code && (
            <p className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border-strong)]" />
              ZIP: {address.postal_code}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
