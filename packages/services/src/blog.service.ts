import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, BlogPost, BlogFilters, PaginatedResult } from '@nest/types';

type BlogPostRow = Database['public']['Tables']['blog_posts']['Row'];

export class BlogService {
  constructor(private supabase: SupabaseClient<Database>) {}

  async listPosts(filters?: BlogFilters, limit = 12, page = 1): Promise<PaginatedResult<BlogPost>> {
    let query = this.supabase
      .from('blog_posts')
      .select('*', { count: 'exact' })
      .eq('is_published', true);

    if (filters?.category) {
      query = query.eq('category', filters.category);
    }
    if (filters?.tag) {
      query = query.contains('tags', [filters.tag]);
    }
    if (filters?.search) {
      query = query.or(`title_en.ilike.%${filters.search}%,excerpt.ilike.%${filters.search}%`);
    }

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1).order('published_at', { ascending: false });

    const { data, count, error } = await query;
    if (error) throw error;

    return {
      data: (data ?? []).map(mapPost),
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    };
  }

  async getPostBySlug(slug: string): Promise<BlogPost | null> {
    const { data, error } = await this.supabase
      .from('blog_posts')
      .select('*, profiles!blog_posts_author_id_fkey(full_name, avatar_url)')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();

    if (error || !data) return null;

    const { profiles, ...row } = data as BlogPostRow & {
      profiles: { full_name: string; avatar_url: string | null } | null;
    };

    return {
      ...mapPost(row as unknown as BlogPostRow),
      author: profiles ?? undefined,
    };
  }

  async getRelatedPosts(
    slug: string,
    category: string | null,
    tags: string[] | null,
    limit = 3,
  ): Promise<BlogPost[]> {
    let query = this.supabase
      .from('blog_posts')
      .select('*')
      .eq('is_published', true)
      .neq('slug', slug)
      .limit(limit)
      .order('published_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) return [];

    return (data ?? []).map(mapPost);
  }

  async getAllCategories(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('blog_posts')
      .select('category')
      .eq('is_published', true)
      .not('category', 'is', null);

    if (error) return [];

    const categories = [...new Set((data ?? []).map((r) => r.category).filter(Boolean))] as string[];
    return categories.sort();
  }

  async getAllTags(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('blog_posts')
      .select('tags')
      .eq('is_published', true);

    if (error) return [];

    const allTags = new Set<string>();
    for (const row of data ?? []) {
      if (row.tags) {
        for (const tag of row.tags) {
          if (tag) allTags.add(tag);
        }
      }
    }
    return [...allTags].sort();
  }
}

function mapPost(row: BlogPostRow): BlogPost {
  return {
    id: row.id,
    title_en: row.title_en,
    title_ar: row.title_ar ?? null,
    slug: row.slug,
    excerpt: row.excerpt ?? null,
    content_en: row.content_en ?? null,
    content_ar: row.content_ar ?? null,
    cover_image: row.cover_image ?? null,
    category: row.category ?? null,
    tags: row.tags ?? null,
    is_published: row.is_published ?? null,
    published_at: row.published_at ?? null,
    author_id: row.author_id,
    created_at: row.created_at ?? null,
    deleted_at: row.deleted_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}
