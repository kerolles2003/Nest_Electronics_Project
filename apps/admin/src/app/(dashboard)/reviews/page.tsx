import { requireAdmin, getAdminServices } from '@/lib/services';
import { Suspense } from 'react';
import { ReviewsTable } from '@/components/reviews/ReviewsTable';

function ReviewsSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-20" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card h-12" />
      <div className="rounded-xl border border-border bg-card h-96" />
    </div>
  );
}

export default async function ReviewsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { supabase } = await getAdminServices();
  const sp = await props.searchParams;

  const page = Number(sp.page) || 1;
  const search = (sp.search as string) || '';
  const statusFilter = (sp.status as string) || '';
  const limit = 25;

  let query = (supabase as any)
    .from('reviews')
    .select(
      `*, product:products(name_en, slug), profiles(full_name, avatar_url)`,
      { count: 'exact' }
    );

  if (search) {
    query = query.or(`product.name_en.ilike.%${search}%,profiles.full_name.ilike.%${search}%`);
  }
  if (statusFilter) {
    query = query.eq('moderation_status', statusFilter);
  }

  const { data, count } = await query
    .range((page - 1) * limit, page * limit - 1)
    .order('created_at', { ascending: false });

  const reviews = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit);

  /* Stats */
  const { count: totalCount } = await (supabase as any)
    .from('reviews')
    .select('*', { count: 'exact', head: true });

  const { count: pendingCount } = await (supabase as any)
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('moderation_status', 'pending');

  const { count: approvedCount } = await (supabase as any)
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('moderation_status', 'approved');

  const { count: rejectedCount } = await (supabase as any)
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('moderation_status', 'rejected');

  const { count: verifiedCount } = await (supabase as any)
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('is_verified_purchase', true);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reviews</h1>
        <p className="text-sm text-muted-foreground mt-1">Moderate product reviews and manage the approval queue.</p>
      </div>

      <Suspense fallback={<ReviewsSkeleton />}>
        <ReviewsTable
          initialReviews={reviews}
          currentPage={page}
          totalPages={totalPages}
          total={total}
          stats={{
            total: totalCount ?? 0,
            pending: pendingCount ?? 0,
            approved: approvedCount ?? 0,
            rejected: rejectedCount ?? 0,
            verified: verifiedCount ?? 0,
          }}
        />
      </Suspense>
    </div>
  );
}
