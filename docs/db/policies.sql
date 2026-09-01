-- ROW LEVEL SECURITY — enablement + policies
-- Extracted READ-ONLY from the live Supabase project (ref: quhllllvwwuizjfrxvdz)
-- PostgreSQL 17.6 | Extraction date: 2026-08-29 | Phase 0.5 forensic audit
-- Method: catalog queries inside BEGIN TRANSACTION READ ONLY (always rolled back).
-- This file is a faithful REPRESENTATION for migration reference. It is NOT a migration script.
-- DO NOT execute against any database.

-- RLS is ENABLED on all 28 public tables. 58 policies total (public + storage).

-- ============ RLS ENABLEMENT ============
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.attribute_values ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.attributes ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.product_compatibility ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.product_tags ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.recently_viewed ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.review_images ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.review_votes ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.slug_redirects ENABLE ROW LEVEL SECURITY;  -- forced=false
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;  -- forced=false

-- ============ POLICIES ============

-- ---- public.addresses ----
CREATE POLICY "addresses_own" ON public.addresses
    AS PERMISSIVE FOR ALL TO public
    USING (((auth.uid() = user_id) OR is_admin()))
;

-- ---- public.admin_audit_logs ----
CREATE POLICY "audit_logs_admin_insert" ON public.admin_audit_logs
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (is_admin())
;
CREATE POLICY "audit_logs_admin_read" ON public.admin_audit_logs
    AS PERMISSIVE FOR SELECT TO public
    USING (is_admin())
;

-- ---- public.attribute_values ----
CREATE POLICY "attribute_values_admin_all" ON public.attribute_values
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "attribute_values_public_read" ON public.attribute_values
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.attributes ----
CREATE POLICY "attributes_admin_all" ON public.attributes
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "attributes_public_read" ON public.attributes
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.blog_posts ----
CREATE POLICY "blog_admin_all" ON public.blog_posts
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "blog_public_read" ON public.blog_posts
    AS PERMISSIVE FOR SELECT TO public
    USING (((is_published = true) AND (deleted_at IS NULL)))
;

-- ---- public.brands ----
CREATE POLICY "brands_admin_all" ON public.brands
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "brands_public_read" ON public.brands
    AS PERMISSIVE FOR SELECT TO public
    USING (((is_active = true) AND (deleted_at IS NULL)))
;

-- ---- public.cart_items ----
CREATE POLICY "cart_items_own" ON public.cart_items
    AS PERMISSIVE FOR ALL TO public
    USING ((EXISTS ( SELECT 1
   FROM carts
  WHERE ((carts.id = cart_items.cart_id) AND ((carts.user_id = auth.uid()) OR is_admin())))))
;

-- ---- public.carts ----
CREATE POLICY "carts_own" ON public.carts
    AS PERMISSIVE FOR ALL TO public
    USING (((auth.uid() = user_id) OR is_admin()))
;

-- ---- public.categories ----
CREATE POLICY "categories_admin_all" ON public.categories
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "categories_public_read" ON public.categories
    AS PERMISSIVE FOR SELECT TO public
    USING (((is_active = true) AND (deleted_at IS NULL)))
;

-- ---- public.coupons ----
CREATE POLICY "coupons_admin_all" ON public.coupons
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;

-- ---- public.inventory_transactions ----
CREATE POLICY "inventory_admin_all" ON public.inventory_transactions
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;

-- ---- public.notifications ----
CREATE POLICY "notifications_own" ON public.notifications
    AS PERMISSIVE FOR ALL TO public
    USING ((auth.uid() = user_id))
;

-- ---- public.order_items ----
CREATE POLICY "order_items_insert" ON public.order_items
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK ((EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid())))))
;
CREATE POLICY "order_items_own" ON public.order_items
    AS PERMISSIVE FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.id = order_items.order_id) AND ((orders.user_id = auth.uid()) OR is_admin())))))
;

-- ---- public.order_status_history ----
CREATE POLICY "order_history_admin_insert" ON public.order_status_history
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (is_admin())
;
CREATE POLICY "order_history_own" ON public.order_status_history
    AS PERMISSIVE FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.id = order_status_history.order_id) AND ((orders.user_id = auth.uid()) OR is_admin())))))
;

-- ---- public.orders ----
CREATE POLICY "orders_admin_update" ON public.orders
    AS PERMISSIVE FOR UPDATE TO public
    USING (is_admin())
;
CREATE POLICY "orders_own_insert" ON public.orders
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK ((auth.uid() = user_id))
;
CREATE POLICY "orders_own_read" ON public.orders
    AS PERMISSIVE FOR SELECT TO public
    USING (((auth.uid() = user_id) OR is_admin()))
;

-- ---- public.product_attribute_values ----
CREATE POLICY "pav_admin_all" ON public.product_attribute_values
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "pav_public_read" ON public.product_attribute_values
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.product_compatibility ----
CREATE POLICY "compat_admin_all" ON public.product_compatibility
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "compat_public_read" ON public.product_compatibility
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.product_images ----
CREATE POLICY "product_images_admin_all" ON public.product_images
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "product_images_public_read" ON public.product_images
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.product_tags ----
CREATE POLICY "product_tags_admin_all" ON public.product_tags
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "product_tags_public_read" ON public.product_tags
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.product_variants ----
CREATE POLICY "product_variants_admin_all" ON public.product_variants
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "product_variants_public_read" ON public.product_variants
    AS PERMISSIVE FOR SELECT TO public
    USING ((is_active = true))
;

-- ---- public.products ----
CREATE POLICY "products_admin_all" ON public.products
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "products_public_read" ON public.products
    AS PERMISSIVE FOR SELECT TO public
    USING (((is_active = true) AND (deleted_at IS NULL)))
;

-- ---- public.profiles ----
CREATE POLICY "profiles_admin_all" ON public.profiles
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "profiles_select_own" ON public.profiles
    AS PERMISSIVE FOR SELECT TO public
    USING (((auth.uid() = id) OR is_admin()))
;
CREATE POLICY "profiles_update_own" ON public.profiles
    AS PERMISSIVE FOR UPDATE TO public
    USING ((auth.uid() = id))
    WITH CHECK (((auth.uid() = id) AND (role = 'customer'::text)))
;

-- ---- public.recently_viewed ----
CREATE POLICY "recently_viewed_own" ON public.recently_viewed
    AS PERMISSIVE FOR ALL TO public
    USING (((auth.uid() = user_id) OR (session_id IS NOT NULL)))
;

-- ---- public.review_images ----
CREATE POLICY "review_images_admin_all" ON public.review_images
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "review_images_own" ON public.review_images
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK ((EXISTS ( SELECT 1
   FROM reviews
  WHERE ((reviews.id = review_images.review_id) AND (reviews.user_id = auth.uid())))))
;
CREATE POLICY "review_images_public_read" ON public.review_images
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.review_votes ----
CREATE POLICY "review_votes_own" ON public.review_votes
    AS PERMISSIVE FOR ALL TO public
    USING ((auth.uid() = user_id))
;

-- ---- public.reviews ----
CREATE POLICY "reviews_admin_all" ON public.reviews
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "reviews_own_insert" ON public.reviews
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK ((auth.uid() = user_id))
;
CREATE POLICY "reviews_own_update" ON public.reviews
    AS PERMISSIVE FOR UPDATE TO public
    USING (((auth.uid() = user_id) AND (moderation_status = 'pending'::text)))
;
CREATE POLICY "reviews_public_read" ON public.reviews
    AS PERMISSIVE FOR SELECT TO public
    USING ((moderation_status = 'approved'::text))
;

-- ---- public.slug_redirects ----
CREATE POLICY "slug_redirects_admin_all" ON public.slug_redirects
    AS PERMISSIVE FOR ALL TO public
    USING (is_admin())
;
CREATE POLICY "slug_redirects_public_read" ON public.slug_redirects
    AS PERMISSIVE FOR SELECT TO public
    USING (true)
;

-- ---- public.wishlists ----
CREATE POLICY "wishlists_own" ON public.wishlists
    AS PERMISSIVE FOR ALL TO public
    USING ((auth.uid() = user_id))
;

-- ---- storage.objects ----
CREATE POLICY "Admin CRUD Access" ON storage.objects
    AS PERMISSIVE FOR ALL TO authenticated
    USING (((bucket_id = 'products'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::text) OR (profiles.role = 'super_admin'::text)))))))
;
CREATE POLICY "Admin Insert Blog" ON storage.objects
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (((bucket_id = 'blog'::text) AND is_admin()))
;
CREATE POLICY "Admin Insert Products" ON storage.objects
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (((bucket_id = 'products'::text) AND is_admin()))
;
CREATE POLICY "Public Read Access" ON storage.objects
    AS PERMISSIVE FOR SELECT TO public
    USING ((bucket_id = 'products'::text))
;
CREATE POLICY "Users Insert Avatars" ON storage.objects
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])))
;
CREATE POLICY "Users Insert Reviews" ON storage.objects
    AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (((bucket_id = 'reviews'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])))
;
