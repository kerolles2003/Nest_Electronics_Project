import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISearchRepository } from '@nest/repositories';
import type { SearchOptions, SearchResult } from '@nest/types';

export class PostgresSearchProvider implements ISearchRepository {
  constructor(private client: SupabaseClient) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult> {
    const start = Date.now();
    const { data, count, error } = await this.client.rpc('search_products', {
      search_query: query,
      category_slug: options.filters?.['category']?.[0] ?? null,
      brand_slug: options.filters?.['brand']?.[0] ?? null,
      min_price: options.filters?.['min_price']?.[0] ? Number(options.filters['min_price'][0]) : null,
      max_price: options.filters?.['max_price']?.[0] ? Number(options.filters['max_price'][0]) : null,
      in_stock_only: options.filters?.['in_stock']?.[0] === 'true',
      result_limit: options.pagination.limit,
      result_offset: (options.pagination.page - 1) * options.pagination.limit,
    }, { count: 'exact' });
    if (error) throw new Error(`Search failed: ${error.message}`);
    return {
      hits: (data ?? []).map((p: Record<string, unknown>) => ({ ...p, available_stock: (p['stock_quantity'] as number) - (p['reserved_quantity'] as number) })) as never,
      total: count ?? 0,
      facetCounts: {},
      processingTimeMs: Date.now() - start,
    };
  }

  async suggest(query: string, limit = 5): Promise<string[]> {
    const { data } = await this.client
      .from('products')
      .select('name_en')
      .ilike('name_en', `%${query}%`)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(limit);
    return (data ?? []).map((p: { name_en: string }) => p.name_en);
  }
}
