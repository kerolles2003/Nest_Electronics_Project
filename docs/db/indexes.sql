-- INDEXES
-- Extracted READ-ONLY from the live Supabase project (ref: quhllllvwwuizjfrxvdz)
-- PostgreSQL 17.6 | Extraction date: 2026-08-29 | Phase 0.5 forensic audit
-- Method: catalog queries inside BEGIN TRANSACTION READ ONLY (always rolled back).
-- This file is a faithful REPRESENTATION for migration reference. It is NOT a migration script.
-- DO NOT execute against any database.

-- 67 indexes in public schema.
-- idx_scan counts are from pg_stat_user_indexes at extraction time (live workload).


-- ---- addresses ----
CREATE UNIQUE INDEX addresses_pkey ON public.addresses USING btree (id);  -- scans=0

-- ---- admin_audit_logs ----
CREATE UNIQUE INDEX admin_audit_logs_pkey ON public.admin_audit_logs USING btree (id);  -- scans=0
CREATE INDEX idx_audit_admin ON public.admin_audit_logs USING btree (admin_id);  -- scans=0
CREATE INDEX idx_audit_entity ON public.admin_audit_logs USING btree (entity_type, entity_id);  -- scans=0

-- ---- attribute_values ----
CREATE UNIQUE INDEX attribute_values_pkey ON public.attribute_values USING btree (id);  -- scans=0

-- ---- attributes ----
CREATE UNIQUE INDEX attributes_pkey ON public.attributes USING btree (id);  -- scans=0
CREATE UNIQUE INDEX attributes_slug_key ON public.attributes USING btree (slug);  -- scans=9

-- ---- blog_posts ----
CREATE UNIQUE INDEX blog_posts_pkey ON public.blog_posts USING btree (id);  -- scans=1
CREATE UNIQUE INDEX blog_posts_slug_key ON public.blog_posts USING btree (slug);  -- scans=1

-- ---- brands ----
CREATE UNIQUE INDEX brands_pkey ON public.brands USING btree (id);  -- scans=6129
CREATE UNIQUE INDEX brands_slug_key ON public.brands USING btree (slug);  -- scans=54

-- ---- cart_items ----
CREATE UNIQUE INDEX cart_items_cart_id_product_id_variant_id_key ON public.cart_items USING btree (cart_id, product_id, variant_id);  -- scans=2
CREATE UNIQUE INDEX cart_items_pkey ON public.cart_items USING btree (id);  -- scans=0

-- ---- carts ----
CREATE UNIQUE INDEX carts_pkey ON public.carts USING btree (id);  -- scans=11
CREATE INDEX idx_carts_session ON public.carts USING btree (session_id);  -- scans=0
CREATE INDEX idx_carts_user ON public.carts USING btree (user_id);  -- scans=4

-- ---- categories ----
CREATE UNIQUE INDEX categories_pkey ON public.categories USING btree (id);  -- scans=4327
CREATE UNIQUE INDEX categories_slug_key ON public.categories USING btree (slug);  -- scans=361

-- ---- coupons ----
CREATE UNIQUE INDEX coupons_code_key ON public.coupons USING btree (code);  -- scans=0
CREATE UNIQUE INDEX coupons_pkey ON public.coupons USING btree (id);  -- scans=0

-- ---- inventory_transactions ----
CREATE INDEX idx_inv_tx_product ON public.inventory_transactions USING btree (product_id);  -- scans=4
CREATE INDEX idx_inv_tx_reference ON public.inventory_transactions USING btree (reference_type, reference_id);  -- scans=0
CREATE UNIQUE INDEX inventory_transactions_pkey ON public.inventory_transactions USING btree (id);  -- scans=0

-- ---- notifications ----
CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);  -- scans=0

-- ---- order_items ----
CREATE UNIQUE INDEX order_items_pkey ON public.order_items USING btree (id);  -- scans=0

-- ---- order_status_history ----
CREATE UNIQUE INDEX order_status_history_pkey ON public.order_status_history USING btree (id);  -- scans=0

-- ---- orders ----
CREATE INDEX idx_orders_number ON public.orders USING btree (order_number);  -- scans=3
CREATE INDEX idx_orders_status ON public.orders USING btree (order_status);  -- scans=35512
CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);  -- scans=94
CREATE UNIQUE INDEX orders_order_number_key ON public.orders USING btree (order_number);  -- scans=0
CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id);  -- scans=395

-- ---- product_attribute_values ----
CREATE INDEX idx_pav_attribute ON public.product_attribute_values USING btree (attribute_id);  -- scans=0
CREATE INDEX idx_pav_product ON public.product_attribute_values USING btree (product_id);  -- scans=60
CREATE INDEX idx_pav_value ON public.product_attribute_values USING btree (attribute_value_id);  -- scans=0
CREATE UNIQUE INDEX product_attribute_values_pkey ON public.product_attribute_values USING btree (id);  -- scans=0
CREATE UNIQUE INDEX product_attribute_values_product_id_attribute_id_key ON public.product_attribute_values USING btree (product_id, attribute_id);  -- scans=0

-- ---- product_compatibility ----
CREATE UNIQUE INDEX product_compatibility_pkey ON public.product_compatibility USING btree (id);  -- scans=0
CREATE UNIQUE INDEX product_compatibility_product_id_compatible_product_id_comp_key ON public.product_compatibility USING btree (product_id, compatible_product_id, compatibility_type);  -- scans=0

-- ---- product_images ----
CREATE UNIQUE INDEX product_images_pkey ON public.product_images USING btree (id);  -- scans=20

-- ---- product_tags ----
CREATE UNIQUE INDEX product_tags_pkey ON public.product_tags USING btree (product_id, tag);  -- scans=0

-- ---- product_variants ----
CREATE UNIQUE INDEX product_variants_pkey ON public.product_variants USING btree (id);  -- scans=0
CREATE UNIQUE INDEX product_variants_sku_key ON public.product_variants USING btree (sku);  -- scans=0

-- ---- products ----
CREATE INDEX idx_products_brand ON public.products USING btree (brand_id) WHERE ((is_active = true) AND (deleted_at IS NULL));  -- scans=131
CREATE INDEX idx_products_category ON public.products USING btree (category_id) WHERE ((is_active = true) AND (deleted_at IS NULL));  -- scans=162
CREATE INDEX idx_products_featured ON public.products USING btree (is_featured) WHERE ((is_active = true) AND (deleted_at IS NULL));  -- scans=621
CREATE INDEX idx_products_search ON public.products USING gin (to_tsvector('english'::regconfig, ((name_en || ' '::text) || COALESCE(description_en, ''::text)))) WHERE ((is_active = true) AND (deleted_at IS NULL));  -- scans=0
CREATE INDEX idx_products_sku ON public.products USING btree (sku);  -- scans=0
CREATE INDEX idx_products_slug ON public.products USING btree (slug);  -- scans=64
CREATE UNIQUE INDEX products_pkey ON public.products USING btree (id);  -- scans=209
CREATE UNIQUE INDEX products_sku_key ON public.products USING btree (sku);  -- scans=0
CREATE UNIQUE INDEX products_slug_key ON public.products USING btree (slug);  -- scans=84

-- ---- profiles ----
CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);  -- scans=2719

-- ---- recently_viewed ----
CREATE INDEX idx_recently_viewed_session ON public.recently_viewed USING btree (session_id);  -- scans=0
CREATE INDEX idx_recently_viewed_user ON public.recently_viewed USING btree (user_id);  -- scans=0
CREATE UNIQUE INDEX recently_viewed_pkey ON public.recently_viewed USING btree (id);  -- scans=0

-- ---- review_images ----
CREATE UNIQUE INDEX review_images_pkey ON public.review_images USING btree (id);  -- scans=0

-- ---- review_votes ----
CREATE UNIQUE INDEX review_votes_pkey ON public.review_votes USING btree (user_id, review_id);  -- scans=0

-- ---- reviews ----
CREATE INDEX idx_reviews_product ON public.reviews USING btree (product_id) WHERE (moderation_status = 'approved'::text);  -- scans=18
CREATE INDEX idx_reviews_user ON public.reviews USING btree (user_id);  -- scans=0
CREATE UNIQUE INDEX reviews_pkey ON public.reviews USING btree (id);  -- scans=0
CREATE UNIQUE INDEX reviews_user_id_product_id_key ON public.reviews USING btree (user_id, product_id);  -- scans=0

-- ---- slug_redirects ----
CREATE INDEX idx_slug_redirect ON public.slug_redirects USING btree (entity_type, old_slug);  -- scans=0
CREATE UNIQUE INDEX slug_redirects_entity_type_old_slug_key ON public.slug_redirects USING btree (entity_type, old_slug);  -- scans=0
CREATE UNIQUE INDEX slug_redirects_pkey ON public.slug_redirects USING btree (id);  -- scans=0

-- ---- wishlists ----
CREATE INDEX idx_wishlists_user ON public.wishlists USING btree (user_id);  -- scans=0
CREATE UNIQUE INDEX wishlists_pkey ON public.wishlists USING btree (id);  -- scans=0
CREATE UNIQUE INDEX wishlists_user_id_product_id_key ON public.wishlists USING btree (user_id, product_id);  -- scans=0
