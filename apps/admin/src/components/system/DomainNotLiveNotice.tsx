import { Construction } from 'lucide-react';

/**
 * "This works, and no customer can see the result yet."
 *
 * ## Why this is a different statement from the banner it succeeds
 *
 * `UnwiredScreenWarning` said *what you type here does not reach the store*,
 * about screens that wrote to Supabase while the storefront read the API. Those
 * are all wired now and it is deleted.
 *
 * These two are a different problem with a similar symptom. Coupons and reviews
 * are **Phase 8 domains** (PLAN.md §22, D-5): the API has no model for either,
 * so these screens still read and write Supabase — and unlike the catalogue,
 * that is the sanctioned state, because the whole domain is rebuilt in one
 * piece later rather than half-migrated now.
 *
 * What is NOT sanctioned is letting an operator believe the work has an effect.
 * There is no coupon field at checkout and no review anywhere on the storefront,
 * so a coupon created here can never be redeemed and a review approved here is
 * approved for nobody. Saying that costs one paragraph; discovering it costs an
 * afternoon of data entry.
 *
 * ## Not red, and not dismissible either
 *
 * It is not an error and not a defect — it is a schedule. The tone is different
 * from the banner's on purpose: nothing here is broken, and treating "not built
 * yet" as an alarm trains an operator to ignore the alarms that matter.
 *
 * Delete each usage when its domain ships; delete the component with the last
 * one.
 */

type Domain = 'coupons' | 'reviews';

const COPY: Record<Domain, { readonly title: string; readonly detail: string }> = {
  coupons: {
    title: 'Coupons are not live at checkout yet',
    detail:
      'This screen still uses the old database, which is deliberate: coupons are rebuilt whole in ' +
      'a later phase rather than half-migrated now. Nothing here reaches a customer — there is no ' +
      'coupon field at checkout, so a code created here cannot be redeemed.',
  },
  reviews: {
    title: 'Reviews are not shown on the storefront yet',
    detail:
      'This screen still uses the old database, which is deliberate: reviews are rebuilt whole in ' +
      'a later phase rather than half-migrated now. Moderating here changes nothing a customer ' +
      'sees, because no product page renders reviews at all.',
  },
};

export function DomainNotLiveNotice({ domain }: { domain: Domain }) {
  const { title, detail } = COPY[domain];

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <Construction className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-bold text-foreground">{title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  );
}
