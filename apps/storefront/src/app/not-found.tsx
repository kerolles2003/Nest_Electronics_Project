import NotFoundContent from '@/components/NotFoundContent';

/**
 * The 404 for a URL that matches no route at all.
 *
 * This file does NOT cover `notFound()` thrown inside a nested segment — Next
 * 16 renders an empty document for that unless the segment has its own
 * `not-found.tsx`. See `NotFoundContent`, which is where the markup lives and
 * where that measurement is recorded.
 */
export default function NotFoundPage() {
  return <NotFoundContent />;
}
