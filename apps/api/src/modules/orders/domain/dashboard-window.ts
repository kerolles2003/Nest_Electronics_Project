/**
 * The time window every order-derived dashboard figure is computed over.
 *
 * Authority: this file. `ORDER-LIFECYCLE.md` and ADR-ORDER-002 say what counts
 * as revenue; they say nothing about over what period, because until now there
 * was no period — every figure was all-time.
 *
 * ## Why a window exists at all
 *
 * Two reasons, and the product one is the stronger.
 *
 * **It is the better answer.** "Delivered revenue, last 30 days" is a question
 * an operator has. "Delivered revenue, since the shop opened" is a number that
 * only moves up, cannot be compared to anything, and tells nobody whether this
 * month was good. A dashboard exists to be looked at daily; an all-time total
 * is a fact for an annual report.
 *
 * **It bounds the scan.** The revenue facet has no `status` index to seek on —
 * `orders` deliberately carries `{placedAt, _id}` and not `{status, placedAt}`,
 * because the UNFILTERED work queue is the screen an operator opens first and a
 * status-leading index would force a blocking in-memory sort on it
 * (`order.schema.ts`). So the facet reads every order it is given. All-time,
 * that is the whole collection on every dashboard load — at 500k orders,
 * roughly 250 MB through the cache to render six tiles. Bounded to 30 days it
 * is an index-seekable range on `order_admin_queue` and a small fraction of the
 * documents.
 *
 * A compound `{status, payment.status, pricing.grandTotal}` index is the other
 * remedy and is deliberately NOT taken: it costs a write on every order
 * placement forever, to serve a screen the window has already made cheap. It
 * becomes worth revisiting when the trailing window itself is large enough to
 * hurt, which is a fact about real volume rather than a guess about it.
 *
 * ## The window is on `placedAt`, and that is a real approximation
 *
 * One `$match` at the head of the pipeline bounds all four facet branches with
 * one index seek. `placedAt` is the field that index leads on, and it is the
 * only order date field indexed at all.
 *
 * The consequence, stated rather than buried: revenue is recognised at
 * DELIVERY, but the window is on PLACEMENT. An order placed 32 days ago and
 * delivered yesterday is not in the 30-day figure. Under Cash on Delivery the
 * two dates are usually days apart, so the divergence is small — but it is
 * real, so every label the console prints says *orders placed*, never just
 * "last 30 days". A number whose caption is wrong is worse than one whose
 * caption is long.
 *
 * Windowing on `shipment.deliveredAt` instead would need its own index and
 * would give the revenue tile a different population from the status breakdown
 * beside it, which is a worse trade than the one taken.
 */

/** The offered windows. A closed set — this is a picker, not a date range. */
export const DASHBOARD_WINDOWS = ['30d', '90d', 'all'] as const;

export type DashboardWindowKey = (typeof DASHBOARD_WINDOWS)[number];

/**
 * The default, and the whole point of the change.
 *
 * All-time remains available and is one click away; it is not the thing a
 * dashboard should show by default, and it is the expensive query.
 */
export const DEFAULT_DASHBOARD_WINDOW: DashboardWindowKey = '30d';

export interface DashboardWindow {
  readonly key: DashboardWindowKey;
  /** Trailing days, or `null` for all-time. */
  readonly days: number | null;
  /** What the console prints. Server-owned, so the caption cannot disagree. */
  readonly label: string;
  /** The lower bound, or `null` for all-time. */
  readonly since: Date | null;
}

const DAYS: Record<DashboardWindowKey, number | null> = {
  '30d': 30,
  '90d': 90,
  all: null,
};

/**
 * Turns a key into the window the aggregation and the caption both use.
 *
 * The label is produced HERE rather than in the console, so that the number and
 * the sentence under it come from one place. A screen that computes its own
 * caption is a screen that can print "last 30 days" over a 90-day figure after
 * somebody changes a default.
 *
 * `now` is injectable for tests, which is the only reason it is a parameter.
 */
export function resolveDashboardWindow(
  key: DashboardWindowKey = DEFAULT_DASHBOARD_WINDOW,
  now: Date = new Date(),
): DashboardWindow {
  const days = DAYS[key];

  if (days === null) {
    return { key, days: null, label: 'All time', since: null };
  }

  return {
    key,
    days,
    // "Orders placed in…", not "in…". See the note above about `placedAt`.
    label: `Orders placed in the last ${String(days)} days`,
    since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
  };
}

/**
 * The `$match` that bounds an orders aggregation to the window.
 *
 * Empty for all-time — an empty match stage is a no-op the planner drops, which
 * is deliberately different from a match that is always true.
 *
 * A fresh object every call, for the same reason `revenueMatch()` returns one:
 * a shared literal is one an aggregation builder can mutate, and a filter that
 * changed under a later caller is a reporting bug nobody would look for in a
 * constant.
 */
export function dashboardWindowMatch(window: DashboardWindow): Record<string, unknown> {
  return window.since === null ? {} : { placedAt: { $gte: window.since } };
}
