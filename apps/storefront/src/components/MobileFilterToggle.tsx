'use client';

import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

interface MobileFilterToggleProps {
  activeFilterCount?: number;
}

export function MobileFilterToggle({ activeFilterCount = 0 }: MobileFilterToggleProps) {
  const openFilter = useUIStore((state) => state.openFilter);
  return (
    <button
      onClick={openFilter}
      className="md:hidden inline-flex items-center gap-1.5 h-8 px-3 border border-[var(--color-border)] rounded-sm text-xs font-medium text-foreground-muted hover:bg-accent transition-colors relative"
    >
      <SlidersHorizontal className="w-3.5 h-3.5" />
      Filters
      {activeFilterCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-[3px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none shadow-sm">
          {activeFilterCount}
        </span>
      )}
    </button>
  );
}
