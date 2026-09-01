'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQueryStates } from 'nuqs';
import { X, Filter, ChevronDown, Search } from 'lucide-react';
import { productsSearchParamsSchema } from '@/app/products/search-params';
import { useUIStore } from '@/stores/ui-store';
import type { Category, Brand } from '@nest/types';

interface FilterSidebarProps {
  categories: Category[];
  brands: Brand[];
  priceRange: { min: number; max: number };
  totalResults: number;
}

function FilterGroup({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [children, isOpen]);

  return (
    <div className="bg-card border border-[var(--color-border)] rounded-md overflow-hidden mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-4 py-3 text-sm font-semibold text-foreground cursor-pointer hover:bg-accent transition-colors duration-200"
        aria-expanded={isOpen}
      >
        {title}
        <span className={`transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDown className="w-4 h-4 text-foreground-muted" />
        </span>
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isOpen ? `${height}px` : '0px',
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div className="px-4 pb-4 pt-1 space-y-2">
          {children}
        </div>
      </div>
    </div>
  );
}

function SearchableFilterGroup({
  title,
  items,
  selectedSlug,
  onSelect,
  defaultOpen = true,
}: {
  title: string;
  items: { id: string; slug: string; name: string }[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  defaultOpen?: boolean;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredItems = useMemo(() => {
    if (search.length < 2) return items;
    const query = search.toLowerCase();
    return items.filter(item => item.name.toLowerCase().includes(query));
  }, [items, search]);

  return (
    <FilterGroup title={title} defaultOpen={defaultOpen}>
      {items.length > 6 && (
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-subtle pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}...`}
            className="w-full h-9 pl-8 pr-2 text-sm border border-[var(--color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors bg-card text-foreground placeholder:text-foreground-subtle"
          />
        </div>
      )}
      <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
        {filteredItems.length === 0 ? (
          <p className="text-xs text-foreground-subtle py-3 text-center">No matching {title.toLowerCase()}</p>
        ) : (
          filteredItems.map((item) => (
            <CheckboxFilter
              key={item.id}
              checked={selectedSlug === item.slug}
              onChange={() => onSelect(item.slug)}
              label={item.name}
            />
          ))
        )}
      </div>
    </FilterGroup>
  );
}

function CheckboxFilter({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="group flex items-center gap-3 min-h-[44px] w-full py-1 text-sm text-foreground-muted hover:text-foreground cursor-pointer transition-colors duration-150 active:bg-accent/50 rounded-md -mx-2 px-2 text-left"
    >
      <span className={`relative flex items-center justify-center w-5 h-5 shrink-0 rounded border transition-all duration-200 ${
        checked
          ? 'bg-primary border-primary'
          : 'border-[var(--color-border)] bg-card group-hover:border-[var(--color-border-strong)]'
      }`}>
        {checked && (
          <svg className="w-full h-full text-white p-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span className="truncate select-none" title={label}>{label}</span>
    </button>
  );
}

function PriceRangeSlider({
  min,
  max,
  currentMin,
  currentMax,
  onChange,
}: {
  min: number;
  max: number;
  currentMin: number | null;
  currentMax: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [localMin, setLocalMin] = useState(currentMin ?? min);
  const [localMax, setLocalMax] = useState(currentMax ?? max);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalMin(currentMin ?? min);
    setLocalMax(currentMax ?? max);
  }, [currentMin, currentMax, min, max]);

  const applyFilters = useCallback((newMin: number, newMax: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const applyMin = newMin <= min ? null : newMin;
      const applyMax = newMax >= max ? null : newMax;
      onChange(applyMin, applyMax);
    }, 300);
  }, [min, max, onChange]);

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.min(Number(e.target.value), localMax - 1);
    setLocalMin(val);
    applyFilters(val, localMax);
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(Number(e.target.value), localMin + 1);
    setLocalMax(val);
    applyFilters(localMin, val);
  };

  const minPercent = ((localMin - min) / (max - min)) * 100;
  const maxPercent = ((localMax - min) / (max - min)) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs font-medium text-foreground">
        <span className="bg-surface border border-[var(--color-border)] rounded-md px-2.5 py-1.5">
          EGP {localMin.toLocaleString()}
        </span>
        <span className="text-foreground-subtle">–</span>
        <span className="bg-surface border border-[var(--color-border)] rounded-md px-2.5 py-1.5">
          EGP {localMax.toLocaleString()}
        </span>
      </div>

      <div className="relative h-8 px-1">
        <div className="absolute top-1/2 -translate-y-1/2 left-1 right-1 h-1.5 bg-surface rounded-full" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-primary rounded-full transition-all duration-150"
          style={{
            left: `${minPercent}%`,
            right: `${100 - maxPercent}%`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={localMin}
          onChange={handleMinChange}
          className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-1.5 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150 [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:transition-transform [&::-moz-range-thumb]:duration-150 [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125"
        />
        <input
          type="range"
          min={min}
          max={max}
          value={localMax}
          onChange={handleMaxChange}
          className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-1.5 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150 [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:transition-transform [&::-moz-range-thumb]:duration-150 [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125"
        />
      </div>

      {(currentMin || currentMax) && (
        <button
          onClick={() => {
            setLocalMin(min);
            setLocalMax(max);
            onChange(null, null);
          }}
          className="w-full h-9 text-sm font-medium text-danger hover:underline transition-colors"
        >
          Clear price filter
        </button>
      )}
    </div>
  );
}

export function FilterSidebar({ categories, brands, priceRange, totalResults }: FilterSidebarProps) {
  const isFilterOpen = useUIStore((state) => state.isFilterOpen);
  const closeFilter = useUIStore((state) => state.closeFilter);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const [params, setParams] = useQueryStates(productsSearchParamsSchema, {
    shallow: false,
  });

  useEffect(() => {
    if (isFilterOpen) {
      setIsVisible(true);
      const timer = requestAnimationFrame(() => setIsAnimating(true));
      document.body.style.overflow = 'hidden';
      return () => {
        cancelAnimationFrame(timer);
      };
    } else {
      setIsAnimating(false);
      document.body.style.overflow = '';
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isFilterOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFilterOpen) {
        closeFilter();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFilterOpen, closeFilter]);

  const handleCategoryChange = useCallback((slug: string) => {
    setParams((prev) => ({ category: prev.category === slug ? null : slug, page: 1 }));
  }, [setParams]);

  const handleBrandChange = useCallback((slug: string) => {
    setParams((prev) => ({ brand: prev.brand === slug ? null : slug, page: 1 }));
  }, [setParams]);

  const handleInStockChange = useCallback(() => {
    setParams((prev) => ({ in_stock: !prev.in_stock ? true : null, page: 1 }));
  }, [setParams]);

  const handlePriceChange = useCallback((newMin: number | null, newMax: number | null) => {
    setParams({ min_price: newMin, max_price: newMax, page: 1 });
  }, [setParams]);

  const clearFilters = useCallback(() => {
    setParams({ category: null, brand: null, min_price: null, max_price: null, in_stock: null, page: 1 });
  }, [setParams]);

  const hasActiveFilters = !!(params.category || params.brand || params.min_price || params.max_price || params.in_stock);

  const activeFilterTags = useMemo(() => {
    const tags: { key: string; label: string }[] = [];
    if (params.category) {
      const cat = categories.find(c => c.slug === params.category);
      tags.push({ key: 'category', label: cat?.name_en || params.category });
    }
    if (params.brand) {
      const brand = brands.find(b => b.slug === params.brand);
      tags.push({ key: 'brand', label: brand?.name_en || params.brand });
    }
    if (params.min_price || params.max_price) {
      const label = [
        params.min_price ? `EGP ${params.min_price}` : '',
        params.max_price ? `EGP ${params.max_price}` : ''
      ].filter(Boolean).join(' – ');
      tags.push({ key: 'price', label });
    }
    if (params.in_stock) {
      tags.push({ key: 'in_stock', label: 'In Stock' });
    }
    return tags;
  }, [params.category, params.brand, params.min_price, params.max_price, params.in_stock, categories, brands]);

  const removeFilter = useCallback((key: string) => {
    if (key === 'category') setParams({ category: null, page: 1 });
    else if (key === 'brand') setParams({ brand: null, page: 1 });
    else if (key === 'price') setParams({ min_price: null, max_price: null, page: 1 });
    else if (key === 'in_stock') setParams({ in_stock: null, page: 1 });
  }, [setParams]);

  const categoryItems = useMemo(() =>
    categories.map(cat => ({ id: cat.id, slug: cat.slug, name: cat.name_en })),
    [categories]
  );

  const brandItems = useMemo(() =>
    brands.map(brand => ({ id: brand.id, slug: brand.slug, name: brand.name_en })),
    [brands]
  );

  const FilterContent = (
    <div className="space-y-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wide flex items-center gap-2">
          <Filter className="w-4 h-4" />
          Filters
        </h2>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-danger hover:underline font-medium transition-colors min-h-[44px] px-2 flex items-center">
            Clear All
          </button>
        )}
      </div>

      <SearchableFilterGroup
        title="Category"
        items={categoryItems}
        selectedSlug={params.category}
        onSelect={handleCategoryChange}
      />

      <SearchableFilterGroup
        title="Brand"
        items={brandItems}
        selectedSlug={params.brand}
        onSelect={handleBrandChange}
      />

      <FilterGroup title="Price Range">
        <PriceRangeSlider
          min={priceRange.min}
          max={priceRange.max}
          currentMin={params.min_price}
          currentMax={params.max_price}
          onChange={handlePriceChange}
        />
      </FilterGroup>

      <FilterGroup title="Availability" defaultOpen={false}>
        <button
          type="button"
          onClick={handleInStockChange}
          className="group flex items-center gap-3 min-h-[44px] w-full py-1 text-sm text-foreground-muted hover:text-foreground cursor-pointer transition-colors duration-150 active:bg-accent/50 rounded-md -mx-2 px-2 text-left"
        >
          <span className={`relative flex items-center justify-center w-5 h-5 shrink-0 rounded border transition-all duration-200 ${
            params.in_stock
              ? 'bg-primary border-primary'
              : 'border-[var(--color-border)] bg-card group-hover:border-[var(--color-border-strong)]'
          }`}>
            {params.in_stock && (
              <svg className="w-full h-full text-white p-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <span className="select-none">In Stock Only</span>
        </button>
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
      {isVisible && (
        <div
          className={`fixed inset-0 z-50 lg:hidden flex`}
          role="dialog"
          aria-modal="true"
          aria-label="Filter products"
        >
          {/* Backdrop */}
          <div
            className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
              isAnimating ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={closeFilter}
          />

          {/* Drawer Panel */}
          <div
            className={`relative w-[85vw] max-w-sm bg-background h-full shadow-2xl overflow-hidden flex flex-col transition-transform duration-300 ease-out ${
              isAnimating ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-background shrink-0">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Filter className="w-5 h-5" />
                Filters
              </h2>
              <button
                onClick={closeFilter}
                className="p-2 rounded-md hover:bg-accent transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Close filters"
              >
                <X className="w-5 h-5 text-foreground-muted" />
              </button>
            </div>

            {/* Active Filters Summary */}
            {activeFilterTags.length > 0 && (
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-surface/50 shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {activeFilterTags.map((tag) => (
                    <button
                      key={tag.key}
                      onClick={() => removeFilter(tag.key)}
                      className="inline-flex items-center gap-1.5 bg-background text-foreground text-xs rounded-full border border-[var(--color-border)] px-3 py-1.5 hover:bg-surface hover:border-[var(--color-border-strong)] transition-colors duration-150 min-h-[32px]"
                    >
                      {tag.label}
                      <X className="w-3 h-3 text-foreground-subtle" />
                    </button>
                  ))}
                  {activeFilterTags.length > 1 && (
                    <button
                      onClick={clearFilters}
                      className="text-xs text-danger hover:underline font-medium min-h-[32px] px-2"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Filter Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {FilterContent}
            </div>

            {/* Sticky Bottom Button */}
            <div className="p-4 bg-background border-t border-[var(--color-border)] shrink-0 safe-area-bottom">
              <button
                onClick={closeFilter}
                className="w-full h-12 text-base font-semibold bg-primary text-white rounded-md hover:bg-primary-hover active:scale-[0.98] transition-all duration-200 shadow-lg shadow-primary/20"
              >
                View {totalResults} Results
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
