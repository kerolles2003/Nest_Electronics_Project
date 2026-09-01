import NotFoundContent from '@/components/NotFoundContent';

/**
 * The 404 boundary for this segment.
 *
 * ## It does not render today, and that is the point of writing it down
 *
 * `notFound()` here is thrown after `await` — this page has to ask the API
 * whether the category exists before it can know. Measured on Next 16.2.4: a
 * `notFound()` thrown after ANY await produces a `404` with an **empty
 * document**, whether or not this file exists, and the client does not render
 * it either. Next's own docs give the rule — *"Place `notFound()` before those
 * boundaries and before any `await` that may suspend"* — which a data-driven
 * 404 cannot obey.
 *
 * So this file changes nothing right now. It is kept because it is the boundary
 * Next resolves, because deleting it would leave nothing at the place someone
 * looks when the body is blank, and because it starts working the moment either
 * remedy lands: the existence check moving into `proxy.ts` (Phase 5b), or Next
 * rendering the boundary after a suspense.
 *
 * The root `app/not-found.tsx` does NOT cover this case — it only covers URLs
 * that match no route at all. `e2e/not-found.spec.ts` carries the full
 * measurement table and a `test.fail()` that goes red the day this renders.
 */
export default function CategoryNotFound() {
  return <NotFoundContent />;
}
