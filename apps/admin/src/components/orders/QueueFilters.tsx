'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Search, X } from 'lucide-react';
import type { OrderQueueSort } from '@/lib/api/endpoints';

/**
 * Search, date range and ordering for the work queue.
 *
 * ## Why these came back
 *
 * They were removed in Phase 6, deliberately: the API's queue took only
 * `status`, `page` and `limit`, and a search box that silently does nothing is
 * worse than no search box. The endpoint now takes `q`, `placedFrom`,
 * `placedTo` and `sort`, so the controls are real again.
 *
 * ## Everything lives in the URL
 *
 * No local state for the filter values. The URL is the single source of truth,
 * which is what makes a filtered queue linkable, bookmarkable, survivable
 * across a reload, and correct when the operator uses the back button. It also
 * means the server component reads exactly what the user sees.
 *
 * ## Every change returns to page one
 *
 * Staying on page 4 of a filter that now has two pages shows an empty table,
 * and an empty table on a fulfilment queue reads as "no orders" rather than
 * "you are past the end". Same rule the status tiles already follow.
 */

const SORTS: readonly { value: OrderQueueSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'total_high', label: 'Highest value' },
  { value: 'total_low', label: 'Lowest value' },
];

export interface QueueFiltersProps {
  q: string;
  placedFrom: string;
  placedTo: string;
  sort: OrderQueueSort;
}

export default function QueueFilters({ q, placedFrom, placedTo, sort }: QueueFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const apply = (changes: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      /*
       * An empty value REMOVES the parameter rather than setting it blank.
       *
       * `?q=` is treated as "no filter" by the API, so it would work — but it
       * leaves a cleared search box looking like an active filter in the
       * address bar, and puts an indistinguishable entry in the back-button
       * history.
       */
      if (value === '') params.delete(key);
      else params.set(key, value);
    }

    params.delete('page');

    startTransition(() => {
      const query = params.toString();
      router.push(`/orders${query === '' ? '' : `?${query}`}`);
    });
  };

  const hasFilters = q !== '' || placedFrom !== '' || placedTo !== '';

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {/*
          A FORM, so Enter submits and the control works before React has
          hydrated. The queue is the first screen an operator opens; it should
          not depend on a bundle having arrived.
        */}
        <form
          className="flex-1 min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('q');
            apply({ q: typeof value === 'string' ? value.trim() : '' });
          }}
        >
          <label htmlFor="queue-search" className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              id="queue-search"
              name="q"
              type="search"
              defaultValue={q}
              /*
               * `key` on the defaultValue source: an uncontrolled input keeps
               * its own value across a re-render, so clearing the filter from
               * elsewhere would leave the old text sitting in the box while the
               * queue showed everything.
               */
              key={q}
              placeholder="Order number, name, email or phone"
              data-testid="queue-search"
              className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-sm"
            />
          </div>
        </form>

        <div>
          <label htmlFor="queue-from" className="block text-xs font-medium text-muted-foreground mb-1">
            Placed from
          </label>
          <input
            id="queue-from"
            type="date"
            value={placedFrom}
            data-testid="queue-placed-from"
            onChange={(event) => {
              apply({ placedFrom: event.target.value });
            }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="queue-to" className="block text-xs font-medium text-muted-foreground mb-1">
            Placed to
          </label>
          <input
            id="queue-to"
            type="date"
            value={placedTo}
            data-testid="queue-placed-to"
            onChange={(event) => {
              apply({ placedTo: event.target.value });
            }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="queue-sort" className="block text-xs font-medium text-muted-foreground mb-1">
            Sort
          </label>
          <select
            id="queue-sort"
            value={sort}
            data-testid="queue-sort"
            onChange={(event) => {
              apply({ sort: event.target.value === 'newest' ? '' : event.target.value });
            }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasFilters && (
        <button
          type="button"
          data-testid="queue-clear-filters"
          onClick={() => {
            apply({ q: '', placedFrom: '', placedTo: '' });
          }}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Clear search and dates
        </button>
      )}
    </div>
  );
}
