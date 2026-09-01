'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Category } from '@nest/types';

interface SearchBarProps {
  initialQuery?: string;
  categories: Category[];
}

export function SearchBar({ initialQuery = '', categories }: SearchBarProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        let url = `/search?q=${encodeURIComponent(trimmed)}`;
        if (selectedCategory) {
          url += `&category=${selectedCategory}`;
        }
        router.push(url);
      }
    },
    [value, selectedCategory, router]
  );

  const handleClear = useCallback(() => {
    setValue('');
    inputRef.current?.focus();
  }, []);

  // Flatten categories for select dropdown
  const flatCategories = categories.filter((c) => !c.parent_id);

  return (
    <form onSubmit={handleSubmit} className="relative w-full">
      <div className="relative flex items-center bg-card border border-primary rounded-sm overflow-hidden h-[42px] transition-colors focus-within:border-primary-hover">
        <select
          className="h-full bg-surface px-3 border-r border-[var(--color-border)] text-[13px] text-foreground font-medium outline-none cursor-pointer hidden md:block max-w-[170px] hover:bg-card transition-colors"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          aria-label="Search category"
        >
          <option value="">Select Category</option>
          {flatCategories.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name_en}</option>
          ))}
        </select>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search for products"
          className="flex-1 bg-transparent px-4 h-full text-[14px] text-foreground placeholder:text-foreground-subtle focus:outline-none"
          aria-label="Search products"
        />
        
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 transition-colors hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="w-4 h-4 text-foreground-subtle" />
          </button>
        )}

        <button 
          type="submit"
          className="h-full px-5 bg-primary text-primary-foreground font-semibold text-[14px] transition-colors hover:bg-primary-hover flex items-center justify-center"
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
        </button>
      </div>
    </form>
  );
}
