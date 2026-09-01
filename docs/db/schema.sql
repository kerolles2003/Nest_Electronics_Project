-- SCHEMA — public
-- Extracted READ-ONLY from the live Supabase project (ref: quhllllvwwuizjfrxvdz)
-- PostgreSQL 17.6 | Extraction date: 2026-08-29 | Phase 0.5 forensic audit
-- Method: catalog queries inside BEGIN TRANSACTION READ ONLY (always rolled back).
-- This file is a faithful REPRESENTATION for migration reference. It is NOT a migration script.
-- DO NOT execute against any database.

-- Views: 0   Materialized views: 0   Enum types: 0
-- NOTE: zero enum types exist; all status columns are text guarded by CHECK constraints.

CREATE TABLE public.addresses (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    label text NOT NULL DEFAULT 'Home'::text,
    full_name text NOT NULL,
    phone text NOT NULL,
    street text NOT NULL,
    city text NOT NULL,
    governorate text NOT NULL,
    postal_code text,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT addresses_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_audit_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    admin_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    changes jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.attribute_values (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    attribute_id uuid NOT NULL,
    value_en text NOT NULL,
    value_ar text,
    sort_order integer DEFAULT 0,
    CONSTRAINT attribute_values_pkey PRIMARY KEY (id)
);

CREATE TABLE public.attributes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name_en text NOT NULL,
    name_ar text,
    slug text NOT NULL,
    type text NOT NULL,
    unit text,
    is_filterable boolean DEFAULT false,
    is_comparable boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    category_ids uuid[],
    CONSTRAINT attributes_type_check CHECK ((type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'select'::text, 'multi_select'::text]))),
    CONSTRAINT attributes_pkey PRIMARY KEY (id),
    CONSTRAINT attributes_slug_key UNIQUE (slug)
);

CREATE TABLE public.blog_posts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    author_id uuid NOT NULL,
    title_en text NOT NULL,
    title_ar text,
    slug text NOT NULL,
    content_en text,
    content_ar text,
    excerpt text,
    cover_image text,
    category text,
    tags text[],
    is_published boolean DEFAULT false,
    published_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT blog_posts_pkey PRIMARY KEY (id),
    CONSTRAINT blog_posts_slug_key UNIQUE (slug)
);

CREATE TABLE public.brands (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name_en text NOT NULL,
    name_ar text,
    slug text NOT NULL,
    logo_url text,
    is_active boolean DEFAULT true,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT brands_pkey PRIMARY KEY (id),
    CONSTRAINT brands_slug_key UNIQUE (slug)
);

CREATE TABLE public.cart_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    cart_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    quantity integer NOT NULL DEFAULT 1,
    CONSTRAINT cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT cart_items_pkey PRIMARY KEY (id),
    CONSTRAINT cart_items_cart_id_product_id_variant_id_key UNIQUE (cart_id, product_id, variant_id)
);

CREATE TABLE public.carts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid,
    session_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT carts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.categories (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name_en text NOT NULL,
    name_ar text,
    slug text NOT NULL,
    parent_id uuid,
    image_url text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT categories_pkey PRIMARY KEY (id),
    CONSTRAINT categories_slug_key UNIQUE (slug)
);

CREATE TABLE public.coupons (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    code text NOT NULL,
    type text NOT NULL,
    value numeric(10,2) NOT NULL,
    min_order numeric(10,2),
    max_discount numeric(10,2),
    usage_limit integer,
    used_count integer DEFAULT 0,
    starts_at timestamp with time zone,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    CONSTRAINT coupons_type_check CHECK ((type = ANY (ARRAY['percentage'::text, 'fixed'::text]))),
    CONSTRAINT coupons_pkey PRIMARY KEY (id),
    CONSTRAINT coupons_code_key UNIQUE (code)
);

CREATE TABLE public.inventory_transactions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    variant_id uuid,
    type text NOT NULL,
    quantity integer NOT NULL,
    reference_type text,
    reference_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_transactions_type_check CHECK ((type = ANY (ARRAY['purchase'::text, 'sale'::text, 'return'::text, 'adjustment'::text, 'reservation'::text, 'reservation_release'::text, 'damaged'::text]))),
    CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text,
    data jsonb,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

CREATE TABLE public.order_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    name text NOT NULL,
    sku text NOT NULL,
    price numeric(10,2) NOT NULL,
    quantity integer NOT NULL,
    total numeric(10,2) NOT NULL,
    CONSTRAINT order_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public.order_status_history (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    field text NOT NULL,
    from_value text,
    to_value text NOT NULL,
    changed_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT order_status_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.orders (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    order_number text NOT NULL DEFAULT generate_order_number(),
    order_status text NOT NULL DEFAULT 'pending_payment'::text,
    payment_status text NOT NULL DEFAULT 'pending'::text,
    fulfillment_status text NOT NULL DEFAULT 'unfulfilled'::text,
    subtotal numeric(10,2) NOT NULL,
    discount numeric(10,2) DEFAULT 0,
    shipping_fee numeric(10,2) DEFAULT 0,
    tax numeric(10,2) DEFAULT 0,
    total numeric(10,2) NOT NULL,
    coupon_id uuid,
    shipping_address jsonb NOT NULL,
    billing_address jsonb,
    payment_method text DEFAULT 'cod'::text,
    payment_provider_id text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT orders_fulfillment_status_check CHECK ((fulfillment_status = ANY (ARRAY['unfulfilled'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'returned'::text]))),
    CONSTRAINT orders_order_status_check CHECK ((order_status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text, 'failed'::text]))),
    CONSTRAINT orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'authorized'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text]))),
    CONSTRAINT orders_pkey PRIMARY KEY (id),
    CONSTRAINT orders_order_number_key UNIQUE (order_number)
);

CREATE TABLE public.product_attribute_values (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    attribute_id uuid NOT NULL,
    attribute_value_id uuid,
    custom_value text,
    CONSTRAINT product_attribute_values_pkey PRIMARY KEY (id),
    CONSTRAINT product_attribute_values_product_id_attribute_id_key UNIQUE (product_id, attribute_id)
);

CREATE TABLE public.product_compatibility (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    compatible_product_id uuid NOT NULL,
    compatibility_type text NOT NULL,
    notes text,
    CONSTRAINT product_compatibility_compatibility_type_check CHECK ((compatibility_type = ANY (ARRAY['works_with'::text, 'requires'::text, 'replaces'::text, 'accessory_for'::text]))),
    CONSTRAINT product_compatibility_pkey PRIMARY KEY (id),
    CONSTRAINT product_compatibility_product_id_compatible_product_id_comp_key UNIQUE (product_id, compatible_product_id, compatibility_type)
);

CREATE TABLE public.product_images (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    url text NOT NULL,
    alt_text text,
    sort_order integer DEFAULT 0,
    is_primary boolean DEFAULT false,
    CONSTRAINT product_images_pkey PRIMARY KEY (id)
);

CREATE TABLE public.product_tags (
    product_id uuid NOT NULL,
    tag text NOT NULL,
    CONSTRAINT product_tags_pkey PRIMARY KEY (product_id, tag)
);

CREATE TABLE public.product_variants (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    name text NOT NULL,
    sku text NOT NULL,
    price_modifier numeric(10,2) DEFAULT 0,
    stock_quantity integer NOT NULL DEFAULT 0,
    reserved_quantity integer NOT NULL DEFAULT 0,
    attributes jsonb,
    is_active boolean DEFAULT true,
    CONSTRAINT chk_variant_stock CHECK ((stock_quantity >= reserved_quantity)),
    CONSTRAINT product_variants_pkey PRIMARY KEY (id),
    CONSTRAINT product_variants_sku_key UNIQUE (sku)
);

CREATE TABLE public.products (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    sku text NOT NULL,
    name_en text NOT NULL,
    name_ar text,
    slug text NOT NULL,
    description_en text,
    description_ar text,
    category_id uuid,
    brand_id uuid,
    base_price numeric(10,2) NOT NULL,
    sale_price numeric(10,2),
    cost_price numeric(10,2),
    stock_quantity integer NOT NULL DEFAULT 0,
    reserved_quantity integer NOT NULL DEFAULT 0,
    low_stock_threshold integer DEFAULT 5,
    weight numeric(8,3),
    dimensions jsonb,
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    seo_title text,
    seo_description text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_available_stock CHECK ((stock_quantity >= reserved_quantity)),
    CONSTRAINT products_pkey PRIMARY KEY (id),
    CONSTRAINT products_sku_key UNIQUE (sku),
    CONSTRAINT products_slug_key UNIQUE (slug)
);

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    phone text,
    avatar_url text,
    role text NOT NULL DEFAULT 'customer'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'admin'::text, 'super_admin'::text]))),
    CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

CREATE TABLE public.recently_viewed (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid,
    session_id text,
    product_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT recently_viewed_pkey PRIMARY KEY (id)
);

CREATE TABLE public.review_images (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL,
    url text NOT NULL,
    sort_order integer DEFAULT 0,
    CONSTRAINT review_images_pkey PRIMARY KEY (id)
);

CREATE TABLE public.review_votes (
    user_id uuid NOT NULL,
    review_id uuid NOT NULL,
    is_helpful boolean NOT NULL,
    CONSTRAINT review_votes_pkey PRIMARY KEY (user_id, review_id)
);

CREATE TABLE public.reviews (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    rating integer NOT NULL,
    title text,
    comment text,
    is_verified_purchase boolean DEFAULT false,
    moderation_status text DEFAULT 'pending'::text,
    helpful_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reviews_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT reviews_pkey PRIMARY KEY (id),
    CONSTRAINT reviews_user_id_product_id_key UNIQUE (user_id, product_id)
);

CREATE TABLE public.slug_redirects (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    entity_type text NOT NULL,
    old_slug text NOT NULL,
    new_slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT slug_redirects_pkey PRIMARY KEY (id),
    CONSTRAINT slug_redirects_entity_type_old_slug_key UNIQUE (entity_type, old_slug)
);

CREATE TABLE public.wishlists (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT wishlists_pkey PRIMARY KEY (id),
    CONSTRAINT wishlists_user_id_product_id_key UNIQUE (user_id, product_id)
);


-- ============ FOREIGN KEYS ============
ALTER TABLE public.addresses ADD CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.admin_audit_logs ADD CONSTRAINT admin_audit_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES profiles(id);
ALTER TABLE public.attribute_values ADD CONSTRAINT attribute_values_attribute_id_fkey FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id);
ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE;
ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
ALTER TABLE public.carts ADD CONSTRAINT carts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.categories ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
ALTER TABLE public.order_status_history ADD CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES profiles(id);
ALTER TABLE public.order_status_history ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id);
ALTER TABLE public.orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.product_attribute_values ADD CONSTRAINT product_attribute_values_attribute_id_fkey FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE;
ALTER TABLE public.product_attribute_values ADD CONSTRAINT product_attribute_values_attribute_value_id_fkey FOREIGN KEY (attribute_value_id) REFERENCES attribute_values(id);
ALTER TABLE public.product_attribute_values ADD CONSTRAINT product_attribute_values_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_compatibility ADD CONSTRAINT product_compatibility_compatible_product_id_fkey FOREIGN KEY (compatible_product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_compatibility ADD CONSTRAINT product_compatibility_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_images ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_tags ADD CONSTRAINT product_tags_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id);
ALTER TABLE public.products ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.recently_viewed ADD CONSTRAINT recently_viewed_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.recently_viewed ADD CONSTRAINT recently_viewed_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.review_images ADD CONSTRAINT review_images_review_id_fkey FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE;
ALTER TABLE public.review_votes ADD CONSTRAINT review_votes_review_id_fkey FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE;
ALTER TABLE public.review_votes ADD CONSTRAINT review_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.wishlists ADD CONSTRAINT wishlists_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.wishlists ADD CONSTRAINT wishlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============ SEQUENCES ============
CREATE SEQUENCE public.order_number_seq AS bigint START WITH 1 INCREMENT BY 1;  -- consumed by generate_order_number()
-- Live last_value at extraction: 10 (GLOBAL counter, never reset per-day)
