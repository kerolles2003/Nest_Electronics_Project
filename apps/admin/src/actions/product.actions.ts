'use server'

import { createClient } from '@/lib/supabase'
import { productSchema } from '@nest/types'
import { requireAdminActor } from '@/lib/api/identity'
import { logAdminAction } from '@/lib/audit/log-action'
import { validateUpload, generateStoragePath } from '@/lib/upload/validate-upload'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'

export type CreateProductResponse = { success: boolean; productId?: string; error?: string }

function parseProductFormData(formData: FormData) {
  return {
    sku: formData.get('sku') as string,
    name_en: formData.get('name_en') as string,
    name_ar: (formData.get('name_ar') as string) || undefined,
    slug: formData.get('slug') as string,
    description_en: (formData.get('description_en') as string) || undefined,
    description_ar: (formData.get('description_ar') as string) || undefined,
    category_id: (formData.get('category_id') as string) || undefined,
    brand_id: (formData.get('brand_id') as string) || undefined,
    base_price: parseFloat(formData.get('base_price') as string),
    sale_price: formData.get('sale_price') ? parseFloat(formData.get('sale_price') as string) : undefined,
    cost_price: formData.get('cost_price') ? parseFloat(formData.get('cost_price') as string) : undefined,
    stock_quantity: parseInt(formData.get('stock_quantity') as string, 10),
    low_stock_threshold: formData.get('low_stock_threshold') ? parseInt(formData.get('low_stock_threshold') as string, 10) : 5,
    weight: formData.get('weight') ? parseFloat(formData.get('weight') as string) : undefined,
    dimensions: (formData.get('dimensions') as string) || undefined,
    is_active: formData.has('is_active'),
    is_featured: formData.has('is_featured'),
    seo_title: (formData.get('seo_title') as string) || undefined,
    seo_description: (formData.get('seo_description') as string) || undefined,
  }
}

export async function createProductAction(formData: FormData): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  const raw = parseProductFormData(formData)
  const parsed = productSchema.safeParse(raw)

  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    // 1. Create product
    const { data: product, error: productError } = await (supabase as any)
      .from('products')
      .insert(parsed.data)
      .select('id')
      .single()

    if (productError || !product) {
      return { success: false, error: productError?.message ?? 'Failed to create product' }
    }

    // 2. Handle Image Uploads
    const imageFiles = formData.getAll('images') as File[]
    if (imageFiles.length > 0 && imageFiles[0].size > 0) {
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i]
        if (file.size === 0) continue

        const validation = validateUpload(file)
        if (!validation.safe) {
          logger.warn('Upload validation failed', validation.error)
          continue
        }

        const storagePath = generateStoragePath(product.id, validation.sanitizedName!)

        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(storagePath, file)

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('products')
            .getPublicUrl(storagePath)

          await (supabase as any).from('product_images').insert({
            product_id: product.id,
            url: publicUrl,
            sort_order: i,
            is_primary: i === 0,
          })
        }
      }
    }

    // 3. Handle Attribute Values
    const attrValuesJson = formData.get('attribute_values') as string
    if (attrValuesJson) {
      try {
        const attrValues = JSON.parse(attrValuesJson) as Array<{
          attribute_id: string
          attribute_value_id: string | null
          custom_value: string | null
        }>
        const inserts = attrValues
          .filter((av) => av.attribute_value_id || av.custom_value)
          .map((av) => ({
            product_id: product.id,
            attribute_id: av.attribute_id,
            attribute_value_id: av.attribute_value_id,
            custom_value: av.custom_value,
          }))
        if (inserts.length > 0) {
          await (supabase as any).from('product_attribute_values').insert(inserts)
        }
      } catch {
        logger.warn('Failed to parse attribute_values on create')
      }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'product:create',
      entityType: 'product',
      entityId: product.id,
      changes: parsed.data,
    })

    revalidatePath('/admin/products')
    logger.info(`Product created: id=${product.id} by=${admin.id}`)
    return { success: true, productId: product.id }
  } catch (e: any) {
    logger.error('createProductAction failed', e)
    return { success: false, error: e.message || 'Internal server error' }
  }
}

export async function updateProductAction(formData: FormData): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  const productId = formData.get('id') as string
  if (!productId) return { success: false, error: 'Product ID is required' }

  const raw = parseProductFormData(formData)
  const parsed = productSchema.safeParse(raw)

  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    return { success: false, error: messages }
  }

  try {
    // 1. Update product
    const { error: updateError } = await (supabase as any)
      .from('products')
      .update(parsed.data)
      .eq('id', productId)

    if (updateError) return { success: false, error: updateError.message }

    // 2. Handle New Images
    const imageFiles = formData.getAll('images') as File[]
    if (imageFiles.length > 0 && imageFiles[0].size > 0) {
      const { data: currentImages } = await (supabase as any)
        .from('product_images')
        .select('sort_order')
        .eq('product_id', productId)
        .order('sort_order', { ascending: false })
        .limit(1)

      let nextSortOrder = (currentImages?.[0]?.sort_order ?? -1) + 1
      const hasExistingImages = (currentImages?.length ?? 0) > 0

      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i]
        if (file.size === 0) continue

        const validation = validateUpload(file)
        if (!validation.safe) {
          logger.warn('Upload validation failed', validation.error)
          continue
        }

        const storagePath = generateStoragePath(productId, validation.sanitizedName!)

        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(storagePath, file)

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('products')
            .getPublicUrl(storagePath)

          const sortOrder = nextSortOrder++
          await (supabase as any).from('product_images').insert({
            product_id: productId,
            url: publicUrl,
            sort_order: sortOrder,
            is_primary: !hasExistingImages && i === 0,
          })
        }
      }
    }

    // 3. Handle Attribute Values
    const attrValuesJson = formData.get('attribute_values') as string
    if (attrValuesJson) {
      try {
        const attrValues = JSON.parse(attrValuesJson) as Array<{
          attribute_id: string
          attribute_value_id: string | null
          custom_value: string | null
        }>
        // Delete existing attribute values for this product
        await (supabase as any)
          .from('product_attribute_values')
          .delete()
          .eq('product_id', productId)

        // Insert new ones
        const inserts = attrValues
          .filter((av) => av.attribute_value_id || av.custom_value)
          .map((av) => ({
            product_id: productId,
            attribute_id: av.attribute_id,
            attribute_value_id: av.attribute_value_id,
            custom_value: av.custom_value,
          }))

        if (inserts.length > 0) {
          await (supabase as any).from('product_attribute_values').insert(inserts)
        }
      } catch {
        logger.warn('Failed to parse attribute_values')
      }
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'product:update',
      entityType: 'product',
      entityId: productId,
      changes: parsed.data,
    })

    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/${productId}`)
    logger.info(`Product updated: id=${productId} by=${admin.id}`)
    return { success: true, productId }
  } catch (e: any) {
    logger.error('updateProductAction failed', e)
    return { success: false, error: e.message || 'Internal server error' }
  }
}

export async function deleteProductImageAction(imageId: string, productPath: string) {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    const { data: image } = await (supabase as any)
      .from('product_images')
      .select('url, product_id')
      .eq('id', imageId)
      .single()

    if (!image) return { success: false, error: 'Image not found' }

    const path = image.url.split('/products/')[1]
    if (path) {
      await supabase.storage.from('products').remove([path])
    }

    await (supabase as any).from('product_images').delete().eq('id', imageId)

    await logAdminAction({
      adminId: admin.id,
      action: 'product:image_delete',
      entityType: 'product',
      entityId: image.product_id,
      changes: { image_id: imageId },
    })

    revalidatePath(productPath)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function softDeleteProductAction(productId: string): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    const { error } = await (supabase as any)
      .from('products')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', productId)

    if (error) return { success: false, error: error.message }

    await logAdminAction({
      adminId: admin.id,
      action: 'product:delete',
      entityType: 'product',
      entityId: productId,
    })

    revalidatePath('/admin/products')
    return { success: true, productId }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function toggleProductStatusAction(productId: string, isActive: boolean): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    const { error } = await (supabase as any)
      .from('products')
      .update({ is_active: isActive })
      .eq('id', productId)

    if (error) return { success: false, error: error.message }

    await logAdminAction({
      adminId: admin.id,
      action: 'product:status_toggle',
      entityType: 'product',
      entityId: productId,
      changes: { is_active: isActive },
    })

    revalidatePath('/admin/products')
    return { success: true, productId }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function reorderProductImagesAction(
  productId: string,
  imageOrders: { imageId: string; sortOrder: number }[]
): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    for (const { imageId, sortOrder } of imageOrders) {
      await (supabase as any)
        .from('product_images')
        .update({ sort_order: sortOrder })
        .eq('id', imageId)
        .eq('product_id', productId)
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'product:image_reorder',
      entityType: 'product',
      entityId: productId,
      changes: { image_orders: imageOrders },
    })

    revalidatePath(`/admin/products/${productId}/edit`)
    return { success: true, productId }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function setPrimaryImageAction(
  productId: string,
  imageId: string
): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    // Unset all primary for this product
    await (supabase as any)
      .from('product_images')
      .update({ is_primary: false })
      .eq('product_id', productId)

    // Set selected as primary
    await (supabase as any)
      .from('product_images')
      .update({ is_primary: true })
      .eq('id', imageId)
      .eq('product_id', productId)

    await logAdminAction({
      adminId: admin.id,
      action: 'product:image_primary',
      entityType: 'product',
      entityId: productId,
      changes: { primary_image_id: imageId },
    })

    revalidatePath(`/admin/products/${productId}/edit`)
    return { success: true, productId }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function duplicateProductAction(productId: string): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    // 1. Fetch original product
    const { data: original } = await (supabase as any)
      .from('products')
      .select('*')
      .eq('id', productId)
      .single()

    if (!original) return { success: false, error: 'Product not found' }

    // 2. Generate unique slug and SKU
    const timestamp = Date.now().toString(36).slice(-4)
    const newSlug = `${original.slug}-copy-${timestamp}`
    const newSku = `${original.sku}-COPY-${timestamp.toUpperCase()}`

    // 3. Create new product (inactive by default)
    const { data: newProduct, error: createError } = await (supabase as any)
      .from('products')
      .insert({
        sku: newSku,
        name_en: `Copy of ${original.name_en}`,
        name_ar: original.name_ar,
        slug: newSlug,
        description_en: original.description_en,
        description_ar: original.description_ar,
        category_id: original.category_id,
        brand_id: original.brand_id,
        base_price: original.base_price,
        sale_price: original.sale_price,
        cost_price: original.cost_price,
        stock_quantity: original.stock_quantity,
        low_stock_threshold: original.low_stock_threshold,
        weight: original.weight,
        dimensions: original.dimensions,
        is_active: false,
        is_featured: false,
        seo_title: original.seo_title,
        seo_description: original.seo_description,
      })
      .select('id')
      .single()

    if (createError || !newProduct) {
      return { success: false, error: createError?.message ?? 'Failed to duplicate product' }
    }

    // 4. Copy images
    const { data: images } = await (supabase as any)
      .from('product_images')
      .select('*')
      .eq('product_id', productId)
      .order('sort_order', { ascending: true })

    if (images && images.length > 0) {
      const imageInserts = images.map((img: any, idx: number) => ({
        product_id: newProduct.id,
        url: img.url,
        sort_order: idx,
        is_primary: idx === 0,
        alt_text: img.alt_text,
      }))
      await (supabase as any).from('product_images').insert(imageInserts)
    }

    // 5. Copy attribute values
    const { data: attrValues } = await (supabase as any)
      .from('product_attribute_values')
      .select('*')
      .eq('product_id', productId)

    if (attrValues && attrValues.length > 0) {
      const attrInserts = attrValues.map((av: any) => ({
        product_id: newProduct.id,
        attribute_id: av.attribute_id,
        attribute_value_id: av.attribute_value_id,
        custom_value: av.custom_value,
      }))
      await (supabase as any).from('product_attribute_values').insert(attrInserts)
    }

    await logAdminAction({
      adminId: admin.id,
      action: 'product:duplicate',
      entityType: 'product',
      entityId: newProduct.id,
      changes: { original_id: productId },
    })

    revalidatePath('/admin/products')
    return { success: true, productId: newProduct.id }
  } catch (e: any) {
    logger.error('duplicateProductAction failed', e)
    return { success: false, error: e.message || 'Internal server error' }
  }
}

export async function createSlugRedirectAction(
  oldSlug: string,
  newSlug: string,
  entityType: string = 'product'
): Promise<CreateProductResponse> {
  const admin = await requireAdminActor()
  const supabase = await createClient()

  try {
    if (!oldSlug || !newSlug || oldSlug === newSlug) {
      return { success: false, error: 'Invalid slug redirect' }
    }

    await (supabase as any).from('slug_redirects').insert({
      old_slug: oldSlug,
      new_slug: newSlug,
      entity_type: entityType,
    })

    await logAdminAction({
      adminId: admin.id,
      action: 'slug_redirect:create',
      entityType,
      entityId: oldSlug,
      changes: { old_slug: oldSlug, new_slug: newSlug },
    })

    return { success: true }
  } catch (e: any) {
    logger.error('createSlugRedirectAction failed', e)
    return { success: false, error: e.message || 'Internal server error' }
  }
}
