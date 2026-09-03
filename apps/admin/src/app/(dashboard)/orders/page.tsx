import { Suspense } from 'react';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { requireAdmin } from '@/lib/api/identity';
import { ORDER_STATUSES, orderStatusCounts } from '@/lib/api/order-stats';
import type { OrderQueueSort } from '@/lib/api/endpoints';
import type { OrderStatus } from '@/lib/api/types';
import OrdersTable from '@/components/orders/OrdersTable';
import QueueFilters from '@/components/orders/QueueFilters';
import { AlertCircle } from 'lucide-react';

/**
 * The order work queue, on the API.
 *
 * ## Every order the storefront creates appears here
 *
 * Since T2 the storefront has placed orders in Mongo through the NestJS API,
 * and this screen read Supabase — so **every order a customer placed was
 * invisible to the console that exists to fulfil it**. That is what this page
 * fixes, and it is the whole reason Phase 6 exists.
 *
 * ## The status vocabulary changed, because the model did
 *
 * Legacy carried three independent status columns — order, payment, fulfilment
 * — 210 combinations with no cross-field validation, and live data already held
 * incoherent ones. The API has ONE fulfilment axis with seven values, plus
 * payment on its own axis, and delivery sets both atomically. So the filters
 * here are `PLACED`, `CONFIRMED`, `SHIPPED`, `DELIVERED`, `DELIVERY_FAILED`,
 * `CANCELLED`, `RETURNED` and there is no separate fulfilment filter. The
 * layout, the components and the interaction are unchanged.
 *
 * ## What is NOT here any more, and why
 *
 * **Revenue tiles.** The Supabase version showed "Today's Revenue" and "This
 * Week" by summing a `total` column across every order row. No endpoint on the
 * API exposes a revenue aggregate, and the honest alternatives were both bad:
 * summing the current PAGE would print a number that changes when you paginate,
 * and fetching every order to add them up client-side is a table scan on every
 * page load. A wrong money figure on a money console is worse than no figure,
 * so there is none, and an aggregate endpoint is the real fix.
 *
 * **The fulfilment filter.** Legacy had a second status axis; the API has one,
 * so there is nothing for a second filter to filter. Not a regression — the
 * 210 combinations it used to offer included incoherent ones that live data
 * already held.
 *
 * ## What came BACK in Phase 7
 *
 * Text search, the date range and sorting. They were removed in Phase 6
 * because the API's queue took only `status`, `page` and `limit`, and a search
 * box that silently does nothing is worse than no search box. `GET
 * /admin/orders` now takes `q`, `placedFrom`, `placedTo` and `sort`, so the
 * controls are real again — see `components/orders/QueueFilters.tsx`.
 *
 * The status tiles are now ONE request rather than seven. They were seven real
 * numbers taken at seven different instants, which is why they did not always
 * add up to the total beside them.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

function OrdersSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}

/** The four orderings the API serves. Anything else is ignored, not passed on. */
const SORTS: readonly OrderQueueSort[] = ['newest', 'oldest', 'total_high', 'total_low'];

/**
 * Reads one query parameter as a string.
 *
 * A repeated parameter arrives as an array; taking the first is the same rule
 * the status filter already follows, and it keeps a hand-edited URL from
 * producing a 400 on a screen somebody is trying to work from.
 */
function text(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
}

/**
 * A sort the API serves, or the default.
 *
 * Narrowed HERE rather than passed through, so a hand-typed `?sort=createdAt`
 * renders the default queue instead of a 400. The API would reject it — this is
 * about not turning a mistyped URL into an error page on a work screen.
 */
function parseSort(raw: string | string[] | undefined): OrderQueueSort {
  const value = text(raw);

  return SORTS.find((sort) => sort === value) ?? 'newest';
}

/** A status is only honoured if the API actually has it. */
function parseStatus(raw: string | string[] | undefined): OrderStatus | null {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return ORDER_STATUSES.includes(value as OrderStatus) ? (value as OrderStatus) : null;
}

export default async function OrdersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();

  const sp = await props.searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const status = parseStatus(sp.status);
  const q = text(sp.q);
  const placedFrom = text(sp.placedFrom);
  const placedTo = text(sp.placedTo);
  const sort = parseSort(sp.sort);

  const [queue, stats] = await Promise.all([
    tryApi(() =>
      api.listOrders({
        page,
        limit: PAGE_SIZE,
        sort,
        ...(status === null ? {} : { status: [status] }),
        ...(q === '' ? {} : { q }),
        ...(placedFrom === '' ? {} : { placedFrom }),
        ...(placedTo === '' ? {} : { placedTo }),
      }),
    ),
    orderStatusCounts(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage and fulfil customer orders.</p>
      </div>

      <QueueFilters q={q} placedFrom={placedFrom} placedTo={placedTo} sort={sort} />

      {!queue.ok ? (
        /*
         * The queue could not be read. This says so and shows NOTHING —
         * an empty table here would read as "no orders", which on a
         * fulfilment console is the most expensive possible lie.
         */
        <div
          role="alert"
          data-testid="queue-error"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center"
        >
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <h2 className="text-base font-bold text-foreground">The order queue could not be loaded</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{queue.error.message}</p>
          <p className="text-xs text-muted-foreground mt-3">
            This is not an empty queue — it is an unanswered question. Reload to try again.
          </p>
        </div>
      ) : (
        <Suspense fallback={<OrdersSkeleton />}>
          <OrdersTable
            orders={queue.data.data}
            meta={queue.data.meta}
            activeStatus={status}
            counts={stats.counts}
            total={stats.total}
          />
        </Suspense>
      )}
    </div>
  );
}
