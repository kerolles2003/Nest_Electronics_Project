import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IProductRepository, ICategoryRepository, IBrandRepository,
  CreateProductInput, UpdateProductInput
} from '@nest/repositories';
import type { Product, Category, Brand, ProductFilters, PaginatedResult, Pagination } from '@nest/types';

export class SupabaseProductProvider implements IProductRepository {
  constructor(private client: SupabaseClient) {}

  async findById(id: string, includeInactive = false): Promise<Product | null> {
    let query = this.client
      .from('products')
      .select(`*, images:product_images(*), category:categories(*), brand:brands(*),
               attributes:product_attribute_values(*, attribute:attributes(*), value:attribute_values(*))`)
      .eq('id', id)
      .is('deleted_at', null);
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query.single();
    if (error || !data) return null;
    return this.mapProduct(data);
  }

  async findBySlug(slug: string, includeInactive = false): Promise<Product | null> {
    let query = this.client
      .from('products')
      .select(`*, images:product_images(*), category:categories(*), brand:brands(*),
               attributes:product_attribute_values(*, attribute:attributes(*), value:attribute_values(*))`)
      .eq('slug', slug)
      .is('deleted_at', null);
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query.single();
    if (error || !data) return null;
    return this.mapProduct(data);
  }

  async findMany(filters: ProductFilters, pagination: Pagination): Promise<PaginatedResult<Product>> {
    const { data, error, count } = await this.client
      .rpc('search_products', {
        search_query: filters.search ?? '',
        category_slug: filters.categorySlug ?? null,
        brand_slug: filters.brandSlug ?? null,
        min_price: filters.minPrice ?? null,
        max_price: filters.maxPrice ?? null,
        in_stock_only: filters.inStockOnly ?? false,
        result_limit: pagination.limit,
        result_offset: (pagination.page - 1) * pagination.limit,
      }, { count: 'exact' });
    if (error) throw new Error(`Product search failed: ${error.message}`);
    const total = count ?? 0;
    return {
      data: (data ?? []).map(this.mapProduct),
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  async findFeatured(limit = 8): Promise<Product[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*, images:product_images(*), brand:brands(*)')
      .eq('is_active', true)
      .eq('is_featured', true)
      .is('deleted_at', null)
      .limit(limit);
    if (error) return [];
    return (data ?? []).map(this.mapProduct);
  }

  async findNewArrivals(limit = 8): Promise<Product[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*, images:product_images(*), brand:brands(*)')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map(this.mapProduct);
  }

  async findBestSelling(limit = 8): Promise<Product[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*, images:product_images(*), brand:brands(*)')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('avg_rating', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map(this.mapProduct);
  }

  async create(data: CreateProductInput): Promise<Product> {
    const { data: product, error } = await this.client
      .from('products').insert(data).select().single();
    if (error || !product) throw new Error(`Failed to create product: ${error?.message}`);
    return this.mapProduct(product);
  }

  async update(id: string, data: UpdateProductInput): Promise<Product> {
    const { data: product, error } = await this.client
      .from('products').update(data).eq('id', id).select().single();
    if (error || !product) throw new Error(`Failed to update product: ${error?.message}`);
    return this.mapProduct(product);
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.client
      .from('products').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(`Failed to delete product: ${error.message}`);
  }

  async adjustStock(id: string, delta: number, reservedDelta = 0): Promise<void> {
    const { error } = await this.client.rpc('adjust_product_stock', {
      p_product_id: id, p_delta: delta, p_reserved_delta: reservedDelta,
    });
    if (error) throw new Error(`Stock adjustment failed: ${error.message}`);
  }

  private mapProduct(raw: Record<string, unknown>): Product {
    const stock = (raw['stock_quantity'] as number) ?? 0;
    const reserved = (raw['reserved_quantity'] as number) ?? 0;
    return { ...raw, available_stock: stock - reserved } as Product;
  }
}

export class SupabaseCategoryProvider implements ICategoryRepository {
  constructor(private client: SupabaseClient) {}

  async findAll(): Promise<Category[]> {
    const { data } = await this.client
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order');
    return data ?? [];
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const { data } = await this.client
      .from('categories').select('*').eq('slug', slug).single();
    return data ?? null;
  }

  async findTree(): Promise<Category[]> {
    const all = await this.findAll();
    const map = new Map<string, Category>(all.map(c => [c.id, { ...c, children: [] }]));
    const roots: Category[] = [];
    for (const cat of map.values()) {
      if (cat.parent_id && map.has(cat.parent_id)) {
        map.get(cat.parent_id)!.children!.push(cat);
      } else {
        roots.push(cat);
      }
    }
    return roots;
  }

  async create(data: Omit<Category, 'id' | 'deleted_at' | 'children'>): Promise<Category> {
    const { data: cat, error } = await this.client.from('categories').insert(data).select().single();
    if (error || !cat) throw new Error(`Failed to create category: ${error?.message}`);
    return cat;
  }

  async update(id: string, data: Partial<Category>): Promise<Category> {
    const { data: cat, error } = await this.client.from('categories').update(data).eq('id', id).select().single();
    if (error || !cat) throw new Error(`Failed to update category: ${error?.message}`);
    return cat;
  }

  async softDelete(id: string): Promise<void> {
    await this.client.from('categories').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  }
}

export class SupabaseBrandProvider implements IBrandRepository {
  constructor(private client: SupabaseClient) {}

  async findAll(): Promise<Brand[]> {
    const { data } = await this.client.from('brands').select('*').eq('is_active', true).is('deleted_at', null).order('name_en');
    return data ?? [];
  }

  async findBySlug(slug: string): Promise<Brand | null> {
    const { data } = await this.client.from('brands').select('*').eq('slug', slug).single();
    return data ?? null;
  }

  async create(data: Omit<Brand, 'id'>): Promise<Brand> {
    const { data: brand, error } = await this.client.from('brands').insert(data).select().single();
    if (error || !brand) throw new Error(`Failed to create brand: ${error?.message}`);
    return brand;
  }

  async update(id: string, data: Partial<Brand>): Promise<Brand> {
    const { data: brand, error } = await this.client.from('brands').update(data).eq('id', id).select().single();
    if (error || !brand) throw new Error(`Failed to update brand: ${error?.message}`);
    return brand;
  }

  async softDelete(id: string): Promise<void> {
    await this.client.from('brands').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  }
}
