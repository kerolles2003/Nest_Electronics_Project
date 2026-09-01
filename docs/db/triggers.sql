-- TRIGGERS
-- Extracted READ-ONLY from the live Supabase project (ref: quhllllvwwuizjfrxvdz)
-- PostgreSQL 17.6 | Extraction date: 2026-08-29 | Phase 0.5 forensic audit
-- Method: catalog queries inside BEGIN TRANSACTION READ ONLY (always rolled back).
-- This file is a faithful REPRESENTATION for migration reference. It is NOT a migration script.
-- DO NOT execute against any database.

-- 10 non-internal triggers across public/auth/storage.
-- NOTE: there is NO rating-rollup trigger, NO inventory trigger, NO audit trigger.

-- [auth.users] on_auth_user_created  (AFTER INSERT) -> handle_new_user()  enabled=O
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- [public.blog_posts] set_updated_at_blog_posts  (BEFORE UPDATE) -> handle_updated_at()  enabled=O
CREATE TRIGGER set_updated_at_blog_posts BEFORE UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- [public.carts] set_updated_at_carts  (BEFORE UPDATE) -> handle_updated_at()  enabled=O
CREATE TRIGGER set_updated_at_carts BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- [public.orders] set_updated_at_orders  (BEFORE UPDATE) -> handle_updated_at()  enabled=O
CREATE TRIGGER set_updated_at_orders BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- [public.products] set_updated_at_products  (BEFORE UPDATE) -> handle_updated_at()  enabled=O
CREATE TRIGGER set_updated_at_products BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- [public.profiles] set_updated_at_profiles  (BEFORE UPDATE) -> handle_updated_at()  enabled=O
CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- [storage.buckets] enforce_bucket_name_length_trigger  (BEFORE INSERT) -> enforce_bucket_name_length()  enabled=O
CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();

-- [storage.buckets] protect_buckets_delete  (BEFORE DELETE) -> protect_delete()  enabled=O
CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

-- [storage.objects] protect_objects_delete  (BEFORE DELETE) -> protect_delete()  enabled=O
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

-- [storage.objects] update_objects_updated_at  (BEFORE UPDATE) -> update_updated_at_column()  enabled=O
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


-- ============ TRIGGER FUNCTIONS (public) ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

