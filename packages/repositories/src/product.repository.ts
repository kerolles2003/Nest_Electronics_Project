import type {
  Product, ProductFilters, Category, Brand,
  Attribute, PaginatedResult, Pagination
} from '@nest/types';

export interface CreateProductInput {
  sku: string;
  name_en: string;
  name_ar?: string;
  slug: string;
  description_en?: string;
  description_ar?: string;
  category_id?: string;
  brand_id?: string;
  base_price: number;
  sale_price?: number;
  cost_price?: number;
  stock_quantity: number;
  low_stock_threshold?: number;
  weight?: number;
  dimensions?: string;
  is_active?: boolean;
  is_featured?: boolean;
  seo_title?: string;
  seo_description?: string;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {}

export interface IProductRepository {
  findById(id: string, includeInactive?: boolean): Promise<Product | null>;
  findBySlug(slug: string, includeInactive?: boolean): Promise<Product | null>;
  findMany(filters: ProductFilters, pagination: Pagination): Promise<PaginatedResult<Product>>;
  findFeatured(limit?: number): Promise<Product[]>;
  findNewArrivals(limit?: number): Promise<Product[]>;
  findBestSelling(limit?: number): Promise<Product[]>;
  create(data: CreateProductInput): Promise<Product>;
  update(id: string, data: UpdateProductInput): Promise<Product>;
  softDelete(id: string): Promise<void>;
  adjustStock(id: string, delta: number, reservedDelta?: number): Promise<void>;
}

export interface ICategoryRepository {
  findAll(): Promise<Category[]>;
  findBySlug(slug: string): Promise<Category | null>;
  findTree(): Promise<Category[]>; // Nested tree with children
  create(data: Omit<Category, 'id' | 'deleted_at' | 'children'>): Promise<Category>;
  update(id: string, data: Partial<Category>): Promise<Category>;
  softDelete(id: string): Promise<void>;
}

export interface IBrandRepository {
  findAll(): Promise<Brand[]>;
  findBySlug(slug: string): Promise<Brand | null>;
  create(data: Omit<Brand, 'id'>): Promise<Brand>;
  update(id: string, data: Partial<Brand>): Promise<Brand>;
  softDelete(id: string): Promise<void>;
}

export interface IAttributeRepository {
  findAll(): Promise<Attribute[]>;
  findByCategoryIds(categoryIds: string[]): Promise<Attribute[]>;
  findFilterable(): Promise<Attribute[]>;
}
