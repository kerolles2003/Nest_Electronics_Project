import { z } from 'zod';

// ---- Auth Schemas ----
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string(),
}).refine(data => data.password === data.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});
export type RegisterInput = z.infer<typeof registerSchema>;

// ---- Checkout Schemas ----
export const shippingAddressSchema = z.object({
  full_name: z.string().min(2).max(100),
  phone: z.string().regex(/^(\+20|0)?1[0-2,5]{1}[0-9]{8}$/, 'Invalid Egyptian phone number'),
  street: z.string().min(5).max(200),
  city: z.string().min(2).max(100),
  governorate: z.string().min(2).max(100),
  postal_code: z.string().optional(),
});
export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;

export const checkoutSchema = z.object({
  shipping_address: shippingAddressSchema,
  payment_method: z.literal('cod'),
  notes: z.string().max(500).optional(),
  coupon_code: z.string().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ---- Review Schemas ----
export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().max(100).optional(),
  comment: z.string().max(2000).optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

// ---- Address Schemas ----
export const addressSchema = shippingAddressSchema.extend({
  label: z.string().max(50).default('Home'),
  is_default: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;

// ---- Admin Product Schemas ----
export const productSchema = z.object({
  sku: z.string().min(1).max(100),
  name_en: z.string().min(2).max(255),
  name_ar: z.string().max(255).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description_en: z.string().max(10000).optional(),
  description_ar: z.string().max(10000).optional(),
  category_id: z.string().uuid().optional(),
  brand_id: z.string().uuid().optional(),
  base_price: z.number().positive(),
  sale_price: z.number().min(0).optional(),
  cost_price: z.number().min(0).optional(),
  stock_quantity: z.number().int().min(0),
  low_stock_threshold: z.number().int().min(0).default(5),
  weight: z.number().min(0).optional(),
  dimensions: z.string().max(100).optional(),
  is_active: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  seo_title: z.string().max(60).optional(),
  seo_description: z.string().max(160).optional(),
});
export type ProductInput = z.infer<typeof productSchema>;

// ---- Coupon Schemas ----
export const couponSchema = z.object({



  code: z.string().min(3).max(50).toUpperCase(),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().positive(),
  min_order: z.number().positive().optional(),
  max_discount: z.number().positive().optional(),
  usage_limit: z.number().int().positive().optional(),
  starts_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  is_active: z.boolean().default(true),
});
export type CouponInput = z.infer<typeof couponSchema>;

// ---- Order Lookup Schema (guest tracking) ----
export const orderLookupSchema = z.object({
  order_number: z.string().min(1, 'Order number required'),
  phone: z
    .string()
    .regex(/^([+]?20|0)?1[0-2,5]{1}[0-9]{8}$/, 'Invalid Egyptian phone number')
    .min(1, 'Phone required'),
});
export type OrderLookupInput = z.infer<typeof orderLookupSchema>;

export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().positive().max(99),
  name: z.string().optional(),
  price: z.number().min(0).optional(),
  imageUrl: z.string().optional(),
  slug: z.string().optional(),
  sku: z.string().optional(),
  maxStock: z.number().int().min(0).optional(),
});

export const cartSyncSchema = z.array(cartItemSchema);
