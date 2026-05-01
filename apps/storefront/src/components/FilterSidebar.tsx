'use client';

import React, { useState } from 'react';
import { useQueryStates } from 'nuqs';
import { X, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { productsSearchParamsSchema } from '@/app/products/search-params';
import { useUIStore } from '@/stores/ui-store';
import type { Category, Brand } from '@nest/types';

interface FilterSidebarProps {
  categories: Category[];
  brands: Brand[];
}

function FilterGroup({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-white border border-border rounded-md overflow-hidden mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-4 py-3 text-sm font-semibold text-foreground cursor-pointer hover:bg-surface transition-colors"
      >
        {title}
        {isOpen ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
      </button>
      {isOpen && <div className="px-4 pb-4 pt-1 space-y-2">{children}</div>}
    </div>
  );
}

function CheckboxFilter({ checked, onChange, label }: { checked: boolean; onChange: (e?: React.ChangeEvent<HTMLInputElement>) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e)}
        className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

export function FilterSidebar({ categories, brands }: FilterSidebarProps) {
  const { isFilterOpen, closeFilter } = useUIStore();

  const [params, setParams] = useQueryStates(productsSearchParamsSchema, {
    shallow: false,
  });

  const handleCategoryChange = (slug: string) => {
    setParams({ category: params.category === slug ? null : slug, page: 1 });
  };

  const handleBrandChange = (slug: string) => {
    setParams({ brand: params.brand === slug ? null : slug, page: 1 });
  };

  const handleInStockChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParams({ in_stock: e.target.checked ? true : null, page: 1 });
  };

  const handlePriceChange = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const min = formData.get('min_price') as string;
    const max = formData.get('max_price') as string;
    setParams({
      min_price: min ? parseInt(min, 10) : null,
      max_price: max ? parseInt(max, 10) : null,
      page: 1,
    });
  };

  const clearFilters = () => {
    setParams({ category: null, brand: null, min_price: null, max_price: null, in_stock: null, page: 1 });
  };

  const hasActiveFilters = !!(params.category || params.brand || params.min_price || params.max_price || params.in_stock);

  const FilterContent = (
    <div className="space-y-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wide flex items-center gap-2">
          <Filter className="w-4 h-4" />
          Filters
        </h2>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-danger hover:underline font-medium transition-colors">
            Clear All
          </button>
        )}
      </div>

      <FilterGroup title="Category">
        <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
          {categories.map((cat) => (
            <CheckboxFilter
              key={cat.id}
              checked={params.category === cat.slug}
              onChange={() => handleCategoryChange(cat.slug)}
              label={cat.name_en}
            />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Brand">
        <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
          {brands.map((brand) => (
            <CheckboxFilter
              key={brand.id}
              checked={params.brand === brand.slug}
              onChange={() => handleBrandChange(brand.slug)}
              label={brand.name_en}
            />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Price Range">
        <form onSubmit={handlePriceChange} className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">EGP</span>
              <input
                type="number"
                name="min_price"
                placeholder="Min"
                defaultValue={params.min_price || ''}
                className="w-full h-9 pl-9 pr-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>
            <span className="text-xs text-foreground-muted">–</span>
            <div className="relative flex-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">EGP</span>
              <input
                type="number"
                name="max_price"
                placeholder="Max"
                defaultValue={params.max_price || ''}
                className="w-full h-9 pl-9 pr-2 text-xs border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>
          </div>
          <button type="submit" className="w-full h-8 text-xs font-medium bg-surface text-foreground border border-border rounded-md hover:bg-surface-low transition-colors">
            Apply
          </button>
        </form>
      </FilterGroup>

      <FilterGroup title="Availability" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={params.in_stock || false}
            onChange={handleInStockChange}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
          />
          <span>In Stock Only</span>
        </label>
      </FilterGroup>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-60 flex-shrink-0">
        <div className="sticky top-24">
          {FilterContent}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {isFilterOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/50" onClick={closeFilter} />
          <div className="relative w-full max-w-xs bg-white h-full shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filters
              </h2>
              <button onClick={closeFilter} className="p-1.5 rounded-md hover:bg-surface transition-colors" aria-label="Close filters">
                <X className="w-4 h-4 text-foreground-muted" />
              </button>
            </div>
            <div className="p-4">
              {FilterContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
