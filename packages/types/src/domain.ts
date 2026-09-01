import type { OrderStatus, PaymentStatus, FulfillmentStatus, ModerationStatus } from './enums';

export interface Pagination {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---- Product Domain ----
export interface Product {
  id: string;
  sku: string;
  name_en: string;
  name_ar: string | null;
  slug: string;
  description_en: string | null;
  description_ar: string | null;
  category_id: string | null;
  brand_id: string | null;
  base_price: number;
  sale_price: number | null;
  cost_price: number | null;
  stock_quantity: number;
  reserved_quantity: number;
  available_stock: number; // computed: stock_quantity - reserved_quantity
  low_stock_threshold: number;
  weight: number | null;
  dimensions: string | null;
  is_active: boolean;
  is_featured: boolean;
  seo_title: string | null;
  seo_description: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Relations (populated by joins)
  images?: ProductImage[];
  category?: Category | null;
  brand?: Brand | null;
  attributes?: ProductAttributeValue[];
  avg_rating?: number;
  review_count?: number;
}

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
}

export interface ProductFilters {
  categorySlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  attributes?: Record<string, string[]>; // { 'protocol': ['i2c', 'spi'] }
  search?: string;
  isFeatured?: boolean;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'rating';
}

export interface Category {
  id: string;
  name_en: string;
  name_ar: string | null;
  slug: string;
  parent_id: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
  children?: Category[];
}

export interface Brand {
  id: string;
  name_en: string;
  name_ar: string | null;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  deleted_at: string | null;
}

export interface Attribute {
  id: string;
  name_en: string;
  slug: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multi_select';
  unit: string | null;
  is_filterable: boolean;
  is_comparable: boolean;
  sort_order: number;
  values?: AttributeValue[];
}

export interface AttributeValue {
  id: string;
  attribute_id: string;
  value_en: string;
  sort_order: number;
}

export interface ProductAttributeValue {
  id: string;
  product_id: string;
  attribute_id: string;
  attribute_value_id: string | null;
  custom_value: string | null;
  attribute?: Attribute;
  value?: AttributeValue;
}

// ---- Cart Domain ----
export interface CartItem {
  productId: string;
  variantId?: string | null;
  quantity: number;
  // Denormalized for display (guest cart)
  name?: string;
  price?: number;
  imageUrl?: string;
  slug?: string;
  sku?: string;
  maxStock?: number;
}

export interface Cart {
  id?: string; // undefined for guest carts
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}

// ---- Order Domain ----
export interface Order {
  id: string;
  user_id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  subtotal: number;
  discount: number;
  shipping_fee: number;
  tax: number;
  total: number;
  shipping_address: ShippingAddress;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
  status_history?: OrderStatusHistory[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  total: number;
}

export interface OrderStatusHistory {
  id: string;
  order_id: string;
  field: string;
  from_value: string | null;
  to_value: string;
  changed_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface ShippingAddress {
  full_name: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  postal_code?: string;
}

// ---- User Domain ----
export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  role: 'customer' | 'admin' | 'super_admin';
  created_at: string;
  updated_at: string;
}

export interface Address {
  id: string;
  user_id: string;
  label: string;
  full_name: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  postal_code: string | null;
  is_default: boolean;
  created_at: string;
}

// ---- Review Domain ----
export interface Review {
  id: string;
  user_id: string;
  product_id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  is_verified_purchase: boolean;
  moderation_status: ModerationStatus;
  helpful_count: number;
  created_at: string;
  images?: ReviewImage[];
  profile?: Pick<Profile, 'full_name' | 'avatar_url'>;
}

export interface ReviewImage {
  id: string;
  review_id: string;
  url: string;
  sort_order: number;
}

// ---- Blog Domain ----
export interface BlogPost {
  id: string;
  title_en: string;
  title_ar: string | null;
  slug: string;
  excerpt: string | null;
  content_en: string | null;
  content_ar: string | null;
  cover_image: string | null;
  category: string | null;
  tags: string[] | null;
  is_published: boolean | null;
  published_at: string | null;
  author_id: string;
  created_at: string | null;
  deleted_at: string | null;
  updated_at: string | null;
  // Joined
  author?: Pick<Profile, 'full_name' | 'avatar_url'>;
}

export interface BlogFilters {
  category?: string;
  tag?: string;
  search?: string;
}

// ---- Search Domain ----
export interface SearchOptions {
  filters?: Record<string, string[]>;
  facets?: string[];
  sort?: { field: string; order: 'asc' | 'desc' };
  pagination: Pagination;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface SearchResult {
  hits: Product[];
  total: number;
  facetCounts: Record<string, FacetCount[]>;
  processingTimeMs: number;
}

// ---- Blog Domain ----
export interface BlogPost {
  id: string;
  title_en: string;
  slug: string;
  excerpt: string | null;
  content_en: string | null;
  cover_image: string | null;
  category: string | null;
  tags: string[] | null;
  is_published: boolean | null;
  published_at: string | null;
  author_id: string;
  created_at: string | null;
  author?: Pick<Profile, 'full_name' | 'avatar_url'>;
}

export interface BlogFilters {
  category?: string;
  tag?: string;
  search?: string;
}
