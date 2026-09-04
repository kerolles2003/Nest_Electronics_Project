import { AlertOctagon } from 'lucide-react';

/**
 * "What you type here does not reach the store."
 *
 * ## Why this exists
 *
 * The console is HALF migrated. Orders, the dashboard, customers and shipping
 * rates read and write the NestJS API, which is the database the storefront
 * serves from. Products, product media and inventory still write Supabase —
 * and **nothing reads Supabase any more**: not the storefront, not the Flutter
 * client, not the dashboard tiles two clicks away from here.
 *
 * That is F-09 returning in a worse form than the original. The original was
 * two catalogues that disagreed; this is one catalogue plus a screen that
 * writes into nowhere and looks like it worked. A product saved here is
 * accepted without error, is re-read from Supabase by the very screen that
 * created it, and therefore **reappears in the table** — while being invisible
 * to every customer and absent from every number on the dashboard.
 *
 * The dashboard now showing real Mongo figures makes this worse, not better:
 * the console reads as migrated, so nothing else on screen contradicts the
 * lie the row is telling.
 *
 * ## Why a banner and not a disabled screen
 *
 * Disabling the screens would be the safer engineering answer and the wrong
 * product answer while they are days from being wired: the operator still
 * needs to look at what is there. So the screen stays readable and the
 * consequence is stated where it cannot be scrolled past.
 *
 * ## When to delete this
 *
 * When the screen it sits on is wired to the API. It is deliberately not
 * dismissible and deliberately not subtle, because its entire job is to be
 * unmissable for as long as it is true. Every usage is a to-do with a
 * deadline: grep for `UnwiredScreenWarning` and the remaining ones are the
 * remaining work.
 */

type Screen = 'products' | 'media' | 'inventory';

const COPY: Record<Screen, { readonly title: string; readonly detail: string }> = {
  products: {
    title: 'Products saved here do not reach the store',
    detail:
      'This screen still writes to the old Supabase database, which nothing reads any more. ' +
      'A product created or edited here reappears in this table — and is invisible to customers, ' +
      'absent from the storefront, and uncounted on the dashboard.',
  },
  media: {
    title: 'Images uploaded here do not reach the store',
    detail:
      'This uploader still writes to Supabase Storage, which no product page reads. ' +
      'An image added here is shown back to you on this form and appears nowhere else — ' +
      'not on the storefront, and not in the media ledger that protects images from deletion.',
  },
  inventory: {
    title: 'Stock changes made here do not reach the store',
    detail:
      'This screen still writes Supabase stock rows and transactions, which nothing reads any more. ' +
      'An adjustment made here changes the number on this page only: the storefront still sells ' +
      'against the API’s stock, and the dashboard still counts it.',
  },
};

/**
 * @param screen which unwired screen this is — selects the copy and nothing else.
 */
export function UnwiredScreenWarning({ screen }: { screen: Screen }) {
  const { title, detail } = COPY[screen];

  return (
    <div
      role="alert"
      className="rounded-xl border-2 border-destructive bg-destructive/10 p-4 shadow-elevated"
    >
      <div className="flex items-start gap-3">
        <AlertOctagon className="h-5 w-5 shrink-0 text-destructive mt-0.5" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-bold text-destructive uppercase tracking-wide">{title}</p>
          <p className="text-sm text-foreground leading-relaxed">{detail}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Do not enter real catalogue data on this screen. It is being wired to the API; until
            that lands, this page is for looking at what is already here.
          </p>
        </div>
      </div>
    </div>
  );
}
