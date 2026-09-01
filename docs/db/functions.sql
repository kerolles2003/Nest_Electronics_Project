-- DATABASE FUNCTIONS — public schema (custom application logic)
-- Extracted READ-ONLY from the live Supabase project (ref: quhllllvwwuizjfrxvdz)
-- PostgreSQL 17.6 | Extraction date: 2026-08-29 | Phase 0.5 forensic audit
-- Method: catalog queries inside BEGIN TRANSACTION READ ONLY (always rolled back).
-- This file is a faithful REPRESENTATION for migration reference. It is NOT a migration script.
-- DO NOT execute against any database.

-- 10 custom functions in public.
-- SECURITY DEFINER functions run as the function OWNER and BYPASS Row Level Security.

-- ============================================================================
-- create_order_v2
-- SECURITY DEFINER: true | EXECUTE ACL: =X/postgres ; postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order_v2(p_user_id uuid, p_items jsonb, p_shipping_address jsonb, p_payment_method text, p_shipping_fee numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order_id UUID;
  v_item RECORD;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC := 0;
  v_product_price NUMERIC;
  v_product_name TEXT;
  v_product_sku TEXT;
  v_order_number TEXT;
BEGIN
  -- Generate order number
  v_order_number := public.generate_order_number();

  -- 1. Create the order with placeholder totals
  INSERT INTO public.orders (
    user_id,
    order_number,
    shipping_address,
    payment_method,
    subtotal,
    shipping_fee,
    total,
    order_status,
    payment_status,
    fulfillment_status
  ) VALUES (
    p_user_id,
    v_order_number,
    p_shipping_address,
    p_payment_method,
    0,
    p_shipping_fee,
    0,
    'processing',
    'pending',
    'unfulfilled'
  ) RETURNING id INTO v_order_id;

  -- 2. Process items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, 
    variant_id UUID, 
    quantity INT
  ) LOOP
    -- Fetch details from DB to ensure integrity
    IF v_item.variant_id IS NOT NULL THEN
      SELECT 
        (p.base_price + COALESCE(pv.price_modifier, 0)), 
        p.name_en, 
        pv.sku 
      INTO v_product_price, v_product_name, v_product_sku
      FROM public.products p
      JOIN public.product_variants pv ON pv.product_id = p.id
      WHERE pv.id = v_item.variant_id;

      IF v_product_price IS NULL THEN
        RAISE EXCEPTION 'Variant not found';
      END IF;

      -- Update variant stock
      UPDATE public.product_variants
      SET stock_quantity = stock_quantity - v_item.quantity
      WHERE id = v_item.variant_id AND stock_quantity >= v_item.quantity;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for variant %', v_product_sku;
      END IF;
    ELSE
      SELECT 
        COALESCE(sale_price, base_price), 
        name_en, 
        sku 
      INTO v_product_price, v_product_name, v_product_sku
      FROM public.products
      WHERE id = v_item.product_id;

      IF v_product_price IS NULL THEN
        RAISE EXCEPTION 'Product not found';
      END IF;

      -- Update product stock
      UPDATE public.products
      SET stock_quantity = stock_quantity - v_item.quantity
      WHERE id = v_item.product_id AND stock_quantity >= v_item.quantity;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_product_sku;
      END IF;
    END IF;

    -- Accumulate subtotal
    v_subtotal := v_subtotal + (v_product_price * v_item.quantity);

    -- Insert order item
    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      name,
      sku,
      price,
      quantity,
      total
    ) VALUES (
      v_order_id,
      v_item.product_id,
      v_item.variant_id,
      v_product_name,
      v_product_sku,
      v_product_price,
      v_item.quantity,
      v_product_price * v_item.quantity
    );

    -- Log inventory transaction
    INSERT INTO public.inventory_transactions (
      product_id,
      variant_id,
      type,
      quantity,
      reference_type,
      reference_id,
      notes
    ) VALUES (
      v_item.product_id,
      v_item.variant_id,
      'sale',
      -v_item.quantity,
      'order',
      v_order_id,
      'Order checkout'
    );
  END LOOP;

  -- 3. Update order totals
  v_total := v_subtotal + p_shipping_fee;
  UPDATE public.orders
  SET subtotal = v_subtotal, total = v_total
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number
  );
END;
$function$
;

-- ============================================================================
-- update_order_status_v2
-- SECURITY DEFINER: true | EXECUTE ACL: =X/postgres ; postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_order_status_v2(p_order_id uuid, p_field text, p_new_value text, p_admin_id uuid, p_notes text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_old_value TEXT;
  v_current_order RECORD;
BEGIN
  -- Get current order and lock row
  SELECT * INTO v_current_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  -- Determine old value based on field
  CASE p_field
    WHEN 'order_status' THEN v_old_value := v_current_order.order_status;
    WHEN 'payment_status' THEN v_old_value := v_current_order.payment_status;
    WHEN 'fulfillment_status' THEN v_old_value := v_current_order.fulfillment_status;
    ELSE RETURN jsonb_build_object('success', false, 'error', 'Invalid field');
  END CASE;

  -- Update order
  EXECUTE format('UPDATE orders SET %I = $1, updated_at = NOW() %s WHERE id = $2', 
    p_field, 
    CASE WHEN p_tracking_number IS NOT NULL THEN ', tracking_number = $3' ELSE '' END
  )
  USING p_new_value, p_order_id, p_tracking_number;

  -- Log history
  INSERT INTO order_status_history (
    order_id,
    field,
    from_value,
    to_value,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    p_field,
    v_old_value,
    p_new_value,
    p_admin_id,
    p_notes
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

-- ============================================================================
-- adjust_stock_v2
-- SECURITY DEFINER: true | EXECUTE ACL: =X/postgres ; postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.adjust_stock_v2(p_product_id uuid, p_quantity integer, p_reason text, p_admin_id uuid, p_reference_type text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_result JSONB;
BEGIN
  -- Get current stock and lock row
  SELECT stock_quantity INTO v_current_stock
  FROM products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;

  v_new_stock := v_current_stock + p_quantity;

  IF v_new_stock < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Stock cannot go below 0');
  END IF;

  -- Update product stock
  UPDATE products
  SET 
    stock_quantity = v_new_stock,
    updated_at = NOW()
  WHERE id = p_product_id;

  -- Log transaction
  INSERT INTO inventory_transactions (
    product_id,
    type,
    quantity,
    notes,
    created_by,
    reference_type
  ) VALUES (
    p_product_id,
    'adjustment',
    p_quantity,
    p_reason,
    p_admin_id,
    p_reference_type
  );

  RETURN jsonb_build_object(
    'success', true,
    'newStock', v_new_stock
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

-- ============================================================================
-- create_order_v1
-- SECURITY DEFINER: true | EXECUTE ACL: =X/postgres ; postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order_v1(p_user_id uuid, p_items jsonb, p_shipping_address jsonb, p_payment_method text, p_subtotal numeric, p_shipping_fee numeric, p_total numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order_id UUID;
  v_item RECORD;
BEGIN
  -- 1. Create the order
  INSERT INTO public.orders (
    user_id,
    shipping_address,
    payment_method,
    subtotal,
    shipping_fee,
    total,
    order_status,
    payment_status,
    fulfillment_status
  ) VALUES (
    p_user_id,
    p_shipping_address,
    p_payment_method,
    p_subtotal,
    p_shipping_fee,
    p_total,
    'processing',
    'pending',
    'unfulfilled'
  ) RETURNING id INTO v_order_id;

  -- 2. Process items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, 
    variant_id UUID, 
    quantity INT, 
    price NUMERIC, 
    name TEXT, 
    sku TEXT
  ) LOOP
    -- Check and update stock
    -- We deduct from stock_quantity directly for a finalized order
    IF v_item.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock_quantity = stock_quantity - v_item.quantity
      WHERE id = v_item.variant_id AND stock_quantity >= v_item.quantity;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for variant %', v_item.sku;
      END IF;
    ELSE
      UPDATE public.products
      SET stock_quantity = stock_quantity - v_item.quantity
      WHERE id = v_item.product_id AND stock_quantity >= v_item.quantity;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_item.sku;
      END IF;
    END IF;

    -- Insert order item
    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      name,
      sku,
      price,
      quantity,
      total
    ) VALUES (
      v_order_id,
      v_item.product_id,
      v_item.variant_id,
      v_item.name,
      v_item.sku,
      v_item.price,
      v_item.quantity,
      v_item.price * v_item.quantity
    );

    -- Log inventory transaction
    INSERT INTO public.inventory_transactions (
      product_id,
      variant_id,
      type,
      quantity,
      reference_type,
      reference_id,
      notes
    ) VALUES (
      v_item.product_id,
      v_item.variant_id,
      'sale',
      -v_item.quantity,
      'order',
      v_order_id,
      'Order checkout'
    );
  END LOOP;

  RETURN v_order_id;
END;
$function$
;

-- ============================================================================
-- generate_order_number
-- SECURITY DEFINER: false | EXECUTE ACL: =X/postgres ; postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_order_number()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT 'NE-' || to_char(now(), 'YYYYMMDD') || '-' ||
         lpad(nextval('order_number_seq')::text, 4, '0');
$function$
;

-- ============================================================================
-- search_products
-- SECURITY DEFINER: false | EXECUTE ACL: =X/postgres ; postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_products(search_query text, category_slug text DEFAULT NULL::text, brand_slug text DEFAULT NULL::text, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, in_stock_only boolean DEFAULT false, result_limit integer DEFAULT 24, result_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, sku text, name_en text, slug text, base_price numeric, sale_price numeric, stock_quantity integer, reserved_quantity integer, is_featured boolean, category_id uuid, brand_id uuid, rank real)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.sku, p.name_en, p.slug,
    p.base_price, p.sale_price,
    p.stock_quantity, p.reserved_quantity,
    p.is_featured, p.category_id, p.brand_id,
    ts_rank(
      to_tsvector('english', p.name_en || ' ' || COALESCE(p.description_en, '')),
      plainto_tsquery('english', search_query)
    ) AS rank
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE
    p.is_active = true
    AND p.deleted_at IS NULL
    AND (
      search_query IS NULL OR search_query = ''
      OR to_tsvector('english', p.name_en || ' ' || COALESCE(p.description_en, ''))
         @@ plainto_tsquery('english', search_query)
      OR p.sku ILIKE '%' || search_query || '%'
      OR p.name_en ILIKE '%' || search_query || '%'
    )
    AND (category_slug IS NULL OR c.slug = category_slug)
    AND (brand_slug IS NULL OR b.slug = brand_slug)
    AND (min_price IS NULL OR COALESCE(p.sale_price, p.base_price) >= min_price)
    AND (max_price IS NULL OR COALESCE(p.sale_price, p.base_price) <= max_price)
    AND (NOT in_stock_only OR (p.stock_quantity - p.reserved_quantity) > 0)
  ORDER BY rank DESC, p.is_featured DESC, p.created_at DESC
  LIMIT result_limit
  OFFSET result_offset;
END;
$function$
;

-- ============================================================================
-- is_admin
-- SECURITY DEFINER: true | EXECUTE ACL: =X/postgres ; postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  );
$function$
;

-- ============================================================================
-- handle_new_user
-- SECURITY DEFINER: true | EXECUTE ACL: postgres=X/postgres ; service_role=X/postgres
-- ============================================================================
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

-- ============================================================================
-- handle_updated_at
-- SECURITY DEFINER: false | EXECUTE ACL: postgres=X/postgres ; service_role=X/postgres
-- ============================================================================
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

-- ============================================================================
-- release_expired_reservations
-- SECURITY DEFINER: true | EXECUTE ACL: postgres=X/postgres ; service_role=X/postgres
-- ============================================================================
CREATE OR REPLACE FUNCTION public.release_expired_reservations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  expired_order RECORD;
BEGIN
  FOR expired_order IN
    SELECT id FROM orders
    WHERE order_status = 'pending_payment'
    AND created_at < now() - interval '30 minutes'
  LOOP
    -- Release reserved_quantity on products
    UPDATE products p
    SET reserved_quantity = GREATEST(0, reserved_quantity - oi.total_qty)
    FROM (
      SELECT product_id, SUM(quantity) as total_qty
      FROM order_items
      WHERE order_id = expired_order.id
      GROUP BY product_id
    ) oi
    WHERE p.id = oi.product_id;

    -- Log the release in inventory_transactions
    INSERT INTO inventory_transactions (product_id, type, quantity, reference_type, reference_id, notes)
    SELECT oi.product_id, 'reservation_release', oi.quantity, 'order', expired_order.id,
           'Auto-released: order expired after 30 minutes'
    FROM order_items oi
    WHERE oi.order_id = expired_order.id;

    -- Fail the order
    UPDATE orders
    SET order_status = 'failed',
        payment_status = 'failed',
        updated_at = now()
    WHERE id = expired_order.id;
  END LOOP;
END;
$function$
;

