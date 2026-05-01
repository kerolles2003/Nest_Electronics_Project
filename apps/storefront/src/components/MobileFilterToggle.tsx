'use client';

import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

export function MobileFilterToggle() {
  const { openFilter } = useUIStore();
  return (
    <button
      onClick={openFilter}
      className="md:hidden inline-flex items-center gap-1.5 h-8 px-3 border border-gray-200 rounded-sm text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
    >
      <SlidersHorizontal className="w-3.5 h-3.5" />
      Filters
    </button>
  );
}
