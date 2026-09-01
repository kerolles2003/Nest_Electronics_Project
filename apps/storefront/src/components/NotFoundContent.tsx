import Link from 'next/link';

/**
 * The designed 404, as a component rather than only a route file.
 *
 * ## Why this is not just `app/not-found.tsx`
 *
 * The markup lives here, in one place, because five route files render it: the
 * root `app/not-found.tsx` and one `not-found.tsx` per segment that calls
 * `notFound()`.
 *
 * Each of those is a real component module that imports this and renders it. A
 * bare `export { default } from '@/app/not-found'` does **not** register as a
 * boundary — measured.
 *
 * ## What actually renders, measured on Next 16.2.4
 *
 * ```
 * URL matches no route at all                  404   this component RENDERS
 * notFound() thrown before any await           404   this component RENDERS
 * notFound() thrown after an await             404   empty document
 * ```
 *
 * Every data-driven 404 is the third row: the page must ask the API whether the
 * thing exists, so it always awaits. The segment files are kept anyway — see
 * the note in any of them — and `e2e/not-found.spec.ts` holds the full table
 * and a `test.fail()` that goes red the day the third row starts rendering.
 */
export default function NotFoundContent() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <span className="text-[120px] font-heading font-bold text-surface-low leading-none">404</span>
      <h1 className="text-2xl font-heading font-semibold text-foreground mt-4">Page Not Found</h1>
      <p className="text-base text-foreground-muted mt-2 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="flex flex-col gap-2 mt-6">
        <Link href="/" className="btn-primary px-6 py-2.5 text-sm inline-flex items-center justify-center">
          Go to Homepage
        </Link>
        <Link href="/products" className="btn-ghost text-sm inline-flex items-center justify-center">
          Browse Products
        </Link>
      </div>
    </div>
  );
}
