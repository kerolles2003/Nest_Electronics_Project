'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface SearchBarProps {
  initialQuery?: string;
}

export function SearchBar({ initialQuery = '' }: SearchBarProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }
    },
    [value, router]
  );

  const handleClear = useCallback(() => {
    setValue('');
    inputRef.current?.focus();
  }, []);

  return (
    <form onSubmit={handleSubmit} className="relative w-full">
      <div className="relative flex items-center rounded-md border border-[var(--color-border)] bg-card p-1 shadow-sm transition-all focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_8%,transparent)]">
        <div className="hidden h-10 items-center border-r border-[var(--color-border)] px-4 text-[12px] font-black uppercase text-foreground-muted md:flex">
          All categories
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search for Arduino, ESP32, sensors..."
          className="w-full bg-transparent px-4 py-2.5 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
        
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="mr-1 rounded-md p-2 transition-colors hover:bg-accent"
            aria-label="Clear search"
          >
            <X className="w-4 h-4 text-foreground-subtle" />
          </button>
        )}

        <button 
          type="submit"
          className="rounded-md bg-primary p-2.5 text-primary-foreground shadow-md transition-all hover:bg-primary-hover active:scale-95"
        >
          <Search className="w-5 h-5" />
        </button>
      </div>
    </form>
  );
}
